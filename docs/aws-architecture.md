# AWS Architecture - meCove Backend (MVP)

> Last updated: 2026-02-28
>
> This document describes the current EC2-based MVP architecture. For step-by-step ops commands
> (SSM access, log locations, deploy commands), see [`aws-mvp-setup-runbook.md`](./aws-mvp-setup-runbook.md).

## Architecture diagram (high level)

```text
Internet (users, Meta WhatsApp)
  |
  | HTTPS :443  (api.mecove.com / api2.mecove.com)
  v
Elastic IP  --->  EC2 (Amazon Linux 2023, x86_64)
                    |
                    | Caddy (Auto-HTTPS, reverse_proxy -> localhost:3000)
                    v
                  Node.js (PM2)
                    - api    (HTTP :3000) webhooks, health
                    - worker (BullMQ) LLM + WhatsApp + PDF generation
                    |
                    +--> Redis 6 (local, :6379) queues/locks
                    |
                    +--> RDS Postgres 16 (private, :5432)
```

## Region & account

| Item            | Value |
|-----------------|-------|
| AWS Region      | `ap-south-1` (Mumbai) |
| AWS Account ID  | `498735610795` |
| Terraform state | `s3://mecove-tfstate-498735610795/mvp/terraform.tfstate` |

## DNS & domains

- Primary API hostname: `api.mecove.com`
- Fallback hostname: `api2.mecove.com`

`api2.mecove.com` exists to keep deploys unblocked if Let's Encrypt rate-limits repeated certificate
issuance for `api.mecove.com` during frequent instance rebuilds. Both hostnames can point to the same
Elastic IP and reverse proxy to the same app.

## Component details

### VPC & networking

- **VPC CIDR:** `10.0.0.0/16`
- **Subnets:** 2 public subnets across 2 AZs (`10.0.0.0/24`, `10.0.1.0/24`)
- **NAT Gateway:** none (the instance has an Elastic IP)

### Compute - EC2

| Setting       | Value |
|--------------|-------|
| Instance     | Amazon Linux 2023 (x86_64) |
| Instance type| `t3.small` |
| Storage      | 30 GB gp3 (encrypted) |
| Public IP    | Elastic IP (stable for DNS A records) |
| Access       | AWS SSM Session Manager (no public SSH) |

### Reverse proxy - Caddy

- Installed on the instance by `infra/terraform/user_data.sh.tpl`.
- Terminates TLS and reverse-proxies to `localhost:3000`.
- Uses Let's Encrypt for certificates; cert data is stored under `/var/lib/caddy`.
- Access logs are written to `/var/log/caddy/access.log` (also shipped to CloudWatch).

### Application - Node.js + PM2

Two Node.js processes managed by PM2:

| Process  | Entry point             | Purpose |
|----------|--------------------------|---------|
| `api`    | `dist/api/server.js`     | Webhook handler + HTTP API (`:3000`) |
| `worker` | `dist/worker/worker.js`  | BullMQ worker (LLM, WhatsApp, summaries, PDF) |

Runtime notes:
- Node.js 20 + pnpm via Corepack.
- PM2 is configured to restart on reboot (`pm2 startup` + `pm2 save`).
- Logs live at `/home/mecove/logs/{api,worker}-{out,err}.log`.

### Cache - Redis (local)

- Redis 6 runs locally on EC2 (`localhost:6379`) as a systemd service.
- Used for BullMQ queues + batching/locks.
- No persistence/replication (acceptable for MVP; jobs can be retried).

### Database - RDS PostgreSQL

| Setting             | Value |
|---------------------|-------|
| Engine              | PostgreSQL 16 |
| Instance class      | `db.t4g.micro` |
| Storage             | 20 GB gp3 (encrypted) |
| DB name             | `mecove` |
| Master user         | `mecove` |
| Master password     | AWS Secrets Manager (managed by RDS) |
| Multi-AZ            | No |
| Backups             | Configurable (`rds_backup_retention_period`); currently `0` |
| Network access      | Only from the EC2 security group |

**TLS/Prisma note (important):** RDS requires TLS. The app uses:
- `DATABASE_URL=...?...sslmode=require&uselibpqcompat=true`
- `DB_USELIBPQCOMPAT=true`

### PDF generation - Puppeteer (worker)

The worker generates PDFs from HTML using Puppeteer.

On `x86_64`, `deploy.sh` ensures a browser exists by running:

```bash
pnpm exec puppeteer browsers install chrome
```

This downloads Chrome for Testing under `/home/mecove/.cache/puppeteer`.

## Observability

### CloudWatch logs

CloudWatch Agent ships these files:
- `/home/mecove/logs/api-out.log` and `/home/mecove/logs/api-err.log` -> `/ec2/mecove-mvp/api`
- `/home/mecove/logs/worker-out.log` and `/home/mecove/logs/worker-err.log` -> `/ec2/mecove-mvp/worker`
- `/var/log/caddy/access.log` -> `/ec2/mecove-mvp/caddy`

Retention is set to 3 days to keep costs low.

## Security

### Security groups

**EC2 security group** (`mecove-mvp-ec2`):

| Direction | Port | Source/Dest  | Purpose |
|----------:|-----:|--------------|---------|
| Inbound   | 80   | `0.0.0.0/0`  | HTTP (redirect to HTTPS) |
| Inbound   | 443  | `0.0.0.0/0`  | HTTPS |
| Outbound  | all  | `0.0.0.0/0`  | Outbound HTTPS to external APIs, package repos, etc. |

**RDS security group** (`mecove-mvp-rds`):

| Direction | Port | Source   | Purpose |
|----------:|-----:|----------|---------|
| Inbound   | 5432 | EC2 SG   | PostgreSQL access |

### Secrets management

- App secrets (WhatsApp tokens, LLM keys) are stored in AWS Secrets Manager and rendered into `/home/mecove/app/.env` by `/home/mecove/load-env.sh`.
- GitHub deploy key is stored in Secrets Manager and used for repo cloning.

### IAM

The instance profile includes least-privilege access for:
- SSM (Session Manager)
- Secrets Manager (read secrets needed for deploy/runtime)
- CloudWatch Logs (write to log groups)

## Deployment

### Initial provisioning

```bash
cd infra/terraform
terraform init
terraform plan
terraform apply
```

`user_data` performs the full bootstrap (packages, Node, Caddy, app clone, env, build, migrations, PM2, CloudWatch agent).

### Subsequent deploys

From an SSM session on the instance:

```bash
sudo -u mecove /home/mecove/deploy.sh
```

### Terraform outputs

| Output | Description |
|--------|-------------|
| `elastic_ip` | Public IP for DNS A record |
| `instance_id` | EC2 instance ID |
| `ssm_start_session_command` | Start an interactive SSM session |
| `ssm_deploy_command` | Trigger `deploy.sh` via SSM (non-interactive) |

## Notes / gotchas

- **Let's Encrypt rate limits:** Frequent instance rebuilds can trigger duplicate certificate rate limits for a hostname (e.g. `api.mecove.com`). If that blocks HTTPS, use a fallback hostname (e.g. `api2.mecove.com`) pointing to the same Elastic IP, or persist Caddy's data directory so certificates survive rebuilds.
