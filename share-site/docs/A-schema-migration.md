# A · Schema Migration Design Doc

> **目標：** 鎖住 KuiperAI 重設計需要的所有 schema 改動，按依賴順序排，附 backfill 策略 + 風險分析。實作 React 之前 schema 先打死，避免每改一個欄位都動 N 處。
>
> **狀態：** v1 設計稿 · 2026-05-29
> **依賴：** `prisma/schema.prisma` 既有 + REDESIGN_PLAN.md Phase 1.5A

---

## 0. TL;DR

- **5 個既有表加欄位**（NovelPromotionPanel / Character / Project / User / Workspace）
- **6 個新表**（PanelVersion / Notification / PublicShare / Comment / Follow / ElementImport）
- **3 個既有表小改 enum**（generationMode / status / visibility）
- **0 個 destructive change**（沒有刪欄位、沒有改 type、所有改動向後相容）
- **2 個 backfill script**（panel mode 推斷 + character sourceVersion 補）

---

## 1. 既有 schema 摘要（重點欄位）

```prisma
// 重點既有表（從現有 prisma/schema.prisma）
NovelPromotionPanel {
  id, storyboardId, panelIndex
  description, location, characters[], props (JSON)
  srtSegment, srtStart, srtEnd, duration (Float)
  shotType, cameraMove, imageUrl, imagePrompt, videoPrompt
  multiShotGroupId, multiShotGroupOrder
  videoUrl, videoGenerationMode (normal|firstlastframe)
  sketchImageUrl, actingNotes, photographyRules
}

CharacterAppearance {
  id, characterId, appearanceIndex
  imageUrl, imageUrls (JSON multi)
  tencentVodElementId, arkAssetId
  description
}

NovelPromotionProject {
  id, workspaceId, title, description
  status (draft|active|archived)
  preferredModels (JSON)
}

User {
  id, email, name, avatarUrl
  passwordHash, role (admin|editor|viewer)
  workspaceMemberships[]
}

Workspace {
  id, orgId, name, slug
  plan (free|creator|studio|team)
  monthlyCredits, usedCredits
}
```

---

## 2. 必須改動清單（按依賴順序）

### 2.1 新 Enum（必須先建，其他依賴）

```prisma
enum PanelGenerationMode {
  direct_t2v
  r2v_with_subjects        // 預設
  t2i_then_i2v
  r2v_with_motion_ref
}

enum NotificationType {
  render_done
  render_failed
  invite_received
  system_update
  comment_received
  follow_received
  credit_low
  monthly_reset
}

enum PublicShareVisibility {
  private              // 預設
  unlisted             // 有連結可看
  public               // showcase 可見
}

enum ElementImportStatus {
  pending
  success
  failed
}
```

### 2.2 既有表加欄位（5 個表，向後相容）

#### NovelPromotionPanel（核心改動，Phase 1.5A）

```prisma
model NovelPromotionPanel {
  // ... 既有欄位 ...

  // ─── 新增（REDESIGN_PLAN Phase 1.5A）───
  generationMode      PanelGenerationMode  @default(r2v_with_subjects)
  sceneContext        String?  @db.Text   // 從 description 鎖定的 T2I/T2V prompt
  motionLine          String?  @db.Text   // I2V 動作描述（LLM 反推或 user 編輯）
  keyframeUrl         String?              // T2I→I2V mode 選定的關鍵幀
  keyframeCandidates  Json?                // T2I 4 張候選（max 4，每張含 url + seed）
  r2vMotionRefUrl     String?              // R2V+motion 的參考運鏡 clip URL
  perShotProvider     String?              // 單鏡 model override (e.g. "ark::seedance-2.0-r2v")
  perShotCameraPresets Json?               // Cinema preset stack (max 3)
  targetDuration      Float?               // user 指定的目標秒數（vs LLM 推導的 duration）

  // 給歷史版本機制用
  currentVersionId    String?              // FK → PanelVersion.id（current selected）

  @@index([generationMode])  // 路由查詢
}
```

**Backfill：** 既有 panel 預設 `direct_t2v`（因為 R2V 是新概念，既有資料沒綁 reference 機制就是 T2V）。**注意：不能預設 `r2v_with_subjects`**，否則所有舊 panel 啟動時系統會去找不存在的 reference。

#### Character（劇集設定 — 跨專案匯入用）

```prisma
model NovelPromotionCharacter {
  // ... 既有欄位 ...

  // ─── 新增 ───
  sourceCharacterId   String?              // 從哪個 char 匯入來的（cross-project）
  sourceWorkspaceId   String?              // 跨 workspace 匯入時記
  importedAt          DateTime?
  isTemplate          Boolean  @default(false)  // 是否設為「樣板角色」可被其他專案用

  @@index([sourceCharacterId])  // 反向查詢「我被誰引用」
}
```

**設計意圖：** mockup 15 角色編輯右下「跨專案 import」按鈕的後端機制。`sourceCharacterId` 指回母角色，改母角色可以 propagate 到所有 child（手動觸發，**不自動**）。

#### NovelPromotionProject

```prisma
model NovelPromotionProject {
  // ... 既有欄位 ...

  // ─── 新增 ───
  publicVisibility    PublicShareVisibility  @default(private)
  publicSlug          String?  @unique       // /v/{slug} 路由
  publishedAt         DateTime?              // 首次公開時間
  isTemplate          Boolean  @default(false)  // 樣板專案（廣場 featured）
  templateClonedFrom  String?                // 從哪個樣板複製來

  // 統計（denormalized for 列表速度）
  viewCount           Int     @default(0)
  likeCount           Int     @default(0)
  cloneCount          Int     @default(0)

  @@index([publicVisibility, publishedAt])  // 廣場排序
  @@index([publicSlug])
}
```

#### User

```prisma
model User {
  // ... 既有欄位 ...

  // ─── 新增 ───
  preferredLanguage   String   @default("zh-CN")  // i18n 偏好
  publicHandle        String?  @unique             // @joshhung
  publicBio           String?  @db.Text            // 公開頁顯示
  followerCount       Int     @default(0)
  followingCount      Int     @default(0)

  // Notification 偏好（JSON 可擴充）
  notificationPrefs   Json?                        // {render_done: true, weekly_digest: false, ...}
}
```

#### Workspace

```prisma
model Workspace {
  // ... 既有欄位 ...

  // ─── 新增 ───
  failedCreditsRefunded   Int  @default(0)         // 失敗已退點（累計，會計用）
  monthlyResetDay         Int  @default(1)         // 月度重置日（1-28）
  billingEmail            String?
  vatNumber               String?                  // 歐盟 VAT
}
```

### 2.3 新增表（6 個 + 1 個 D 拍板補的 CreditTopUp）

#### 2.3.1 PanelVersion — 歷史版本機制（mockup 30）

```prisma
model PanelVersion {
  id                String   @id @default(cuid())
  panelId           String
  panel             NovelPromotionPanel @relation(fields: [panelId], references: [id], onDelete: Cascade)
  versionNumber     Int                  // 1, 2, 3... (per-panel auto-increment)

  // Snapshot 當時的關鍵欄位（不存全部 panel state — 太重）
  videoUrl          String?
  imageUrl          String?
  generationMode    PanelGenerationMode
  provider          String?              // "ark::seedance-2.0"
  seed              BigInt?
  cost              Int                  // 點數
  motionLine        String?  @db.Text
  sceneContext      String?  @db.Text

  // Metadata
  createdById       String                // 誰生的
  createdBy         User     @relation(fields: [createdById], references: [id])
  createdAt         DateTime @default(now())
  reason            String?               // "user retry" / "mode change" / "param adjust" / "initial"
  isFavorite        Boolean  @default(false)

  @@unique([panelId, versionNumber])
  @@index([panelId, createdAt])
}
```

**設計：**
- **不存全 panel state** — 只存最關鍵的「變了什麼」+ output URL
- 想看舊版回 panel 主表也找不到 — 但 video/image URL 是 immutable storage（R2/COS）所以還在
- 收藏（favorite）讓 user 標記「這版我喜歡」
- 預估每 panel 平均 5-10 個 version；100 萬 panel × 8 version = 800 萬筆，索引夠用

#### 2.3.2 Notification — 通知系統（mockup 29）

```prisma
model Notification {
  id                String   @id @default(cuid())
  userId            String
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  type              NotificationType
  title             String
  body              String   @db.Text

  // 結構化 metadata（取代 hardcode 字串）
  metadata          Json?                // {projectId, panelId, episodeId, fromUserId, ...}

  // 跳轉
  actionUrl         String?              // "/v2/workspace/xyz/storyboard"
  actionLabel       String?              // "查看成片"

  // 狀態
  readAt            DateTime?
  dismissedAt       DateTime?
  createdAt         DateTime @default(now())

  // 推送通道追蹤
  sentViaEmail      Boolean  @default(false)
  sentViaPush       Boolean  @default(false)

  @@index([userId, readAt, createdAt])  // 主查詢：unread + 排序
  @@index([userId, type])                // 篩選類型
}
```

**設計：**
- `metadata` 用 JSON 而不是各種 FK — 通知本身不該 cascade delete 影響業務表
- `actionUrl` 用 string 而不是 enum + params — 解耦合 routing
- `sentViaEmail` / `sentViaPush` 為了「user 在 settings 改了偏好不想重複通知」用

#### 2.3.3 PublicShare — 公開分享（mockup 31）

```prisma
model PublicShare {
  id                String   @id @default(cuid())
  projectId         String   @unique     // 一個 project 只有一個分享連結
  project           NovelPromotionProject @relation(fields: [projectId], references: [id], onDelete: Cascade)
  slug              String   @unique     // /v/{slug} — 用 nanoid 6 字元

  // 可見性（覆蓋 project.publicVisibility 的細粒度）
  password          String?              // optional 密碼保護
  expiresAt         DateTime?            // optional 過期

  // 統計
  viewCount         Int      @default(0)
  uniqueViewerCount Int      @default(0)  // distinct IP/cookie

  // OG 預覽快取
  ogImage           String?              // 自動生成 OG 縮圖（cron）
  ogTitle           String?
  ogDescription     String?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  // 反向：被誰 clone
  clonedAs          NovelPromotionProject[] @relation("ClonedFrom")
}
```

**問題：** 既有 `NovelPromotionProject` 已經有 `publicSlug` 跟 `publicVisibility`。為什麼還要 PublicShare 表？

**答：** project 是業務主表，欄位很重；PublicShare 是元資料表，獨立的 viewCount、OG 快取、密碼、過期等讓 project 表保持精瘦。觀察 GitHub gist / Notion share link 都是分表設計。

#### 2.3.4 Comment — 公開作品留言（mockup 31）

```prisma
model Comment {
  id                String   @id @default(cuid())
  publicShareId     String
  publicShare       PublicShare @relation(fields: [publicShareId], references: [id], onDelete: Cascade)

  // 作者（必須登入才能留言）
  authorId          String
  author            User     @relation(fields: [authorId], references: [id])

  body              String   @db.Text

  // Threading
  parentId          String?              // null = top level
  parent            Comment? @relation("CommentThread", fields: [parentId], references: [id])
  replies           Comment[] @relation("CommentThread")

  // 互動
  likeCount         Int      @default(0)
  isHidden          Boolean  @default(false)  // 作者隱藏
  isFlagged         Boolean  @default(false)  // 被檢舉

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([publicShareId, createdAt])
  @@index([parentId])
  @@index([authorId, createdAt])  // 「我的留言」查詢
}
```

#### 2.3.5 Follow — 創作者關注（mockup 31）

```prisma
model Follow {
  id                String   @id @default(cuid())
  followerId        String
  follower          User     @relation("FollowerRelation", fields: [followerId], references: [id], onDelete: Cascade)
  followingId       String
  following         User     @relation("FollowingRelation", fields: [followingId], references: [id], onDelete: Cascade)

  createdAt         DateTime @default(now())

  @@unique([followerId, followingId])  // 不能重複 follow
  @@index([followingId, createdAt])    // 反向：誰 follow 我
}
```

**Denorm 提醒：** User.followerCount / followingCount 是 denormalized。新增/刪除 Follow 時要寫個 trigger 或 service 層更新 User 表，**否則會 drift**。

#### 2.3.6 CreditTopUp — 加購點數包（D 拍板新增）

```prisma
model CreditTopUp {
  id              String   @id @default(cuid())
  workspaceId     String
  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  stripePaymentId String   @unique
  amount          Int                  // 點數量（1000/5000/20000）
  pricePaid       Int                  // 美元 cents
  usedAmount      Int      @default(0)
  expiresAt       DateTime?            // null = 不過期（D 拍板）
  createdAt       DateTime @default(now())

  @@index([workspaceId, usedAmount])
}
```

**Usage 順序：** 月度 credits 先扣 → top-up 後扣（避免月度 reset 浪費 top-up）。

#### 2.3.7 ElementImport — 跨專案匯入記錄

```prisma
model ElementImport {
  id                String   @id @default(cuid())

  // 來源
  sourceProjectId   String
  sourceWorkspaceId String
  sourceElementId   String              // 角色/場景/道具 id
  sourceElementType String              // "character" | "location" | "prop"

  // 目標
  targetProjectId   String
  targetElementId   String              // 匯入後產生的新 element id

  // 同步
  isLinked          Boolean  @default(false)  // 是否雙向同步（false = 一次性 copy）
  lastSyncedAt      DateTime?

  // 動作主
  importedById      String
  importedBy        User     @relation(fields: [importedById], references: [id])
  status            ElementImportStatus  @default(success)

  createdAt         DateTime @default(now())

  @@index([sourceProjectId])
  @@index([targetProjectId])
}
```

**設計：** `isLinked` 是關鍵 — 預設一次性 copy（拿了就拿了），可選 linked 模式讓母 element 改動 propagate 到子 element（會增加查詢成本，default off 是對的）。

### 2.4 既有 Enum 擴充（向後相容）

```prisma
// User.role 加 'owner'（org-level）
enum UserRole {
  owner           // 新增 — org owner
  admin
  editor
  viewer
}

// Workspace.plan 加 'enterprise'
enum WorkspacePlan {
  free
  creator
  studio
  team
  enterprise      // 新增（可選）
}

// NovelPromotionProject.status 加 'public_listed'
enum ProjectStatus {
  draft
  active
  archived
  public_listed   // 新增（廣場已 featured）
}
```

---

## 3. Migration 依賴順序（重要！）

**必須按這個順序執行 migration**（每個是獨立 prisma migration）：

```
1. add_enums         (新 enum 定義)
2. add_panel_columns (NovelPromotionPanel + currentVersionId 但先不加 FK)
3. add_panel_version (新 PanelVersion 表)
4. add_panel_fk      (NovelPromotionPanel.currentVersionId 加 FK → PanelVersion.id)
5. add_user_columns  (User + 加 publicHandle unique)
6. add_workspace_columns
7. add_character_columns
8. add_project_columns
9. add_public_share  (PublicShare 表)
10. add_comment      (Comment 表)
11. add_follow       (Follow 表)
12. add_element_import (ElementImport 表)
13. add_notification (Notification 表)
14. backfill_panel_mode (data migration script)
15. backfill_user_handle (從 email 推 handle，碰撞處理)
```

**為什麼分這麼細：** 每個 migration 都要能單獨 rollback。Step 4 把 FK 拆開是因為 Step 2 加欄位時 PanelVersion 還不存在。

---

## 4. Backfill 策略

### 4.1 Panel mode backfill（**必須**）

```sql
-- backfill_panel_mode.sql
-- 邏輯：已有 imageUrl 的視為 t2i_then_i2v；沒 imageUrl 但有 characters/location 的視為 r2v_with_subjects；其他 direct_t2v
UPDATE "NovelPromotionPanel"
SET "generationMode" = CASE
  WHEN "imageUrl" IS NOT NULL AND "imageUrl" != '' THEN 'r2v_with_subjects'::PanelGenerationMode
  WHEN "characters" IS NOT NULL OR "location" IS NOT NULL THEN 'r2v_with_subjects'::PanelGenerationMode
  ELSE 'direct_t2v'::PanelGenerationMode
END
WHERE "generationMode" IS NULL;
```

**保守選擇：** 預設 `direct_t2v` 比 `r2v_with_subjects` 安全 — 因為 R2V worker 找不到 reference 會 fail，T2V worker 不會。

### 4.2 User handle backfill

```typescript
// scripts/backfill-user-handle.ts
// 邏輯：email local-part → handle，碰撞時加數字後綴
async function backfillUserHandle() {
  const users = await prisma.user.findMany({ where: { publicHandle: null } });
  for (const user of users) {
    const base = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
    let handle = base;
    let counter = 1;
    while (await prisma.user.findUnique({ where: { publicHandle: handle } })) {
      handle = `${base}${counter++}`;
    }
    await prisma.user.update({ where: { id: user.id }, data: { publicHandle: handle } });
  }
}
```

### 4.3 NOT 需要的 backfill

- PublicShare / Comment / Follow / ElementImport / PanelVersion / Notification — 都是新表，**沒有舊資料**
- User.preferredLanguage 預設 `zh-CN`，舊資料自動拿到
- Project.viewCount / likeCount / cloneCount 預設 0，從新計起

---

## 5. 風險分析

### 5.1 高風險

| 風險 | 後果 | 緩解 |
|---|---|---|
| **Panel.generationMode backfill 錯誤** | 舊 panel 啟動時 worker 找不到 reference 失敗 | 預設用 `direct_t2v` 而不是 `r2v_with_subjects`（保守選擇） |
| **User.publicHandle unique constraint** | 多個 user email 撞同 handle 時 migration 中斷 | 加 sequence number 後綴邏輯（4.2 已寫）|
| **PanelVersion 表暴漲** | 100 萬 panel × 平均 8 version = 800 萬筆 | 加 retention policy：>90 天且非 favorite 自動 archive 到 cold storage |
| **Project.publicSlug 衝突** | 兩個專案同時 publish 撞 slug | 用 nanoid(6) 而不是 user-chosen slug |

### 5.2 中風險

| 風險 | 後果 | 緩解 |
|---|---|---|
| **Comment threading 太深** | UI 渲染慢、N+1 query | 限制 max depth 3 層 + 用 cursor 分頁 |
| **Follow denorm drift** | User.followerCount 跟實際 Follow count 不一致 | 寫 cron 每天 reconcile + Service 層用 transaction 包 |
| **Notification 暴漲** | 重度 user 一週幾千通知 | 加 retention：>30 天已讀自動刪 |

### 5.3 低風險（但要注意）

- **Element import linked mode** — 改母 element 要傳播到 N 個子 element，N 大時慢。Default off + 顯式 opt-in。
- **PublicShare password protection** — 密碼存 hash + salt（**不可** plain text）。

---

## 6. Index 策略

按查詢頻率排序的 index：

```prisma
// 高頻
@@index([userId, readAt, createdAt])         // Notification 未讀查詢
@@index([publicVisibility, publishedAt])     // 廣場排序
@@index([generationMode])                    // worker 路由
@@index([panelId, createdAt])                // PanelVersion timeline

// 中頻
@@index([publicShareId, createdAt])          // 留言列表
@@index([followingId, createdAt])            // 反向 follow

// 低頻
@@index([sourceCharacterId])                 // 跨專案血緣
@@index([sourceProjectId]) / @@index([targetProjectId])  // Element 匯入
```

**反 pattern：** 不要對 JSON 欄位（characters / props / keyframeCandidates / metadata）加 GIN index — 寫入成本太高。如果需要查 JSON 內容，改用 normalized 表。

---

## 7. 估算

| 項目 | 預估 |
|---|---|
| 新 enum | 4 個 |
| 既有表加欄位 | 5 個表 / 25 個欄位 |
| 新表 | 6 個 |
| Migration 步驟 | 15 步 |
| Backfill script | 2 個（panel mode / user handle） |
| 影響 worker 程式碼 | NovelPromotionPanel.generationMode 路由 + ~10 處 query |
| 影響 API 程式碼 | ~30 個新 endpoint（見 B 文件） |
| 工程預估 | 3-4 天寫 + 1 天 review + 0.5 天 prod migration |

---

## 8. 上線 checklist

- [ ] Migration 在 staging 跑過完整 backfill，比對 row count
- [ ] Worker 程式碼讀 generationMode 之前先驗證 enum value（防 NULL）
- [ ] 既有 worker 路由不能因為新 mode 出現 fall-through（加 default case）
- [ ] PanelVersion 寫入路徑加入既有 panel 重生流程（每次重生產生新 version）
- [ ] Notification 寫入點：render-completed-handler / render-failed-handler / invite-handler / billing-handler
- [ ] User.publicHandle 移到 signup form（新 user 自選 handle）
- [ ] Backup prod DB 後再跑 migration（pg_dump）

---

**下一份：** B-api-endpoints.md
