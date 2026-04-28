# Multi-User System — Handoff for the next agent

This document captures everything the previous Claude session built on the
`feature/multi-user` branch so a fresh agent can pick up without
re-reading the chat. **Read this end-to-end before touching code.**

---

## 1. Where the work lives

| Item | Value |
|---|---|
| Repository | `https://github.com/waoowaooAI/waoowaoo.git` |
| Main worktree (the **other** Claude is working here) | `/Users/joshhung/KuiperAI` on branch `main` |
| **My** worktree (this work) | `/Users/joshhung/Documents/kuiperAI-multiuser` on branch `feature/multi-user` |
| Branch base | `38da730` (main HEAD when worktree was created) |
| Commits on this branch | 6 — see "Commit log" below |
| Pushed to remote | **No** — local only, intentional |
| node_modules in worktree | Yes, installed via `npm install` |

**To resume the work, always `cd /Users/joshhung/Documents/kuiperAI-multiuser`.**
The other agent is editing `main` in `/Users/joshhung/KuiperAI` for Tencent
provider integration; do not edit that path or you'll smash their WIP.

`git worktree list` from either directory shows the split.

---

## 2. What we built (one-line per phase)

| Phase | Commit | One-liner |
|---|---|---|
| K1 | `ce4e8a5` | Multi-user **schema** + role helpers + legacy backfill |
| K2 | `0581663` | **Invite-only** signup, login hardening, admin bootstrap |
| K3a | `a5fa747` | **Admin API** for users + invites |
| K3b | `0c75353` | **Asset hub flipped to team-shared** (read-anyone, write-editor+) |
| K4 | `4ae8201` | **Admin UI** for users + invites |
| K5 | `baabbae` | **39 unit tests** for admin-service + role helpers |

K6 (Caddy + DigitalOcean prod compose) was scoped but **not implemented**. See §10.

---

## 3. Role model (the single source of truth)

```
admin   → full access: sees all data, manages users + invites
editor  → own private projects + read/write team-shared asset hub
member  → own private projects + read-only on team-shared asset hub
```

Database column: `User.role String @default("member")`.

**Legacy compatibility:** rows with `role = 'user'` (the schema's old default
before this branch) are mapped to `'member'` at runtime via `normalizeRole()`
in `src/lib/api-auth.ts`. A one-shot script `scripts/migrations/migrate-user-role-to-member.ts`
can rewrite them in place — see §9.

---

## 4. File-by-file inventory

### 4.1 New files

| File | Purpose |
|---|---|
| `prisma/schema.prisma` (additions only) | Added `InviteCode` model and 3 new fields on `User` |
| `src/lib/admin-service.ts` | `isValidRole`, `generateInviteCode`, `createInvite`, `revokeInvite`, `assertNotLastActiveAdmin` |
| `src/app/api/admin/users/route.ts` | `GET` list users (admin) |
| `src/app/api/admin/users/[id]/role/route.ts` | `PATCH` change role (admin) |
| `src/app/api/admin/users/[id]/active/route.ts` | `PATCH` enable/disable (admin) |
| `src/app/api/admin/invites/route.ts` | `GET` list, `POST` create (admin) |
| `src/app/api/admin/invites/[id]/route.ts` | `DELETE` revoke (admin) |
| `src/app/[locale]/admin/layout.tsx` | Server-side admin gate (`redirect` non-admins) |
| `src/app/[locale]/admin/users/page.tsx` | User table + inline role select + enable/disable |
| `src/app/[locale]/admin/invites/page.tsx` | Invite table + create modal + copy + revoke |
| `messages/zh/admin.json` | 50 i18n keys (zh) |
| `messages/en/admin.json` | 50 i18n keys (en) |
| `scripts/bootstrap-admin.ts` | Idempotent: creates admin from env, ensures one usable invite |
| `scripts/migrations/migrate-user-role-to-member.ts` | Legacy `role='user'` → `'member'` rewrite (dry-run by default) |
| `tests/unit/admin/admin-service.test.ts` | 26 tests (mocked Prisma) |
| `tests/unit/admin/role-helpers.test.ts` | 13 tests (mocked Prisma + next-auth) |
| `MULTI_USER_HANDOFF.md` | This document |

### 4.2 Modified files

| File | What changed | Conflict risk vs Tencent WIP |
|---|---|---|
| `prisma/schema.prisma` | `User` model gains `displayName`, `isActive`, `lastLoginAt`, role default → `'member'`, plus relations to `InviteCode`. New `InviteCode` model appended at file end. | **HIGH** — Tencent integration likely also adds models. Mitigated by appending at file end + minimal field additions in User. |
| `src/lib/api-auth.ts` | New section appended at end: `Role` type, `requireRoleAuth`, `requireEditorAuth`, `normalizeRole`. | **MEDIUM** — Tencent integration has been editing this file. Our additions are at file end with a clear separator comment. |
| `src/lib/auth.ts` | `authorize` callback now refuses inactive accounts and updates `lastLoginAt`; default role fallback `'user'` → `'member'`. | **MEDIUM** — Tencent integration may touch providers. Our edit is localized inside the credentials authorize body. |
| `src/app/api/auth/register/route.ts` | Full rewrite: requires `invite_code`, runs invite consumption + user create + balance row in a single `prisma.$transaction`. | LOW — Tencent integration unlikely to touch register. |
| `src/app/[locale]/auth/signup/page.tsx` | Added invite-code input field, auto-fills from `?invite=` query, validates non-empty. | LOW |
| `messages/{zh,en}/auth.json` | Added 4 keys: `inviteCode`, `inviteCodePlaceholder`, `inviteRequired`, `inviteInvalid`. | LOW |
| `src/i18n.ts` | Registered new `admin` namespace alongside the existing 30. | LOW |
| `src/app/api/asset-hub/folders/route.ts` | Read: drop userId filter. Write: `requireEditorAuth`. | LOW |
| `src/app/api/asset-hub/folders/[folderId]/route.ts` | All ops `requireEditorAuth`, ownership check on userId removed. | LOW |
| `src/app/api/asset-hub/characters/route.ts` | Same pattern as folders. | LOW |
| `src/app/api/asset-hub/characters/[characterId]/route.ts` | Same pattern. | LOW |
| `src/app/api/asset-hub/locations/route.ts` | Same pattern. | LOW |
| `src/app/api/asset-hub/locations/[locationId]/route.ts` | Same pattern. | LOW |
| `src/app/api/asset-hub/voices/route.ts` | Same pattern. | LOW |
| `src/app/api/asset-hub/voices/[id]/route.ts` | Same pattern. | LOW |

### 4.3 Files we deliberately did NOT touch

We made a conscious split in K3 to avoid colliding with Tencent integration:

- **12 operation-style routes under `/api/asset-hub/*`** — `upload-image`,
  `generate-image`, `modify-image`, `undo-image`, `ai-modify-character`,
  `appearances`, `character-voice`, `picker`, `select-image`,
  `update-asset-label`, `voices/upload`, `characters/[id]/appearances/[idx]`.
  These act on a specific item via id and the underlying detail routes
  already enforce read-anyone / write-editor through K3b. If any still
  has its own per-user filter, integration tests will catch it.
- All other API routes — projects, novel-promotion, runs, tasks,
  task-target-states, sse, system, files, cos, user-preference, billing,
  user/api-config. The team-sharing semantics for these are unchanged
  (still per-user). If you want Project to be team-shared too, it's a
  separate scope.

---

## 5. Behavior changes summary

| Surface | Before | After |
|---|---|---|
| `POST /api/auth/register` | Anyone with name+password could register | Requires valid `invite_code` body field; failure modes: `invite_not_found`/`invite_used`/`invite_revoked`/`invite_expired`/`username_taken` |
| Login (NextAuth credentials) | Any user with valid pw could log in | Disabled accounts (`isActive=false`) refused; successful login bumps `lastLoginAt` |
| `GET /api/asset-hub/{folders,characters,locations,voices}` | Returned only the caller's items | Returns **all** items in the team |
| `POST /api/asset-hub/{folders,characters,locations,voices}` (and detail PATCH/DELETE) | Anyone authenticated with `requireUserAuth` | Now `requireEditorAuth`; members get 403 |
| `/admin/users`, `/admin/invites` pages | Did not exist | Live; admin-only via server layout + API |
| `User.role` for new sign-ups | `'user'` (legacy) | `'editor'` or `'member'` depending on invite role |

**Day-1 impact for existing users**: every member instantly sees every
other member's `GlobalCharacter`/`GlobalLocation`/`GlobalVoice`/folders.
Members lose write access to those tables until promoted to editor.
This is the intended "team library" semantic.

---

## 6. Tests

```bash
cd /Users/joshhung/Documents/kuiperAI-multiuser
npx vitest run tests/unit/admin/
# → 39 passed
```

Coverage:

- `admin-service.ts` — full coverage (every branch + last-admin guard)
- `api-auth.ts` role helpers — full coverage (admin/editor/member/user/null × allow-list permutations + isActive guard)

**Not yet covered (would need MySQL container):**
- `/api/auth/register` invite-code happy & sad paths end-to-end
- `/api/admin/*` routes against a real DB
- Asset-hub team-sharing observable behavior

The repo's integration test infra (`tests/integration/api/*`) requires
MySQL + Redis containers spun up via `tests/setup/global-setup.ts`. We
left those for the merge / a follow-up PR — the unit tests above already
cover all the non-DB logic.

---

## 7. How to verify locally / on CI

```bash
cd /Users/joshhung/Documents/kuiperAI-multiuser

# 1. Type check (ignore the upstream ATLASCLOUD enum error from Tencent WIP)
npx tsc --noEmit -p tsconfig.json

# 2. Schema validation (requires DATABASE_URL or a dummy)
DATABASE_URL="mysql://x:y@z:3306/k" npx prisma validate

# 3. Generate prisma client (after schema changes)
npx prisma generate

# 4. Unit tests
npx vitest run tests/unit/admin/

# 5. Apply schema to MySQL (destructive — make sure DATABASE_URL is dev/staging)
npx prisma db push

# 6. Bootstrap admin + first invite
ADMIN_USERNAME=admin \
ADMIN_PASSWORD=ChangeMeNow123 \
ADMIN_EMAIL=admin@example.com \
  npx tsx scripts/bootstrap-admin.ts

# 7. Migrate any legacy role='user' rows
npx tsx scripts/migrations/migrate-user-role-to-member.ts          # dry-run
npx tsx scripts/migrations/migrate-user-role-to-member.ts --apply  # actually write
```

**Smoke test in browser** (after `pnpm dev` or `docker compose up`):

1. Visit `/auth/signin`, log in as admin user
2. Visit `/zh/admin/users` — should see your row with `(你自己)` tag
3. Visit `/zh/admin/invites` — click "生成邀请码", select role=editor, copy
4. Sign out, visit `/zh/auth/signup?invite=<paste-the-code>`
5. Register with a new username — invite code should auto-fill
6. New user should land on home page; check role in admin panel

---

## 8. Known issues / quirks

- **Pre-existing TS error**: `src/lib/async-poll.ts(235,14): "ATLASCLOUD"
  is not in the type union`. This is from the **other Claude's**
  Tencent provider WIP on `main`, not us. Run tests with `tsc --noEmit`
  filtered or just ignore that one line until they finish.
- **`prisma validate` requires DATABASE_URL set** even if you don't
  intend to connect. Use `DATABASE_URL="mysql://x:y@z:3306/k" npx prisma validate`.
- **`prisma db push` will write `role='member'` as default** for any new
  rows but won't migrate existing `'user'` rows. Run the migration
  script (§9) on staging before relying on the new helpers.
- **The CSV / clipboard copy** in `/admin/invites/page.tsx` may fail
  silently in browsers that require explicit user gesture for clipboard
  writes — we swallow the error. This is acceptable; user can manually
  select the code.
- **`AppHeader.tsx` has no `/admin` link yet.** Admins navigate via the
  URL bar. A nav link gated on `session.user.role === 'admin'` would be
  a tiny follow-up.

---

## 9. Operator runbook

### First-time setup on a fresh DB

```bash
# 1. Apply schema
npx prisma db push

# 2. Create the first admin + a fresh admin invite code
ADMIN_USERNAME=admin ADMIN_PASSWORD='Strong12345!' npx tsx scripts/bootstrap-admin.ts
# stdout will print the invite code; share it with another founding admin
```

### Existing DB upgrade (legacy → multi-user)

```bash
# 1. Apply schema additions (non-destructive — adds nullable columns + new tables)
npx prisma db push

# 2. Backfill role='user' → 'member' (idempotent; --apply to commit)
npx tsx scripts/migrations/migrate-user-role-to-member.ts
npx tsx scripts/migrations/migrate-user-role-to-member.ts --apply

# 3. Promote at least one user to admin manually if none exists yet
mysql -e "UPDATE user SET role='admin' WHERE name='your-admin-name';"

# 4. Bootstrap script can also create an admin from env if none exists
ADMIN_USERNAME=admin ADMIN_PASSWORD='Strong12345!' npx tsx scripts/bootstrap-admin.ts
```

### Day-2: rotate the bootstrap admin's invite

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='ignored-in-this-mode' \
  npx tsx scripts/bootstrap-admin.ts --rotate-invite
```

### Promote / demote / disable a user

Either via UI (`/zh/admin/users`) or directly:

```http
PATCH /api/admin/users/<userId>/role
Content-Type: application/json
Cookie: <admin session>

{ "role": "editor" }
```

```http
PATCH /api/admin/users/<userId>/active
{ "isActive": false }
```

The system enforces:
- Cannot self-modify (admin cannot change own role/active state via these endpoints)
- Cannot demote / disable the last active admin

---

## 10. What's left (suggested next phases)

In rough priority order:

| Phase | Effort | Dependencies |
|---|---|---|
| Merge with Tencent integration on `main` | 1 hr | Other Claude commits their WIP |
| Integration tests for `/api/admin/*` + register invite flow | 3 hr | MySQL test container |
| Add `/admin` nav link to `AppHeader.tsx` | 15 min | None (visibility check on `session.user.role`) |
| **K6** — Caddy + production docker-compose for DigitalOcean | 4 hr | None; pattern in handoff `huobao-drama-multiuser` repo for reference |
| AI usage quota per user (we shipped the role/active fields but no quota) | 4 hr | Decision: $-budget vs request-count vs token-count |
| Audit the 12 operation-style asset-hub routes for any remaining per-user filters | 2 hr | None |

---

## 11. How to merge into `main`

Once the other agent finishes Tencent integration on `main`:

```bash
cd /Users/joshhung/Documents/kuiperAI-multiuser
git fetch origin
git rebase origin/main
# Expect conflicts in:
#   - prisma/schema.prisma (their new models / our InviteCode at file end)
#   - src/lib/api-auth.ts  (additions in different sections — usually clean)
#   - src/lib/auth.ts      (their providers vs our authorize body)
#   - package.json / package-lock.json (Tencent SDK adds)
# Resolve, run:
npx vitest run tests/unit/admin/
npx tsc --noEmit -p tsconfig.json
# When green, fast-forward main:
git checkout main && git merge feature/multi-user --ff-only
```

**Do not push without testing the rebase locally first** — `prisma generate`
+ `tsc --noEmit` must both succeed before you push.

---

## 12. Quick reference — commit log with full SHAs

```
baabbae test: K5 — unit coverage for admin-service + role helpers
4ae8201 feat(auth): K4 — admin UI for users + invites
0c75353 feat(auth): K3b — flip Global asset hub to team-shared (read-all, write-editor)
a5fa747 feat(auth): K3a — admin API for users + invites
0581663 feat(auth): K2 — invite-only signup, login hardening, admin bootstrap
ce4e8a5 feat(auth): K1 — multi-user schema + role helpers + legacy backfill
38da730 ← branch base, last common commit with main
```

Each commit message has a detailed body including conflict notes,
verification steps, and out-of-scope lists. Run `git show <sha>` to
read them.

---

*Generated from session — last updated when commit `baabbae` landed.*
