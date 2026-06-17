#!/usr/bin/env bash
#
# verify-deploy.sh — after a deploy, confirm the RUNNING container actually
# contains the committed versions of files the app reads at runtime.
#
# Why this exists: a cached `docker compose build` can "complete" with a
# healthy container yet bake a STALE file (Docker COPY-layer cache miss).
# Hit 2026-06-17: a prompt-.txt-only deploy baked the old prompt — build was
# green, container healthy, but the new prompt was NOT live until --no-cache.
#
# Authoritative (source == what executes at runtime):
#   - lib/prompts/**, standards/**, messages/**   (read from disk per request)
#   - src/lib/**, scripts/**                       (the worker runs
#     `tsx src/lib/workers/index.ts` and the entrypoint runs `tsx scripts/...`,
#     i.e. TypeScript straight from source — NOT compiled)
# NOT authoritative (compiled into .next; a vestigial src/app copy is unused):
#   - src/app/**                                   (Next.js pages/components/API)
#
# Run ON the prod host:
#   ./deploy/verify-deploy.sh [N]      # N = how many recent commits to check (default 1)
# Exit code 1 if any authoritative runtime file is STALE in the container.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP="${VERIFY_APP_CONTAINER:-kuiper-app}"
N="${1:-1}"
cd "$REPO_ROOT" || { echo "FATAL: repo root not found"; exit 2; }

HEAD=$(git rev-parse --short HEAD)
echo "prod git HEAD : $HEAD"
echo "container     : $(docker ps --filter "name=$APP" --format '{{.Status}}')"
echo "checking files changed in last $N commit(s):"
echo

RUNTIME_FILES=$(git diff --name-only "HEAD~${N}..HEAD" -- lib/prompts standards messages src/lib scripts 2>/dev/null)
COMPILED_FILES=$(git diff --name-only "HEAD~${N}..HEAD" -- 'src/app' 2>/dev/null)

if [ -z "$RUNTIME_FILES$COMPILED_FILES" ]; then
  echo "  (no runtime/compiled files changed in this range — nothing to verify)"
  exit 0
fi

echo "── runtime-read (prompts / catalogs / worker .ts via tsx / scripts) — AUTHORITATIVE ──"
ok=0; stale=0; missing=0; stalelist=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  ghash=$(git show "HEAD:$f" 2>/dev/null | sha256sum | cut -d' ' -f1)
  chash=$(docker exec "$APP" sh -c "sha256sum '/app/$f' 2>/dev/null" | cut -d' ' -f1)
  if [ -z "$chash" ]; then echo "  ⚠️  not-in-image   $f"; missing=$((missing+1))
  elif [ "$ghash" = "$chash" ]; then echo "  ✅ $f"; ok=$((ok+1))
  else echo "  ❌ STALE (container != git)   $f"; stale=$((stale+1)); stalelist="$stalelist $f"; fi
done <<EOF
$RUNTIME_FILES
EOF
[ "$ok$stale$missing" = "000" ] && echo "  (none changed)"

if [ -n "$COMPILED_FILES" ]; then
  echo
  echo "── compiled frontend (src/app/**) — served from .next, NOT raw source ──"
  bid=$(docker exec "$APP" sh -c "stat -c %y .next/BUILD_ID 2>/dev/null" | cut -d. -f1)
  echo "  .next BUILD_ID time: ${bid:-unknown}  (matches the deploy time ⇒ bundle is fresh)"
  echo "  Confirm a specific src/app change is live by grepping .next for a signature:"
  echo "    docker exec $APP sh -c 'grep -rl \"<new-symbol>\" .next/cache/webpack 2>/dev/null | head -1'"
  while IFS= read -r f; do [ -n "$f" ] && echo "    · $f"; done <<EOF2
$COMPILED_FILES
EOF2
fi

echo
echo "── summary (runtime assets): ✅ $ok in-sync | ❌ $stale STALE | ⚠️ $missing not-in-image ──"
if [ "$stale" -gt 0 ]; then
  echo
  echo "STALE runtime files (container baked an old version):$stalelist"
  echo "FIX → clean rebuild:  ./deploy/deploy.sh update --no-cache"
  echo "  or:  cd deploy && docker compose -f docker-compose.prod.yml --env-file .env.prod build --no-cache app && ... up -d app"
  exit 1
fi
echo "Runtime-read assets are all live. ✅"
