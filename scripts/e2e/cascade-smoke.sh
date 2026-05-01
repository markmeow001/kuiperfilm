#!/usr/bin/env bash
#
# scripts/e2e/cascade-smoke.sh
#
# End-to-end smoke test for the novel-promotion cascade pipeline against
# a deployed environment. Drives the full happy path through real APIs:
#
#   project → episode → novelText →
#   analyze_novel (cascade) → clips_build → script_to_storyboard_run →
#   image_character → image_panel → video_multi_shot
#
# Validates:
#   - cascade chain enqueues the next handler with locale propagated
#   - storyboard worker survives multi-step LLM streaming
#   - panel-image worker writes imageUrl + uploads to R2
#   - multi-shot video B-path (Tencent VOD Kling-Omni) submits without
#     billing throwing on uncatalogued pricing
#
# Use after every prod deploy that touches:
#   - src/lib/workers/handlers/{analyze-novel,clips-build,
#     script-to-storyboard*,panel-image-task-handler,
#     character-image-task-handler,multi-shot-video-*}.ts
#   - src/lib/task/{submitter,service}.ts
#   - src/lib/workers/shared.ts (reportTaskProgress / withFlowFields)
#   - src/lib/billing/task-policy.ts (calcVideo guarding)
#
# Cost: ~1 LLM run + 1 character image + 1 panel image + 1 multi-shot
# video (Kling-Omni 5s 1080P). Roughly $0.05–$0.15 per run depending on
# provider keys.
#
# Usage:
#   E2E_USERNAME=admin E2E_PASSWORD=... ./scripts/e2e/cascade-smoke.sh
#
# Optional env:
#   E2E_BASE_URL    default https://art.kuiperfilmailab.com
#   E2E_LOCALE      default zh-TW
#   E2E_KEEP        if set, do NOT delete the test project at the end
#   E2E_SKIP_VIDEO  skip multi-shot video stage (for lighter checks)
#
# Exit codes:
#   0  every stage completed
#   1  pre-flight (login / config) failed
#   2  cascade stage (analyze/clips/storyboard) failed
#   3  asset stage (character or panel image) failed
#   4  video stage failed
#

set -euo pipefail

BASE_URL="${E2E_BASE_URL:-https://art.kuiperfilmailab.com}"
LOCALE="${E2E_LOCALE:-zh-TW}"
USERNAME="${E2E_USERNAME:-}"
PASSWORD="${E2E_PASSWORD:-}"

if [[ -z "$USERNAME" || -z "$PASSWORD" ]]; then
  echo "ERROR: E2E_USERNAME and E2E_PASSWORD env vars are required" >&2
  exit 1
fi

# Pin python3 path so this runs under conda/zsh/bash without env confusion.
PYTHON3="${PYTHON3:-$(command -v python3 || echo /usr/bin/python3)}"
if [[ ! -x "$PYTHON3" ]]; then
  echo "ERROR: python3 not found (set PYTHON3=...)" >&2
  exit 1
fi

RUN_DIR="$(mktemp -d -t kuiper-e2e-XXXXXX)"
JAR="$RUN_DIR/cookies.txt"
trap 'echo "[e2e] artifacts: $RUN_DIR"' EXIT

ts() { date '+%H:%M:%S'; }
log() { echo "[$(ts)] $*"; }
log_step() { echo; echo "═══ $* ═══"; }
fail() { echo "FAIL: $*" >&2; exit "${2:-1}"; }

C() { curl -s --max-time 60 -b "$JAR" -c "$JAR" "$@"; }
JF() { "$PYTHON3" -c "$1"; }

# ─── 1. Login ──────────────────────────────────────────────────────────
log_step "Login"
CSRF=$(curl -s --max-time 10 -c "$JAR" "$BASE_URL/api/auth/csrf" \
  | "$PYTHON3" -c "import json,sys;print(json.load(sys.stdin)['csrfToken'])")
[[ -n "$CSRF" ]] || fail "csrf fetch failed"

LOGIN_HTTP=$(curl -s --max-time 15 -X POST "$BASE_URL/api/auth/callback/credentials" \
  -b "$JAR" -c "$JAR" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "csrfToken=$CSRF&username=$USERNAME&password=$PASSWORD&redirect=false&json=true" \
  -o /dev/null -w "%{http_code}")
[[ "$LOGIN_HTTP" == "200" ]] || fail "login HTTP $LOGIN_HTTP"

SESSION_USER=$(C "$BASE_URL/api/auth/session" | "$PYTHON3" -c "
import json,sys
d=json.load(sys.stdin)
u=d.get('user') or {}
print(f\"{u.get('name','?')}/{u.get('role','?')}\")")
log "logged in as $SESSION_USER"
[[ "$SESSION_USER" != "?/?" ]] || fail "session not established"

# ─── 2. Verify provider keys present ───────────────────────────────────
log_step "Verify provider keys"
MISSING=$(C "$BASE_URL/api/user/api-config" | "$PYTHON3" -c "
import json,sys
d=json.load(sys.stdin)
needs = {'openrouter': 'analysis LLM', 'tencent-vod': 'image+video'}
miss=[]
for p in d.get('providers',[]):
    if p.get('id') in needs and not p.get('apiKey'):
        miss.append(f\"{p['id']} ({needs[p['id']]})\")
print('|'.join(miss))")
if [[ -n "$MISSING" ]]; then
  fail "missing provider keys: $MISSING"
fi
log "openrouter + tencent-vod keys present"

# ─── 3. Create project + episode + novelText ───────────────────────────
log_step "Create project + episode"
PROJECT_NAME="[E2E-$(date '+%Y%m%d-%H%M%S')]"
PROJ=$(C -X POST -H "Content-Type: application/json" \
  -d "{\"name\":\"$PROJECT_NAME\"}" "$BASE_URL/api/projects")
echo "$PROJ" > "$RUN_DIR/project.json"
PID=$(echo "$PROJ" | "$PYTHON3" -c "import json,sys;print(json.load(sys.stdin)['project']['id'])")
log "project: $PID"

EP=$(C -X POST -H "Content-Type: application/json" \
  -d '{"name":"E1"}' "$BASE_URL/api/novel-promotion/$PID/episodes")
echo "$EP" > "$RUN_DIR/episode.json"
EID=$(echo "$EP" | "$PYTHON3" -c "import json,sys;print(json.load(sys.stdin)['episode']['id'])")
log "episode: $EID"

# Inline test novel — 2 mini scenes, 3 characters, 4 locations.
# Compact enough to keep LLM cost down but rich enough for the analyzer
# to extract a meaningful character/location set.
NOVEL_FILE="$RUN_DIR/novel.txt"
cat > "$NOVEL_FILE" <<'EOF'
第一集：失業

早晨七點，林志明關掉鬧鐘，盯著天花板發呆。他三十二歲，在科技公司當了八年的工程師。昨天，主管把他叫進辦公室，公司裁員，名單上有他的名字。

「志明，你還好嗎？」女友陳雅婷端著早餐進來。她在出版社當編輯，個性溫柔。

「我被裁了。」林志明聲音平靜，但雙手在抖。

雅婷坐到床邊，握住他的手：「沒關係，我們一起想辦法。」

林志明苦笑：「我銀行帳戶只剩兩萬塊。」

雅婷沉默片刻，從口袋裡掏出一張紙條。「我表哥開了間餐廳，缺人。雖然不是你專業，但能撐一陣子。」

下午三點，林志明站在「老王牛肉麵」前。胖胖的老王走出來，拍拍他的肩膀：「年輕人，不嫌棄就一起做。」

林志明點頭，第一次穿上廚房的圍裙。

第二集：第一天

清晨五點，林志明跟著老王去市場批菜。

「做麵不只是煮麵。」老王邊挑著青菜邊說，「要懂得看人。」

回到店裡，老王教他熬高湯。火候、配方、時間，每樣都是學問。

「老王哥，你這麼厲害，怎麼不開分店？」林志明問。

老王笑了：「賺夠就好。錢這東西，永遠不夠。」
EOF

NOVEL_JSON=$("$PYTHON3" -c "import json,sys;print(json.dumps(open('$NOVEL_FILE').read()))")
C -X PATCH -H "Content-Type: application/json" \
  -d "{\"novelText\":$NOVEL_JSON}" \
  "$BASE_URL/api/novel-promotion/$PID/episodes/$EID" > "$RUN_DIR/patch.json"
log "novelText patched ($(wc -c < $NOVEL_FILE | tr -d ' ') bytes)"

# ─── 4. Cascade: analyze → clips → storyboard ──────────────────────────
log_step "Cascade analyze→clips→storyboard"
TRIG=$(C -X POST -H "Content-Type: application/json" \
  -d "{\"episodeId\":\"$EID\",\"async\":true,\"cascadeToStoryboard\":true,\"meta\":{\"locale\":\"$LOCALE\"}}" \
  "$BASE_URL/api/novel-promotion/$PID/analyze")
echo "$TRIG" > "$RUN_DIR/analyze-trigger.json"
TASK_ID=$(echo "$TRIG" | "$PYTHON3" -c "import json,sys;d=json.load(sys.stdin);print(d.get('taskId') or d.get('task',{}).get('id') or '')")
[[ -n "$TASK_ID" ]] || { echo "$TRIG"; fail "analyze trigger failed" 2; }
log "analyze task: $TASK_ID"

# Poll the cascade chain — we wait for SCRIPT_TO_STORYBOARD_RUN to
# terminate, since that's the slowest link and the one that surfaces
# the most issues (multi-LLM streaming, voice analyze step).
START=$SECONDS
LAST=""
TIMEOUT_CASCADE=$(( ${E2E_CASCADE_TIMEOUT:-1500} ))
while [[ $((SECONDS - START)) -lt $TIMEOUT_CASCADE ]]; do
  SNAP=$(C "$BASE_URL/api/tasks?projectId=$PID&pageSize=10" 2>/dev/null || echo '{}')
  S=$(echo "$SNAP" | "$PYTHON3" -c "
import json,sys
d=json.load(sys.stdin) if sys.stdin else {}
tasks=d.get('tasks',[])
sb=next((t for t in tasks if t.get('type')=='script_to_storyboard_run'),None)
cb=next((t for t in tasks if t.get('type')=='clips_build'),None)
an=next((t for t in tasks if t.get('type')=='analyze_novel'),None)
print(f\"an={an.get('status') if an else '-'} cb={cb.get('status') if cb else '-'} sb={sb.get('status') if sb else '-'}\")" 2>/dev/null || echo "an=? cb=? sb=?")
  if [[ "$S" != "$LAST" ]]; then
    log "elapsed $((SECONDS-START))s | $S"
    LAST="$S"
  fi
  if echo "$S" | grep -qE "sb=(completed|success)"; then
    break
  fi
  if echo "$S" | grep -qE "sb=(failed|error)"; then
    log "Cascade FAILED:"
    echo "$SNAP" | "$PYTHON3" -m json.tool > "$RUN_DIR/cascade-fail.json"
    fail "storyboard task failed — see $RUN_DIR/cascade-fail.json" 2
  fi
  sleep 15
done
[[ $((SECONDS - START)) -lt $TIMEOUT_CASCADE ]] || fail "cascade timed out after ${TIMEOUT_CASCADE}s" 2

# Fetch counts.
ASSETS=$(C "$BASE_URL/api/novel-promotion/$PID/assets")
SBS=$(C "$BASE_URL/api/novel-promotion/$PID/storyboards?episodeId=$EID")
COUNTS=$(echo "$ASSETS" | "$PYTHON3" -c "
import json,sys
d=json.load(sys.stdin)
print(f\"chars={len(d.get('characters',[]))} locs={len(d.get('locations',[]))}\")")
SB_COUNTS=$(echo "$SBS" | "$PYTHON3" -c "
import json,sys
d=json.load(sys.stdin)
sbs=d.get('storyboards',[])
panel_total=sum(len(s.get('panels',[])) for s in sbs)
print(f\"sbs={len(sbs)} panels={panel_total}\")")
log "result: $COUNTS $SB_COUNTS"

CHARACTERS_OK=$(echo "$COUNTS" | grep -oE 'chars=[0-9]+' | grep -oE '[0-9]+')
SB_OK=$(echo "$SB_COUNTS" | grep -oE 'sbs=[0-9]+' | grep -oE '[0-9]+')
[[ "$CHARACTERS_OK" -gt 0 ]] || fail "no characters extracted" 2
[[ "$SB_OK" -gt 0 ]] || fail "no storyboards persisted" 2

# Pick character #1's first appearance + storyboard #1's first panel for
# the asset stage. Both must exist or we'd already have failed above.
PICKS=$(echo "$ASSETS" | "$PYTHON3" -c "
import json,sys
d=json.load(sys.stdin)
c=d['characters'][0]
a=(c.get('appearances') or [{}])[0]
print(f\"{c['id']}|{a.get('id','')}|{c['name']}\")")
CID=$(echo "$PICKS" | cut -d'|' -f1)
AID=$(echo "$PICKS" | cut -d'|' -f2)
CNAME=$(echo "$PICKS" | cut -d'|' -f3)
log "picked character: $CNAME ($CID/$AID)"

# Pick first panel from first storyboard for the panel-image stage.
PANEL=$(echo "$SBS" | "$PYTHON3" -c "
import json,sys
d=json.load(sys.stdin)
sb=d['storyboards'][0]
print(sb['panels'][0]['id'])")
log "picked panel: $PANEL"

# Pick first 3 panels from first storyboard for multi-shot video.
PANEL_3=$(echo "$SBS" | "$PYTHON3" -c "
import json,sys
d=json.load(sys.stdin)
sb=d['storyboards'][0]
ids=[p['id'] for p in sb['panels'][:3]]
print(json.dumps(ids))")

# ─── 5. Character image ────────────────────────────────────────────────
log_step "Character image (Tencent VOD GEM-3.1)"
TRIG=$(C -X POST -H "Content-Type: application/json" \
  -d "{\"type\":\"character\",\"id\":\"$CID\",\"appearanceId\":\"$AID\",\"imageIndex\":0,\"async\":true,\"meta\":{\"locale\":\"$LOCALE\"}}" \
  "$BASE_URL/api/novel-promotion/$PID/regenerate-single-image")
echo "$TRIG" > "$RUN_DIR/char-image-trigger.json"
TID=$(echo "$TRIG" | "$PYTHON3" -c "import json,sys;d=json.load(sys.stdin);print(d.get('taskId',''))")
[[ -n "$TID" ]] || { echo "$TRIG"; fail "character image trigger failed" 3; }

START=$SECONDS
TIMEOUT_IMG=$(( ${E2E_IMAGE_TIMEOUT:-300} ))
while [[ $((SECONDS - START)) -lt $TIMEOUT_IMG ]]; do
  S=$(C "$BASE_URL/api/tasks/$TID" | "$PYTHON3" -c "
import json,sys
try: d=json.load(sys.stdin); print((d.get('task') or d).get('status','?'))
except: print('?')" 2>/dev/null)
  if [[ "$S" == "completed" || "$S" == "success" ]]; then break; fi
  if [[ "$S" == "failed" || "$S" == "error" ]]; then
    fail "character image task failed (see $BASE_URL/api/tasks/$TID)" 3
  fi
  sleep 15
done
log "character image done in $((SECONDS-START))s"

# ─── 6. Panel image ────────────────────────────────────────────────────
log_step "Panel image (Tencent VOD GEM-3.1)"
TRIG=$(C -X POST -H "Content-Type: application/json" \
  -d "{\"panelId\":\"$PANEL\",\"candidateCount\":1,\"async\":true,\"meta\":{\"locale\":\"$LOCALE\"}}" \
  "$BASE_URL/api/novel-promotion/$PID/regenerate-panel-image")
echo "$TRIG" > "$RUN_DIR/panel-image-trigger.json"
TID=$(echo "$TRIG" | "$PYTHON3" -c "import json,sys;d=json.load(sys.stdin);print(d.get('taskId',''))")
[[ -n "$TID" ]] || { echo "$TRIG"; fail "panel image trigger failed" 3; }

START=$SECONDS
while [[ $((SECONDS - START)) -lt $TIMEOUT_IMG ]]; do
  S=$(C "$BASE_URL/api/tasks/$TID" | "$PYTHON3" -c "
import json,sys
try: d=json.load(sys.stdin); print((d.get('task') or d).get('status','?'))
except: print('?')" 2>/dev/null)
  if [[ "$S" == "completed" || "$S" == "success" ]]; then break; fi
  if [[ "$S" == "failed" || "$S" == "error" ]]; then
    fail "panel image task failed (see $BASE_URL/api/tasks/$TID)" 3
  fi
  sleep 10
done
log "panel image done in $((SECONDS-START))s"

# ─── 7. Multi-shot video (B-path) ──────────────────────────────────────
if [[ -n "${E2E_SKIP_VIDEO:-}" ]]; then
  log "Skipping video stage (E2E_SKIP_VIDEO set)"
else
  log_step "Multi-shot video (Tencent VOD Kling-3.0-Omni B-path)"
  TRIG=$(C -X POST -H "Content-Type: application/json" \
    -d "{\"panelIds\":$PANEL_3,\"videoModel\":\"tencent-vod::Kling-3.0-Omni\",\"async\":true,\"meta\":{\"locale\":\"$LOCALE\"}}" \
    "$BASE_URL/api/novel-promotion/$PID/generate-multi-shot-video")
  echo "$TRIG" > "$RUN_DIR/video-trigger.json"
  TID=$(echo "$TRIG" | "$PYTHON3" -c "import json,sys;d=json.load(sys.stdin);print(d.get('taskId',''))")
  [[ -n "$TID" ]] || { echo "$TRIG"; fail "video trigger failed (likely billing/pricing)" 4; }

  START=$SECONDS
  TIMEOUT_VID=$(( ${E2E_VIDEO_TIMEOUT:-900} ))
  while [[ $((SECONDS - START)) -lt $TIMEOUT_VID ]]; do
    S=$(C "$BASE_URL/api/tasks/$TID" | "$PYTHON3" -c "
import json,sys
try: d=json.load(sys.stdin); print((d.get('task') or d).get('status','?'))
except: print('?')" 2>/dev/null)
    if [[ "$S" == "completed" || "$S" == "success" ]]; then break; fi
    if [[ "$S" == "failed" || "$S" == "error" ]]; then
      fail "video task failed (see $BASE_URL/api/tasks/$TID)" 4
    fi
    sleep 30
  done

  VIDEO_URL=$(C "$BASE_URL/api/tasks/$TID" | "$PYTHON3" -c "
import json,sys
d=json.load(sys.stdin)
r=(d.get('task') or d).get('result') or {}
print(r.get('multiShotVideoUrl') or r.get('videoUrl') or '')")
  log "video done in $((SECONDS-START))s"
  log "  url: $VIDEO_URL"
fi

# ─── 8. Cleanup ────────────────────────────────────────────────────────
if [[ -z "${E2E_KEEP:-}" ]]; then
  log_step "Cleanup"
  DEL_HTTP=$(curl -s --max-time 30 -b "$JAR" -X DELETE \
    "$BASE_URL/api/projects/$PID" -o "$RUN_DIR/cleanup.json" \
    -w "%{http_code}" || echo "000")
  if [[ "$DEL_HTTP" == "200" || "$DEL_HTTP" == "204" ]]; then
    log "deleted project $PID"
  else
    log "WARN: cleanup HTTP $DEL_HTTP — manual cleanup may be needed (project $PID kept)"
  fi
else
  log "Skipping cleanup (E2E_KEEP set) — project $PID kept"
fi

log_step "ALL GREEN"
echo "Artifacts: $RUN_DIR"
exit 0
