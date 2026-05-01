#!/usr/bin/env bash
#
# Pre-deploy housekeeping. Run before ./deploy.sh up to free up disk +
# RAM headroom + sanity-check the host has resources for a Next.js
# production build.
#
# Lessons from the 2026-05-01 OOM:
#   - Build needs ~1.5-2GB extra RAM during peak
#   - On a 2GB host with kuiper-app + mysql + redis already running,
#     swap thrashing kills SSH for 20+ minutes
#   - Even on a 4GB host, leftover docker layers from past builds eat
#     disk + (occasionally) memory via dangling buildx caches
#
# What this script does:
#   - check_disk:   warn if free disk < 5GB
#   - check_ram:    warn if free RAM + free swap < 2GB
#   - check_load:   warn if 1m load average > vCPU count × 4
#   - prune_docker: docker system prune --volumes=false (safe)
#   - free_apt:     apt-get clean
#   - report:       summary
#
# Usage:
#   ./deploy-prep.sh           # check + prune
#   ./deploy-prep.sh --check   # check only, no prune
#   ./deploy-prep.sh --aggressive  # also prune dangling volumes (DANGEROUS)

set -euo pipefail

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

MODE="prune"
case "${1:-}" in
  --check)      MODE="check" ;;
  --aggressive) MODE="aggressive" ;;
  --help|-h)
    grep -E '^# ' "$0" | sed 's/^# //'
    exit 0
    ;;
esac

# 1. Disk
DISK_FREE_GB="$(df -BG / | awk 'NR==2{gsub("G","",$4); print $4}')"
if [[ "${DISK_FREE_GB}" -lt 5 ]]; then
  red "[disk] only ${DISK_FREE_GB}GB free on /. Build needs >5GB."
  DISK_WARN=1
else
  green "[disk] ${DISK_FREE_GB}GB free on /."
  DISK_WARN=0
fi

# 2. RAM + swap
RAM_FREE_MB="$(free -m | awk '/^Mem:/{print $7}')"   # available column
SWAP_FREE_MB="$(free -m | awk '/^Swap:/{print $4}')"
TOTAL_FREE_MB=$((RAM_FREE_MB + SWAP_FREE_MB))
if [[ "${TOTAL_FREE_MB}" -lt 2048 ]]; then
  red "[ram] only ${RAM_FREE_MB}MB available + ${SWAP_FREE_MB}MB swap free. Build needs ~2GB. Will likely thrash."
  RAM_WARN=1
else
  green "[ram] ${RAM_FREE_MB}MB available + ${SWAP_FREE_MB}MB swap free."
  RAM_WARN=0
fi

# 3. Load average vs vCPU count
VCPU="$(nproc)"
LOAD_1M="$(awk '{print $1}' /proc/loadavg)"
LOAD_THRESH="$((VCPU * 4))"
if awk -v l="${LOAD_1M}" -v t="${LOAD_THRESH}" 'BEGIN{exit !(l>t)}'; then
  red "[load] 1m=${LOAD_1M} on ${VCPU} vCPU (threshold=${LOAD_THRESH}). System busy."
  LOAD_WARN=1
else
  green "[load] 1m=${LOAD_1M} on ${VCPU} vCPU (ok)."
  LOAD_WARN=0
fi

if [[ "${MODE}" == "check" ]]; then
  if [[ "${DISK_WARN}" == "1" || "${RAM_WARN}" == "1" || "${LOAD_WARN}" == "1" ]]; then
    yellow "[deploy-prep] check found warnings — consider waiting / pruning before deploy"
    exit 1
  fi
  green "[deploy-prep] check ok"
  exit 0
fi

# 4. Prune docker
yellow "[prune] docker system prune (safe — no volumes)"
docker system prune --force --filter "until=24h" || yellow "[prune] docker prune returned non-zero, continuing"

if [[ "${MODE}" == "aggressive" ]]; then
  yellow "[prune] DANGEROUS: also pruning dangling volumes"
  docker volume prune --force || yellow "[prune] volume prune returned non-zero"
fi

# 5. Apt cache
yellow "[apt] apt-get clean"
apt-get clean -y >/dev/null 2>&1 || true

# 6. Final report
yellow "[deploy-prep] post-prune disk:"
df -h / | head -2

yellow "[deploy-prep] post-prune RAM:"
free -h | head -3

green "[deploy-prep] done. Now run ./deploy.sh up"
