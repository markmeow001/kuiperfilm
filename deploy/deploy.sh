#!/usr/bin/env bash
#
# kuiperAI deployment helper for DigitalOcean (or any Ubuntu/Debian host).
#
# Usage:
#   ./deploy.sh bootstrap       # First-time setup on a fresh droplet
#   ./deploy.sh init-secrets    # Print a block of fresh secrets to stdout
#   ./deploy.sh up              # Build + start the stack
#   ./deploy.sh down            # Stop the stack
#   ./deploy.sh logs            # Tail caddy + app + mysql logs
#   ./deploy.sh status          # Show container + health status
#   ./deploy.sh update          # git pull + rebuild + restart
#   ./deploy.sh backup          # mysqldump + tar app-data into ./backups/
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.prod"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
COMPOSE="docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE}"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

require_env() {
  if [[ ! -f "${ENV_FILE}" ]]; then
    red "Missing ${ENV_FILE}. Copy .env.prod.example to .env.prod and fill it in."
    red "Tip: run \`./deploy.sh init-secrets\` to generate strong values."
    exit 1
  fi
  # Reject anything that isn't KEY=value, blank, or '# comment'.
  # Sourcing such a line would execute it as a shell command — which
  # is exactly how a stray './deploy.sh up' pasted into .env.prod
  # turned into a fork bomb in the past.
  local bad
  bad="$(grep -nvE '^([A-Za-z_][A-Za-z0-9_]*=.*|#.*|[[:space:]]*)$' "${ENV_FILE}" || true)"
  if [[ -n "${bad}" ]]; then
    red "Refusing to source ${ENV_FILE}: lines that are not KEY=value / # comment / blank:"
    while IFS= read -r line; do red "  ${line}"; done <<< "${bad}"
    red "Edit the file so every non-comment line is KEY=value, then re-run."
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
  : "${DOMAIN:?DOMAIN missing in .env.prod}"
  : "${CADDY_EMAIL:?CADDY_EMAIL missing in .env.prod}"
  : "${NEXTAUTH_URL:?NEXTAUTH_URL missing}"
  : "${NEXTAUTH_SECRET:?NEXTAUTH_SECRET missing}"
  if (( ${#NEXTAUTH_SECRET} < 32 )); then
    red "NEXTAUTH_SECRET must be at least 32 characters (got ${#NEXTAUTH_SECRET})."
    exit 1
  fi
  : "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD missing}"
  : "${ADMIN_USERNAME:?ADMIN_USERNAME missing}"
  : "${ADMIN_PASSWORD:?ADMIN_PASSWORD missing}"
  if (( ${#ADMIN_PASSWORD} < 8 )); then
    red "ADMIN_PASSWORD must be at least 8 characters."
    exit 1
  fi
  : "${API_ENCRYPTION_KEY:?API_ENCRYPTION_KEY missing}"
  if [[ ! "${API_ENCRYPTION_KEY}" =~ ^[0-9a-fA-F]{64}$ ]]; then
    red "API_ENCRYPTION_KEY must be a 64-character hex string (openssl rand -hex 32)."
    exit 1
  fi
}

cmd_bootstrap() {
  yellow "==> Installing Docker + Compose plugin (idempotent)"
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  fi
  if ! docker compose version >/dev/null 2>&1; then
    apt-get update
    apt-get install -y docker-compose-plugin
  fi
  yellow "==> Configuring UFW (allow 22, 80, 443)"
  if command -v ufw >/dev/null 2>&1; then
    ufw allow 22/tcp || true
    ufw allow 80/tcp || true
    ufw allow 443/tcp || true
    ufw --force enable || true
  fi
  green "Bootstrap complete."
  green "Next: cp .env.prod.example .env.prod  &&  edit  &&  ./deploy.sh up"
  green "Tip: run \`./deploy.sh init-secrets\` to generate strong random values."
}

cmd_init_secrets() {
  cat <<EOF
# Paste these into .env.prod and edit DOMAIN / CADDY_EMAIL / etc.

NEXTAUTH_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 16)
INTERNAL_TASK_TOKEN=$(openssl rand -hex 16)
API_ENCRYPTION_KEY=$(openssl rand -hex 32)
MYSQL_ROOT_PASSWORD=$(openssl rand -hex 24)
ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '/=+' | cut -c1-20)
EOF
}

cmd_up() {
  require_env
  yellow "==> Building images (this can take 5-10 min on first run)"
  ${COMPOSE} build --pull
  yellow "==> Starting stack"
  ${COMPOSE} up -d
  yellow "==> Waiting for app health check..."
  for i in {1..60}; do
    status="$(docker inspect -f '{{.State.Health.Status}}' kuiper-app 2>/dev/null || echo unknown)"
    if [[ "${status}" == "healthy" ]]; then
      green "Stack is up and healthy."
      green "App:  https://${DOMAIN}"
      green "Admin: https://${DOMAIN}/zh/admin/users"
      return
    fi
    sleep 3
  done
  red "App did not become healthy in 180s. Tail logs with: ./deploy.sh logs"
  exit 1
}

cmd_down() {
  require_env
  ${COMPOSE} down
}

cmd_logs() {
  require_env
  ${COMPOSE} logs -f --tail=200
}

cmd_status() {
  require_env
  ${COMPOSE} ps
  echo
  yellow "Health checks:"
  for c in kuiper-app kuiper-mysql kuiper-redis kuiper-caddy; do
    s="$(docker inspect -f '{{.State.Health.Status}}' "${c}" 2>/dev/null || echo no-healthcheck)"
    printf '%-18s %s\n' "${c}" "${s}"
  done
}

_wait_healthy() {
  for _ in {1..60}; do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' kuiper-app 2>/dev/null || echo unknown)" == "healthy" ]] && return 0
    sleep 3
  done
  return 1
}

cmd_update() {
  require_env
  local nocache=""
  [[ "${1:-}" == "--no-cache" ]] && nocache="--no-cache"
  yellow "==> Pulling latest source"
  cd "${REPO_ROOT}"
  git fetch --all
  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  local before after n
  before="$(git rev-parse HEAD)"
  git pull --ff-only origin "${current_branch}"
  after="$(git rev-parse HEAD)"
  n="$(git rev-list --count "${before}..${after}" 2>/dev/null || echo 1)"
  (( n < 1 )) && n=1
  yellow "==> Rebuilding + restarting ${nocache:+(no-cache)}"
  cd "${SCRIPT_DIR}"
  ${COMPOSE} build ${nocache} --pull app
  ${COMPOSE} up -d app
  _wait_healthy || { red "App did not become healthy. ./deploy.sh logs"; exit 1; }

  # A cached build can "succeed" yet bake a STALE runtime file (Docker COPY
  # cache miss — hit 2026-06-17). Verify the container actually has the new
  # prompts / worker source; if not, auto-recover with a clean rebuild.
  yellow "==> Verifying the running container has the new runtime files"
  if bash "${REPO_ROOT}/deploy/verify-deploy.sh" "${n}"; then
    green "Update complete + verified."
    return
  fi
  red "==> STALE files detected — auto-recovering with a --no-cache rebuild"
  ${COMPOSE} build --no-cache --pull app
  ${COMPOSE} up -d app
  _wait_healthy || { red "App did not become healthy after no-cache rebuild."; exit 1; }
  if bash "${REPO_ROOT}/deploy/verify-deploy.sh" "${n}"; then
    green "Recovered — update complete + verified after --no-cache rebuild."
  else
    red "Still stale after --no-cache. Investigate manually (./deploy/verify-deploy.sh ${n})."
    exit 1
  fi
}

cmd_backup() {
  require_env
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  out_dir="${SCRIPT_DIR}/backups"
  mkdir -p "${out_dir}"

  yellow "==> 1/2 mysqldump → ${out_dir}/mysql-${ts}.sql.gz"
  docker exec kuiper-mysql sh -c \
    "exec mysqldump -uroot -p\"${MYSQL_ROOT_PASSWORD}\" --single-transaction --routines --triggers \"${MYSQL_DATABASE:-kuiper}\"" \
    | gzip > "${out_dir}/mysql-${ts}.sql.gz"

  yellow "==> 2/2 tar app-data + caddy-data → ${out_dir}/volumes-${ts}.tar.gz"
  docker run --rm \
    -v kuiper-multiuser_app-data:/v/app-data:ro \
    -v kuiper-multiuser_caddy-data:/v/caddy-data:ro \
    -v "${out_dir}:/backup" \
    alpine:3.19 \
    tar -czf "/backup/volumes-${ts}.tar.gz" -C /v .

  green "Backup written to ${out_dir} (${ts})."
}

case "${1:-}" in
  bootstrap)    cmd_bootstrap ;;
  init-secrets) cmd_init_secrets ;;
  up)           cmd_up ;;
  down)         cmd_down ;;
  logs)         cmd_logs ;;
  status)       cmd_status ;;
  update)       cmd_update "${2:-}" ;;
  verify)       bash "${REPO_ROOT}/deploy/verify-deploy.sh" "${2:-1}" ;;
  backup)       cmd_backup ;;
  *)
    cat <<EOF
Usage: $(basename "$0") <command>

Commands:
  bootstrap     Install Docker + open firewall ports (run once on a fresh host)
  init-secrets  Print a block of fresh random secrets — copy into .env.prod
  up            Build images and start the stack (mysql + redis + app + caddy)
  down          Stop the stack (data preserved)
  logs          Tail logs from all services
  status        Show container + per-service health
  update        git pull, rebuild, restart, then VERIFY the container has the
                new runtime files (auto --no-cache rebuild if a stale bake is
                detected). Pass --no-cache to force a clean rebuild up front.
  verify [N]    Check the running container actually has the committed runtime
                files from the last N commits (default 1). Catches cache-miss
                stale bakes. Exits 1 if stale.
  backup        mysqldump + tar app-data into ./backups/

Required: ${ENV_FILE} (copy .env.prod.example and edit)
EOF
    exit 1
    ;;
esac
