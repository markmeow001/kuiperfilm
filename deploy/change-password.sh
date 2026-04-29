#!/usr/bin/env bash
#
# Interactive helper to reset a user's password on the running app
# container. Reads the new password masked; never echoes; never
# leaves it in shell history; clears the env var when done.
#
# Usage:
#   bash deploy/change-password.sh             # resets 'admin'
#   bash deploy/change-password.sh someuser    # resets specified user

set -e

USERNAME="${1:-admin}"

if ! docker ps --format '{{.Names}}' | grep -q '^kuiper-app$'; then
  echo "ERROR: kuiper-app container is not running."
  exit 1
fi

echo "Resetting password for user: ${USERNAME}"
read -r -s -p "New password (input is hidden): " NEW_PASSWORD
echo
read -r -s -p "Confirm password: " CONFIRM
echo

if [ "${NEW_PASSWORD}" != "${CONFIRM}" ]; then
  echo "ERROR: passwords do not match."
  unset NEW_PASSWORD CONFIRM
  exit 1
fi

if [ "${#NEW_PASSWORD}" -lt 8 ]; then
  echo "ERROR: password must be at least 8 characters."
  unset NEW_PASSWORD CONFIRM
  exit 1
fi

unset CONFIRM

# Pass the password into the container via env var, so it never
# appears in the docker exec command line (which would show up in
# `ps aux` and shell history). The container's reset-password.ts
# reads NEW_PASSWORD from process.env.
docker exec -e NEW_PASSWORD="${NEW_PASSWORD}" kuiper-app \
  npx tsx scripts/reset-password.ts --username "${USERNAME}"

unset NEW_PASSWORD
echo "Done. Try logging in at https://${DOMAIN:-your-domain} with the new password."
