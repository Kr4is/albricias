#!/usr/bin/env bash
# One-command local setup: install deps, ensure .env exists.
# Idempotent — safe to re-run; never overwrites an existing .env.
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

echo
echo "Setup complete. Run 'npm run dev' and open http://localhost:3000"
