# AWS Deployment Architecture — Discussion Doc (meCove Backend)

This document is meant to *frame a team discussion* about how to deploy `mecove-backend` on AWS. It intentionally focuses on decisions, options, tradeoffs, and open questions rather than prescribing one final design.

## 1) What we’re deploying (from the current repo)

**Core runtime components**

- **API container**: Node.js HTTP server (port **3000**) handling:
  - `GET /health`
  - `GET /webhooks/whatsapp` (Meta webhook verification)
  - `POST /webhooks/whatsapp` (inbound WhatsApp messages)
  - debug endpoints under `/debug/*` (should be disabled/guarded in prod)
- **Worker container**: BullMQ workers for:
  - batched acknowledgment reply generation (LLM) + sending replies to WhatsApp
  - 15‑day summary pipeline (multi-stage LLM) + PDF generation + sending PDF to WhatsApp
- **PostgreSQL** (Prisma): persistent store for users, identities, messages, summaries.
- **Redis** (BullMQ + batching state): queues + short-lived state and locks.

**External integrations**

- **Meta WhatsApp Business API**
  - Inbound: webhook to our API
  - Outbound: Graph API calls from our API/worker to send text, buttons, typing indicators, PDFs
- **LLM provider(s)**: OpenAI / Groq / Sarvam via HTTP APIs (keys in env/secrets).

**Local/dev-only**

- `ngrok` in `docker-compose.yml` is for local testing and webhook registration during development; production should use a stable HTTPS endpoint.

## 2) Workload characteristics (to guide AWS choices)

- **Ingress**: public HTTPS webhook endpoint (Meta must reach it).
- **Latency sensitivity**:
  - webhook handler should respond quickly (enqueue + 200 OK)
  - LLM work is async (worker), not on the webhook request path
- **Burstiness**: WhatsApp message bursts per user; reply batching uses Redis timers/locks.
- **Statefulness**:
  - API and worker are stateless (aside from Redis + Postgres)
  - Redis is *critical* to correct batching + BullMQ reliability
- **PII**: messages can be sensitive; storage, logging, and retention need explicit decisions.

## 3) Candidate AWS architectures

### Option A — ECS on Fargate (recommended starting point)

**Why**

- Container-friendly (repo already has a `Dockerfile`)
- Simple ops compared to EKS
- Easy to run **two services** (API + Worker) with independent scaling

**High-level shape**

```text
Meta Webhooks -> (Route53 + ACM TLS) -> ALB -> ECS Service: API (port 3000)
                                                |
                                                +-> ElastiCache Redis (BullMQ + batching)
                                                +-> RDS Postgres (Prisma)
                                                +-> Outbound HTTPS: LLM APIs + Meta Graph API

ECS Service: Worker (no ingress)
  |
  +-> ElastiCache Redis
  +-> RDS Postgres
  +-> Outbound HTTPS: LLM APIs + Meta Graph API
```

**AWS building blocks**

- **VPC**: public subnets (ALB), private subnets (ECS tasks, RDS, ElastiCache)
- **ALB**: HTTPS listener, route all traffic to API target group
- **ECS/Fargate**:
  - Service 1: `api` (desired count >= 2 for HA, if migrations handled safely)
  - Service 2: `worker` (desired count >= 1, scale by queue depth)
- **ECR**: container image registry
- **RDS for PostgreSQL**: Multi-AZ, backups, encryption at rest
- **ElastiCache for Redis**: replication group, Multi-AZ; evaluate cluster mode vs non-cluster mode for BullMQ
- **Secrets Manager / SSM Parameter Store**: WhatsApp tokens, LLM keys, DB creds
- **CloudWatch**: logs + metrics + alarms
- **WAF** (optional but recommended): protect webhook endpoint from noise/scans

### Option B — EKS (Kubernetes)

**Why**

- Standard platform if the org already runs EKS
- Better ecosystem for custom operators/autoscaling patterns

**Costs/complexity**

- Higher operational overhead than ECS for this app size
- More moving parts (Ingress controller, autoscaling, policy, etc.)

### Option C — Lambda + SQS + Step Functions (more redesign)

**Why**

- Can be cost-effective at very low throughput

**Problems for current design**

- BullMQ assumes Redis; you’d likely rework to **SQS** for queues and re-implement batching/locking semantics
- Summary pipeline may hit Lambda time/memory limits unless split into steps (Step Functions)
- Significant refactor vs current container-first design

## 4) Key decisions to make (discussion checklist)

### 4.1 Compute & scaling

- ECS service counts:
  - API: minimum for HA (2) vs single instance (1) during early pilot
  - Worker: scale based on queue depth and LLM throughput/cost
- Autoscaling signals:
  - ALB request count / target response times (API)
  - BullMQ queue depth / job age / failure rate (Worker)

### 4.2 Networking

- Do we place ECS tasks in **private subnets** with a **NAT Gateway** for outbound internet?
  - Needed for calls to Meta Graph API + LLM APIs.
- Ingress:
  - Use ALB with **ACM TLS** certificate and a stable domain.
  - Consider **WAF** and IP allowlists (Meta IPs can change; allowlisting may be brittle).

### 4.3 Database (RDS Postgres)

- Multi-AZ, storage autoscaling, backups + retention, PITR
- Credentials:
  - traditional user/password in Secrets Manager **vs** IAM auth (optional)
- Connection management:
  - Prisma connection behavior under multiple ECS tasks

### 4.4 Redis (ElastiCache)

- Topology:
  - replication group with Multi-AZ failover
- BullMQ compatibility:
  - confirm whether cluster mode is needed/avoided (BullMQ has constraints depending on setup)
- TLS:
  - ElastiCache in-transit encryption usually implies TLS; current code uses `ioredis` with `REDIS_URL` only.
  - Decide whether to use `rediss://` + TLS options (code/config change may be required).

### 4.5 Secrets & configuration

Secrets (do not put in plain env files in prod):

- WhatsApp: `WHATSAPP_*` tokens/IDs
- LLM keys: `OPENAI_API_KEY`, `GROQ_API_KEY`, `SARVAM_API_KEY`
- DB credentials (or RDS secret)

Non-secrets (config):

- `CONSENT_CONFIG_PATH` (file baked into the image today)
- batching knobs: `REPLY_BATCH_DEBOUNCE_MS`, `REPLY_BATCH_MAX_WAIT_MS`
- `WHATSAPP_TYPING_INDICATOR_ENABLED`

### 4.6 Migrations (Prisma)

Current `docker-compose.yml` runs `pnpm prisma migrate deploy` inside the API container at startup.

On AWS, decide one of these approaches:

1) **CI/CD runs migrations once per deploy** (recommended)
   - Run a one-off ECS task: `pnpm prisma migrate deploy`
   - Then deploy/roll ECS services
2) **API runs migrations on boot**
   - Simple, but risky if multiple API tasks start simultaneously (concurrent migrations)
   - If used, consider limiting API desired count during migration, or adding a DB-level advisory lock strategy

### 4.7 Webhook registration (Meta)

- Production needs a stable HTTPS URL for:
  - `GET /webhooks/whatsapp` verification
  - `POST /webhooks/whatsapp` inbound messages
- Decide how webhook registration is managed:
  - manual in Meta dashboard
  - scripted in CI/CD (if allowed) using Meta APIs
- Any environment separation:
  - dev/stage/prod WhatsApp apps and webhook endpoints

### 4.8 Observability & operations

- Logs:
  - structured logs to CloudWatch
  - avoid logging message bodies or tokens (PII + security)
- Metrics/alarms:
  - API 5xx rate, latency, ALB target health
  - Redis CPU/memory, evictions, connection count
  - RDS CPU/storage, connections, replication lag
  - Worker: queue depth, job failures, job duration, “oldest job age”
- Tracing:
  - optional OpenTelemetry/X-Ray if we want request → job correlation

### 4.9 Security & privacy (important for this product)

- Encryption at rest:
  - RDS encryption enabled
  - ElastiCache encryption enabled (if feasible)
- Encryption in transit:
  - HTTPS everywhere (ALB/ACM)
  - TLS to Redis/RDS if required by policy
- IAM:
  - task role with least privilege (read secrets, write logs)
- Data retention:
  - how long to keep messages/summaries
  - delete flow and audit requirements

## 5) Suggested “first production” AWS layout (concrete proposal)

This is a pragmatic baseline to debate:

- **ECS Fargate** with two services:
  - `mecove-api` behind an **ALB**
  - `mecove-worker` with no ingress
- **RDS Postgres** (Multi-AZ) + **ElastiCache Redis** (Multi-AZ)
- **Secrets Manager** for all external tokens/keys
- **Route53 + ACM** for a stable webhook domain (e.g. `api.<env>.example.com`)
- **CloudWatch** logs + alarms
- **CI/CD**:
  - build once → push to ECR
  - run DB migrate task
  - deploy ECS services (rolling)

## 6) Open questions for the team (bring to the meeting)

1) Expected throughput: users/messages per day, and peak burst assumptions?
2) HA requirements for pilot vs production:
   - Can API/worker be single-instance initially?
3) Data policy:
   - retention duration, deletion expectations, encryption requirements
4) Redis posture:
   - in-transit encryption required? (might need code/config updates)
5) Meta setup:
   - separate WhatsApp apps per environment?
6) Cost guardrails:
   - LLM spend caps, autoscaling limits, budget alarms
7) CI/CD toolchain:
   - GitHub Actions vs CodePipeline, IaC preference (CDK/Terraform/CloudFormation)

