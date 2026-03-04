# AWS Commands - meCove Backend (MVP)

> Last updated: 2026-03-02
>
> Two places you'll run commands:
> 1) **Local machine (AWS CLI)** for SSM access + CloudWatch logs
> 2) **On the EC2 instance (SSM session)** for deploys, restarts, and diagnostics

## Local machine (AWS CLI)

### Prereqs

- AWS CLI installed + configured (profile/credentials)
- Session Manager Plugin installed (needed for `aws ssm start-session`)
- Default region: `ap-south-1`

### Connect to EC2 via SSM (recommended)

- Windows:
  - `aws\connect-ec2.cmd`
  - Optional: `aws\connect-ec2.cmd -Profile <PROFILE> -Region ap-south-1`
- Bash/macOS/Linux:
  - `./aws/connect-ec2.sh`
  - Optional: `AWS_PROFILE=<PROFILE> AWS_REGION=ap-south-1 ./aws/connect-ec2.sh`

### Find instance id (by tags)

This looks for the newest running instance tagged `Project=mecove` and `Env=mvp`:

```bash
aws --region ap-south-1 ec2 describe-instances \
  --filters Name=instance-state-name,Values=running Name=tag:Project,Values=mecove Name=tag:Env,Values=mvp \
  --query "sort_by(Reservations[].Instances[], &LaunchTime)[-1].InstanceId" \
  --output text
```

### Run deploy without an interactive session (SSM send-command)

```bash
aws --region ap-south-1 ssm send-command \
  --document-name AWS-RunShellScript \
  --targets Key=instanceIds,Values=<INSTANCE_ID> \
  --parameters commands='sudo -u mecove /home/mecove/deploy.sh' \
  --comment 'mecove deploy'
```

### Tail CloudWatch logs (from local)

```bash
aws --region ap-south-1 logs tail "/ec2/mecove-mvp/api" --since 15m --follow
aws --region ap-south-1 logs tail "/ec2/mecove-mvp/worker" --since 15m --follow
aws --region ap-south-1 logs tail "/ec2/mecove-mvp/caddy" --since 15m --follow
```

### Stop / start EC2

```bash
aws --region ap-south-1 ec2 stop-instances --instance-ids <INSTANCE_ID>
aws --region ap-south-1 ec2 start-instances --instance-ids <INSTANCE_ID>
```

## On the EC2 instance (SSM session)

### Quick health checks

```bash
uname -m
sudo cloud-init status --long

sudo systemctl status caddy --no-pager -l
sudo ss -lntp | egrep ':80|:443|:3000' || true

sudo -u mecove pm2 status
curl -i http://localhost:3000/health
```

### Deploy latest code (pull + build + migrate + restart)

```bash
sudo -u mecove /home/mecove/deploy.sh
```

### Restart app processes (api + worker)

```bash
sudo -u mecove pm2 restart api worker
```

Restart everything in the ecosystem file:

```bash
sudo -u mecove pm2 restart /home/mecove/ecosystem.config.cjs
```

### View logs on the instance

App logs (PM2 file logs):

```bash
sudo tail -n 200 /home/mecove/logs/api-out.log
sudo tail -n 200 /home/mecove/logs/api-err.log
sudo tail -n 200 /home/mecove/logs/worker-out.log
sudo tail -n 200 /home/mecove/logs/worker-err.log

sudo tail -f /home/mecove/logs/api-out.log /home/mecove/logs/api-err.log
sudo tail -f /home/mecove/logs/worker-out.log /home/mecove/logs/worker-err.log
```

Caddy logs:

```bash
sudo tail -n 200 /var/log/caddy/access.log
sudo tail -f /var/log/caddy/access.log
sudo journalctl -u caddy -n 200 --no-pager -l
```

### WhatsApp / queue diagnostics scripts (from EC2)

Run from the repo directory:

```bash
sudo -u mecove bash -lc 'cd /home/mecove/app && pnpm check:reply-queue'
sudo -u mecove bash -lc 'cd /home/mecove/app && pnpm sync:webhook'
sudo -u mecove bash -lc 'cd /home/mecove/app && pnpm db:smoke'
```

### Seed chat data

Seed from a hand-written JSON file:

```bash
sudo -u mecove bash -lc 'cd /home/mecove/app && pnpm seed:chat seed/chat-data/chat1.json --clear'
```

LLM-generate chat data from a YAML config (and optionally seed DB):

```bash
sudo -u mecove bash -lc 'cd /home/mecove/app && pnpm seed:generate'
sudo -u mecove bash -lc 'cd /home/mecove/app && pnpm seed:generate seed/seed-input.yaml'
```

### Wipe the database (data-only; schema stays intact)

This truncates all tables in `public` except `_prisma_migrations`. It is intentionally guarded.

```bash
sudo -u mecove bash -lc 'cd /home/mecove/app && ALLOW_DB_WIPE=true pnpm db:wipe -- --confirm mecove'
```

Safer sequence (optional):

```bash
sudo -u mecove pm2 stop api worker
sudo -u mecove bash -lc 'cd /home/mecove/app && ALLOW_DB_WIPE=true pnpm db:wipe -- --confirm mecove'
sudo -u mecove pm2 start api worker
```
