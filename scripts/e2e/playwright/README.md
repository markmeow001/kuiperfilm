# scripts/e2e/playwright

Playwright UI smoke tests against deployed KuiperAI. Drives real
chromium against `art.kuiperfilmailab.com` (or any deployed env).
Catches UI bugs that the static field-wire audit can't see — UI
sends X but renders Y, hydration race, route 404, value not
persisting, etc.

## ui-smoke.py

5 critical flows in one run, sequential, ~10 seconds:

| # | Flow | What it asserts |
| --- | --- | --- |
| 1 | `signin` | `#username` + `#password` fill commits to React state, submit lands a `session-token` cookie |
| 2 | `v2_home` | `/zh/v2` renders without error overlay, has 新建/專案/Create text |
| 3 | `project_create` | `POST /api/projects` accepts payload, **GET round-trips** the exact `name` value |
| 4 | `v2_workspace` | `/zh/v2/workspace/{id}` loads without "Application error" or 500 |
| 5 | `episode_round_trip` | Create episode + PATCH `novelText`, **GET round-trips** the exact text including newlines + Chinese |

Self-cleans the test project unless `E2E_KEEP=1` is set. Failed
flows write `fail.png` (full page screenshot) to
`test-results/<timestamp>/<flow>/`.

### Why Python instead of `@playwright/test`

Adding `@playwright/test` would touch `package.json` which Session
A actively edits (avoid merge conflicts). The Python `playwright`
package is already installed via conda (1.59.1) with chromium
cached, so the script runs immediately with zero repo dep change.

### Usage

```bash
# Required
export E2E_USERNAME=admin
export E2E_PASSWORD=...

# Optional
export E2E_BASE_URL=https://art.kuiperfilmailab.com   # default
export E2E_LOCALE=zh                                   # default
export E2E_HEADED=1                                    # show browser (debug)
export E2E_KEEP=1                                      # keep test project after run

python3 scripts/e2e/playwright/ui-smoke.py
```

### When to run

- After every prod deploy that touches:
  - Auth flow (`src/lib/auth.ts`, `src/app/api/auth/*`)
  - V2 home / workspace shell (`src/app/[locale]/v2/**`)
  - Project / episode CRUD (`src/app/api/projects/route.ts`,
    `.../episodes/route.ts`)
- Before opening prod to demo / external viewers
- Pair with `scripts/e2e/cascade-smoke.sh` for full-pipeline
  coverage (this script verifies UI/API wires; cascade-smoke
  verifies the LLM/image/video pipeline)

### Cost

Approximately zero. No LLM / image / video calls — the test only
exercises auth + CRUD. ~10 seconds wall clock. Hits prod only via
HTTP API (no extra droplet CPU load beyond a few requests).

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | every flow passed |
| 1 | pre-flight (env vars missing) |
| 2 | a flow failed — see `test-results/<timestamp>/<flow>/fail.png` |

### What this DOES NOT cover

- Form fields beyond `username`/`password`/project name/episode novelText
- Character / location / panel edit flows (need V2 modal navigation)
- Image / video generation (covered by `cascade-smoke.sh`)
- Multi-user isolation (covered by `tests/integration/api/multi-user-isolation.test.ts`)
- Role / permission boundaries (admin vs member visibility)

If the field-wire audit (`scripts/quality/field-wire-audit-v3`)
flags a field as suspect, add a flow here that fills it and
verifies the round-trip — that's the canonical way to settle
"is this wire actually live in production".
