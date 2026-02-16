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
RUN pnpm prune --prod

FROM node:20-slim AS runtime
WORKDIR /app

RUN corepack enable

COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-lock.yaml* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
COPY --from=build /app/consent.config.yaml ./

USER node

