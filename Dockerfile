# syntax=docker/dockerfile:1

FROM node:20-slim AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml* ./
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY consent.config.yaml ./

RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else pnpm install; fi

COPY tsconfig.json ./
COPY src ./src

RUN pnpm prisma generate
RUN pnpm build
RUN cp src/llm/llm.yaml dist/llm/llm.yaml
RUN mkdir -p dist/summary/template/images && cp src/summary/template/sessionbridge-report.html src/summary/template/styles.css dist/summary/template/ && cp src/summary/template/images/* dist/summary/template/images/ 2>/dev/null || true
RUN pnpm prune --prod

FROM node:20-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN corepack enable

COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-lock.yaml* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/consent.config.yaml ./
COPY --from=build /app/dist/summary/template ./dist/summary/template

# Prisma CLI may need to download/write engine binaries at runtime (e.g., during migrations).
# Ensure the non-root `node` user can write to /app (including node_modules).
RUN chown -R node:node /app

USER node
