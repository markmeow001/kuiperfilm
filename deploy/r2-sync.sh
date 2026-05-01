#!/usr/bin/env bash
#
# Daily cross-bucket mirror: kuiperfilm-storage → kuiperfilm-backups/storage/
#
# Cloudflare R2 dashboard does not expose Object Versioning, so a
# stray `wrangler r2 object delete` or a leaked main API token could
# wipe every user-generated panel image / video / zip pack with no
# in-bucket recovery. This script mirrors the entire main bucket into
# a separate backup bucket every night so we always have a recent
# off-bucket copy.
#
# Idempotent: each run HEADs every source object against the backup
# bucket and only copies what's missing — daily reruns are cheap and
# safe, only newly-generated assets get transferred.
#
# Pairs with db-backup.sh (which uses the same R2_BACKUP_* creds for
# MySQL dumps under db/). Layout in the backup bucket ends up:
#
#   kuiperfilm-backups/
#     ├── db/kuiperai-{ts}.sql.gz       ← from db-backup.sh
#     └── storage/                       ← this script
#         ├── images/...
#         ├── exports/...
#         └── ...
#
# Usage (manual):
#   ./r2-sync.sh
#
# Usage (cron — recommended daily 04:00 UTC, an hour after db-backup):
#   0 4 * * * cd /opt/kuiperAI/deploy && ./r2-sync.sh >> /var/log/kuiper-r2-sync.log 2>&1
#
# Pre-reqs in .env.prod (same set as db-backup.sh):
#   - R2_BACKUP_BUCKET             (e.g. kuiperfilm-backups)
#   - R2_BACKUP_ACCESS_KEY_ID      (token scoped only to R2_BACKUP_BUCKET)
#   - R2_BACKUP_SECRET_ACCESS_KEY
#   - R2_BACKUP_ENDPOINT           (https://<account-id>.r2.cloudflarestorage.com)
#
# Plus the main app's own R2 creds (already present, used to read source):
#   - R2_BUCKET_NAME               (kuiperfilm-storage)
#   - R2_ACCESS_KEY_ID
#   - R2_SECRET_ACCESS_KEY
#   - R2_ACCOUNT_ID                (used to derive source endpoint)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.prod"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

if [[ ! -f "${ENV_FILE}" ]]; then
  red "Missing ${ENV_FILE}"
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

# Source side (main bucket)
: "${R2_BUCKET_NAME:?R2_BUCKET_NAME not set in .env.prod}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID not set in .env.prod}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY not set in .env.prod}"
: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID not set in .env.prod}"

# Destination side (backup bucket)
: "${R2_BACKUP_BUCKET:?R2_BACKUP_BUCKET not set in .env.prod}"
: "${R2_BACKUP_ACCESS_KEY_ID:?R2_BACKUP_ACCESS_KEY_ID not set in .env.prod}"
: "${R2_BACKUP_SECRET_ACCESS_KEY:?R2_BACKUP_SECRET_ACCESS_KEY not set in .env.prod}"
: "${R2_BACKUP_ENDPOINT:?R2_BACKUP_ENDPOINT not set in .env.prod}"

if ! command -v aws >/dev/null 2>&1; then
  red "aws CLI missing — install with: apt install awscli"
  exit 1
fi

SOURCE_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
TMP_LIST="/tmp/r2-sync-${TIMESTAMP}.txt"

green "[r2-sync] starting mirror"
green "  source: ${R2_BUCKET_NAME} via ${SOURCE_ENDPOINT}"
green "    dest: ${R2_BACKUP_BUCKET}/storage/ via ${R2_BACKUP_ENDPOINT}"

# Strategy: stream every object via aws s3 cp (no local disk hop).
# `aws s3 sync` between two endpoints isn't supported in a single
# invocation because it can only handle one set of creds at a time;
# instead we list keys from source, then copy each via stdin pipe.
#
# `aws s3 ls` with a recursive flag enumerates all objects. For a
# bucket under ~10k objects this is fine; if it grows past that we
# switch to paginated listing or rclone.

green "[r2-sync] enumerating source objects"
AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
aws s3 ls "s3://${R2_BUCKET_NAME}/" --recursive \
  --endpoint-url "${SOURCE_ENDPOINT}" \
  | awk '{ $1=$2=$3=""; sub(/^   /, ""); print }' \
  > "${TMP_LIST}"

OBJECT_COUNT="$(wc -l < "${TMP_LIST}" | tr -d ' ')"
green "[r2-sync] ${OBJECT_COUNT} objects to mirror"

if [[ "${OBJECT_COUNT}" -eq 0 ]]; then
  yellow "[r2-sync] nothing to copy"
  rm -f "${TMP_LIST}"
  exit 0
fi

COPIED=0
SKIPPED=0
FAILED=0

while IFS= read -r KEY; do
  # Skip empty lines (defensive — awk shouldn't emit any)
  [[ -z "${KEY}" ]] && continue

  DEST_KEY="storage/${KEY}"

  # Check if destination already has the object (idempotent — only
  # copy what's new since last sync).
  if AWS_ACCESS_KEY_ID="${R2_BACKUP_ACCESS_KEY_ID}" \
     AWS_SECRET_ACCESS_KEY="${R2_BACKUP_SECRET_ACCESS_KEY}" \
     aws s3api head-object \
       --bucket "${R2_BACKUP_BUCKET}" \
       --key "${DEST_KEY}" \
       --endpoint-url "${R2_BACKUP_ENDPOINT}" \
       >/dev/null 2>&1; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Stream copy: source → stdout → stdin → dest. No local file.
  if AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
     AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
     aws s3 cp "s3://${R2_BUCKET_NAME}/${KEY}" - \
       --endpoint-url "${SOURCE_ENDPOINT}" \
       --no-progress 2>/dev/null \
     | AWS_ACCESS_KEY_ID="${R2_BACKUP_ACCESS_KEY_ID}" \
       AWS_SECRET_ACCESS_KEY="${R2_BACKUP_SECRET_ACCESS_KEY}" \
       aws s3 cp - "s3://${R2_BACKUP_BUCKET}/${DEST_KEY}" \
         --endpoint-url "${R2_BACKUP_ENDPOINT}" \
         --no-progress 2>/dev/null; then
    COPIED=$((COPIED + 1))
  else
    yellow "[r2-sync] FAILED: ${KEY}"
    FAILED=$((FAILED + 1))
  fi
done < "${TMP_LIST}"

rm -f "${TMP_LIST}"

green "[r2-sync] done — copied: ${COPIED}, skipped (already in dest): ${SKIPPED}, failed: ${FAILED}"

if [[ "${FAILED}" -gt 0 ]]; then
  exit 1
fi
