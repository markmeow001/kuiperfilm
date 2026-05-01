#!/usr/bin/env bash
#
# Interactive setup: writes R2_BACKUP_* env vars into .env.prod.
#
# Why this script: keeps backup credentials out of shell history,
# out of the Claude Code transcript, and out of any chat. The only
# place the secrets ever land in plaintext is .env.prod (which is
# already 0600 and the canonical secret store) and your terminal
# scrollback (clearable with `clear` after).
#
# Usage (on droplet):
#   cd /opt/kuiperAI/deploy
#   ./setup-r2-backup.sh
#
# What it does:
#   1. Prompts for the 4 R2_BACKUP_* values (secrets read silently)
#   2. Verifies the creds work by HEAD-ing the backup bucket
#   3. Backs up the existing .env.prod
#   4. If R2_BACKUP_* already present: replaces them; otherwise appends
#   5. Tells you what to do next (smoke-test scripts + cron)
#
# Re-runnable: safe to run again to rotate creds.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.prod"

red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
bold()   { printf '\033[1m%s\033[0m\n' "$*"; }

if [[ ! -f "${ENV_FILE}" ]]; then
  red "Missing ${ENV_FILE}"
  exit 1
fi

bold "R2 backup credentials setup"
echo
echo "Paste the values from Cloudflare → Manage R2 API Tokens → (your"
echo "kuiperfilm-backup-only token). Secrets are read silently — they"
echo "won't echo to the terminal as you paste."
echo

read -r -p "R2_BACKUP_BUCKET           [kuiperfilm-backups]: " INPUT_BUCKET
BACKUP_BUCKET="${INPUT_BUCKET:-kuiperfilm-backups}"

read -r -p "R2_BACKUP_ACCESS_KEY_ID    : " BACKUP_KEY_ID
if [[ -z "${BACKUP_KEY_ID}" ]]; then
  red "Access Key ID is required"
  exit 1
fi

read -r -s -p "R2_BACKUP_SECRET_ACCESS_KEY: " BACKUP_SECRET
echo
if [[ -z "${BACKUP_SECRET}" ]]; then
  red "Secret Access Key is required"
  exit 1
fi

read -r -p "R2_BACKUP_ENDPOINT         (full https://...r2.cloudflarestorage.com URL): " BACKUP_ENDPOINT
if [[ -z "${BACKUP_ENDPOINT}" ]]; then
  red "Endpoint is required"
  exit 1
fi
if [[ ! "${BACKUP_ENDPOINT}" =~ ^https://.*\.r2\.cloudflarestorage\.com/?$ ]]; then
  yellow "[warn] endpoint doesn't look like a typical R2 URL — continuing anyway"
fi

echo
green "[step 1/3] verifying credentials against bucket..."
if ! command -v aws >/dev/null 2>&1; then
  yellow "[step 1/3] aws CLI not installed — skipping live verification"
  yellow "           (will install later; smoke-test will catch any bad creds)"
else
  if AWS_ACCESS_KEY_ID="${BACKUP_KEY_ID}" \
     AWS_SECRET_ACCESS_KEY="${BACKUP_SECRET}" \
     aws s3 ls "s3://${BACKUP_BUCKET}/" \
       --endpoint-url "${BACKUP_ENDPOINT}" \
       >/dev/null 2>&1; then
    green "[step 1/3] OK — creds can list ${BACKUP_BUCKET}"
  else
    red "[step 1/3] FAILED — creds cannot list bucket. Common causes:"
    red "  - Token scope doesn't include this bucket"
    red "  - Bucket name typo (you entered: ${BACKUP_BUCKET})"
    red "  - Endpoint typo (you entered: ${BACKUP_ENDPOINT})"
    red "  - Token wasn't created yet / still propagating (wait 30s, retry)"
    exit 1
  fi
fi

echo
green "[step 2/3] backing up existing .env.prod"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP_PATH="${ENV_FILE}.bak.${TIMESTAMP}"
cp "${ENV_FILE}" "${BACKUP_PATH}"
green "          → ${BACKUP_PATH}"

echo
green "[step 3/3] writing R2_BACKUP_* into .env.prod"

# Strip any existing R2_BACKUP_* lines so re-runs don't accumulate.
grep -v -E '^R2_BACKUP_(BUCKET|ACCESS_KEY_ID|SECRET_ACCESS_KEY|ENDPOINT)=' "${ENV_FILE}" > "${ENV_FILE}.tmp"
mv "${ENV_FILE}.tmp" "${ENV_FILE}"

# Append the new block. Use printf so values with special chars don't
# get re-interpreted by a shell heredoc.
{
  printf '\n# R2 backup (kuiperfilm-backups, separate token from main R2_*)\n'
  printf 'R2_BACKUP_BUCKET=%s\n'             "${BACKUP_BUCKET}"
  printf 'R2_BACKUP_ACCESS_KEY_ID=%s\n'      "${BACKUP_KEY_ID}"
  printf 'R2_BACKUP_SECRET_ACCESS_KEY=%s\n'  "${BACKUP_SECRET}"
  printf 'R2_BACKUP_ENDPOINT=%s\n'           "${BACKUP_ENDPOINT}"
} >> "${ENV_FILE}"

chmod 600 "${ENV_FILE}"
green "          ✓ written, mode 600"

echo
bold "Done. Next steps (run on this droplet):"
echo
echo "  # 1. Install aws CLI (R2 talks S3 protocol)"
echo "  apt-get install -y awscli"
echo
echo "  # 2. Smoke-test both backup paths"
echo "  ./db-backup.sh"
echo "  ./r2-sync.sh"
echo
echo "  # 3. Add daily cron entries (paste both lines into 'crontab -e')"
echo "  0 3 * * * cd /opt/kuiperAI/deploy && ./db-backup.sh  >> /var/log/kuiper-backup.log  2>&1"
echo "  0 4 * * * cd /opt/kuiperAI/deploy && ./r2-sync.sh    >> /var/log/kuiper-r2-sync.log 2>&1"
echo
yellow "Tip: 'clear' your terminal scrollback now if you want to wipe the values you pasted."
