# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:24.4.0-bookworm-slim

# ── base ──────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
WORKDIR /app
RUN corepack enable pnpm

# ── deps ──────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN SKIP_ENV_VALIDATION=1 pnpm build

# ── runner (default) ──────────────────────────────────────────────────────────
# Serves the Next.js app (CMD) and also supports the worker service
# (docker-compose overrides CMD to: node --conditions=react-server -r tsx/cjs src/worker.ts)
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Full node_modules first (includes tsx for worker runtime)
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# Next.js standalone output overwrites the above node_modules dir – re-add full deps after
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Restore full node_modules so tsx (devDep used by worker) is available
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# Worker source and config needed to run src/worker.ts with tsx
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=node:node /app/package.json ./package.json
USER node
CMD ["node", "server.js"]

# ── migrate ───────────────────────────────────────────────────────────────────
# pushed as ghcr.io/fairchan/findmyjob-migrate:<sha>
FROM base AS migrate
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node prisma ./prisma
ENV NODE_ENV=production
USER node
ENTRYPOINT ["node_modules/.bin/prisma", "migrate", "deploy"]

# ── tools (not pushed) ────────────────────────────────────────────────────────
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
USER postgres
ENTRYPOINT ["/opt/findmyjob/bin/findmyjob-backup"]
