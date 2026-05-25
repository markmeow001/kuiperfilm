# Workspace Collaboration Spec — Phase 12.5

Figma-style team collaboration for KuiperAI: workspace role + per-project edit grants + request-to-edit flow + audit log + soft-delete.

**Status**: spec for review, not yet implemented.
**Generated**: 2026-05-22
**Estimated effort**: ~27 hr (3-4 days)

---

## 1. Locked decisions

| # | Decision | Choice |
|---|---|---|
| 1 | 新成員加進 workspace 預設 role | **Viewer**（safer default for author-driven workflow） |
| 2 | 同 workspace member 預設能 read 別人專案 | **Yes**（避免 dropdown 列出卻點不進去）|
| 3 | Edit request 通過後 grant 範圍 | **Per-project**（不升 workspace role）|
| 4 | Owner 可以撤回 edit grant | **Yes** |
| 5 | Edit request 通知 channel | **In-app only**（內部 10-20 人團隊，email 多此一舉）|

---

## 2. Goals

1. Multi-tenant team collaboration with **per-project edit grants** (Figma 風格)
2. **4-level access model**: Owner / Admin (sys) / Editor (workspace 或 per-project) / Viewer
3. **Request-to-edit flow** for safe collaboration without privilege escalation
4. **Audit log + soft-delete** for accountability and disaster recovery
5. **Top-bar workspace switcher** for navigation between workspaces

---

## 3. Schema changes

### 3.1 New columns

```prisma
model WorkspaceMember {
  workspaceId String
  userId      String
  role        WorkspaceRole @default(viewer)   // ← NEW
  addedBy     String
  joinedAt    DateTime @default(now())
  @@id([workspaceId, userId])
}

enum WorkspaceRole {
  editor   // Default workspace-wide RW on all projects
  viewer   // Default workspace-wide read-only on all projects
}

model NovelPromotionProject {
  // ...existing fields
  workspaceId String?     // ← NEW: nullable, null = personal (legacy + standalone)
  deletedAt   DateTime?   // ← NEW: soft-delete marker
  deletedBy   String?     // ← NEW: who soft-deleted
  @@index([workspaceId])
  @@index([deletedAt])
}
```

### 3.2 New tables

```prisma
model ProjectCollaborator {
  projectId  String
  userId     String
  role       ProjectCollabRole   // Overrides workspace-level default
  grantedBy  String
  grantedAt  DateTime @default(now())
  @@id([projectId, userId])
  @@index([userId])
}

enum ProjectCollabRole {
  editor
  viewer
}

model EditRequest {
  id          String        @id @default(cuid())
  projectId   String
  requesterId String
  status      RequestStatus @default(pending)
  message     String?
  createdAt   DateTime      @default(now())
  resolvedAt  DateTime?
  resolvedBy  String?
  @@index([projectId, status])
  @@index([requesterId])
}

enum RequestStatus {
  pending
  approved
  denied
  expired   // Auto-set after 7 days
}

model AuditLog {
  id         String   @id @default(cuid())
  userId     String   // Actor
  projectId  String?  // Affected project (nullable for workspace-level actions)
  action     String   // e.g. "panel.update" / "project.delete" / "collaborator.add"
  entityType String   // "Panel" | "Project" | "Character" | "Collaborator" | etc.
  entityId   String
  snapshot   Json?    // Pre-mutation state (destructive actions only)
  createdAt  DateTime @default(now())
  @@index([projectId, createdAt])
  @@index([userId])
}
```

### 3.3 Migration order (踩坑提醒)

Per `reference_kuiperfilm.md` memory — SQL must apply BEFORE code deploy or Prisma client crashes on boot.

1. `scripts/migrations/2026-05-22-workspace-collab.sql` deploy first
2. Then `prisma generate` + code deploy
3. Backfill (next section)

### 3.4 Backfill策略

| Table | Default for existing rows |
|---|---|
| `WorkspaceMember.role` | **editor** (preserve existing 4-tier cascade behavior — they already had RW) |
| `NovelPromotionProject.workspaceId` | **NULL** (treat all existing as personal) |
| `NovelPromotionProject.deletedAt` | NULL (no rows deleted) |

**Critical**: existing WorkspaceMember rows get `editor`, NOT `viewer`. Stripping access silently would break trust.

NEW members added after deploy default to `viewer` (per Decision 1B).

---

## 4. Auth cascade (4-tier → 8-tier including legacy fallback)

```
For project P, requester R, action ∈ {read, write}:

1. R == P.ownerUserId                            → ✓ read+write   (owner always)
2. R.role == 'admin'                              → ✓ read+write   (sys admin bypass)
3. R == P.workspace.ownerEditorId (if ws set)    → ✓ read+write   (workspace 領導, NEW)
3.5 [LEGACY FALLBACK] R is editor of any
    workspace containing P.ownerUserId as member  → ✓ read+write   (preserves existing 4-tier
                                                                    behavior for projects with
                                                                    workspaceId=NULL)
4. ProjectCollaborator(P, R) exists              → ✓ role-based   (per-project grant, overrides #5)
5. WorkspaceMember(P.ws, R) (if ws set)         → ✓ role-based   (workspace default)
6. else                                          → 403

For action=write: only role=editor in #4 or #5 passes
For action=read: both editor and viewer pass
```

### Why step 3.5 (legacy fallback) is mandatory

Without 3.5, the migration is a SILENT REGRESSION for existing workspace owner editors:

- Today: editor E owns workspace W, member M is in W, M creates project P
- Today: `editorCanAccessProject(E, M)` queries `workspace.findFirst({ ownerEditorId: E, members.some.userId: M })` → finds W → E sees P via existing 4-tier step 3
- After migration: P.workspaceId is NULL (backfill default), so new step 3 fails (no workspace to check ownerEditorId on); step 5 also fails (no workspaceId)
- Without 3.5: **E loses access to P**

Step 3.5 preserves the existing `editorCanAccessProject(R, P.ownerUserId)` query as a fallback that triggers ONLY when:
- The project has no explicit workspaceId (legacy), AND
- The requester is an editor of a workspace that contains the project owner as member

Once users start assigning projects to specific workspaces (Phase 2 — explicit project-to-workspace migration), step 3.5 becomes redundant. Mark it `[DEPRECATED, remove in Phase 2]` in the code comment.

### 4.1 Implementation

New helper in `src/lib/api-auth.ts`:

```ts
export async function requireProjectAccess(
  projectId: string,
  requesterId: string,
  action: 'read' | 'write',
): Promise<
  | { allowed: true; effectiveRole: 'owner' | 'admin' | 'ws_owner' | 'ws_owner_legacy' | 'editor' | 'viewer' }
  | { allowed: false; reason: string }
>
```

Implementation reuses the existing `editorCanAccessProject(R, ownerId)` helper at step 3.5 — no new SQL, just keep the legacy code path alive as a fallback after step 3 returns no match.

Replaces existing `requireProjectAuth` everywhere. Existing 4-tier cascade callers automatically inherit new behavior (cascade extends, doesn't replace).

The `effectiveRole` distinguishes `ws_owner` (new path, via P.workspaceId) from `ws_owner_legacy` (3.5 path, via owner's workspace membership) so we can log usage and verify when 3.5 stops firing (signal that all legacy projects have been assigned to workspaces).

### 4.2 Hard gate audit

Every mutation API endpoint (POST/PATCH/DELETE) must:
1. Call `requireProjectAccess(projectId, requesterId, 'write')` BEFORE any DB write
2. If `!allowed`, return 403 with code `INSUFFICIENT_ACCESS`
3. Server-side validation, regardless of UI state

**Endpoint audit checklist** (must all pass):
- `/api/novel-promotion/[projectId]/*` — all POST/PATCH/DELETE
- `/api/novel-promotion/[projectId]/character/*`
- `/api/novel-promotion/[projectId]/location/*`
- `/api/novel-promotion/[projectId]/character/appearance` (POST/PATCH/DELETE)
- `/api/novel-promotion/[projectId]/episodes/*`
- `/api/novel-promotion/[projectId]/generate-multi-shot-video`
- `/api/novel-promotion/[projectId]/storyboard/*`
- `/api/novel-promotion/[projectId]/voice/*`
- Any other write endpoint scoped to a project

Integration tests must cover viewer + stranger access to each endpoint.

---

## 5. New API endpoints

### 5.1 Project listing (scoped)

```
GET /api/projects?ws=<id|personal|all>
  ws=personal:    WHERE ownerUserId = me AND workspaceId IS NULL
  ws=<id>:        WHERE workspaceId = ? AND deletedAt IS NULL
                  (auth: me must be workspace member or owner editor)
  ws=all:         WHERE deletedAt IS NULL (admin only)

Response: { projects: [...], scope: '...' }
```

### 5.2 Workspace member role management

```
PATCH /api/workspaces/:id/members/:userId
  body: { role: 'editor' | 'viewer' }
  auth: workspace owner editor or admin

Response: { ok: true, member: {...} }
```

### 5.3 Per-project collaborators

```
GET    /api/projects/:id/collaborators
       — list current per-project collaborators
       auth: read access to project

POST   /api/projects/:id/collaborators
       body: { userId, role: 'editor' | 'viewer' }
       — owner|admin only, adds explicit grant
       (creates audit log: "collaborator.add")

DELETE /api/projects/:id/collaborators/:userId
       — revoke per-project grant
       auth: owner|admin only
       (audit log: "collaborator.remove")
```

### 5.4 Edit request flow

```
POST   /api/projects/:id/edit-requests
       body: { message?: string }
       — viewer requests edit access
       auth: must have read access to project
       rate limit: max 5 pending per requester (across all projects),
                   max 3 pending per (requester, project) pair

GET    /api/edit-requests/incoming
       — for project owners, lists pending requests on their projects
       Response: { requests: [{id, projectId, requester, message, createdAt}] }

PATCH  /api/edit-requests/:id
       body: { action: 'approve' | 'deny' }
       auth: project owner|admin only
       on approve: creates ProjectCollaborator(projectId, requesterId, editor)
       updates: status, resolvedAt, resolvedBy
       (audit log: "request.approve" or "request.deny")
```

### 5.5 Audit + soft-delete

```
GET    /api/projects/:id/audit
       — list audit log for project
       auth: read access to project
       Response: paginated audit entries

POST   /api/projects/:id/restore
       — restore soft-deleted project (clear deletedAt)
       auth: owner|admin only, within 30 days
```

### 5.6 Modified endpoints

```
DELETE /api/novel-promotion/:projectId
       — change from hard DELETE to soft (UPDATE deletedAt)
       — audit log entry: "project.delete" with full snapshot
       — owner receives in-app notification
```

### 5.7 Cron / background jobs

```
- Edit request expiry: every 1 hr, mark pending requests >7d as 'expired'
- Hard delete: every 24 hr, hard DELETE projects where deletedAt > 30d
```

---

## 6. UI changes

### 6.1 Top-bar workspace switcher

**Location**: only on `/v2/` home page (project list), NOT on `/v2/workspace/{projectId}/*` pages

**Component**: `V2TopBar.tsx` (new)

```
[Logo · Kuiper 影界]  [▾ ABC 工作區]                          [🔔 2] [Avatar ▾]
                      ├─ 我的工作區 ✓ (3 個專案)
                      ├─ ABC 工作區 (test 組織 · 5 個專案)
                      ├─ Team A (Demo Studio · 2 個專案)
                      └─ ─────────
                      └─ 管理工作區 →
```

**State**: URL search param `?ws=<id|personal>`, defaults to `personal`.

**Behavior**:
- Switch → `router.replace('?ws=newId')` + invalidate project list query
- Project count per workspace shown via existing `/api/workspaces` `_count`
- "管理工作區" link → `/zh/workspaces` (existing dashboard)

### 6.2 Read-only mode

New hook: `useProjectAccess(projectId)`

```ts
function useProjectAccess(projectId: string): {
  role: 'owner' | 'admin' | 'ws_owner' | 'editor' | 'viewer' | null
  canEdit: boolean
  canView: boolean
  loading: boolean
}
```

Calls `GET /api/projects/:id/access` (new helper endpoint).

**Page-by-page disable list**:

| Page | Buttons to gate (`disabled={!canEdit}`) |
|---|---|
| `script/V2ScriptClient.tsx` | 儲存, 新建劇集, 重命名劇集, 刪除劇集, 上傳劇本檔案 |
| `subjects/V2SubjectsClient.tsx` | 一鍵分析, 重新分析, 角色卡 [重新生成/上傳替換/編輯/刪除/鎖定], 場景卡同上, 道具卡同上 |
| `storyboard/V2StoryboardClient.tsx` | 一鍵生成分鏡, 重新分析, 編輯 panel, 生成視頻, 重新生成視頻, 切組 toggles |
| `storyboard/GroupCard.tsx` | 全部 mutation buttons (生成視頻, 重新分析, 編輯敘事, 鎖定, 風格 select, 時長 select 等) |
| `voice/V2VoiceClient.tsx` | 生成配音, 重新生成, 上傳替換 |
| `final/V2FinalClient.tsx` | 合成最終影片, 重新合成 |

**Top-right badge** (mounted in V2WorkspaceShell):

```
[OWNER]   amber, default
[ADMIN]   rose
[EDITOR]  amber outline
[VIEWER]  stone, "唯讀模式" tooltip
```

**Edit button tooltip when viewer**: `"你是 viewer · 點此請求編輯權限"` → opens request modal

### 6.3 Edit request modal

Trigger: viewer clicks any disabled edit button.

```
┌─────────────────────────────────────┐
│ 請求編輯權限                  [✕]   │
├─────────────────────────────────────┤
│                                     │
│ 專案: 《迁徙》3分钟先导片            │
│ 擁有者: @IkariNERV                  │
│                                     │
│ 留言（選填，給擁有者參考）：          │
│ ┌─────────────────────────────────┐ │
│ │ 我想幫你改 EP02 對白...           │ │
│ │                                 │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ⓘ 擁有者批准後你會收到通知          │
│                                     │
│           [取消]  [送出請求]        │
└─────────────────────────────────────┘
```

### 6.4 Notification center

Top-bar 🔔 icon. Pending count badge.

Click → dropdown panel:

```
┌────────────────────────────────────────┐
│ 通知                       [全部已讀]   │
├────────────────────────────────────────┤
│ 🔔 收到的編輯請求 (2)                  │
│                                        │
│ • @userA 想編輯《迁徙》3分钟先导片      │
│   留言: 我想幫你改 EP02 對白           │
│   [批准] [拒絕]                        │
│                                        │
│ • @userB 想編輯 TEST DDAY              │
│   [批准] [拒絕]                        │
│                                        │
├────────────────────────────────────────┤
│ ✅ 你的請求 (1)                        │
│ • 《XYZ 專案》— 已批准 ✓               │
├────────────────────────────────────────┤
│ ⚠️ 你的專案被 admin 操作               │
│ • Admin 刪除了《廢棄試片》              │
│   [恢復]（剩 28 天）                   │
└────────────────────────────────────────┘
```

### 6.5 Project share modal (owner UI)

In project's V2 home page, owner clicks `[設定 → 協作者]`:

```
┌─────────────────────────────────────────┐
│ 協作者                          [✕]     │
├─────────────────────────────────────────┤
│ 此專案在 ABC 工作區                      │
│ 工作區成員預設 Viewer 角色              │
│                                         │
│ ━━━ 個別 grant (覆寫 workspace 預設) ━━━ │
│                                         │
│ @userA  Editor   [▾]    [移除]          │
│ @userB  Viewer   [▾]    [移除]          │
│                                         │
│ [+ 邀請成員]                            │
│   (從 workspace member 列表選)          │
└─────────────────────────────────────────┘
```

### 6.6 Activity log tab

In project settings:

```
活動記錄                                  [篩選 ▾]
─────────────────────────────────────────────────
2026-05-22 14:32  @admin       restore   project
2026-05-22 14:15  @admin       delete    project
2026-05-22 11:08  @userA       update    panel#42
2026-05-22 10:55  @userA       create    appearance#xyz
2026-05-21 22:00  @owner       update    appearance#abc
...
[載入更多]
```

---

## 7. Test plan

### 7.1 Auth matrix (most critical)

9 actor types × 2 actions × 2 workspace contexts = **36 base test cases**:

```
Actors:
  1. owner of project
  2. sys admin
  3. workspace ownerEditor via P.workspaceId (new path)
  3.5 editor of legacy workspace containing P.owner as member (LEGACY fallback path)
  4. per-project collaborator (editor)
  5. per-project collaborator (viewer)
  6. workspace member (editor role)
  7. workspace member (viewer role)
  8. stranger (no access)

Actions: { read, write }
Contexts:
  - "modern": project has workspaceId set
  - "legacy": project.workspaceId IS NULL (pre-migration projects)

Expected (modern context):
  - read=allow for actors 1-7 except stranger
  - write=allow for actors 1-4, plus 5/6 if role=editor

Expected (legacy context — workspaceId IS NULL):
  - read+write=allow for actors 1-2 (owner, admin)
  - read+write=allow for actor 3.5 (LEGACY fallback — preserves existing behavior)
  - 403 for everyone else (no ProjectCollaborator on legacy projects,
    no WorkspaceMember check possible without workspaceId)

CRITICAL REGRESSION TEST:
  - Create test fixture matching current production state:
    - User E with role=editor
    - Workspace W owned by E
    - User M added to W as member
    - User M creates project P (P.workspaceId IS NULL)
  - Verify E can read+write P via cascade step 3.5
  - This test MUST pass before deploy — it's the regression gate
```

### 7.2 API integration tests

For each mutation endpoint listed in §4.2:
- Owner POSTs → 200
- Admin POSTs → 200
- Workspace owner editor POSTs → 200
- Project editor collaborator POSTs → 200
- Project viewer collaborator POSTs → 403
- Workspace member (editor) POSTs → 200
- Workspace member (viewer) POSTs → 403
- Stranger POSTs → 403

### 7.3 Edit request flow

- POST creates row, increments owner notification count
- Rate limit: 6th request from same user → 429
- Rate limit: 4th request on same project from same user → 429
- Auto-expire: pending row created with `createdAt = now() - 8d`, run cron → status='expired'
- Approve creates ProjectCollaborator with role=editor
- Deny just updates status
- Owner can't approve other owners' projects → 403

### 7.4 Soft delete + restore

- DELETE doesn't drop row, sets deletedAt+deletedBy
- Owner sees notification in bell
- Restore within 30d works → deletedAt cleared
- Cron at >30d → hard DELETE
- After hard DELETE: restore returns 404

### 7.5 E2E

```
Scenario 1: Owner invites viewer
  Owner creates project P in workspace W
  Owner opens collaborator modal, adds userX with viewer role
  userX logs in, switches to W, sees P in list
  userX clicks P → sees read-only mode, viewer badge
  userX tries to edit any field → request modal opens

Scenario 2: Viewer requests, owner approves
  Continued from #1
  userX submits request with message
  Owner receives bell notification
  Owner approves
  userX refreshes → can now edit
  userX makes edit → audit log shows it
  Owner can see audit log in activity tab

Scenario 3: Admin nukes project, owner restores
  Admin opens any project, clicks delete
  DELETE soft-deletes
  Owner sees bell notification with [恢復] button
  Owner clicks restore → project comes back
  Audit log shows: delete by admin, restore by owner

Scenario 4: Workspace switching
  User in 3 workspaces
  Top bar dropdown shows all 3 + 我的工作區
  Click each → list updates
  URL ?ws=X persists across page reloads
  Click "管理工作區" → existing /workspaces page
```

---

## 8. Implementation order (4 days)

### Day 1 (~8.5 hr) — schema + auth foundation
- [ ] Prisma schema migration (3 new tables + 2 columns + enums)
- [ ] SQL migration script `2026-05-22-workspace-collab.sql`
- [ ] Backfill defaults (existing WorkspaceMember.role=editor, project.workspaceId=NULL)
- [ ] `requireProjectAccess` helper in `src/lib/api-auth.ts`
- [ ] **Step 3.5 LEGACY fallback** — reuse `editorCanAccessProject` (NEW per regression fix)
- [ ] Replace all `requireProjectAuth` callers with `requireProjectAccess`
- [ ] DELETE endpoint → soft delete
- [ ] Auth integration tests (60+ cases incl. legacy regression scenario)
- [ ] **REGRESSION GATE**: legacy editor→member project access test must pass before merge

### Day 2 (~8 hr) — read-only UI + collaborator modal
- [ ] `useProjectAccess` hook
- [ ] `/api/projects/:id/access` lightweight endpoint
- [ ] Top-right badge in `V2WorkspaceShell`
- [ ] Disable mutation buttons across all V2 pages (per §6.2 table)
- [ ] Edit-button tooltip + click-to-request modal entry
- [ ] Project share modal: add/list/revoke collaborators
- [ ] Workspace member role management API + UI

### Day 3 (~8 hr) — requests + audit + workspace switcher
- [ ] Edit request API (POST, GET incoming, PATCH approve/deny)
- [ ] Rate limit middleware (5 per requester, 3 per pair)
- [ ] Edit request modal UI
- [ ] Audit log middleware (Prisma extension hooks)
- [ ] Activity log tab in project settings
- [ ] `V2TopBar` workspace switcher component
- [ ] URL-driven active workspace + query invalidation
- [ ] Notification center dropdown

### Day 4 (~3 hr) — polish + tests
- [ ] Cron: auto-expire requests, hard-delete after 30d
- [ ] E2E tests (Scenarios 1-4)
- [ ] Documentation: in-app banner explaining new feature
- [ ] Deploy + smoke test

---

## 9. Out of scope (Phase 2 candidates)

- Email notifications (in-app only for now per Decision 5)
- Full version history with restore (audit log only, no content versioning)
- Workspace-scoped role promotion via self-service UI (admin only)
- Project move between workspaces UI
- Workspace-wide settings (default video model, etc.)
- Quota / billing per workspace
- Per-workspace API rate limits
- Real-time collaboration (Y.js / CRDT)

---

## 9.5 Day 3 architectural decisions (locked 2026-05-24, no AskUserQuestion gate)

Reviewed via `/plan-eng-review` before implementation. Calls below are documented here so future readers know *why*.

### Risk ranking
| Sub-step | Risk | Reason |
|---|---|---|
| 3.3 Audit log | **HIGH** | Prisma `$use` deprecated; `$extends` has recursion + transaction-semantics footguns; pre-mutation snapshot doubles read load on Panel writes |
| 3.4 WS switcher | MED | URL state must be in every React Query cache key or stale data on switch |
| 3.1 EditRequest | LOW | Plain CRUD + count query against existing composite indexes |
| 3.2 Notification | LOW | 10-20 internal users → polling 30s, no realtime infra |

### Decisions

1. **Rate limit storage = DB count query** (not Redis / in-memory). Cheap with existing `@@index([requesterId])`, survives restart, no new dep. Logic: `count(status='pending', requesterId=X) < 5` AND `count(status='pending', requesterId=X, projectId=Y) < 3`.

2. **Notification delivery = polling every 30s** via single combined endpoint `GET /api/notifications/summary` (returns `{ incomingRequests, myRequests, adminDeletions }`). One poll instead of three. No SSE/WebSocket — Caddy reverse_proxy + BullMQ worker push complexity not worth it at 10-20 users.

3. **Audit log scope NARROW in v1** — only Project / ProjectCollaborator / EditRequest / WorkspaceMember mutations. **Explicitly skip Panel + Character** (worker writes hundreds per run → noise + DB cost). Implementation gated by `AUDIT_LOG_ENABLED=true` env flag so we can disable in prod if it misbehaves. Panel-level audit can come later in Phase 2 if user signals demand.

4. **Audit log = explicit `recordAudit()` helper, NO `$extends` extension.** Per CLAUDE.md §3 ("不打補丁. 不隱式回退."), Prisma client extensions are implicit magic that's hard to trace at the call site. Instead, every mutation that needs an audit row calls `recordAudit(client, { userId, projectId, action, entityType, entityId, snapshot? })` explicitly. Total ~12 call sites across our narrow model scope (Project / ProjectCollaborator / EditRequest / WorkspaceMember). For multi-statement transactions (e.g. EditRequest approve), `recordAudit` accepts a `tx` client so the audit row commits/rolls back with the parent. For single-statement mutations, it writes via the global `prisma` client. The helper wraps inserts in try/catch + warns on failure so a broken audit can never block the user mutation. Gated by `AUDIT_LOG_ENABLED=true` env.

5. **Workspace switcher URL state = `?ws=<id>` (absent = personal)**. Don't introduce `?ws=personal` literal — keep null-sentinel semantics. React Query cache key includes ws so switching forces refetch.

### Edge cases added beyond spec

- **EditRequest POST**: reject 409 if requester already has access (any tier via `requireProjectAccess`); reject 400 if requester is project owner; **idempotent** — if pending request already exists for same (requester, project), return existing row not duplicate.
- **EditRequest GET incoming**: filter `status='pending' AND createdAt > now - 7 days` (defense in depth before Day 4 cron expires them).
- **EditRequest PATCH approve**: idempotent — if already resolved, return current state with `alreadyResolved: true`.
- **Audit log GET**: cursor pagination required (project with many entries → thousands).

### Effort sanity check
- 3.1 API: ~1.5h
- 3.2 Notification + modal: ~3h
- 3.3 Audit (narrow scope): ~1.5h
- 3.4 Workspace switcher: ~1.5h
- Activity log tab UI: ~1h
- Total ~8.5h — matches Section 8 estimate.

**Highest-blow-up risk: 3.3 audit log.** Build it last, behind feature flag. If it's making prod weird, flip the env off and ship the rest.

---

## 10. Known unresolved risks (acknowledged)

1. **No version history**: editor overwriting editor's work is silent. Audit log says who, but doesn't restore content. Acceptable for v1, but flag in user-facing docs.

2. **Race condition on concurrent edit**: two editors saving same panel — last write wins. Need optimistic lock for v2.

3. **Bell notification scroll fatigue at scale**: at 100+ team members the bell becomes useless. OK for internal 10-20.

4. **Soft-delete leak**: hidden projects still consume R2 storage for 30 days. Acceptable cost (~$0.02/proj/month).

---

## 11. Deploy plan (matches reference_kuiperfilm.md SOP)

```bash
# 1. Pre-deploy
git fetch origin feature/phase-11
git pull --ff-only origin feature/phase-11

# 2. Apply SQL FIRST (before code)
ssh root@137.184.64.179 'cd /opt/kuiperAI && mysql -u root -p kuiper < scripts/migrations/2026-05-22-workspace-collab.sql'

# 3. Backfill
ssh root@137.184.64.179 'cd /opt/kuiperAI && npx tsx scripts/backfill-workspace-collab.ts'

# 4. Then code deploy (rebuild + restart)
ssh root@137.184.64.179 'cd /opt/kuiperAI/deploy && docker compose -p deploy -f docker-compose.prod.yml --env-file .env.prod up -d --build app'

# 5. Smoke
curl https://art.kuiperfilmailab.com/  # 307 expected
ssh root@137.184.64.179 'docker logs kuiper-app --tail 50 | grep -i "auth\|workspace"'  # check for errors

# 6. Verify auth cascade
# Manual test: owner→OK, admin→OK, ws member viewer→read OK write 403
```

Rollback: SQL migration is additive (only ADD COLUMN / CREATE TABLE), safe to deploy. If code has bug, revert code commit; SQL changes harmless.
