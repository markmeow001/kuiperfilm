#!/bin/bash
# Backfill missing panel images across all projects.
#
# Walks every project's panels via /api/novel-promotion/.../storyboards,
# finds those with no imageUrl, and POSTs /regenerate-panel-image for
# each. Throttled so we don't blow past Tencent's 5-slot AIGC quota.
#
# Modes:
#   --dry-run (default)  Just count what would be triggered. No tasks
#                        submitted. Reports per-project missing counts.
#   --apply              Actually submit image_panel tasks.
#
# Usage:
#   bash scripts/backfill-panel-images.sh              # dry-run
#   bash scripts/backfill-panel-images.sh --apply      # for real
#
# Pacing: 1 submission per second. With Tencent's 5-slot cap, the
# worker queue absorbs the burst and processes 5 in parallel; the
# extras sit on BullMQ until quota frees up. No need for client-side
# concurrency control beyond the 1/s rate.

set -euo pipefail

BASE=${KUIPER_BASE_URL:-https://art.kuiperfilmailab.com}
USER=${KUIPER_USER:-admin}
PASS=${KUIPER_PASS:-1qaz2wsx}

MODE="dry-run"
[ "${1:-}" = "--apply" ] && MODE="apply"

JAR=$(mktemp)
trap "rm -f $JAR" EXIT

log() { echo "[$(date +%H:%M:%S)] $*"; }

log "mode: $MODE"
log "login as $USER"
CSRF=$(curl -sS -c "$JAR" -b "$JAR" "$BASE/api/auth/csrf" | python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")
curl -sS -c "$JAR" -b "$JAR" \
  -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=$USER" \
  --data-urlencode "password=$PASS" \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "callbackUrl=/zh/v2" \
  --data-urlencode "json=true" \
  -L -o /dev/null > /dev/null

ROLE=$(curl -sS -b "$JAR" "$BASE/api/auth/session" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('role',''))")
[ "$ROLE" = "admin" ] || { log "login failed (role=$ROLE)"; exit 1; }

log "fetch all projects"
PROJECTS_JSON=$(curl -sS -b "$JAR" "$BASE/api/projects?page=1&pageSize=200")
# Skip throwaway E2E test projects by name pattern. Real projects keep
# their generated images; E2E ones are short-lived test artifacts and
# spending Tencent quota on them is pure waste.
PROJECT_IDS=$(echo "$PROJECTS_JSON" | python3 -c "
import sys, json, re
d = json.load(sys.stdin)
for p in d.get('projects', []):
    name = p.get('name', '')
    if re.search(r'\[?E2E\]?|Multi-Kling|Rooftop', name, re.IGNORECASE):
        continue
    print(p['id'])
")
PROJECT_COUNT=$(echo "$PROJECT_IDS" | wc -l | tr -d ' ')
log "  found $PROJECT_COUNT real projects (E2E test projects skipped)"

TOTAL_MISSING=0
TOTAL_SUBMITTED=0
TOTAL_FAILED=0

for PID in $PROJECT_IDS; do
  PNAME=$(echo "$PROJECTS_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
pid = sys.argv[1]
for p in d.get('projects', []):
    if p['id'] == pid:
        print(p['name'])
        break
" "$PID")

  # List episodes for this project
  EPS_JSON=$(curl -sS -b "$JAR" "$BASE/api/novel-promotion/$PID/episodes" 2>/dev/null || echo '{"episodes":[]}')
  EP_IDS=$(echo "$EPS_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for e in d.get('episodes', []):
    print(e['id'])
")

  PROJECT_MISSING=0
  for EP_ID in $EP_IDS; do
    SBS_JSON=$(curl -sS -b "$JAR" "$BASE/api/novel-promotion/$PID/storyboards?episodeId=$EP_ID" 2>/dev/null || echo '{"storyboards":[]}')
    MISSING_PANELS=$(echo "$SBS_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for sb in d.get('storyboards', []):
    for p in sb.get('panels', []):
        if not p.get('imageUrl'):
            # Only request gen for panels with a description (else worker has nothing to feed the model).
            if (p.get('description') or '').strip():
                print(p['id'])
")
    if [ -n "$MISSING_PANELS" ]; then
      EP_COUNT=$(echo "$MISSING_PANELS" | wc -l | tr -d ' ')
      PROJECT_MISSING=$((PROJECT_MISSING + EP_COUNT))
      if [ "$MODE" = "apply" ]; then
        for PANEL_ID in $MISSING_PANELS; do
          RES=$(curl -sS -b "$JAR" \
            -X POST "$BASE/api/novel-promotion/$PID/regenerate-panel-image" \
            -H "Content-Type: application/json" \
            -H "Accept-Language: zh" \
            -d "{\"panelId\":\"$PANEL_ID\",\"count\":1,\"locale\":\"zh\",\"meta\":{\"locale\":\"zh\"}}" 2>&1 || echo "{}")
          if echo "$RES" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('taskId') or d.get('id') else 1)" 2>/dev/null; then
            TOTAL_SUBMITTED=$((TOTAL_SUBMITTED + 1))
          else
            TOTAL_FAILED=$((TOTAL_FAILED + 1))
            log "    submit fail panel=$PANEL_ID: $(echo $RES | head -c 150)"
          fi
          # 1 req/s — let the queue absorb the burst.
          sleep 1
        done
      fi
    fi
  done

  if [ "$PROJECT_MISSING" -gt 0 ]; then
    log "  $PNAME ($PID): missing $PROJECT_MISSING panels"
    TOTAL_MISSING=$((TOTAL_MISSING + PROJECT_MISSING))
  fi
done

log ""
log "=== summary ==="
log "mode             : $MODE"
log "total missing    : $TOTAL_MISSING"
if [ "$MODE" = "apply" ]; then
  log "tasks submitted  : $TOTAL_SUBMITTED"
  log "submit failures  : $TOTAL_FAILED"
else
  log "(dry-run — re-run with --apply to submit tasks)"
fi
