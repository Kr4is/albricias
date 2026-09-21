# Next.js standalone build for the Albricias web app.
# Runs alongside the existing Flask container during the migration.
#
# Debian-slim rather than Alpine: better-sqlite3 (the Prisma 7 SQLite driver
# adapter) is a native module and ships glibc prebuilds, so no compile step.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 ships prebuilt glibc binaries for amd64, but not reliably for
# every arch the multi-arch build targets (arm64 in particular) — install a
# minimal native toolchain so npm ci can compile it from source as a
# fallback instead of failing outright when no prebuild matches.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Generates src/generated/prisma, which is gitignored and required by the build.
RUN npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js statically collects page data at build time, which instantiates the
# Prisma client for pages like /admin/account/api-token. DATABASE_URL only
# needs to be present (not reachable) for this to succeed; the real runtime
# value is provided separately when the container starts.
ENV DATABASE_URL="file:./build-placeholder.db"
# Static page collection queries these tables (empty results are fine, a
# missing schema is not), so migrate the placeholder db before building.
RUN npx prisma migrate deploy
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# chown: media uploads are written into public/uploads at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Kept so `prisma migrate deploy` can be run against the container's database.
# The standalone output only traces what's needed to *run* the app, so the
# prisma CLI itself is missing there — pull the full node_modules from
# `deps` (already `npm ci`-installed at the right versions) to make the
# `prisma` binary available without npx trying to fetch it over the network.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma7.config.ts ./prisma7.config.ts
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
