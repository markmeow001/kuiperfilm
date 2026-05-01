# scripts/e2e

End-to-end smoke tests against deployed environments. These hit real
APIs and real LLM/image/video providers — they cost real money. Use
sparingly (after a deploy, before a release).

## cascade-smoke.sh

Drives the full novel-promotion happy path:

```
project → episode → novelText →
analyze_novel (cascade=true) → clips_build → script_to_storyboard_run →
image_character → image_panel → video_multi_shot
```

### When to run

- After every prod deploy that touches anything in:
  - `src/lib/workers/handlers/{analyze-novel,clips-build,script-to-storyboard*,panel-image-task-handler,character-image-task-handler,multi-shot-video-*}.ts`
  - `src/lib/task/{submitter,service}.ts`
  - `src/lib/workers/shared.ts`
  - `src/lib/billing/task-policy.ts`
- Before a release / before opening a demo to external viewers
- When investigating "is it the worker, the cascade, or the API layer?"
  questions

### Usage

```bash
# Required
export E2E_USERNAME=admin
export E2E_PASSWORD=...

# Optional
export E2E_BASE_URL=https://art.kuiperfilmailab.com   # default
export E2E_LOCALE=zh-TW                                # default
export E2E_KEEP=1                                      # don't delete the test project
export E2E_SKIP_VIDEO=1                                # skip the video stage (cheaper)
export E2E_CASCADE_TIMEOUT=1500                        # seconds for storyboard
export E2E_IMAGE_TIMEOUT=300                           # seconds per image task
export E2E_VIDEO_TIMEOUT=900                           # seconds for multi-shot

./scripts/e2e/cascade-smoke.sh
```

### Cost estimate per run

| Stage | Provider | Approx cost |
| --- | --- | --- |
| analyze_novel | OpenRouter (Gemini 3.1 Pro) | ~$0.04 |
| clips_build + storyboard | OpenRouter | ~$0.05 |
| character image | Tencent VOD GEM-3.1 | $0 (Tencent VOD is metered separately) |
| panel image | Tencent VOD GEM-3.1 | $0 |
| multi-shot video | Tencent VOD Kling-3.0-Omni | $0 |

Real spend per run ≈ **$0.05–$0.15**, plus Tencent VOD usage on the
billing dashboard.

Set `E2E_SKIP_VIDEO=1` to skip the longest, most-billed stage when you
just want to validate the cascade chain.

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | every stage completed |
| 1 | pre-flight (login / config) failed |
| 2 | cascade stage (analyze/clips/storyboard) failed |
| 3 | asset stage (character or panel image) failed |
| 4 | video stage failed |

### Artifacts

Each run writes to a fresh `mktemp -d` directory containing:

- `project.json` — created project payload
- `episode.json` — created episode
- `patch.json` — novelText PATCH response
- `analyze-trigger.json` — initial cascade enqueue response
- `cascade-fail.json` — full task table snapshot if cascade failed
- `char-image-trigger.json`, `panel-image-trigger.json`, `video-trigger.json`

Path is printed on exit.

### What this script does NOT cover

- Voice analyze + voice line generation
- Lip-sync (fal — admin doesn't have a fal key configured today)
- Full-episode FFmpeg stitch
- Multi-user isolation (use `tests/integration/api/multi-user-isolation.test.ts`)
- Concurrent / contention edge cases (use load tests, not this)

## Adding new e2e scripts

1. Single-purpose: one script per pipeline path. Don't add modes to
   `cascade-smoke.sh` for unrelated flows; create `voice-smoke.sh` etc.
2. Read-driven: every assertion should be checking a specific
   observable (DB row, R2 path, task status). No "did the HTTP call
   return 200?" — hit the next API to confirm state actually moved.
3. Fail loud: exit non-zero with a specific code so CI / wrapper
   scripts can route alerts. Capture the failing payload to the run
   directory.
4. Self-cleaning by default: delete the test project at end unless
   `E2E_KEEP=1`. Tag test names with `[E2E-<timestamp>]` so leaked
   projects are easy to grep + bulk-delete.
