# meCove Backend

A Node.js backend service for meCove, handling WhatsApp webhooks, message processing, and AI-powered summary generation using BullMQ job queues.

## 🏗️ Architecture

- **API Server**: HTTP server handling webhooks and API requests
- **Worker**: Background job processor for async tasks (summary generation)
- **PostgreSQL**: Primary database (via Prisma ORM)
- **Redis**: Job queue backend (BullMQ)
- **Docker Compose**: Local development environment

### System Flow

1. **WhatsApp Message Arrives**:
   - Meta/Facebook sends webhook POST to `/webhooks/whatsapp`
   - API validates and processes the message
   - Creates/finds User and Identity for the sender
   - Stores Message in database
   - For normal text: appends to a Redis reply batch and waits for inactivity
   - Worker generates one combined acknowledgment reply for the batch
   - Optionally enqueues a `generateSummary` job based on LLM intent

2. **Summary Generation**:
   - Worker picks up `generateSummary` job from Redis queue
   - Loads last 7 days of messages for the user
   - Calls LLM to generate summary
   - Creates Summary record in database
   - Logs completion

## 📋 Prerequisites

- **Node.js** >= 20
- **pnpm** (install globally: `npm install -g pnpm`)
- **Docker** and **Docker Compose** (for local development)
- **PostgreSQL** 16+ (or use Docker)
- **Redis** 7+ (or use Docker)

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd mecove-backend
pnpm install
```

### 2. Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Required environment variables:

```env
# Database
DATABASE_URL=postgresql://mecove:mecove@localhost:5432/mecove

# Redis
REDIS_URL=redis://localhost:6379

# WhatsApp (for webhooks and replies)
WHATSAPP_APP_ID=your_app_id
WHATSAPP_APP_SECRET=your_app_secret
WHATSAPP_VERIFY_TOKEN=your_verify_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_PERMANENT_TOKEN=your_permanent_token

# LLM (for summary generation and acknowledgment replies)
GROQ_API_KEY=your_groq_api_key

# Consent gate config
CONSENT_CONFIG_PATH=consent.config.yaml

# Reply batching
REPLY_BATCH_DEBOUNCE_MS=5000
REPLY_BATCH_MAX_WAIT_MS=15000

# Optional native WhatsApp typing indicator while composing batch reply
WHATSAPP_TYPING_INDICATOR_ENABLED=false

# Optional: ngrok for webhook tunneling
NGROK_AUTHTOKEN=your_ngrok_token
NGROK_TARGET=api:3000
NGROK_ADMIN_URL=http://localhost:4040
```

### 3. Start Services with Docker

```bash
docker compose up -d
```

For a full Docker run, set `NGROK_TARGET=api:3000` so ngrok forwards to the API container. Use `NGROK_TARGET=host.docker.internal:3000` only when the API is running on the host with `pnpm dev:api`.

This starts:
- PostgreSQL on port `5432`
- Redis on port `6379`
- API server on port `3000`
- Worker process
- ngrok (optional, if configured)

### 4. Run Database Migrations

The API container automatically runs migrations on startup. For manual migration:

```bash
pnpm prisma migrate deploy
```

Or for development:

```bash
pnpm prisma migrate dev
```

## 💻 Development

### Local Development (without Docker)

1. **Start PostgreSQL and Redis** (via Docker or locally):
   ```bash
   docker compose up -d postgres redis
   ```

2. **Run migrations**:
   ```bash
   pnpm prisma migrate deploy
   ```

3. **Generate Prisma Client**:
   ```bash
   pnpm prisma generate
   ```

4. **Start API server** (with hot reload):
   ```bash
   pnpm dev:api
   ```

5. **Start worker** (in another terminal):
   ```bash
   pnpm dev:worker
   ```

6. **Puppeteer (summary PDFs)** — If you run the worker locally, PDF generation needs Chrome. Install it once:
   ```bash
   npx puppeteer browsers install chrome
   ```
   (In Docker, the image uses system Chromium; no extra step needed.)

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev:api` | Start API server with hot reload (tsx watch) |
| `pnpm dev:worker` | Start worker with hot reload (tsx watch) |
| `pnpm build` | Compile TypeScript to JavaScript |
| `pnpm start:api` | Start API server (production mode) |
| `pnpm start:worker` | Start worker (production mode) |
| `pnpm db:smoke` | Run database smoke test (creates test data) |
| `pnpm sync:webhook` | Sync WhatsApp webhook with Meta/Facebook (requires ngrok) |
| `pnpm prisma format` | Format Prisma schema |
| `pnpm prisma migrate dev` | Create and apply migration |
| `pnpm prisma migrate deploy` | Apply pending migrations |
| `pnpm prisma generate` | Generate Prisma Client |
| `pnpm prisma studio` | Open Prisma Studio (DB GUI) |
| `pnpm db:wipe` | Wipe all data (requires `ALLOW_DB_WIPE=true` + `--confirm <DB_NAME>`) |
| `pnpm seed:chat [file] --phone <phone>` | Seed DB with chat data from a JSON file for a WhatsApp phone number |
| `pnpm seed:generate [yaml]` | LLM-generate chat data from a YAML config and optionally seed DB |

See [`docs/seed-generation.md`](docs/seed-generation.md) for the full seed data workflow and JSON format.

## 🗄️ Database

### Schema Overview

- **User**: Represents a user in the system
- **Identity**: User identity on a channel (e.g., WhatsApp phone number)
- **Message**: Messages from users (linked to Identity and User)
- **Summary**: AI-generated summaries of message ranges

### Prisma Commands

```bash
# Format schema
pnpm prisma format

# Create migration
pnpm prisma migrate dev --name migration_name

# Apply migrations
pnpm prisma migrate deploy

# Generate Prisma Client
pnpm prisma generate

# Open Prisma Studio
pnpm prisma studio
```

### Database Smoke Test

Test database connectivity and create sample data:

```bash
pnpm db:smoke
```

This creates:
- A test user
- A WhatsApp identity (`channel="whatsapp"`, `channelUserKey="+10000000000"`)
- A test message

## 🔌 API Endpoints

### Health Check

```http
GET /health
```

Returns: `OK`

### WhatsApp Webhook

```http
GET /webhooks/whatsapp
POST /webhooks/whatsapp
```

Handles incoming WhatsApp messages and webhook verification.

**Verification** (GET):
- Query param: `hub.mode` must be `"subscribe"`
- Query param: `hub.verify_token` must match `WHATSAPP_VERIFY_TOKEN`
- Query param: `hub.challenge` is echoed back

**Message Processing** (POST):
- Processes incoming text messages
- Creates or finds user and identity for the sender phone number
- Stores messages in database (upsert by `identityId` + `sourceMessageId`)
- For slash commands (`/chatlog`, `/clear`, `/f`): executes immediately when no batch is pending
- For normal text: batches messages in Redis, waits for inactivity, then sends one combined AI acknowledgment reply
- Optionally enqueues summary generation (`generateSummary`) when LLM detects summary intent

**Webhook Setup**:
Use the `sync:webhook` script to automatically configure the webhook with Meta/Facebook:

```bash
# Start ngrok first (via docker compose or standalone)
docker compose up -d ngrok

# Sync webhook (reads ngrok URL and configures Meta)
pnpm sync:webhook
```

This script:
1. Fetches the public HTTPS URL from ngrok
2. Configures Meta/Facebook webhook subscription pointing to `{ngrok_url}/webhooks/whatsapp`
3. Uses `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_VERIFY_TOKEN`

### Debug Endpoints

#### Enqueue Summary Job

```http
POST /debug/enqueue-summary
```

Enqueues a summary generation job for the test user/identity.

**Response:**
```json
{
  "ok": true,
  "jobId": "job-id-here"
}
```

## 🔄 Job Queue (BullMQ)

### Summary Queue

The worker processes jobs from the `summary` queue:

- **Job Name**: `generateSummary`
- **Payload**: `{ userId: string, range: "last_7_days" }`
- **Process**: 
  - Loads messages from the last 7 days for the user
  - Generates a summary using the configured LLM
  - Creates a `Summary` record in the database with:
    - `rangeStart`: 7 days ago
    - `rangeEnd`: now
    - `status`: "success"
    - `summaryText`: Generated summary text
    - `inputMessagesCount`: Number of messages processed
    - `inputHash`: SHA-256 hash of message IDs and texts (first 32 chars)

**Note**: Summary jobs are automatically enqueued when new WhatsApp messages arrive.

### Queue Configuration

- **Queue Name**: `summary`
- **Connection**: Redis (via `REDIS_URL`)
- **Job Retention**: Keeps last 1000 completed jobs

## 🐳 Docker

### Build Images

```bash
docker compose build
```

### Start Services

```bash
docker compose up -d
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api
docker compose logs -f worker
```

### Stop Services

```bash
docker compose down
```

### Clean Volumes

```bash
docker compose down -v
```

## 📁 Project Structure

```
mecove-backend/
├── src/
│   ├── api/
│   │   └── server.ts          # HTTP API server
│   ├── worker/
│   │   └── worker.ts          # BullMQ worker
│   ├── infra/
│   │   ├── prisma.ts          # Prisma client setup
│   │   ├── redis.ts           # Redis connection
│   │   └── logger.ts          # Logging utilities
│   ├── queues/
│   │   └── summaryQueue.ts    # BullMQ queue definition
│   ├── llm/
│   │   ├── index.ts           # LLM integration exports
│   │   ├── ackReply.ts        # Acknowledgment reply generation
│   │   ├── config.ts           # LLM configuration loader
│   │   ├── llmViaApi.ts       # LLM API client implementation
│   │   ├── types.ts            # LLM type definitions
│   │   └── llm.yaml           # LLM prompts/config
│   └── scripts/
│       └── db_smoke.ts        # Database smoke test
├── scripts/
│   └── syncMetaWebhook.ts    # WhatsApp webhook sync script
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── migrations/            # Database migrations
├── docker-compose.yml         # Docker services
├── Dockerfile                 # Docker build config
├── prisma.config.ts           # Prisma 7 config
└── package.json
```

## 🔧 Configuration

### Prisma 7 Configuration

Database connection is configured in `prisma.config.ts` (not in `schema.prisma`):

```typescript
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
```

### LLM Configuration

LLM prompts and configuration are in `src/llm/llm.yaml`. API key is set via `GROQ_API_KEY` environment variable.

The LLM is used for:
- **Summary Generation**: Creating summaries of message ranges (processed by worker)
- **Acknowledgment Replies**: Generating conversational replies to incoming WhatsApp messages

**Acknowledgment Reply Flow**:
1. When a WhatsApp message arrives, the system fetches the last 10 messages for that user
2. Passes them to the LLM with a prompt asking for a short, friendly acknowledgment
3. Sends the generated reply back to WhatsApp (if configured)

## 🧪 Testing

### Database Smoke Test

```bash
pnpm db:smoke
```

This creates test data:
- A user
- A WhatsApp identity (`channel="whatsapp"`, `channelUserKey="+10000000000"`)
- A test message

### Manual API Testing

```bash
# Health check
curl http://localhost:3000/health

# Enqueue summary job (requires test identity from db:smoke)
curl -X POST http://localhost:3000/debug/enqueue-summary

# Test WhatsApp webhook verification
curl "http://localhost:3000/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test123"
```

### WhatsApp Webhook Testing

1. **Start ngrok** (if testing locally):
   ```bash
   docker compose up -d ngrok
   # Or use ngrok directly: ngrok http 3000
   ```

2. **Sync webhook with Meta**:
   ```bash
   pnpm sync:webhook
   ```

3. **Send a test message** from WhatsApp to your configured phone number

4. **Check logs**:
   ```bash
   docker compose logs -f api worker
   ```

## 🚨 Troubleshooting

### Prisma Client Not Found

If you see `Module '@prisma/client' has no exported member 'PrismaClient'`:

```bash
pnpm prisma generate
```

### Redis Connection Failed

Ensure Redis is running and `REDIS_URL` is correct:

```bash
# Check Redis
docker compose ps redis
redis-cli -u $REDIS_URL ping
```

### Database Connection Failed

Check PostgreSQL is running and `DATABASE_URL` is correct:

```bash
# Check PostgreSQL
docker compose ps postgres
psql $DATABASE_URL -c "SELECT 1"
```

### Worker Not Processing Jobs

1. Check worker logs: `docker compose logs worker`
2. Verify Redis connection
3. Ensure jobs are being enqueued (check API logs)
4. Verify `GROQ_API_KEY` is set (required for summary generation)

### WhatsApp Replies Not Sending

If replies aren't being sent:
1. Check API logs for warnings about missing WhatsApp credentials
2. Verify `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_PERMANENT_TOKEN` are set
3. Ensure the tokens have permission to send messages
4. Check Meta/Facebook API status

### Webhook Verification Failing

1. Ensure `WHATSAPP_VERIFY_TOKEN` matches what's configured in Meta
2. Check the webhook URL is accessible (use ngrok for local testing)
3. Verify the webhook is properly configured: `pnpm sync:webhook`
4. Check API logs for verification attempts

## 📝 Environment Variables Reference

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string | - |
| `REDIS_URL` | ✅ | Redis connection string | - |
| `WHATSAPP_APP_ID` | ⚠️ | WhatsApp App ID (for webhook setup) | - |
| `WHATSAPP_APP_SECRET` | ⚠️ | WhatsApp App Secret (for webhook setup) | - |
| `WHATSAPP_VERIFY_TOKEN` | ⚠️ | Webhook verification token | - |
| `WHATSAPP_PHONE_NUMBER_ID` | ⚠️ | WhatsApp Phone Number ID (for sending replies) | - |
| `WHATSAPP_PERMANENT_TOKEN` | ⚠️ | WhatsApp Permanent Access Token (for sending replies) | - |
| `GROQ_API_KEY` | ⚠️ | Groq API key for LLM (summaries & replies) | - |
| `REPLY_BATCH_DEBOUNCE_MS` | ❌ | Inactivity debounce before batch flush (ms) | `5000` |
| `REPLY_BATCH_MAX_WAIT_MS` | ❌ | Max wait before forced batch flush (ms) | `15000` |
| `WHATSAPP_TYPING_INDICATOR_ENABLED` | ❌ | Enable best-effort native typing indicator | `false` |
| `PORT` | ❌ | API server port | `3000` |
| `NGROK_AUTHTOKEN` | ❌ | ngrok auth token (for webhook tunneling) | - |
| `NGROK_TARGET` | ❌ | ngrok target host (`api:3000` or `host.docker.internal:3000`) | `api:3000` |
| `NGROK_ADMIN_URL` | ❌ | ngrok admin API URL | `http://localhost:4040` |

## 🔐 Security Notes

- Never commit `.env` files
- Use strong passwords in production
- Rotate API keys regularly
- Use environment-specific configurations
- Validate webhook tokens

## 📚 Tech Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **Framework**: Native Node.js HTTP
- **ORM**: Prisma 7
- **Database**: PostgreSQL 16
- **Queue**: BullMQ (Redis-backed)
- **Package Manager**: pnpm
- **Containerization**: Docker & Docker Compose

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests: `pnpm db:smoke`
4. Ensure build passes: `pnpm build`
5. Submit a pull request

## 📄 License

[Add your license here]

## 🔗 Related Documentation

- [AWS deployment architecture discussion](docs/aws-architecture-discussion.md)
- [AWS MVP setup runbook (resume context)](docs/aws-mvp-setup-runbook.md)
- [Prisma Documentation](https://www.prisma.io/docs)
- [BullMQ Documentation](https://docs.bullmq.io)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)
- [Meta Webhooks](https://developers.facebook.com/docs/graph-api/webhooks)
- [Groq API](https://console.groq.com/docs)
