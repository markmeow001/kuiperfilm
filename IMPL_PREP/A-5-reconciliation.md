# A.5 · Schema Reconciliation（A 文件 vs 既有 prisma 對齊）

> **目的：** A 文件當時寫的時候沒 audit 既有 prisma schema，導致 6 個「規劃要新建」的 model 其實已經存在（Phase 12.5 Figma collaboration 5/22 ship + ApiKey Phase 5 5/25 ship）。本文件對齊現實，產出**真實能跑**的 migration 計劃。
>
> **狀態：** v1 · 2026-05-31（A 文件後 2 天 audit 補丁）
> **依賴：** A-schema-migration.md / prisma/schema.prisma 當前狀態
> **代替：** A §3 的 26 step migration plan（部分 step 不可跑）

---

## 0. TL;DR — 真實 delta

| 對象 | A 文件規劃 | 現實 | 動作 |
|---|---|---|---|
| WorkspaceMember | 新建（§2.3.8）| ✅ 5/22 已建 | **不動**，只改 enum 加 5 role |
| EditRequest | 新建（§2.3.10）+ scope JSON | ✅ 5/22 已建（project-scoped）| **保留 + 加 4 欄**（granted_duration / expires_at / revoked_at + RequestStatus 加 revoked）|
| AuditLog | 新建（§2.3.11）+ AuditScope | ✅ 5/22 已建（簡版）| **加 4 欄**（actorName denorm / scope / ipAddress / userAgent / expiresAt）|
| ApiKey | 新建（§2.3.12）| ✅ 5/25 已建（更完善：含 rate limit + usage tracking）| **A 文件 §2.3.12 廢棄**，繼續用既有 |
| ProjectCollaborator | A 沒提（漏 audit）| ✅ 5/22 已建 | **A 文件補一節**說明這是 D-1 7-role 之外的 per-project override |
| ApiKeyUsage | A 沒提 | ✅ 5/25 已建 | **A 文件補一節** |
| WorkspaceRole enum | A 改成 7-role | ⚠️ 既有只 `editor/viewer` | **加 5 個 role**（owner/admin/commenter/billing/guest）|
| User.role | A 假設 UserRole enum 4 role | ⚠️ 現實 `String` `"admin\|editor\|member"` | **保留 String + 內部用 UserRole enum constants** OR 改 enum（中等變更）|
| PanelVersion | 新建（§2.3.1）| ❌ 沒 | **真新建** |
| PublicShare + Comment + Follow | 新建（§2.3.3-5）| ❌ 沒 | **真新建 3 model** |
| Notification | 新建（§2.3.2）| ❌ 沒 | **真新建** |
| ProviderConfig | 新建（§2.3.13）| ❌ 沒 | **真新建** |
| Integration | 新建（§2.3.14）| ❌ 沒 | **真新建** |
| CreditTopUp | 新建（D 拍板補；§2.3.6）| ❌ 沒 | **真新建** |
| CreditLedger | N 文件 §5.2 拍板 append-only | ❌ 沒 | **真新建** |
| ElementImport | 新建（§2.3.7）| ❌ 沒 | **真新建** |

---

## 1. 真實 migration step（A §3 的 26 step → 修正版 16 step）

```
1. extend_workspace_role_enum    (WorkspaceRole 從 2 → 7 role；ALTER TYPE ADD VALUE)
2. extend_request_status_enum    (RequestStatus 加 revoked)
3. add_edit_request_columns      (EditRequest + grantedDuration / expiresAt / revokedAt / revokedBy)
4. add_audit_log_columns         (AuditLog + actorName / scope / ipAddress / userAgent / expiresAt)
5. add_panel_version             (新 PanelVersion 表)
6. add_panel_columns             (NovelPromotionPanel + currentVersionId nullable FK)
7. add_public_share              (新 PublicShare)
8. add_comment                   (新 Comment)
9. add_follow                    (新 Follow)
10. add_notification             (新 Notification)
11. add_provider_config          (新 ProviderConfig + KMS-encrypted secret 欄位)
12. add_integration              (新 Integration)
13. add_credit_topup             (新 CreditTopUp — D 拍板)
14. add_credit_ledger            (新 CreditLedger — N 文件 §5.2 append-only)
15. add_element_import           (新 ElementImport)
16. backfill_workspace_member_role  (5/22 既有 editor/viewer → 補 owner role)
```

**從 26 → 16 step，省 10 step**（因 6 個既有 model 不重建）。

---

## 2. 詳細：3 個既有 model 怎麼改

### 2.1 EditRequest — 補 4 欄

```prisma
model EditRequest {
  // 既有
  id          String        @id @default(uuid())
  projectId   String
  requesterId String
  status      RequestStatus @default(pending)
  message     String?       @db.Text
  createdAt   DateTime      @default(now())
  resolvedAt  DateTime?
  resolvedBy  String?

  // ── A.5 新加（D-5 設計補進去）──
  grantedDuration EditRequestDuration?  // 批准時選的時長
  expiresAt       DateTime?             // = resolvedAt + grantedDuration；cron 找過期
  revokedAt       DateTime?             // owner 手動撤銷
  revokedById     String?
  approverNote    String?      @db.VarChar(500)

  // 既有關聯
  project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  requester User    @relation("EditRequester", fields: [requesterId], references: [id], onDelete: Cascade)
  resolver  User?   @relation("EditRequestResolver", fields: [resolvedBy], references: [id], onDelete: SetNull)
  // ── 新加關聯 ──
  revoker   User?   @relation("EditRequestRevoker", fields: [revokedById], references: [id], onDelete: SetNull)

  // 既有 index
  @@index([projectId, status])
  @@index([requesterId])
  @@index([status, createdAt])
  // ── 新加 index ──
  @@index([status, expiresAt])  // cron 找過期
  @@map("edit_request")
}

enum RequestStatus {
  pending
  approved
  denied
  expired
  revoked  // ── A.5 新加 ──
}

enum EditRequestDuration {  // ── A.5 新加 ──
  temp_24h
  temp_7d
  temp_30d
  permanent
}
```

**關鍵：5/22 既有 EditRequest 是 project-level**（D-5 設計的是 workspace-level scope JSON）。**保留 project-level，scope JSON 不做** — 因為既有 RBAC cascade 已經是「per-project」邏輯，workspace-level 過度設計。

### 2.2 AuditLog — 補 5 欄

```prisma
model AuditLog {
  // 既有
  id         String   @id @default(uuid())
  userId     String   // Actor
  projectId  String?
  action     String
  entityType String
  entityId   String
  snapshot   Json?
  createdAt  DateTime @default(now())

  // ── A.5 新加（D-5 + N 文件 §10 retention）──
  actorName  String?  @db.VarChar(100)  // denorm，actor 被刪後仍可顯示
  workspaceId String? // workspace-level action 用（一般進 projectId 為 null）
  scope      AuditScope  @default(project)  // 給 N §10 雙軌 retention
  ipAddress  String?  @db.VarChar(45)
  userAgent  String?  @db.VarChar(500)
  diff       Json?    // pre/after 雙寫（之前 snapshot 只記 pre）
  expiresAt  DateTime?  // scope=billing → 7 年 / 其他 → 90 天

  // 既有關聯
  user User @relation("AuditActor", fields: [userId], references: [id], onDelete: Cascade)
  // ── 新加 workspace 關聯 ──
  workspace Workspace? @relation("WorkspaceAudit", fields: [workspaceId], references: [id], onDelete: SetNull)

  // 既有 index
  @@index([projectId, createdAt])
  @@index([userId])
  // ── 新加 index ──
  @@index([workspaceId, createdAt(sort: Desc)])
  @@index([scope, expiresAt])
  @@map("audit_log")
}

enum AuditScope {
  workspace
  project
  billing
  api
}
```

### 2.3 WorkspaceMember — 不動，只擴 enum

```prisma
// 既有 (5/22)
model WorkspaceMember {
  workspaceId String
  userId      String
  addedBy     String
  joinedAt    DateTime      @default(now())
  role        WorkspaceRole @default(viewer)  // 既有 enum 只 2 role
  // ...
}

// ── A.5 改 enum：2 → 7 role ──
enum WorkspaceRole {
  // 既有
  editor
  viewer
  // ── 新加 5 role（D-1 拍板對齊 K UserRole）──
  owner       // workspace 創建者，唯一可指派 / 轉移 / 刪
  admin       // 可邀請 / 移除 / 改設定
  commenter   // 只能留言（不可改）
  billing     // 只看帳單
  guest       // 公開 share 訪客
}

// Backfill：既有 row.role 對映
//   - workspace.ownerEditorId = userId → 升 'owner'
//   - role='editor' → 維持 'editor'
//   - role='viewer' → 維持 'viewer'
//   - 沒既有 admin/commenter/billing/guest → 都新分配（手動或 onboarding）
```

---

## 3. User.role 處理（D-1 對齊）

**現實：** `User.role` 是 `String @default("member")`，註解寫 `"admin | editor | member"`，跟 D-1 的 7-role 完全不同。

**選擇：**

| 方案 | 描述 | 工 | 風險 |
|---|---|---|---|
| **A. 保留 String + 補 enum constant** | TypeScript 端宣告 `enum UserRole { OWNER, ADMIN, EDITOR, COMMENTER, VIEWER, BILLING, GUEST }`，DB 仍是 String，application 層 validate | 低 | 無 backfill；既有 "member" → 新概念 "viewer" |
| **B. 改 enum**（A 文件原計劃）| `User.role` 改 `UserRole` enum 7 值，跑 ALTER TABLE | 中 | backfill `member`→`viewer`；需測 application 沒寫死 "member" 字串 |

**A.5 推薦 A** — 既有 application 大量字串 `if (user.role === "admin")` 改 enum 風險高。

> **注意：** `User.role` 是 org-level role，跟 `WorkspaceMember.role`（workspace-level）是兩個獨立概念。混淆的話 RBAC service 會炸。

---

## 4. ProjectCollaborator 在 D-1 矩陣的位置

A 文件規劃 7-role 全在 workspace-level；但既有 ProjectCollaborator 提供 **per-project role override**（Figma "share" 模式）。

**A.5 補：** D-1 7-role 維持，**ProjectCollaborator 視為 D-1 §4.3 「Project-level role override」的實作**（C 文件已寫，只是當時不知道有這個 model）。

**RBAC cascade（既有 §4 cascade，A.5 更新標 D-1 對齊）：**

```
1. owner            ← User.role='admin' 跨 org
2. admin            ← User.role='admin'
3. workspace.ownerEditorId      ← workspace 創建者
3.5 LEGACY editorCanAccessProject  ← 留給 workspaceId=NULL 老 project
4. ProjectCollaborator           ← per-project override（Figma share）
5. WorkspaceMember.role          ← 7-role 從 D-1
6. 403
```

---

## 5. 新建 model（10 個全新）

照 A §2.3 + N §5.2 的設計新建，無 conflict：

| Model | 用途 | A 段 |
|---|---|---|
| PanelVersion | panel 版本歷史（mockup 30）| §2.3.1 |
| PublicShare | 公開分享 slug（mockup 31）| §2.3.3 |
| Comment | 公開作品留言 | §2.3.4 |
| Follow | 創作者關注 | §2.3.5 |
| Notification | 通知（mockup 29）| §2.3.2 |
| ProviderConfig | 5 provider 設定 + KMS-encrypted secret（mockup 37）| §2.3.13 |
| Integration | 第三方整合（Stripe / Slack / 5 platform）| §2.3.14 |
| CreditTopUp | 加購點數包（D 拍板）| §2.3.6 |
| CreditLedger | 失敗不扣點 append-only 帳本 | N §5.2 |
| ElementImport | 跨專案匯入 | §2.3.7 |

---

## 6. 跑 migration 順序（修正版）

```
Phase 4.1 — 既有 model 擴充（風險低，向後相容）
  1. ALTER TYPE workspace_role ADD VALUE 'owner', 'admin', 'commenter', 'billing', 'guest'
  2. ALTER TYPE request_status ADD VALUE 'revoked'
  3. CREATE TYPE edit_request_duration / audit_scope
  4. ALTER TABLE edit_request ADD COLUMN granted_duration / expires_at / revoked_at / revoked_by / approver_note
  5. ALTER TABLE audit_log ADD COLUMN actor_name / workspace_id / scope / ip_address / user_agent / diff / expires_at

Phase 4.2 — 新建 10 model（風險中，新 table 不影響既有）
  6. CREATE TABLE panel_version
  7. ALTER TABLE novel_promotion_panel ADD COLUMN current_version_id (nullable, no FK first)
  8. CREATE TABLE public_share + comment + follow + notification + provider_config + integration + credit_topup + credit_ledger + element_import

Phase 4.3 — 加 FK（風險低）
  9. ALTER TABLE novel_promotion_panel ADD CONSTRAINT FK panel_version
  10. backfill panel_version（既有 panel 各補 1 個 version 紀錄）

Phase 4.4 — Backfill（風險高，要先 dry-run）
  11. backfill workspace_member.role（owner backfill from Workspace.ownerEditorId）
  12. backfill audit_log.scope（既有 row 標 project / billing 分類）

Phase 4.5 — 觀察 30 天後 cleanup（Phase 9 soft launch 後）
  13. drop legacy editorCanAccessProject（如果完全 migrate 到 WorkspaceMember）
```

---

## 7. 不做的事（A 文件規劃但 A.5 拒絕）

| A 規劃 | A.5 為何拒 |
|---|---|
| 新建 WorkspaceMember | 已存在 |
| 新建 EditRequest | 已存在 |
| 新建 AuditLog | 已存在 |
| 新建 APIKey | 已存在（且更完善：rate limit + usage）|
| EditRequest.scope JSON（workspace-level）| 既有是 project-level，不改邏輯 |
| User.role 改 enum | application 層大量字串比對；風險 vs 收益不值 |
| WorkspaceInvite 表 | 既有沒有邀請表 — 待補（Phase 4.6）|
| K UserRole 7-role 全套寫進 prisma | 改用 WorkspaceRole 7 + User.role String + TypeScript enum 三層處理 |

---

## 8. 落地計劃

### 8.1 寫 prisma schema patch

按 §6 順序，先寫 Phase 4.1（5 step，向後相容），跑本機驗證後 commit。

### 8.2 跑 prisma db push 本機

```bash
# 本機 MySQL（localhost:13306）跑驗
cd /Users/joshhung/KuiperAI
npx prisma db push --schema=prisma/schema.prisma
```

確認 ALTER TABLE 成功 + 沒 data loss warning。

### 8.3 prod 跑（用 helper script）

```bash
bash ~/migrate-phase-4-1.sh
```

每個 ALTER 之前先 `pg_dump` backup（droplet 上有 backup cron）。

### 8.4 verify

每跑完一 step：
- prisma generate（本機 + droplet）
- npm run check:config-center-guards
- npm run test:regression（KuiperAI CLAUDE.md 強制）

---

## 9. Phase 4 工期重估

| Phase | 內容 | 工 |
|---|---|---|
| 4.1 既有 model 擴充（5 step）| schema + 本機驗 + prod migrate | 0.5 天 |
| 4.2 新 10 model（不含 backfill）| schema + 本機驗 + prod migrate | 1 天 |
| 4.3 FK + backfill panel_version | 包含 backfill script | 0.5 天 |
| 4.4 Backfill workspace_member + audit_log | 風險最高，要 staging-like 驗 | 1 天 |
| 4.5 legacy cleanup（30 天觀察後）| Phase 9 後 | 0.25 天 |
| **合計** | | **~3.25 工作天** |

**A 文件估 1-2 天，A.5 重估 3.25 天**（含已存在 model 的 reconciliation 工）。

---

## 10. 拍板紀錄（2026-05-31）

| # | 議題 | 拍板 |
|---|---|---|
| 1 | User.role | **B 改 enum**（要 audit prod code 寫死字串）|
| 2 | WorkspaceInvite 表 | **要建**（D-5 計畫含）|
| 3 | Rollout 架構 | **Feature flag**（同 URL + User.uiVersion 欄）|
| 4 | Schema 策略 | **只加不改**（additive）— 既有 model 只補欄位、不破壞 |

---

## 11. Feature flag 架構（拍板補充）

**核心欄位：**

```prisma
model User {
  // ... 既有欄位 ...
  uiVersion  String   @default("v2")  // "v2" = 既有 UI / "new" = 新設計
}
```

**Page route 模板：**

```typescript
// app/[locale]/page.tsx
export default async function HomePage() {
  const user = await getCurrentUser()
  if (user?.uiVersion === "new") {
    return <NewHomePage />  // 從新 mockup 實作出的 component
  }
  return <OldHomePage />  // 既有 V2 UI 不動
}
```

**Admin 控制：**
- /admin/users 頁 + 每 user 行加「給這個 user 開新版 UI」toggle
- DB 直接改 `user.uiVersion = "new"` → 該 user 下次 refresh 就看到新版

**全切時機：**
- Beta 期：10-50 個 invited users，跑 4-8 週
- Soft launch：開放給已付費用戶 opt-in，跑 2-4 週
- Full rollout：所有用戶預設 `uiVersion = "new"`
- Cleanup：拿掉 if 分支 + 刪 User.uiVersion 欄位（Phase 9 完成後）

---

## 12. Phase 4 修正版 step（feature flag + additive）

**從 16 step → 12 step（簡化）：**

```
Phase 4.0 — 預備（schema 沒動）
  1. audit prod code 寫死 "admin"/"editor"/"member" 字串
     → 出 audit report，列出要改的檔案數 + 行數
     → user review，拍板要改的清單
  2. PR：寫 UserRole enum constant + 重構這些字串
     → 進 staging 驗 → 進 prod
     → 完成才能下一步 schema migration

Phase 4.1 — 既有 model 加欄位（純加，向後相容）
  3. add User.uiVersion column (default "v2")
  4. add EditRequest 4 cols (grantedDuration / expiresAt / revokedAt / revokedBy)
  5. add AuditLog 5 cols (actorName / workspaceId / scope / ipAddress / userAgent / diff / expiresAt)
  6. extend RequestStatus enum (+ revoked)
  7. extend WorkspaceRole enum (+ owner/admin/commenter/billing/guest 5 個)

Phase 4.2 — 新 10 model（純加）
  8. CREATE PanelVersion + add NovelPromotionPanel.currentVersionId (nullable FK)
  9. CREATE PublicShare + Comment + Follow (3 model)
  10. CREATE Notification
  11. CREATE ProviderConfig + Integration
  12. CREATE CreditTopUp + CreditLedger
  13. CREATE ElementImport
  14. CREATE WorkspaceInvite

Phase 4.3 — Backfill（資料層）
  15. backfill workspace_member.role → 'owner' from Workspace.ownerEditorId
  16. backfill panel_version → 每既有 panel 建一 v1 紀錄
  17. backfill audit_log.scope → 既有 row 分類

Phase 4.4 — 確認 ready，feature flag 才開始有實效
  18. （Phase 5 開工的 prerequisite，這時 schema 全到位）
```

**注意：每個 step 都是「加」，沒任何 DROP / 改既有欄位 type / 刪 enum value。所以**：
- prod 永遠 working
- 改錯就 ALTER 加回去
- 沒 backfill 失敗的災難（既有資料原封不動）

---

## 13. User.role audit 第一步要跑的 audit

```bash
# 在 prod codebase 跑（本機 KuiperAI/）
grep -rn '"admin"' src/ | grep -v node_modules | wc -l    # 預估 50-200 hit
grep -rn '"editor"' src/ | grep -v node_modules | wc -l
grep -rn '"member"' src/ | grep -v node_modules | wc -l
grep -rn 'role.*===.*"' src/ | grep -v node_modules
grep -rn 'role:\s*"' src/ | grep -v node_modules
```

預估改動：~50 個檔，每檔 1-3 行。工時 2-4 小時（人工檢視 + sed + test）。

---

**下一步：** 開跑 Phase 4.0 audit prod code。我跑 grep + 出 audit report，user review 後才 schema 動工。
