#!/usr/bin/env bash
#
# Nightly MySQL backup → upload to Cloudflare R2.
#
# Lessons from the 2026-05-01 OOM incident: we have NO database backup.
# If the droplet had truly corrupted InnoDB during swap thrashing, every
# user / project / character / panel row would be gone with no recovery.
#
# This script:
#   1. mysqldump the database (name from MYSQL_DATABASE in .env.prod,
#      default "kuiper") from the running container
#   2. gzip + timestamp the dump
#   3. upload to a separate R2 bucket (off-host, off-droplet)
#   4. keep the 14 most recent local copies, prune older
#
# Usage (manual):
#   ./db-backup.sh
#
# Usage (cron — recommended every day at 03:00 UTC):
#   0 3 * * * cd /opt/kuiperAI/deploy && ./db-backup.sh >> /var/log/kuiper-backup.log 2>&1
#
# Pre-reqs in .env.prod:
#   - MYSQL_ROOT_PASSWORD (already there)
#   - R2_BACKUP_BUCKET             (separate from kuiperfilm-storage;
#                                   recommend kuiperfilm-backups so a
#                                   deletion-cascade in the main bucket
#                                   can't take backups too)
#   - R2_BACKUP_ACCESS_KEY_ID      (intentionally distinct from the main
#   - R2_BACKUP_SECRET_ACCESS_KEY   app's R2_ACCESS_KEY_ID — issue a
#   - R2_BACKUP_ENDPOINT            separate API token scoped only to
#                                   the backup bucket)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.prod"
BACKUP_DIR="${SCRIPT_DIR}/backups/db"
RETENTION_DAYS=14
# DB name comes from MYSQL_DATABASE in .env.prod (defaults to "kuiper" per
# docker-compose.prod.yml). Hardcoding "kuiperai" was a porting leftover.
DB_NAME_DEFAULT="kuiper"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

if [[ ! -f "${ENV_FILE}" ]]; then
  red "Missing ${ENV_FILE}"
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

if [[ -z "${MYSQL_ROOT_PASSWORD:-}" ]]; then
  red "MYSQL_ROOT_PASSWORD not set in .env.prod"
  exit 1
fi

DB_NAME="${MYSQL_DATABASE:-${DB_NAME_DEFAULT}}"

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
DUMP_NAME="${DB_NAME}-${TIMESTAMP}.sql.gz"
LOCAL_PATH="${BACKUP_DIR}/${DUMP_NAME}"

green "[backup] dumping ${DB_NAME} → ${LOCAL_PATH}"

# Pipe directly through gzip so we don't write the uncompressed dump to disk
# (saves IO on a swap-strained host).
docker exec kuiper-mysql mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --quick \
  -u root -p"${MYSQL_ROOT_PASSWORD}" \
  "${DB_NAME}" \
  | gzip -9 \
  > "${LOCAL_PATH}"

DUMP_SIZE="$(du -h "${LOCAL_PATH}" | cut -f1)"
green "[backup] dump complete: ${DUMP_SIZE}"

# Upload to R2 if credentials present.
# These env vars are intentionally distinct from the main app's R2_*
# (which writes to kuiperfilm-storage). The backup token must be scoped
# only to R2_BACKUP_BUCKET so a leaked main token can't reach backups.
if [[ -n "${R2_BACKUP_BUCKET:-}" && -n "${R2_BACKUP_ACCESS_KEY_ID:-}" && -n "${R2_BACKUP_SECRET_ACCESS_KEY:-}" && -n "${R2_BACKUP_ENDPOINT:-}" ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    yellow "[backup] aws CLI missing — skip R2 upload. Install: apt install awscli"
  else
    green "[backup] uploading to s3://${R2_BACKUP_BUCKET}/db/${DUMP_NAME}"
    AWS_ACCESS_KEY_ID="${R2_BACKUP_ACCESS_KEY_ID}" \
    AWS_SECRET_ACCESS_KEY="${R2_BACKUP_SECRET_ACCESS_KEY}" \
    aws s3 cp "${LOCAL_PATH}" "s3://${R2_BACKUP_BUCKET}/db/${DUMP_NAME}" \
      --endpoint-url "${R2_BACKUP_ENDPOINT}" \
      --no-progress
    green "[backup] uploaded"
  fi
else
  yellow "[backup] R2_BACKUP_* env vars missing — local-only backup. Add R2_BACKUP_BUCKET/R2_BACKUP_ACCESS_KEY_ID/R2_BACKUP_SECRET_ACCESS_KEY/R2_BACKUP_ENDPOINT to .env.prod"
fi

# Prune local copies older than RETENTION_DAYS
yellow "[backup] pruning local copies older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name "${DB_NAME}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete -print

green "[backup] done"
