#!/usr/bin/env bash
# Run the Tencent VOD credential smoke test inside the production app
# container, with all the docker-compose / env-file plumbing pre-baked
# so you don't have to fight terminal line-wrapping when pasting long
# `docker compose exec` invocations.
#
# Usage (on the droplet):
#   cd /opt/kuiperAI
#   ./deploy/smoke-vod.sh                  # uses first admin user
#   ./deploy/smoke-vod.sh --user <userId>  # explicit user
#   DEBUG=1 ./deploy/smoke-vod.sh          # verbose SDK error output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="deploy/docker-compose.prod.yml"
ENV_FILE="deploy/.env.prod"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[smoke-vod] $ENV_FILE not found — make sure you're on the droplet at /opt/kuiperAI" >&2
  exit 1
fi

# Forward DEBUG flag if set, plus any extra args (e.g. --user <id>)
DEBUG_ENV=()
if [[ "${DEBUG:-}" == "1" ]]; then
  DEBUG_ENV=(-e DEBUG=1)
fi

exec docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" \
  exec "${DEBUG_ENV[@]}" app \
  sh -c 'cd /app && npx --no-install tsx --env-file=deploy/.env.prod scripts/tencent-vod-smoke.ts "$@"' \
  -- "$@"
