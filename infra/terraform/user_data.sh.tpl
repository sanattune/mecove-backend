#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/user-data.log) 2>&1

echo "=== [1/11] System packages ==="
dnf update -y
dnf install -y git jq curl-minimal redis6 amazon-cloudwatch-agent \
  alsa-lib atk cups-libs gtk3 mesa-libgbm nss pango \
  libXcomposite libXcursor libXdamage libXext libXi libXrandr libXScrnSaver libXtst \
  xorg-x11-fonts-Type1 xorg-x11-fonts-misc fontconfig freetype

# Fonts (best-effort; package name varies by repo)
dnf install -y liberation-fonts || dnf install -y fonts-liberation || true

systemctl enable redis6 --now

echo "=== [2/11] Node.js 20 + pnpm + PM2 ==="
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

corepack enable
npm install -g pm2

echo "=== [3/11] Caddy ==="
dnf install -y ca-certificates tar

# Install Caddy (static binary) for Linux ARM64
# (Use official download endpoint; GitHub "latest" asset names vary.)
curl -fsSL -o /usr/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=arm64"
chmod 0755 /usr/bin/caddy

getent group caddy >/dev/null || groupadd --system caddy
id -u caddy >/dev/null 2>&1 || useradd --system --gid caddy --home-dir /var/lib/caddy --shell /usr/sbin/nologin caddy

mkdir -p /etc/caddy /var/lib/caddy /var/log/caddy
chown -R caddy:caddy /var/lib/caddy /var/log/caddy

cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
Restart=on-failure

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload

cat > /etc/caddy/Caddyfile <<'CADDY'
${api_domain} {
    reverse_proxy localhost:3000
    log {
        output file /var/log/caddy/access.log {
            roll_size 10mb
            roll_keep 5
        }
    }
}
CADDY

systemctl enable caddy --now

echo "=== [4/11] App user ==="
useradd -m -s /bin/bash mecove

echo "=== [5/11] GitHub deploy key ==="
mkdir -p /home/mecove/.ssh
chmod 700 /home/mecove/.ssh

aws secretsmanager get-secret-value \
  --secret-id "${github_deploy_key_secret_arn}" \
  --region "${aws_region}" \
  --query SecretString --output text \
  > /home/mecove/.ssh/id_ed25519

chmod 600 /home/mecove/.ssh/id_ed25519
chown -R mecove:mecove /home/mecove/.ssh

cat > /home/mecove/.ssh/config <<'SSHCFG'
Host github.com
  IdentityFile ~/.ssh/id_ed25519
  StrictHostKeyChecking accept-new
SSHCFG
chmod 600 /home/mecove/.ssh/config
chown mecove:mecove /home/mecove/.ssh/config

echo "=== [6/11] Clone repo ==="
sudo -u mecove git clone -b "${github_branch}" "${github_repo}" /home/mecove/app

echo "=== [7/11] load-env.sh ==="
cat > /home/mecove/load-env.sh <<'LOADENV'
#!/bin/bash
set -euo pipefail

REGION="${aws_region}"

# Fetch DB credentials
DB_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "${db_master_secret_arn}" \
  --region "$REGION" \
  --query SecretString --output text)

DB_USER=$(echo "$DB_SECRET" | jq -r '.username')
DB_PASSWORD=$(echo "$DB_SECRET" | jq -r '.password')

# Fetch app secrets
APP_SECRET=$(aws secretsmanager get-secret-value \
  --secret-id "${app_secrets_arn}" \
  --region "$REGION" \
  --query SecretString --output text)

# Write .env
cat > /home/mecove/app/.env <<EOF
# Database
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@${db_host}:${db_port}/${db_name}?sslmode=require
DB_HOST=${db_host}
DB_PORT=${db_port}
DB_NAME=${db_name}
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_SSLMODE=require
DB_USELIBPQCOMPAT=true

# Redis (local)
REDIS_URL=redis://localhost:6379

# Puppeteer
# Leave Puppeteer defaults so it can use its bundled Chromium.

# Consent
CONSENT_CONFIG_PATH=consent.config.yaml

# App secrets (from Secrets Manager)
$(echo "$APP_SECRET" | jq -r 'to_entries[] | "\(.key)=\(.value)"')
EOF

chmod 600 /home/mecove/app/.env
LOADENV
chmod +x /home/mecove/load-env.sh
chown mecove:mecove /home/mecove/load-env.sh

echo "=== [8/11] Install + build ==="
cd /home/mecove/app
sudo -u mecove bash -c 'cd /home/mecove/app && pnpm install --frozen-lockfile --ignore-scripts=false && pnpm exec prisma generate && pnpm build'

echo "=== [9/11] Load env + Prisma migrate ==="
sudo -u mecove /home/mecove/load-env.sh
sudo -u mecove bash -c 'cd /home/mecove/app && npx prisma migrate deploy'

echo "=== [10/11] PM2 ecosystem ==="
cat > /home/mecove/ecosystem.config.cjs <<'PM2CFG'
module.exports = {
  apps: [
    {
      name: "api",
      cwd: "/home/mecove/app",
      script: "dist/api/server.js",
      node_args: "--enable-source-maps",
      env: {
        NODE_ENV: "production",
      },
      error_file: "/home/mecove/logs/api-err.log",
      out_file: "/home/mecove/logs/api-out.log",
      merge_logs: true,
    },
    {
      name: "worker",
      cwd: "/home/mecove/app",
      script: "dist/worker/worker.js",
      node_args: "--enable-source-maps",
      env: {
        NODE_ENV: "production",
      },
      error_file: "/home/mecove/logs/worker-err.log",
      out_file: "/home/mecove/logs/worker-out.log",
      merge_logs: true,
    },
  ],
};
PM2CFG
chown mecove:mecove /home/mecove/ecosystem.config.cjs

mkdir -p /home/mecove/logs
chown mecove:mecove /home/mecove/logs

# Source .env for PM2 processes
sudo -u mecove bash -c '
  set -a
  source /home/mecove/app/.env
  set +a
  cd /home/mecove
  pm2 start ecosystem.config.cjs
  pm2 save
'

# PM2 startup hook (runs as mecove)
env PATH=$PATH:/usr/bin pm2 startup systemd -u mecove --hp /home/mecove

echo "=== [11/11] CloudWatch Agent ==="
cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json <<CWCFG
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/home/mecove/logs/api-out.log",
            "log_group_name": "${log_group_api}",
            "log_stream_name": "{instance_id}/api-out"
          },
          {
            "file_path": "/home/mecove/logs/api-err.log",
            "log_group_name": "${log_group_api}",
            "log_stream_name": "{instance_id}/api-err"
          },
          {
            "file_path": "/home/mecove/logs/worker-out.log",
            "log_group_name": "${log_group_worker}",
            "log_stream_name": "{instance_id}/worker-out"
          },
          {
            "file_path": "/home/mecove/logs/worker-err.log",
            "log_group_name": "${log_group_worker}",
            "log_stream_name": "{instance_id}/worker-err"
          },
          {
            "file_path": "/var/log/caddy/access.log",
            "log_group_name": "${log_group_caddy}",
            "log_stream_name": "{instance_id}/access"
          }
        ]
      }
    }
  }
}
CWCFG

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 \
  -c file:/opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json -s

echo "=== deploy.sh ==="
cat > /home/mecove/deploy.sh <<'DEPLOY'
#!/bin/bash
set -euo pipefail

cd /home/mecove/app
git pull --ff-only
pnpm install --frozen-lockfile --ignore-scripts=false
pnpm exec prisma generate
pnpm build

# Reload secrets
/home/mecove/load-env.sh

# Run migrations
npx prisma migrate deploy

# Restart processes
set -a
source /home/mecove/app/.env
set +a
cd /home/mecove
pm2 restart ecosystem.config.cjs
pm2 save

echo "Deploy complete at $(date)"
DEPLOY
chmod +x /home/mecove/deploy.sh
chown mecove:mecove /home/mecove/deploy.sh

echo "=== Bootstrap complete ==="
