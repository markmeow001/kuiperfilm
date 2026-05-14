#!/bin/bash
# Run style-library seed inside the prod app container.
# Idempotent: safe to re-run after content edits.
#
# Usage (on droplet):
#   cd /opt/kuiperAI
#   git pull
#   bash scripts/prod-seed-style.sh
set -euo pipefail
cd /opt/kuiperAI/deploy
docker compose -p deploy -f docker-compose.prod.yml --env-file .env.prod \
  exec -T app npx tsx scripts/seed-style-library.ts
