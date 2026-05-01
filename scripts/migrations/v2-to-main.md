# v2-to-main migration plan

> **Status**: not yet executed. Inventory dated 2026-05-01. Re-run inventory
> commands at top of this file before starting — Session A actively edits
> the V2 surface and counts will drift.

## Goal

Move the V2 work-in-progress UX out of the `/v2/` URL prefix so deployed
URLs read as the main product:

| Before | After |
| --- | --- |
| `https://art.kuiperfilmailab.com/zh/v2` | `https://art.kuiperfilmailab.com/zh` |
| `/zh/v2/workspace/<id>` | `/zh/workspace/<id>` |
| `/zh/v2/workspace/<id>/script` | `/zh/workspace/<id>/script` |
| `/zh/v2/workspace/<id>/subjects` | `/zh/workspace/<id>/subjects` |
| `/zh/v2/workspace/<id>/storyboard` | `/zh/workspace/<id>/storyboard` |
| `/zh/v2/workspace/<id>/voice` | `/zh/workspace/<id>/voice` |
| `/zh/v2/workspace/<id>/final` | `/zh/workspace/<id>/final` |
| `/zh/v2/workspace/<id>/home` | `/zh/workspace/<id>/home` |
| `/zh/v2/new` | `/zh/new` (or `/zh/projects/new`) |

The V1 (legacy /workspace/...) surface needs to be retired — it currently
holds the URL we want.

## When to run

**Not now.** Pre-conditions:

1. V2 functional surface frozen — Phase 12 voice/lip-sync/stitch all
   landed. URL changes mid-feature-work create merge conflicts every push.
2. Session A signals "no more big V2 PRs in flight" (today they pushed 10+
   commits to V2 in <2h; that velocity has to drop).
3. A clean `feature/phase-11` rebase point with no in-flight Session B
   work either.

Run as a **single PR**. Don't half-migrate.

## Inventory (2026-05-01)

### V2 routes — 11 directories, 23 files (to relocate)

```
src/app/[locale]/v2
src/app/[locale]/v2/new
src/app/[locale]/v2/workspace
src/app/[locale]/v2/workspace/[projectId]
src/app/[locale]/v2/workspace/[projectId]/final
src/app/[locale]/v2/workspace/[projectId]/home
src/app/[locale]/v2/workspace/[projectId]/hooks
src/app/[locale]/v2/workspace/[projectId]/script
src/app/[locale]/v2/workspace/[projectId]/storyboard
src/app/[locale]/v2/workspace/[projectId]/subjects
src/app/[locale]/v2/workspace/[projectId]/voice
```

### V1 routes — 275 files (to delete or reconcile)

```
src/app/[locale]/workspace/                         # the legacy V1 root
src/app/[locale]/workspace/[projectId]
src/app/[locale]/workspace/[projectId]/components
src/app/[locale]/workspace/[projectId]/hooks
src/app/[locale]/workspace/[projectId]/modes
src/app/[locale]/workspace/[projectId]/modes/novel-promotion
src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components
…(20+ subdirectories under modes/)
src/app/[locale]/workspace/asset-hub                # admin-only asset hub (keep — see "Cross-deps")
```

### `/v2/` hardcoded path references — 19 occurrences

Live grep query (re-run before starting):

```bash
grep -rn 'v2/workspace\|v2/new\|/v2"\|`/v2`\|/${locale}/v2' \
  src/ --include="*.tsx" --include="*.ts"
```

Known callers (Link href / router.push / cache key / etc):

- `src/app/[locale]/page.tsx` — landing CTA
- `src/app/[locale]/v2/V2HomeClient.tsx` — project list links
- `src/app/[locale]/v2/new/V2NewProjectClient.tsx` — `router.push` after create
- `src/app/[locale]/v2/workspace/[projectId]/V2WorkspaceShell.tsx` — sidebar tabs
- `src/app/[locale]/v2/workspace/[projectId]/script/V2ScriptClient.tsx` — internal links
- `src/app/[locale]/v2/workspace/[projectId]/subjects/V2SubjectsClient.tsx` — to /storyboard
- `src/components/v2/Sidebar.tsx` — sidebar logo + "← 所有專案"
- `src/components/v2/TopBar.tsx` — project switcher dropdown
- `src/components/Navbar.tsx` — main brand link

### Cross-deps the migration must NOT break

V2 currently imports from V1 surface in 2 places:

- `src/app/[locale]/v2/workspace/[projectId]/subjects/V2SubjectsClient.tsx`
  imports `asset-hub` related UI from `src/components/shared/assets/*`
  (those live under `src/components/`, not under V1 — safe).
- `src/app/[locale]/v2/workspace/[projectId]/final/V2FinalClient.tsx`
  similarly references shared component utilities.

`src/app/[locale]/workspace/asset-hub/page.tsx` — admin-only entry, must
**survive** the V1 deletion. Either:
- Move to `src/app/[locale]/asset-hub/page.tsx` (top-level), or
- Move under the new main workspace as `/zh/workspace/asset-hub`.

`SpeakerVoiceBindingDialog.tsx` lives at
`src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/`.
If V2 voice page imports it (V2 voice is mostly stub today), pull it up to
`src/components/shared/voice/` first, then delete V1 voice dir.

`src/lib/novel-promotion/stages/*` — runtime stage helpers shared between
V1 and V2. Keep these untouched; they're not in `src/app/`.

## Execution checklist (single PR)

1. **Fresh inventory** (re-run grep — counts will drift)
2. **Branch** from latest origin/feature/phase-11 (or whatever branch
   feature work merges to at that point)
3. **Coordinate with Session A** — explicit lock window, no V2 PRs while
   migration is in flight
4. **Move V2 → main**:
   ```bash
   git mv src/app/\[locale\]/v2/workspace src/app/\[locale\]/workspace.new
   git mv src/app/\[locale\]/v2/new src/app/\[locale\]/new.new
   git mv src/app/\[locale\]/v2/V2HomeClient.tsx src/app/\[locale\]/V2HomeClient.tsx  # consider rename to HomeClient.tsx
   git mv src/app/\[locale\]/v2/page.tsx src/app/\[locale\]/v2-page-temp.tsx  # holding pen
   ```
5. **Delete V1** (after pulling shared deps out — see Cross-deps):
   ```bash
   git rm -r src/app/\[locale\]/workspace
   git mv src/app/\[locale\]/workspace.new src/app/\[locale\]/workspace
   git mv src/app/\[locale\]/new.new src/app/\[locale\]/new
   rm src/app/\[locale\]/v2-page-temp.tsx
   git rm -r src/app/\[locale\]/v2  # the now-empty original v2 folder
   ```
6. **Sweep `/v2/` path strings** (the 19 known sites + anything new):
   ```bash
   grep -rl 'v2/workspace\|v2/new' src/ | xargs sed -i '' 's|v2/workspace|workspace|g; s|v2/new|new|g'
   # Verify with: grep -rn '/v2' src/  → should be 0 hits in app code
   ```
7. **Add redirects** in `next.config.js` for old bookmarks:
   ```js
   async redirects() {
     return [
       { source: '/zh/v2', destination: '/zh', permanent: true },
       { source: '/zh/v2/:path*', destination: '/zh/:path*', permanent: true },
       { source: '/en/v2/:path*', destination: '/en/:path*', permanent: true },
     ]
   }
   ```
8. **Update `scripts/e2e/cascade-smoke.sh`** if it ever derives URLs from
   `/v2/` (currently it doesn't — it hits API directly).
9. **Update `docs/ai-runtime/08-open-gaps.md`** "E2E pipeline 验证" sample
   URLs.
10. **Update master plan** if any phase still tracks `/v2/...` paths.
11. **Run** `npm run test:regression` + `scripts/e2e/cascade-smoke.sh` end-to-end.
12. **Deploy** + smoke-check `/zh/workspace/<existing-project-id>` loads
    and `/zh/v2/workspace/<id>` redirects to it.

## Estimated effort

| Step | Time |
| --- | --- |
| Coordinate + branch + fresh inventory | 30 min |
| Cross-dep extraction (asset-hub + SpeakerVoiceBindingDialog) | 30-60 min |
| File moves + V1 delete + path sweep | 1-2 h |
| Redirects + e2e sweep + docs | 30 min |
| Test + deploy + verify | 30 min |
| **Total** | **3-5 hours** focused work, 1 dev |

## Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Session A pushes V2 work mid-migration | High | Lock window. Single PR. |
| Old user bookmarks 404 | Low (no public users yet) | `next.config.js` redirects |
| External docs / Slack messages link to `/v2/` | Low | Audit + redirects cover it |
| Cross-dep imports break (asset-hub / voice dialog) | Medium | Extract to `src/components/shared/` BEFORE V1 delete |
| Test fixtures hardcoded `/v2/` | Low | grep tests/ before commit |
| Vercel/Caddy rewrite caches old paths | Low | Force redeploy, clear Caddy cache |

## Out of scope for this PR

- Renaming the V2HomeClient / V2WorkspaceShell / V2*Client classes — the
  prefix is fine, file move semantics are stable. A separate cleanup PR
  can drop the `V2` prefix when nothing references it.
- Rewriting any V2 page styling. Keep the cinematic palette.
- Backfilling V1-era e2e tests. They're already tied to V1 routes that
  are about to die; delete them in this PR if any survive.
