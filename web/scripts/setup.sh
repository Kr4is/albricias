#!/usr/bin/env bash
# One-command local setup: install deps, ensure .env exists, apply migrations.
# Idempotent — safe to re-run; never overwrites an existing .env or database.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "==> Installing dependencies"
npm install

if [ -f .env ]; then
  echo "==> .env already exists, leaving it as is"
else
  echo "==> Creating .env from .env.example"
  cp .env.example .env
fi

echo "==> Generating Prisma client"
npx prisma generate

echo "==> Applying database migrations"
npx prisma migrate deploy

echo
echo "Setup complete. Run 'npm run dev' and open http://localhost:3000"
echo "On first run you'll see the /setup wizard — the only required step is"
echo "the admin password; every other category (AI, GitHub, Spotify, ...) can"
echo "be skipped and configured later from /admin/settings."
