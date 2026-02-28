# AWS MVP Setup Runbook (meCove Backend)

This is a "resume-from-here" runbook capturing what we set up, what we debugged, and the exact names/commands used.

It is intentionally verbose and operational. Do **not** store any secrets in this file.

> For the full architecture overview, see [`aws-architecture.md`](./aws-architecture.md).

## 0) Safety / key notes

- **Never paste secrets into chat/PRs/logs.** During setup, secrets were accidentally exposed in terminal/chat; rotate keys if that happens again (OpenAI key, WhatsApp token, DB password).
- RDS is only accessible from the EC2 instance (security group restricted). For DB actions, SSH into the EC2 instance.
- PowerShell quoting can break JSON CLI args; prefer `file://overrides.json` with **no BOM**.

## 1) High-level architecture (current MVP)

- **Region:** `ap-south-1`
- **Domain:** `api.mecove.com` (DNS A record pointing to Elastic IP)
- **Compute:** Single EC2 instance (`t4g.small`, Amazon Linux 2023 ARM64)
- **Reverse proxy:** Caddy (auto Let's Encrypt TLS on `:443` → `localhost:3000`)
- **Process manager:** PM2 (API + Worker)
- **Cache:** Redis 6 (local on EC2, `:6379`)
- **Database:** RDS PostgreSQL 16 (`db.t4g.micro`, private access via EC2 SG only)
- **Secrets:** AWS Secrets Manager
  - App secret: `mecove-mvp/app-secrets` (WhatsApp + LLM keys)
  - RDS secret: auto-managed by RDS (master username/password)
  - GitHub deploy key: ED25519 SSH key for private repo cloning
- **Logs:** CloudWatch Log Groups
  - `/ec2/mecove-mvp/api`
  - `/ec2/mecove-mvp/worker`
  - `/ec2/mecove-mvp/caddy`

## 2) AWS account details used during setup

- **AWS Account ID:** `498735610795`
- **AWS CLI identity (example):** `arn:aws:iam::498735610795:user/santosh-admin`

## 3) DNS + TLS

### 3.1 TLS via Caddy

TLS is handled automatically by Caddy using Let's Encrypt. No ACM certificate is needed for the EC2 setup.

Caddy is configured to serve `api.mecove.com` and auto-provisions + renews the certificate.

### 3.2 DNS (Hostinger)

**API domain A record:**

- Type: `A`
- Name/Host: `api`
- Target: `<ELASTIC_IP>` (from `terraform output elastic_ip`)
- TTL: `300`

### 3.3 DNS verification

```powershell
nslookup api.mecove.com
curl https://api.mecove.com/health
```

## 4) Terraform setup

### 4.1 Terraform state bucket (S3 backend)

- Bucket: `mecove-tfstate-498735610795`
- State key: `mvp/terraform.tfstate`

Create bucket + enable versioning:

```powershell
aws s3api create-bucket --bucket mecove-tfstate-498735610795 --region ap-south-1 --create-bucket-configuration LocationConstraint=ap-south-1
aws s3api put-bucket-versioning --bucket mecove-tfstate-498735610795 --versioning-configuration Status=Enabled
```

### 4.2 Terraform location

Terraform lives in this repo under: `infra/terraform`

Initialize:

```powershell
cd infra/terraform
terraform init
terraform validate
terraform plan
terraform apply
```

### 4.3 Terraform files

In `infra/terraform`:

- `versions.tf` / `backend.tf` / `provider.tf`
- `vpc.tf` (VPC module: CIDR `10.0.0.0/16`, 2 AZs, 2 public subnets, **no NAT**)
- `security-groups.tf` (EC2 SG + RDS SG)
- `ec2.tf` (EC2 instance, Elastic IP, IAM role/profile, SSH key pair)
- `rds.tf` (RDS Postgres 16, single-AZ, backups disabled)
- `logs.tf` (CloudWatch log groups, 14-day retention)
- `user_data.sh.tpl` (bootstrap script: packages, Node.js, Caddy, app deploy, PM2, CloudWatch agent)
- `variables.tf` / `outputs.tf`

### 4.4 Key Terraform variables

- `api_domain_name` = `api.mecove.com`
- `app_secrets_arn` = Secrets Manager ARN for app secrets
- `github_deploy_key_secret_arn` = Secrets Manager ARN for GitHub SSH key
- `github_repo` = `git@github.com:jazzjazzy/mecove-backend.git`
- `github_branch` = `main`
- `instance_type` = `t4g.small`
- `ssh_allowed_cidrs` = defaults to `0.0.0.0/0` (restrict in production)

## 5) What was deployed (from Terraform outputs)

After `terraform apply`, get values with:

```powershell
terraform output
```

Key outputs:

- `elastic_ip` — public IP for DNS A record
- `instance_id` — EC2 instance ID
- `ssh_command` — ready-to-use SSH command
- `deploy_command` — ready-to-use deploy trigger
- `ssh_private_key` — generated ED25519 key (sensitive; use `terraform output -raw ssh_private_key > mecove-mvp.pem`)
- `rds_endpoint` — PostgreSQL hostname
- `rds_port` — `5432`
- `rds_master_secret_arn` — ARN of DB password secret

## 6) SSH access

Save the SSH private key:

```powershell
terraform output -raw ssh_private_key > mecove-mvp.pem
chmod 600 mecove-mvp.pem   # Linux/Mac
```

Connect:

```powershell
ssh -i mecove-mvp.pem ec2-user@<ELASTIC_IP>
```

Or use the output directly:

```powershell
$(terraform output -raw ssh_command)
```

## 7) Deploying application updates

### 7.1 Using the deploy script (recommended)

```powershell
ssh -i mecove-mvp.pem ec2-user@<ELASTIC_IP> "sudo -u mecove /home/mecove/deploy.sh"
```

The deploy script does:
1. `git pull` latest from configured branch
2. `pnpm install --frozen-lockfile`
3. `pnpm build`
4. Re-load secrets from Secrets Manager → regenerate `.env`
5. `npx prisma migrate deploy`
6. `pm2 restart all`

### 7.2 Manual deploy steps (if needed)

```bash
# SSH in first
ssh -i mecove-mvp.pem ec2-user@<ELASTIC_IP>

# Switch to app user
sudo -iu mecove
cd ~/app

# Pull and build
git pull
pnpm install --frozen-lockfile
pnpm build

# Reload env from Secrets Manager
source ~/load-env.sh

# Run migrations
npx prisma migrate deploy

# Restart processes
pm2 restart all
pm2 status
```

## 8) Secrets setup (AWS Secrets Manager)

App secrets:

- Name: `mecove-mvp/app-secrets`
- ARN: `arn:aws:secretsmanager:ap-south-1:498735610795:secret:mecove-mvp/app-secrets-XMe5kC`

Expected keys (do not store values here):

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_PERMANENT_TOKEN`
- `OPENAI_API_KEY`

These are fetched at runtime by the `load-env.sh` script on EC2 and written to `.env`.

## 9) CloudWatch logs

Tail logs:

```powershell
aws logs tail "/ec2/mecove-mvp/api" --region ap-south-1 --follow --since 30m
aws logs tail "/ec2/mecove-mvp/worker" --region ap-south-1 --follow --since 30m
aws logs tail "/ec2/mecove-mvp/caddy" --region ap-south-1 --follow --since 30m
```

Or SSH in and check PM2 logs directly:

```bash
ssh -i mecove-mvp.pem ec2-user@<ELASTIC_IP>
sudo -iu mecove
pm2 logs api --lines 100
pm2 logs worker --lines 100
```

## 10) Webhook verification test

```powershell
irm "https://api.mecove.com/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=test123"
```

Expected output: `test123`

## 11) Local "fake WhatsApp message" POST (for testing)

```powershell
$payload = @{
  entry = @(@{
    changes = @(@{
      value = @{
        messages = @(@{
          from = "919999999999"
          id = "wamid.TEST_003"
          timestamp = "1700000000"
          type = "text"
          text = @{ body = "hello test" }
        })
      }
    })
  })
}

Invoke-WebRequest -Method Post `
  -Uri "https://api.mecove.com/webhooks/whatsapp" `
  -ContentType "application/json" `
  -Body ($payload | ConvertTo-Json -Depth 20)
```

## 12) Database access (via EC2)

RDS is not publicly accessible. Access it through the EC2 instance:

```bash
ssh -i mecove-mvp.pem ec2-user@<ELASTIC_IP>
sudo -iu mecove
cd ~/app

# Source the env to get DB credentials
source ~/load-env.sh

# Use Prisma Studio (if available)
npx prisma studio

# Or connect via psql (if installed)
psql "$DATABASE_URL"
```

### Running migrations

```bash
ssh -i mecove-mvp.pem ec2-user@<ELASTIC_IP>
sudo -iu mecove
cd ~/app
source ~/load-env.sh
npx prisma migrate deploy
```

## 13) PM2 process management

```bash
# SSH in as mecove user
ssh -i mecove-mvp.pem ec2-user@<ELASTIC_IP>
sudo -iu mecove

# Status
pm2 status

# Restart
pm2 restart all
pm2 restart api
pm2 restart worker

# Logs
pm2 logs
pm2 logs api --lines 200
pm2 logs worker --lines 200

# Monitoring dashboard
pm2 monit
```

## 14) Known issues hit + fixes

### 14.1 RDS free-tier restriction error

Error: "backup retention period exceeds maximum available to free tier customers".
Fix: `backup_retention_period = 0` and `delete_automated_backups = true`.

### 14.2 Postgres SSL

RDS has `rds.force_ssl=1`. The `load-env.sh` script sets the appropriate SSL parameters in the `DATABASE_URL` connection string.

### 14.3 WhatsApp test/sandbox restriction

Meta error: `Recipient phone number not in allowed list`.
Fix: add test recipient number in Meta / use a permitted number.

### 14.4 Summary PDF (Puppeteer/Chromium)

The worker generates summary PDFs via Puppeteer using Chromium installed on the EC2 instance. `PUPPETEER_EXECUTABLE_PATH` is set to the system Chromium path. If PDF jobs fail with Chrome/Chromium errors, SSH in and verify Chromium is installed (`which chromium-browser` or `which chromium`).

## 15) Pause / destroy to stop costs

### 15.1 Pause (keep infra, stop compute)

```powershell
# Stop EC2 instance
aws ec2 stop-instances --region ap-south-1 --instance-ids <INSTANCE_ID>

# Stop RDS
aws rds stop-db-instance --region ap-south-1 --db-instance-identifier mecove-mvp-postgres
```

Resume:

```powershell
# Start EC2 instance
aws ec2 start-instances --region ap-south-1 --instance-ids <INSTANCE_ID>

# Start RDS
aws rds start-db-instance --region ap-south-1 --db-instance-identifier mecove-mvp-postgres
```

> Note: Elastic IP still costs ~$3.65/month when the instance is stopped.
> RDS auto-restarts after 7 days if stopped; re-stop if needed.

### 15.2 Destroy (stop all costs; deletes infra + data)

```powershell
cd infra/terraform
terraform destroy
```

Non-Terraform leftovers to consider deleting manually:

- Terraform state bucket: `mecove-tfstate-498735610795`
- Secrets: `mecove-mvp/app-secrets` and the RDS secret
- GitHub deploy key secret
