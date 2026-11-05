ARG NODE_IMAGE=node:24.4.0-bookworm-slim

# ── base ──────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
WORKDIR /app
RUN corepack enable pnpm
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN pnpm install --frozen-lockfile && pnpm prisma generate

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN SKIP_ENV_VALIDATION=1 pnpm build

# ── migrate ───────────────────────────────────────────────────────────────────
# pushed as ghcr.io/fairchan/findmyjob-migrate:<sha>
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node prisma ./prisma
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node_modules/.bin/prisma", "migrate", "deploy"]

# ── tools ─────────────────────────────────────────────────────────────────────
# pushed as ghcr.io/fairchan/findmyjob-tools:<sha>
# for running scripts/ against a live database (seed, backfill, decrypt-verify)
FROM base AS tools
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node src ./src
COPY --chown=node:node tsconfig.json ./tsconfig.json
COPY --chown=node:node package.json ./package.json
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node", "--conditions=react-server", "-r", "tsx/cjs"]

# ── backup ────────────────────────────────────────────────────────────────────
# pushed as ghcr.io/fairchan/findmyjob-backup:<sha>
# deps: postgresql-client-16 (pg_dump, psql), age (encryption), awscli (S3), curl (healthchecks)
FROM postgres:16.6-bookworm AS backup
RUN apt-get update && apt-get install -y --no-install-recommends \
    age \
    awscli \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --chmod=755 deploy/server/findmyjob-backup /opt/findmyjob/bin/findmyjob-backup
RUN install -d -o postgres -g postgres -m 700 /backup-tmp
USER postgres
ENTRYPOINT ["/opt/findmyjob/bin/findmyjob-backup"]

# ── runner (default) ──────────────────────────────────────────────────────────
# Serves the Next.js app (CMD) and also supports the worker service
# (docker-compose overrides CMD to: node --conditions=react-server -r tsx/cjs src/worker.ts)
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Standalone output first (server.js, .next/server/, minimal node_modules)
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Full node_modules (with Prisma client and tsx) overwrites standalone minimal node_modules
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# Worker source and config needed to run src/worker.ts with tsx
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node
CMD ["node", "server.js"]
