#!/usr/bin/env bash
#
# Sanity-check the deploy/.env.prod file.
# Prints visible fields plainly, secrets only as a length, and flags
# duplicates / missing fields. Never prints secret content.
#
# Usage:  bash deploy/check-env.sh

set -u

ENV_FILE="$(cd "$(dirname "$0")" && pwd)/.env.prod"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

VISIBLE_KEYS="DOMAIN CADDY_EMAIL NEXTAUTH_URL ADMIN_USERNAME ADMIN_EMAIL STORAGE_TYPE R2_BUCKET_NAME R2_PUBLIC_URL R2_ACCOUNT_ID"
SECRET_KEYS="NEXTAUTH_SECRET API_ENCRYPTION_KEY MYSQL_ROOT_PASSWORD ADMIN_PASSWORD CRON_SECRET INTERNAL_TASK_TOKEN R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY"

echo "=== file ==="
ls -la "$ENV_FILE"

echo ""
echo "=== duplicates (should be empty) ==="
DUPS="$(grep -E '^[A-Z_][A-Z0-9_]*=' "$ENV_FILE" | cut -d= -f1 | sort | uniq -d)"
if [ -z "$DUPS" ]; then
  echo "(no duplicates)"
else
  echo "$DUPS" | while read -r k; do echo "  DUP: $k"; done
fi

echo ""
echo "=== visible fields ==="
for k in $VISIBLE_KEYS; do
  line="$(grep -E "^${k}=" "$ENV_FILE" | head -1)"
  if [ -z "$line" ]; then
    echo "  MISSING  $k"
  else
    val="${line#${k}=}"
    if [ -z "$val" ]; then
      echo "  EMPTY    $k="
    else
      echo "  OK       $line"
    fi
  fi
done

echo ""
echo "=== secret presence ==="
for k in $SECRET_KEYS; do
  line="$(grep -E "^${k}=" "$ENV_FILE" | head -1)"
  if [ -z "$line" ]; then
    echo "  MISSING  $k"
  else
    val="${line#${k}=}"
    if [ -z "$val" ]; then
      echo "  EMPTY    $k"
    else
      echo "  OK       $k = ${#val} chars"
    fi
  fi
done

echo ""
echo "=== summary ==="
echo "  file: $ENV_FILE"
echo "  duplicates: $([ -z "$DUPS" ] && echo none || echo "$(echo "$DUPS" | wc -l) keys")"
