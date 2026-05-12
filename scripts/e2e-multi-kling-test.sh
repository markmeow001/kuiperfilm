#!/bin/bash
# E2E test: multi-Kling chunked dispatch.
#
# Creates a project, pastes "The Rooftop" 60s script with ~30s of
# dialogue, runs analyze + auto-group, dispatches the first
# multi-shot group, polls until done, then verifies the storyboard
# row has multiShotClipUrls.length > 1 (chunked output).
#
# Runtime: ~10-15 min (analyze 30-90s + multi-shot video 3-10 min × N chunks).
#
# Usage:
#   bash scripts/e2e-multi-kling-test.sh

set -euo pipefail

BASE=${KUIPER_BASE_URL:-https://art.kuiperfilmailab.com}
USER=${KUIPER_TEST_USER:-admin}
PASS=${KUIPER_TEST_PASS:-1qaz2wsx}

JAR=$(mktemp)
trap "rm -f $JAR" EXIT

log() { echo "[$(date +%H:%M:%S)] $*"; }

log "1/9 login as $USER"
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
SESSION_OK=$(curl -sS -b "$JAR" "$BASE/api/auth/session" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('user',{}).get('role'))")
[ "$SESSION_OK" = "admin" ] || { log "login failed (got role=$SESSION_OK)"; exit 1; }
log "  ok admin"

log "2/9 create project"
PROJECT_JSON=$(curl -sS -b "$JAR" \
  -X POST "$BASE/api/projects" \
  -H "Content-Type: application/json" \
  -d '{"name":"E2E Multi-Kling Rooftop","description":"60s short with action+dialogue, expects 2-3 chunks"}')
PROJECT_ID=$(echo "$PROJECT_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('project',d).get('id'))")
log "  projectId=$PROJECT_ID"

log "3/9 create episode"
EP_JSON=$(curl -sS -b "$JAR" \
  -X POST "$BASE/api/novel-promotion/$PROJECT_ID/episodes" \
  -H "Content-Type: application/json" \
  -d '{"name":"Episode 1: The Rooftop"}')
EP_ID=$(echo "$EP_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['episode']['id'])")
log "  episodeId=$EP_ID"

SCRIPT=$(cat <<'EOF'
THE ROOFTOP — a 90-second short with dense dialogue, designed to trigger
the multi-Kling chunker by exceeding 15s of estimated speech.

PANEL 1. Wet rooftop, neon haze. DETECTIVE MARCUS bursts through the stairwell door, gun drawn, scanning. ZARA stands silhouetted near the ledge, back turned. Marcus advances slowly, gun trained.
MARCUS: Don't move, Zara. Three years I've chased you across this city. Three years of dead bodies, burned files, and witnesses who suddenly forget their own names. And tonight, on this miserable rooftop, it finally ends. Don't make me put a bullet in your back.

PANEL 2. Zara turns, raises her hands halfway, smiling through the rain. Marcus closes distance, gun steady on her chest.
ZARA: You came alone, detective. No backup. No partner. No warrant. Just you, your gun, and that stubborn little voice in your head that swears you're still one of the good ones. Tell me — what does that voice sound like at three in the morning when you're holding a glass and thinking about Sarah?

PANEL 3. Marcus's grip tightens on the gun. Zara takes one slow step forward. They circle each other near the ledge.
MARCUS: Don't say her name. You took everything from her. Her future, her name, her mother's faith. She was eighteen years old. Eighteen. And you handed her a needle and called it freedom. So no, Zara. I don't care about the voice in my head tonight. I care about the trigger under my finger.

PANEL 4. Zara dives left. Marcus fires — sparks crack off metal. She rolls, comes up behind a ventilation unit, breathing hard. Action beat: Marcus advances, weapon ready.
ZARA: She made her own choice, Marcus. You taught me that. You stood in that courtroom three years ago and said everyone gets exactly what they deserve. So tell me, detective — what does that make you tonight, with a gun in your hand and rage in your throat?

PANEL 5. Zara springs from cover, slams a wrench into Marcus's wrist — gun clatters across concrete. They grapple. A knee, a forearm to the throat, Zara reversing, Marcus catching her sleeve. No dialogue, only impacts and breath.

PANEL 6. Marcus pins Zara at the ledge. Sirens flood the alley below. Helicopter searchlight sweeps across the rooftop. Both are bleeding.
MARCUS: Tell me where it is. Where you hid the ledger. Tell me now or I swear I will let you go right over this edge.
ZARA: Behind every door you've already opened, detective. Behind every name you've already crossed off. You weren't looking. You never were. That's the joke, Marcus. You found me, but you'll never find what you came for.
EOF
)

log "4/9 paste script (${#SCRIPT} chars)"
PATCH_BODY=$(python3 -c "import json,os; print(json.dumps({'novelText': os.environ['SCRIPT_TEXT']}))" SCRIPT_TEXT="$SCRIPT" </dev/null 2>/dev/null || \
  python3 -c "import json,sys; print(json.dumps({'novelText': sys.stdin.read()}))" <<<"$SCRIPT")
curl -sS -b "$JAR" \
  -X PATCH "$BASE/api/novel-promotion/$PROJECT_ID/episodes/$EP_ID" \
  -H "Content-Type: application/json" \
  -d "$PATCH_BODY" -o /dev/null
log "  ok"

log "5/9 trigger analyze"
ANALYZE_RES=$(curl -sS -b "$JAR" \
  -X POST "$BASE/api/novel-promotion/$PROJECT_ID/analyze" \
  -H "Content-Type: application/json" \
  -H "Accept-Language: en" \
  -d "{\"episodeId\":\"$EP_ID\",\"locale\":\"en\",\"meta\":{\"locale\":\"en\"},\"cascadeToStoryboard\":true}")
TASK_ID=$(echo "$ANALYZE_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('taskId') or d.get('task',{}).get('id') or d.get('id') or '')")
log "  analyze taskId=$TASK_ID"
[ -n "$TASK_ID" ] || { log "no taskId"; echo "$ANALYZE_RES"; exit 1; }

log "6/9 poll until panels exist (analyze → clips_build → script_to_storyboard cascade, ~2-3 min)"
PANELS_READY=""
for i in $(seq 1 60); do
  COUNT=$(curl -sS -b "$JAR" "$BASE/api/novel-promotion/$PROJECT_ID/storyboards?episodeId=$EP_ID" \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
sbs = d.get('storyboards') or []
total = sum(len(sb.get('panels') or []) for sb in sbs)
print(total)
")
  log "  [$i] panel count=$COUNT"
  if [ "$COUNT" -gt 0 ]; then
    PANELS_READY="yes"
    break
  fi
  # Also check if analyze itself failed early
  ATASK_STATUS=$(curl -sS -b "$JAR" "$BASE/api/tasks/$TASK_ID" | python3 -c "import sys,json; print(json.load(sys.stdin).get('task',{}).get('status') or 'unknown')")
  if [ "$ATASK_STATUS" = "failed" ] || [ "$ATASK_STATUS" = "cancelled" ]; then
    log "analyze terminal: $ATASK_STATUS"
    curl -sS -b "$JAR" "$BASE/api/tasks/$TASK_ID" | python3 -m json.tool | head -40
    exit 1
  fi
  sleep 5
done
[ -n "$PANELS_READY" ] || { log "panels did not appear within 5 min"; exit 1; }
log "  panels ready"

log "7/9 auto-group multi-shot"
GROUPS_RES=$(curl -sS -b "$JAR" \
  -X POST "$BASE/api/novel-promotion/$PROJECT_ID/episodes/$EP_ID/auto-group-multi-shot" \
  -H "Content-Type: application/json" \
  -H "Accept-Language: en" \
  -d '{"locale":"en","meta":{"locale":"en"}}')
log "  groups response (preview):"
echo "$GROUPS_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps({k:v for k,v in d.items() if k!='task'},indent=2,ensure_ascii=False))" | head -40 || echo "$GROUPS_RES" | head -30

# auto-group might be sync or async; try to extract panelIds either way.
PANEL_IDS_JSON=$(echo "$GROUPS_RES" | python3 -c "
import sys, json
d = json.load(sys.stdin)
groups = d.get('groups') or []
for g in groups:
    pids = g.get('panelIds') or []
    if len(pids) >= 2:
        print(json.dumps(pids))
        sys.exit()
print('')
")
if [ -z "$PANEL_IDS_JSON" ]; then
  log "  no synchronous groups in response — falling back to DB read of storyboards"
  # If async, we'd need to poll. For now, error out so user sees it.
  log "auto-group returned no usable groups; aborting"
  exit 1
fi
log "  picked group with panelIds=$PANEL_IDS_JSON"

log "8/9 trigger multi-shot video gen (Kling-3.0-Omni)"
GEN_BODY=$(python3 -c "import json,sys; pids=json.loads(sys.argv[1]); print(json.dumps({'panelIds':pids,'videoModel':'tencent-vod::Kling-3.0-Omni','sound':True,'aspectRatio':'9:16','locale':'en','meta':{'locale':'en'}}))" "$PANEL_IDS_JSON")
GEN_RES=$(curl -sS -b "$JAR" \
  -X POST "$BASE/api/novel-promotion/$PROJECT_ID/generate-multi-shot-video" \
  -H "Content-Type: application/json" \
  -H "Accept-Language: en" \
  -d "$GEN_BODY")
VIDEO_TASK_ID=$(echo "$GEN_RES" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('taskId') or d.get('task',{}).get('id') or '')")
log "  video taskId=$VIDEO_TASK_ID"
[ -n "$VIDEO_TASK_ID" ] || { log "no taskId"; echo "$GEN_RES"; exit 1; }

log "9/9 poll multi-shot video (~5-15 min, N chunks each ~3-5 min)"
for i in $(seq 1 240); do
  TASK_JSON=$(curl -sS -b "$JAR" "$BASE/api/tasks/$VIDEO_TASK_ID")
  STATUS=$(echo "$TASK_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('task',{}).get('status') or 'unknown')")
  PROGRESS=$(echo "$TASK_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('task',{}).get('progress') or 0)")
  log "  [$i] status=$STATUS progress=$PROGRESS"
  if [ "$STATUS" = "completed" ]; then break; fi
  if [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ]; then
    log "video terminal: $STATUS"
    echo "$TASK_JSON" | python3 -m json.tool | head -50
    exit 1
  fi
  sleep 10
done

log "=== RESULT ==="
echo "$TASK_JSON" | python3 -c "
import sys, json
t = json.load(sys.stdin).get('task', {})
r = t.get('result', {})
print(f\"status         : {t.get('status')}\")
print(f\"shotCount      : {r.get('shotCount')}\")
print(f\"chunkCount     : {r.get('chunkCount')}\")
print(f\"clipUrls       : {r.get('multiShotClipUrls')}\")
print(f\"legacy url     : {r.get('multiShotVideoUrl')}\")
clips = r.get('multiShotClipUrls') or []
if isinstance(clips, list) and len(clips) > 1:
    print()
    print(f'✓ CHUNKED — {len(clips)} clips delivered')
elif isinstance(clips, list) and len(clips) == 1:
    print()
    print(f'⚠ SINGLE CLIP — chunker did not trigger (dialogue may have estimated <15s)')
else:
    print()
    print(f'✗ UNEXPECTED — clipUrls shape: {clips}')
"

log "project: $BASE/zh/v2/workspace/$PROJECT_ID/storyboard"
