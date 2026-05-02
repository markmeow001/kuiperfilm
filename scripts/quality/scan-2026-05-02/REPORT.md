# Dead-code scan — 2026-05-02

> First pass of the "監測所有欄位是不是真實有效" audit. This pass is
> **code-level only** (dead exports / files / deps). Field-level
> verification (form field → API param → DB column wire-up) is a
> separate pass — see "Next steps".

## Inputs

- Branch: `feature/phase-11` @ commit `9ddf05b` (rebased onto latest
  Session A push before scan)
- Tools: `knip 6.11.0` (default config, no project knip.json) +
  `ts-prune` (npm latest)
- Run: 2026-05-02

## Top-line numbers

| Category | Count | Notes |
| --- | --- | --- |
| Unused files | **65** | Almost entirely the V1 `[locale]/workspace/...` tree. Lines up exactly with `scripts/migrations/v2-to-main.md`'s "delete V1" plan |
| Unused dependencies | 7 | Needs human verify — knip false-positives on dynamic imports |
| Unused devDependencies | 3 | One is `eslint-config-next` which Next.js framework requires (knip false-positive) |
| Unused exports | 123 | Bulk of these live in dead V1 files — vanish for free when V1 is deleted |
| Unused exported types | 148 | Same — dead types in dead files |
| `ts-prune` raw lines | 1346 | 367 "(used in module)" + 979 "pure dead" — but a third of "pure dead" is framework-required (Next.js middleware/config/instrumentation default exports) |

## Headline finding

**~65 dead files = the V1 `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/...` tree**.

That confirms what the v2-to-main migration plan already
predicted: V1 is structurally dead weight, the only thing keeping
it in the repo is the URL slot it occupies. Deleting it has zero
runtime cost and reclaims:
- 65 files
- ~120 of the 123 unused exports
- ~140 of the 148 unused exported types
- ~3-5 of the 7 "unused" deps (file-saver / mammoth / react-hot-toast
  are V1-era UX choices V2 didn't carry forward)

**Recommendation**: when Session A's V2 push velocity drops and the
v2-to-main migration runs, do that whole tree's deletion in the
same PR — no need for a separate dead-code-cleanup PR.

## Unused dependencies (needs human verify)

| Package | Likelihood it's truly dead | Verify how |
| --- | --- | --- |
| `@ai-sdk/google` | Medium — V2 uses `@ai-sdk` indirectly via run-runtime; might be a runtime-only consumer | `grep -rn "from '@ai-sdk/google'" src/` |
| `@openrouter/sdk` | Low — OpenRouter is the active analysis LLM; this might be wrong package name vs what's actually imported | grep imports |
| `@remotion/cli` | Medium — Remotion render is a Phase 12.x deferred capability; CLI may be future-only | check `next.config` + `package.json` scripts |
| `@types/bcryptjs` | False-positive — types follow `bcryptjs` runtime usage in NextAuth credentials provider | leave |
| `file-saver` | High — V1-era download UX; V2 uses streamed download | safe to drop with V1 |
| `mammoth` | Medium — Word .docx import; check smart-import flow | grep `import mammoth` |
| `react-hot-toast` | Medium — V2 uses different toast lib? | grep `react-hot-toast` |
| `@swc/helpers` (devDep) | False-positive — Next.js SWC compile may need it implicitly | leave |
| `@types/file-saver` | High — pairs with `file-saver` above | drop together |
| `eslint-config-next` (devDep) | **False-positive — Next.js framework requires this** | **DO NOT remove** |

After V1 delete + verify pass, expected remaining unused deps:
0–2 packages.

## Files generated

```
scripts/quality/scan-2026-05-02/
├── REPORT.md         (this file)
├── knip.txt          (371 lines — file/dep/export breakdown)
└── ts-prune.txt      (1346 lines — every export × usage status)
```

## Caveats

1. **ts-prune ≠ knip**. ts-prune's "pure dead" includes
   `middleware.ts default`, `next.config.ts default`,
   `instrumentation.ts register` — all framework-required. Filter
   those before action.
2. **Knip default config**. No `knip.json` was authored, so
   `entry`/`project` patterns rely on knip's auto-detection of
   Next.js. A few real entry points (BullMQ workers triggered via
   shell scripts) may be misclassified as unused. **Do not bulk
   delete from knip output without read-checking each file.**
3. **Dynamic imports invisible**. Both tools track static `import`
   only. `import('./foo')` lazy-loads or `require(varName)` patterns
   look dead but aren't.
4. **API contract surface**. Unused exports under
   `src/app/api/.../route.ts` look like a route is dead, but Next.js
   App Router invokes the route by file path, not by import — they
   are not dead, knip just doesn't model App Router routing.

## What this pass does NOT cover

The user asked "監測平台內所有欄位是不是真實有效". Code-level
dead detection answers "is this exported function reachable" —
it does NOT answer:

- **Form field → API param**: does every `<input name="X">` in a V2
  modal actually get sent to a backend route that reads `body.X`?
- **API param → DB column**: does every `body.X` the API reads
  actually get persisted to a Prisma `data.X` write?
- **DB column → API response**: does every column we write get
  returned by some GET endpoint, or are we writing data nothing
  ever reads?
- **UI display lies**: does the rendered value match the actual DB
  column (or is the UI showing stale local state)?

## Next steps (in cost order)

1. **Quick wins (15 min, 0 token)** — drop the 4 confidently-dead deps
   (`file-saver`, `@types/file-saver`, `mammoth`, `react-hot-toast`)
   after `grep` verify. PR atomic. ~50KB shaved off the bundle.
2. **Field-level audit script (1-2 h, 0 token)** — write
   `scripts/quality/field-wire-audit.ts`:
   - Extract every `<input name="X">` / `<select name="X">` from V2 tsx
   - Extract every `body.X` / `body?.X` / destructure from API routes
   - Extract every Prisma `data: { X: ... }` write
   - Cross-reference: orphan form fields (no API consumer), orphan
     API params (no DB write), orphan DB writes (no GET reader)
3. **Playwright UI smoke (30 min write + 20 min run)** — for top 5
   forms (signin / signup / project create / character edit /
   storyboard panel edit), drive the form, hit submit, verify the
   value lands in the API response. Catches "type matches but UI
   wires wrong field name".
4. **V2 → main URL migration** — when timing right (per
   `scripts/migrations/v2-to-main.md`), single PR that:
   - Deletes `src/app/[locale]/workspace/...` (V1)
   - Auto-shrinks 60+ of the unused exports / types
   - Drops V1-only deps
   - Sweeps dead-code report 80% smaller
