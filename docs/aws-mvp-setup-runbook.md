# AWS MVP Setup Runbook (meCove Backend)

This is a “resume-from-here” runbook capturing what we set up, what we debugged, and the exact names/commands used.

It is intentionally verbose and operational. Do **not** store any secrets in this file.

## 0) Safety / key notes

- **Never paste secrets into chat/PRs/logs.** During setup, secrets were accidentally exposed in terminal/chat; rotate keys if that happens again (OpenAI key, WhatsApp token, DB password).
- RDS is in **private subnets**, so your laptop cannot connect directly to Postgres. For DB actions, run one-off ECS tasks.
- PowerShell quoting can break JSON CLI args; prefer `file://overrides.json` with **no BOM**.

## 1) High-level architecture (MVP)

- **Region:** `ap-south-1`
- **Domain:** `api.mecove.com` (DNS hosted at Hostinger; we used CNAME)
- **Ingress:** ALB (HTTPS via ACM) → ECS Fargate API container (port `3000`)
- **Compute:** ECS Fargate
  - API service: `mecove-mvp-api`
  - Worker service: `mecove-mvp-worker`
- **Data:**
  - RDS Postgres 16: `mecove-mvp-postgres` (private)
  - ElastiCache Redis 7.1: `mecove-mvp-redis` (private)
- **Secrets:** AWS Secrets Manager
  - App secret: `mecove-mvp/app-secrets` (WhatsApp + LLM keys)
  - RDS secret: auto-managed by RDS (master username/password)
- **Logs:** CloudWatch Log Groups
  - `/ecs/mecove-mvp/api`
  - `/ecs/mecove-mvp/worker`

## 2) AWS account details used during setup

- **AWS Account ID:** `498735610795`
- **AWS CLI identity (example):** `arn:aws:iam::498735610795:user/santosh-admin`

## 3) DNS + TLS (Hostinger + ACM)

### 3.1 ACM certificate

- Certificate ARN:
  - `arn:aws:acm:ap-south-1:498735610795:certificate/08ea4708-902f-4404-b7c4-a2c69beca41e`
- We requested wildcard + apex:
  - `mecove.com`
  - `*.mecove.com`

### 3.2 Hostinger DNS records

**ACM validation CNAME** (example used):

- Type: `CNAME`
- Name/Host: `_3e982c9e9e879b7f437aa4ebadbbf20f`
- Target: `_a79af4ba4ae197453dcc5ab2e96aa78e.jkddzztszm.acm-validations.aws`
- TTL: `300`

**API domain CNAME** (ALB):

- Type: `CNAME`
- Name/Host: `api`
- Target:
  - `mecove-mvp-alb-1697608693.ap-south-1.elb.amazonaws.com`
- TTL: `300`

### 3.3 DNS verification commands

```powershell
nslookup -type=CNAME _3e982c9e9e879b7f437aa4ebadbbf20f.mecove.com
nslookup api.mecove.com
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

- Terraform lives in this repo under: `infra/terraform`

Initialize:

```powershell
cd infra/terraform
terraform init
terraform validate
terraform plan
terraform apply
```

### 4.3 Terraform files created

In `infra/terraform`:

- `versions.tf` / `backend.tf` / `provider.tf`
- `vpc.tf` (VPC module: CIDR `10.0.0.0/16`, 2 AZs, public+private subnets, **no NAT**)
- `security-groups.tf`
- `alb.tf` (ALB 80→443 redirect, target group to port `3000`, health check `/health`)
- `logs.tf` (CloudWatch log groups)
- `ecr.tf` (ECR repo `mecove-mvp`, `force_delete = true` for clean destroys)
- `rds.tf` (RDS Postgres 16, single-AZ; backups disabled due to free-tier restriction)
- `redis.tf` (ElastiCache Redis 7.1; parameter group sets `maxmemory-policy=noeviction`)
- `ecs.tf` (ECS cluster + task defs + services)
- `variables.tf` / `outputs.tf`

### 4.4 Key Terraform variables used (as defaults)

- `acm_certificate_arn` = `arn:aws:acm:ap-south-1:498735610795:certificate/08ea4708-902f-4404-b7c4-a2c69beca41e`
- `api_domain_name` = `api.mecove.com`
- `app_secrets_arn` = `arn:aws:secretsmanager:ap-south-1:498735610795:secret:mecove-mvp/app-secrets-XMe5kC`

## 5) What was deployed (names/IDs observed)

These came from `terraform output` during setup.

- VPC: `vpc-0f15f647344a9d43f`
- Public subnets:
  - `subnet-0f3c5ecd1e03e80f9`
  - `subnet-027614a2ca0251537`
- Private subnets:
  - `subnet-01d21299153c6a23a`
  - `subnet-05f3a75c306cdbcb3`
- ALB DNS:
  - `mecove-mvp-alb-1697608693.ap-south-1.elb.amazonaws.com`
- ECR repo URL:
  - `498735610795.dkr.ecr.ap-south-1.amazonaws.com/mecove-mvp`
- RDS endpoint:
  - `mecove-mvp-postgres.cp062gs66srn.ap-south-1.rds.amazonaws.com:5432`
- Redis endpoint:
  - `mecove-mvp-redis.siz9nr.0001.aps1.cache.amazonaws.com:6379`
- App secret ARN:
  - `arn:aws:secretsmanager:ap-south-1:498735610795:secret:mecove-mvp/app-secrets-XMe5kC`
- RDS secret ARN (auto-created):
  - `arn:aws:secretsmanager:ap-south-1:498735610795:secret:rds!db-46c1dba1-d0b0-4752-8a45-15ee61a9ff1f-yE4o34`

## 6) Build + push image to ECR

ECR login (PowerShell, known to work):

```powershell
docker login -u AWS -p (aws ecr get-login-password --region ap-south-1) 498735610795.dkr.ecr.ap-south-1.amazonaws.com
```

Build + push:

```powershell
docker build -t mecove-mvp .
docker tag mecove-mvp:latest 498735610795.dkr.ecr.ap-south-1.amazonaws.com/mecove-mvp:latest
docker push 498735610795.dkr.ecr.ap-south-1.amazonaws.com/mecove-mvp:latest
```

Force ECS redeploy:

```powershell
aws ecs update-service --region ap-south-1 --cluster mecove-mvp --service mecove-mvp-api --force-new-deployment
aws ecs update-service --region ap-south-1 --cluster mecove-mvp --service mecove-mvp-worker --force-new-deployment
```

Health check:

```powershell
irm https://api.mecove.com/health
```

## 7) Secrets setup (AWS Secrets Manager)

We created one “app secrets” secret for MVP:

- Name: `mecove-mvp/app-secrets`
- ARN:
  - `arn:aws:secretsmanager:ap-south-1:498735610795:secret:mecove-mvp/app-secrets-XMe5kC`

Suggested keys (do not store values here):

- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_PERMANENT_TOKEN`
- `OPENAI_API_KEY`

These are injected into ECS using `secrets` in `infra/terraform/ecs.tf`.

## 8) CloudWatch logs commands

Tail logs:

```powershell
aws logs tail "/ecs/mecove-mvp/api" --region ap-south-1 --follow --since 30m
aws logs tail "/ecs/mecove-mvp/worker" --region ap-south-1 --follow --since 30m
```

Get newest stream then fetch events:

```powershell
aws logs describe-log-streams --log-group-name "/ecs/mecove-mvp/api" --order-by LastEventTime --descending --max-items 1
aws logs get-log-events --log-group-name "/ecs/mecove-mvp/api" --log-stream-name "<STREAM>" --limit 200
```

## 9) Webhook verification test (no Meta UI required)

```powershell
irm "https://api.mecove.com/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=test123"
```

Expected output: `test123`

## 10) Local “fake WhatsApp message” POST (for testing API end-to-end)

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

## 11) ECS one-off tasks (migrations + DB diagnostics)

### 11.1 Prisma migrations (inside AWS)

Problem: laptop cannot reach private RDS; run in ECS.

Create `overrides.json` **without BOM** (ASCII):

```powershell
@'
{
  "containerOverrides": [
    {
      "name": "api",
      "command": ["pnpm", "prisma", "migrate", "deploy"]
    }
  ]
}
'@ | Out-File -Encoding ascii overrides.json
```

Run task:

```powershell
$taskArn = aws ecs run-task --region ap-south-1 --cluster mecove-mvp --launch-type FARGATE `
  --task-definition mecove-mvp-api:3 `
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0f3c5ecd1e03e80f9,subnet-027614a2ca0251537],securityGroups=[sg-0e7341f4cc23f8f14],assignPublicIp=ENABLED}" `
  --overrides file://overrides.json `
  --query "tasks[0].taskArn" --output text

aws ecs wait tasks-stopped --region ap-south-1 --cluster mecove-mvp --tasks $taskArn
aws ecs describe-tasks --region ap-south-1 --cluster mecove-mvp --tasks $taskArn --query "tasks[0].containers[0].exitCode" --output text
```

### 11.2 DB diagnostic task (connect to `postgres` + `mecove`)

This was used to confirm ownership + CONNECT privileges.

```powershell
@'
{
  "containerOverrides": [
    {
      "name": "api",
      "command": [
        "node",
        "-e",
        "const {Client}=require('pg'); const base={host:process.env.DB_HOST,port:Number(process.env.DB_PORT||'5432'),user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:{rejectUnauthorized:false}}; (async()=>{ const c1=new Client({...base,database:'postgres'}); await c1.connect(); const r=await c1.query(\"select current_user, current_database() db\"); console.log('CONNECTED',r.rows[0]); const p=await c1.query(\"select datname, pg_get_userbyid(datdba) owner, datacl from pg_database where datname='mecove'\"); console.log('DBROW',JSON.stringify(p.rows[0]||null)); const h=await c1.query(\"select has_database_privilege(current_user,'mecove','CONNECT') can_connect\"); console.log('PRIV',h.rows[0]); await c1.end(); const c2=new Client({...base,database:'mecove'}); await c2.connect(); await c2.query('select 1'); console.log('CONNECT_TO_MECOVE_OK'); await c2.end(); })().catch(e=>{ console.error('DBDIAG_FAIL',e.message||String(e)); process.exit(1); });"
      ]
    }
  ]
}
'@ | Out-File -Encoding ascii dbdiag.json
```

Run it with `aws ecs run-task ... --overrides file://dbdiag.json`.

## 12) Known issues hit + fixes

### 12.1 `InvalidClientTokenId` on `aws sts get-caller-identity`

Cause: AWS CLI not configured. Fix: create IAM user + access keys + `aws configure`.

### 12.2 ECR login failing with HTTP 400

Workaround:

```powershell
docker login -u AWS -p (aws ecr get-login-password --region ap-south-1) 498735610795.dkr.ecr.ap-south-1.amazonaws.com
```

### 12.3 Redis eviction policy warning

BullMQ prefers `noeviction`. Fix: ElastiCache parameter group sets `maxmemory-policy=noeviction`, then restart ECS tasks.

### 12.4 RDS free-tier restriction error

Error: “backup retention period exceeds maximum available to free tier customers”.
Fix: `backup_retention_period = 0` and `delete_automated_backups = true`.

### 12.5 Postgres SSL

RDS had `rds.force_ssl=1`. We configured ECS to set:

- `DB_SSLMODE=require`
- `DB_USELIBPQCOMPAT=true`

and the app builds the connection string from `DB_*` parts (not a raw `DATABASE_URL`).

### 12.6 WhatsApp test/sandbox restriction

Meta error: `Recipient phone number not in allowed list`.
Fix: add test recipient number in Meta / use a permitted number.

## 13) Status snapshot (when this doc was written)

- Core infra was created via Terraform, with ALB reachable at `https://api.mecove.com/health`.
- We were still troubleshooting TLS + WhatsApp reply restrictions when session ended.

## 14) Pause / destroy to stop costs

### 14.1 Pause (keep infra, stop compute)

Helper scripts:

```powershell
.\scripts\aws_pause_mvp.ps1
.\scripts\aws_status_mvp.ps1
```

Manual:

```powershell
aws ecs update-service --region ap-south-1 --cluster mecove-mvp --service mecove-mvp-api --desired-count 0
aws ecs update-service --region ap-south-1 --cluster mecove-mvp --service mecove-mvp-worker --desired-count 0
aws rds stop-db-instance --region ap-south-1 --db-instance-identifier mecove-mvp-postgres
```

Resume:

```powershell
.\scripts\aws_resume_mvp.ps1
```

### 14.2 Destroy (stop most costs; deletes infra + data)

```powershell
cd infra/terraform
terraform destroy
```

Non-Terraform leftovers to consider deleting manually:

- Terraform state bucket: `mecove-tfstate-498735610795`
- Secrets: `mecove-mvp/app-secrets` and the RDS secret
- ACM certificate (no monthly cost; keep if you will reuse)
