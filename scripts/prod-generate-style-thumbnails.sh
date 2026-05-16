#!/bin/bash
# Phase D — generate the 29 style-library thumbnails on prod via Tencent
# VOD AIGC (Kling Image O1). Idempotent: skips styles that already have
# a thumbnailUrl in the DB.
#
# Usage (on droplet):
#   cd /opt/kuiperAI
#   git pull
#   bash scripts/prod-generate-style-thumbnails.sh           # missing only
#   bash scripts/prod-generate-style-thumbnails.sh --force   # all 29
set -euo pipefail
cd /opt/kuiperAI/deploy
docker compose -p deploy -f docker-compose.prod.yml --env-file .env.prod \
  exec -T app npx tsx scripts/generate-style-thumbnails.ts "$@"
