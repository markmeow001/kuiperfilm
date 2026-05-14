#!/bin/bash
# Phase C deploy: push the visualStyleId/lightingPresetId schema columns,
# rebuild the app container so worker picks up the new style-library
# integration, and reseed the curated catalog (idempotent).
#
# Usage (on droplet):
#   cd /opt/kuiperAI
#   git pull
#   bash scripts/prod-deploy-style-library.sh
set -euo pipefail
cd /opt/kuiperAI/deploy

echo "==> Push schema (adds visualStyleId / lightingPresetId nullable columns)"
docker compose -p deploy -f docker-compose.prod.yml --env-file .env.prod \
  exec -T app npx prisma db push

echo "==> Re-seed style library (idempotent)"
docker compose -p deploy -f docker-compose.prod.yml --env-file .env.prod \
  exec -T app npx tsx scripts/seed-style-library.ts

echo "==> Rebuild + restart app container so worker loads new code"
docker compose -p deploy -f docker-compose.prod.yml --env-file .env.prod \
  up -d --build app

echo "==> Done. Tail worker logs with:"
echo "    docker compose -p deploy -f docker-compose.prod.yml --env-file .env.prod logs -f --tail=50 app"
