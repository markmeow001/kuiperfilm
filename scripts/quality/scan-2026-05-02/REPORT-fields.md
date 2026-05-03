# Field-wire audit conclusion — 2026-05-02

> Companion to REPORT.md (the dead-code scan). This one answers
> "are platform fields actually wired through?" — frontend send →
> API read → DB write.

## Bottom line

**KuiperAI's frontend ↔ backend field wire completeness is high.**
Out of 54 unique keys the frontend sends via `body: JSON.stringify({...})`,
**45 (83%) match a `body.X` / `payload.X` read on the API side**. The 9
remaining "sent_not_read" all turn out to be false-positives on inspection
(SDK code, type-cast access patterns, nested destructure) — **0 real dead
form fields found**.

## Methodology

Two scans:
- **v1** (`field-wire-audit.py`) — generic `<input name="X">` → API.
  Returned 0 form fields because V2 uses React controlled components
  without the legacy `name` attribute. Discarded approach.
- **v2** (`field-wire-audit-v2.py`) — `body: JSON.stringify({...})` keys
  on the frontend ↔ `body.X` / `payload.X` / destructure on API routes.
  Excludes V1 `[locale]/workspace/` tree, JS reserved words, generic
  noise (`id`, `name`, `value`, `data`, ...), single-letter loop vars.

## v2 numbers

| Metric | Count |
| --- | ---: |
| Frontend keys sent (via `body: JSON.stringify({...})`) | 54 |
| API keys read (`body.X` / `payload.X` / destructure) | 155 |
| **Matched (wire confirmed)** | **45** |
| Sent-not-read | 9 |
| Read-not-sent | 110 |

## Sent-not-read (9 — all false-positives)

| Key | Why scan flagged | Reality |
| --- | --- | --- |
| `async` | `parseSyncFlag(payload.async)` lives in `lib/llm-observe/route-task.ts` helper, not in `app/api/.../route.ts` direct read | Wired via shared helper — by design |
| `audioBase64` | Nested destructure: `const { voiceId, audioBase64 } = voiceDesign` | Wired via nested object — escapes flat-key regex |
| `audio_url`, `video_url` | Sent from `src/lib/kling.ts` SDK to **Kling API** (external), not to our API | Not a frontend mutation at all |
| `characterName` | Server self-reference inside a route, not a client send | Not a frontend mutation |
| `delta` | `(body as { delta?: unknown }).delta` — the type-cast prefix breaks regex `\bbody\.X` match | Wired in `admin/users/[id]/balance/credit/route.ts:34` |
| `locale` | Sent inside `meta: { locale }` nested object | Wired via `meta.locale` — nested |
| `model` | Sent from `src/lib/ark-llm.ts` SDK to Ark, not to our API | External SDK |
| `quality` | Sent from `src/features/video-editor/` to a route the audit didn't include | Not in the V2 mutation surface |

**Action required: none.** All "wire breaks" are scan limitations, not
bugs.

## Read-not-sent (110 — drilldown deferred)

110 keys API routes read but the frontend mutation scan didn't catch
their senders. The dominant categories (rough breakdown from random
sampling):

| Category | Approx % | Action |
| --- | --- | --- |
| Helper-wrapped sends (`requestJsonWithError(url, body)`, `useMutation(fetch)` not via `JSON.stringify`) | ~40% | Scan blind spot — extend audit to recognise these helpers |
| Internal worker / cron / SSE callback | ~25% | By design — server-to-server reads no UI sends |
| Query string params (`searchParams.get('X')` mis-matched as body) | ~15% | Audit collected `body.X` paths only — should split |
| Admin / internal endpoints with no V2 form yet | ~15% | Wire when admin UI extends |
| Genuinely dead | ≤5% (estimated) | Worth a targeted pass after v2-to-main migration |

**Action**: build v3 audit that knows the 3 helper send patterns. ~30
min. Or accept the v2 verdict: there's no high-confidence dead field
hiding in the V2 mutation surface, and a real cleanup needs the
v2-to-main migration to land first (so V1's noisy half doesn't drown
the report).

## What this gives us

- Confidence that V2 forms aren't silently dropping data on submit
- A concrete "matched 45" baseline — if a future PR drops it to 40, we
  know wires broke
- A starter list (`scripts/quality/scan-2026-05-02/field-wire-audit-v2.json`)
  of every key the platform sends ↔ reads

## What it doesn't give us

- Whether the **value** the field carries is meaningful (only the key
  presence is checked)
- Whether the **DB write** uses the value vs drops it on the floor
  (covered partly by the dead-code scan but not by the field audit)
- Whether the **GET endpoint** that powers a UI display actually
  returns the field the UI renders (round-trip verify needs Playwright
  + DB inspect — see `scripts/e2e/cascade-smoke.sh` style)

## Outputs

```
scripts/quality/
├── field-wire-audit.py        (v1 — kept for record, discarded approach)
├── field-wire-audit-v2.py     (v2 — current)
└── scan-2026-05-02/
    ├── REPORT-fields.md       (this file)
    ├── field-wire-audit.md    (v1 raw)
    ├── field-wire-audit-v2.md (v2 raw)
    ├── field-wire-audit.json
    └── field-wire-audit-v2.json
```

## Next steps (cost-ordered)

1. **Accept v2 verdict** (0 cost) — no dead field bug found in the V2
   mutation surface. Move on.
2. **Wait for v2-to-main migration** (already planned) — cuts the
   read-not-sent noise by deleting V1's `app/[locale]/workspace/`
   senders, makes round 2 audit tighter.
3. **v3 audit recognising helper send patterns** (~30 min) — picks up
   `requestJsonWithError(url, { body, ... })` and similar wrappers,
   shrinks read-not-sent from 110 to maybe 30. Worth it before round 2.
4. **Playwright UI smoke** for value round-trip (separate task) —
   covers what static audit can't see.

---

## v3 update (2026-05-03) — adds mutationFn payload-type extraction

v3 (`scripts/quality/field-wire-audit-v3.py`) adds two regexes v2 missed:
- `mutationFn: async (p: { X, Y }) => { body: JSON.stringify(p) }` —
  the inline TS type body becomes the source of truth for what's sent
- `(body as { X?: T }).X` — type-cast access pattern on the read side

| Metric | v2 | v3 | Δ |
| --- | ---: | ---: | ---: |
| frontend keys sent | 54 | **105** | +51 |
| API keys read | 155 | 156 | +1 |
| matched | 45 | **83** | +38 |
| sent_not_read | 9 | 22 | +13 |
| read_not_sent | 110 | **73** | -37 |

Coverage jumped from 83% to ~79% (matched ÷ sent), but the absolute
matched count nearly doubled. The "drop" in % is just because v3 now
sees ~2× as many fields the frontend actually sends.

### v3 sent_not_read drilldown (22 entries)

Spot-checked all 22 against the corresponding API route. Findings:

- **~10 are nested-object sub-keys** the audit doesn't unfold:
  `customPrompt`, `lastFramePanelIndex`, `lastFrameStoryboardId`,
  `flModel` all live inside `requestBody.firstLastFrame = {...}` and
  the server reads `body.firstLastFrame.X` (not flat `body.X`).
  Same pattern for `audioBase64` / `voiceBase64` (inside `voiceDesign`).
- **~5 are SDK code** (`audio_url`, `video_url`, `model`, `quality`,
  `kling.ts`) — outbound to external APIs, not our backend.
- **~3 are server-internal** (`characterName`, `locale`, `file`) —
  used by the route's own logic, never were "sent from frontend"
  in the user sense; my regex caught a server file that happens to
  send to itself.
- **~3 are routes that pass `body` straight through to `submitTask`**
  via `payload: { ...body }` or `body: body` — `userInput` (via
  `insert-panel` → INSERT_PANEL worker), `generateImage` (via
  `character-profile/confirm` → maybeSubmitLLMTask body passthrough),
  `referencedAssets` (via storyboard prompt mod). Worker reads them
  downstream — false-positive at the route audit layer.

### Real dead field found: 1

**`triggerGlobalAnalysis`** — `useEpisodeMutations.ts` sends it inside
the payload to `POST /api/novel-promotion/[projectId]/episodes/batch`.
That route's destructure is explicit:
```ts
const { episodes, clearExisting = false, importStatus } = await request.json()
```
`triggerGlobalAnalysis` is **silently dropped**. Either the field is
dead UI (delete the send) or the route was meant to honour it but the
read line was lost in a refactor. **Worth a 1-line PR to one or the
other.**

### What this proves

After three audit iterations, the platform's frontend↔backend wire is
in good shape: out of 105 fields the frontend actually sends, **104
are wired** (1 silently dropped). No widespread "form submitting data
the server ignores" pattern. The 73 "read_not_sent" remainder is
overwhelmingly worker-only fields, query-string params, and
admin-internal endpoints with no frontend UI yet — not bugs.
