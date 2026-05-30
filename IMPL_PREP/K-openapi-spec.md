# K · OpenAPI 3.1 合約 spec

> **目標：** 把 B 的 121 個 endpoint 翻成可被前後端共用的合約。後端 scaffold、前端 mock、SDK 自動產，全部以 `openapi.yaml` 為唯一真相源。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** A-schema-migration.md（Prisma model）/ B-api-endpoints.md（端點清單）/ C-rbac-matrix.md（權限）
> **產出：** 本 md（讀法說明 + 範例）+ `K-openapi.yaml`（機器可讀合約）

---

## 1. 為什麼先寫合約

不寫合約直接 coding 的代價：
- 每個 endpoint 平均往返 3 輪「欄位叫啥」「response 包不包 envelope」「錯誤碼怎麼寫」確認
- 121 × 3 = 363 輪 = 兩個 sprint 的純溝通成本
- 前後端用不同假設 ship，整合期才發現要重做 30%

寫合約的收益：
- 後端用 `openapi-typescript` 直接 scaffold 路由骨架
- 前端用 `openapi-fetch` 拿型別安全 client，連 fetch wrapper 都不用寫
- Mock server 用 `prism` 一行起，前端可以在後端寫好前就有資料
- 合約測試 `dredd` 自動驗證實作 vs spec 一致
- 對 OAuth scope、rate limit、error code 統一規範，避免每個 dev 各自發明

---

## 2. Spec 結構總覽

```
K-openapi.yaml
├── info                    # 標題 / 版本 / 聯繫
├── servers                 # prod / staging / mock
├── security                # OAuth2 / Bearer / Cookie
├── tags                    # 11 個分類對應 B 的 11 個 section
├── paths                   # 121 個端點 → 80% 完整 + 20% summary-only
└── components
    ├── schemas             # 30+ 個 model（Panel / Episode / Character ... ）
    ├── parameters          # 共用 query/path（cursor / locale / workspaceId）
    ├── responses           # 共用 response（200 / 400 / 401 / 403 / 404 / 429 / 500）
    ├── securitySchemes     # bearerAuth / cookieAuth / apiKeyAuth
    └── examples            # 5-10 個典型 payload 範例
```

---

## 3. 命名約定（強制）

### 3.1 路徑

- **資源層級用複數**：`/projects` 不是 `/project`
  > B 文件用單數，正式 spec 修正成複數 RESTful 慣例
- **動作走 sub-resource**：`/runs/{id}/cancel` 而非 `/cancel-run`
- **批次走 collection action**：`/panels:bulk-regenerate`（Google AIP-136 風格）

### 3.2 欄位

- camelCase（前端友善）：`createdAt`、`generationMode`、`perShotProvider`
- 時間：ISO 8601 UTC string，欄位以 `At` / `Until` 結尾
- 點數：**內部 `credits` / UI 顯示「點」雙軌**（D-3 拍板 2026-05-30）
  - Schema / API 欄位一律用 `credits` 系列：`creditsEstimated` / `creditsActual` / `creditsRemaining` / `creditsLimit` / `creditsRefunded`
  - i18n 字典中文 zh = 「點/點數」/ 英文 en = 「Credits」
  - 1 credit = $0.0015（後端統一）
  - 禁止再用 `points` 為欄位名（spec 內 `points` 舊用詞算 typo，逐步替換）
- 列舉：全大寫 `SNAKE_CASE`：`RENDERING`、`R2V_WITH_SUBJECTS`

### 3.3 ID

| 對象 | 格式 | 範例 |
|---|---|---|
| User | `usr_` + 26 char nanoid | `usr_01HQT8...` |
| Workspace | `ws_` | `ws_01HQT9...` |
| Project | `prj_` | `prj_01HQTA...` |
| Episode | `ep_` | `ep_01HQTB...` |
| Panel | `pnl_` | `pnl_01HQTC...` |
| Character | `char_` | `char_01HQTD...` |
| Run | `run_` | `run_01HQTE...` |
| EditRequest | `er_` | `er_01HQTF...` |

> ULID prefix 讓 log 一眼看出對象類型，比裸 UUID 好查。

---

## 4. 統一回應 envelope

### 4.1 成功

```jsonc
{
  "data": { /* resource */ },
  "meta": { "requestId": "req_..." }  // 可選
}
```

列表額外帶 `pagination`：
```jsonc
{
  "data": [/* items */],
  "pagination": {
    "cursor": "eyJpZCI6...",
    "hasMore": true,
    "total": null  // 大集合不算 total，要算 → 走 /count
  }
}
```

### 4.2 錯誤

```jsonc
{
  "error": {
    "code": "PANEL_NOT_FOUND",            // 機器可讀
    "message": "Panel pnl_xxx not found", // 開發者看
    "userMessage": "找不到此分镜",         // i18n 過的，給終端用戶看
    "details": { "panelId": "pnl_xxx" },  // 可選結構化資料
    "traceId": "trc_..."                   // 對應 OpenTelemetry traceId
  }
}
```

### 4.3 標準錯誤碼表

| HTTP | code | 何時 |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod schema fail，`details.fields` 帶逐欄錯訊 |
| 400 | `INVALID_GENERATION_MODE` | 業務規則違反（e.g. T2V 模式塞 referenceImage） |
| 401 | `UNAUTHENTICATED` | 沒 token 或過期 |
| 403 | `INSUFFICIENT_PERMISSION` | 有 token 但 RBAC 擋下，`details.required` 帶需要的 role |
| 403 | `PLAN_LIMIT_EXCEEDED` | 點數不足 / 並發爆 / Team-only 功能 |
| 404 | `RESOURCE_NOT_FOUND` | 通用，`details.kind` 帶 `panel/episode/...` |
| 409 | `CONFLICT` | optimistic lock fail（含 `details.currentVersion`） |
| 422 | `BUSINESS_RULE_VIOLATION` | e.g. Episode 已 publish 不能改 |
| 429 | `RATE_LIMITED` | 帶 `Retry-After` header |
| 500 | `INTERNAL_ERROR` | 通用兜底，不洩漏細節 |
| 502 | `PROVIDER_ERROR` | AI provider 回錯（含 `details.provider`） |
| 503 | `SERVICE_UNAVAILABLE` | 維護中或 queue 滿 |

---

## 5. 共用 Schema（高槓桿）

把以下 30+ schema 完整寫進 yaml，個別 endpoint 只 `$ref` 引用，不重複定義。

### 5.1 核心對象

| Schema | 對應 Prisma model | 來源 mockup |
|---|---|---|
| `User` | User | 19/28 |
| `Workspace` | Workspace | 20/36 |
| `WorkspaceMember` | WorkspaceMember | 20 |
| `WorkspaceInvite` | WorkspaceInvite | 20 |
| `Project` | Project | 02 |
| `Episode` | Episode | 13/08 |
| `Panel` | Panel | 13/08 |
| `PanelVersion` | PanelVersion | 30 |
| `Character` | Character | 15 |
| `CharacterAppearance` | CharacterAppearance | 15 |
| `Location` | Location | 16 |
| `Prop` | Prop | 17 |
| `Run` | Run | 24 |
| `RunStep` | RunStep | 24 |
| `DialogueLine` | DialogueLine | 23 |
| `Voice` | Voice catalog | 23 |
| `Notification` | Notification | 29 |
| `PublicShare` | PublicShare | 31 |
| `Comment` | Comment | 31 |
| `Work` | Project public view | 32 |
| `EditRequest` | EditRequest | 38 |
| `AuditLog` | AuditLog | 37 |
| `Provider` | Provider config | 37 |
| `APIKey` | APIKey | 37/28 |
| `BillingState` | Workspace billing | 36 |
| `Receipt` | Invoice | 36 |
| `KPI` | Admin metrics | 18 |
| `Diff` | Panel version diff | 30 |
| `OnboardingState` | User.onboardingState | 26 |

### 5.2 列舉

```yaml
GenerationMode:
  type: string
  enum:
    - DIRECT_T2V                # 直接文字→影片
    - R2V_WITH_SUBJECTS         # 帶角色/場景/道具 ref
    - T2I_THEN_I2V              # 先生圖再 image-to-video
    - R2V_WITH_MOTION_REF       # 帶動作 ref 影片

ProjectVisibility:
  type: string
  enum: [PRIVATE, WORKSPACE, UNLISTED, PUBLIC]

PanelStatus:
  type: string
  enum: [DRAFT, GENERATING, COMPLETED, FAILED, OUTDATED]

RunStatus:
  type: string
  enum: [QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELED, RETRYING]

UserRole:
  type: string
  enum: [OWNER, ADMIN, EDITOR, COMMENTER, VIEWER, BILLING, GUEST]

Plan:
  type: string
  enum: [FREE, CREATOR, STUDIO, TEAM]

Language:
  type: string
  enum: [zh-CN, en, ja, ko, es]  # i18n 支援列
```

---

## 6. 範例 schema（給 yaml 抄寫用）

### 6.1 Panel（最複雜，全寫一次）

```yaml
Panel:
  type: object
  required: [id, episodeId, sequence, description, status, generationMode, createdAt, updatedAt]
  properties:
    id:
      type: string
      pattern: '^pnl_[0-9a-zA-Z]{26}$'
    episodeId:
      type: string
      pattern: '^ep_[0-9a-zA-Z]{26}$'
    sequence:
      type: integer
      minimum: 1
      description: 在 episode 內的順序，1-based
    description:
      type: string
      maxLength: 5000
      description: 五要素敘事
    sceneContext:
      type: string
      maxLength: 2000
      nullable: true
    motionLine:
      type: string
      maxLength: 500
      nullable: true
    srtSegment:
      type: string
      nullable: true
      description: TTS 對白片段
    generationMode:
      $ref: '#/components/schemas/GenerationMode'
    perShotProvider:
      type: string
      nullable: true
      description: 鏡頭級 provider override，null 表示走 project 預設
    targetDuration:
      type: number
      minimum: 2
      maximum: 15
      description: 秒
    status:
      $ref: '#/components/schemas/PanelStatus'
    characters:
      type: array
      items:
        type: object
        properties:
          characterId: { type: string }
          appearanceId: { type: string, nullable: true }
          asAnchor: { type: boolean }  # 用作參考 anchor
    locations:
      type: array
      items:
        type: object
        properties:
          locationId: { type: string }
          variantId: { type: string, nullable: true }
    props:
      type: array
      items:
        type: object
        properties:
          propId: { type: string }
          holderId: { type: string, nullable: true }
    currentVersionId:
      type: string
      nullable: true
    versions:
      type: array
      items:
        $ref: '#/components/schemas/PanelVersion'
      description: 完整版本歷史，僅 detail endpoint 帶
    createdAt: { type: string, format: date-time }
    updatedAt: { type: string, format: date-time }
```

### 6.2 Run（任務生命週期）

```yaml
Run:
  type: object
  required: [id, kind, status, createdAt]
  properties:
    id: { type: string, pattern: '^run_' }
    kind:
      type: string
      enum:
        - SCRIPT_ANALYZE
        - GENERATE_PANEL
        - BATCH_REGENERATE
        - BATCH_SYNTHESIZE
        - COMPOSE_VIDEO
        - RENDER_QUEUE
    status: { $ref: '#/components/schemas/RunStatus' }
    provider: { type: string, nullable: true }
    creditsEstimated: { type: integer }
    creditsActual: { type: integer, nullable: true }
    panelId: { type: string, nullable: true }
    episodeId: { type: string, nullable: true }
    error:
      type: object
      nullable: true
      properties:
        code: { type: string }
        message: { type: string }
        providerCode: { type: string, nullable: true }
        retriable: { type: boolean }
    steps:
      type: array
      items: { $ref: '#/components/schemas/RunStep' }
    startedAt: { type: string, format: date-time, nullable: true }
    completedAt: { type: string, format: date-time, nullable: true }
    createdAt: { type: string, format: date-time }
```

---

## 7. 25 個高槓桿 endpoint（yaml 完整寫）

以下 25 個是其他 endpoint 的 pattern 範本，yaml 寫到 request/response/error 全齊。其餘 96 個用 summary-only（method/path/operationId + 連到對應 schema）。

| # | OperationId | Method | Path | 為何高槓桿 |
|---|---|---|---|---|
| 1 | `getPanel` | GET | /panels/{id} | Panel 是 30 個 endpoint 的核心對象 |
| 2 | `updatePanel` | PATCH | /panels/{id} | 含 optimistic lock 範例 |
| 3 | `regeneratePanel` | POST | /panels/{id}:regenerate | 啟動 Run 的範本 |
| 4 | `bulkRegeneratePanels` | POST | /panels:bulk-regenerate | 批次操作範本 |
| 5 | `listEpisodePanels` | GET | /episodes/{id}/panels | 列表 + cursor 分頁範本 |
| 6 | `createEpisode` | POST | /projects/{id}/episodes | 巢狀 resource 範本 |
| 7 | `uploadScript` | POST | /projects/{id}/script:upload | multipart 範本 |
| 8 | `analyzeScript` | POST | /scripts:analyze | 長任務 async 範本 |
| 9 | `getRun` | GET | /runs/{id} | Run 查詢範本 |
| 10 | `cancelRun` | POST | /runs/{id}:cancel | Idempotent action 範本 |
| 11 | `streamRunEvents` | GET | /runs/{id}/events | SSE / WebSocket 範本 |
| 12 | `listCharacters` | GET | /projects/{id}/characters | 劇集設定範本 |
| 13 | `createCharacter` | POST | /projects/{id}/characters | RBAC `editor+` 範本 |
| 14 | `uploadCharacterAppearance` | POST | /characters/{id}/appearances | 子資源 + multipart |
| 15 | `getWorkspace` | GET | /workspaces/{id} | Workspace 範本 |
| 16 | `inviteToWorkspace` | POST | /workspaces/{id}/invites | 批次邀請 + email side-effect |
| 17 | `listAuditLog` | GET | /workspaces/{id}/audit-log | cursor + filter 範本 |
| 18 | `createEditRequest` | POST | /workspaces/{id}/edit-requests | 申請流程範本 |
| 19 | `approveEditRequest` | POST | /edit-requests/{id}:approve | 審核 + 時效範本 |
| 20 | `publishProject` | POST | /projects/{id}:publish | 公開設定範本 |
| 21 | `getPublicShare` | GET | /v/{slug} | 公開 SSR endpoint 範本 |
| 22 | `clonePublicShare` | POST | /share/{slug}:clone | 衍生 resource 範本 |
| 23 | `magicLinkRequest` | POST | /auth/magic-link | passwordless 範本 |
| 24 | `stripeWebhook` | POST | /webhook/stripe | webhook 簽章驗證範本 |
| 25 | `providerCallback` | POST | /webhook/provider/{name} | AI provider callback 範本 |

剩餘 96 個 endpoint 在 yaml 用 `$ref` 引用同類範本，只列差異。

---

## 8. SSE / 長任務 protocol

Render queue / Generate panel 是分鐘級任務。合約定義：

### 8.1 啟動

```
POST /panels/{id}:regenerate
→ 202 Accepted
  Location: /runs/run_xxx
  body: { data: Run }  // status: QUEUED
```

### 8.2 串流事件

```
GET /runs/{id}/events
Accept: text/event-stream

event: run.update
data: {"status":"RUNNING","progress":0.42,"currentStep":"COMPOSITING"}

event: run.step
data: {"stepId":"...","status":"SUCCEEDED","output":{...}}

event: run.complete
data: {"status":"SUCCEEDED","creditsActual":120}

event: run.error
data: {"code":"PROVIDER_ERROR","retriable":true}
```

SSE 客戶端要處理 reconnect + last-event-id resume。

### 8.3 idempotency

啟動類 endpoint（regenerate、compose、publish）支援 `Idempotency-Key` header，24h 內重送同 key 回原 Run 不重啟。

---

## 9. 認證 / 授權

### 9.1 Security schemes

```yaml
securitySchemes:
  cookieAuth:
    type: apiKey
    in: cookie
    name: kp_session
    description: Web app 主要認證
  bearerAuth:
    type: http
    scheme: bearer
    description: Mobile / API client
  apiKeyAuth:
    type: apiKey
    in: header
    name: X-API-Key
    description: Workspace API key（Team plan）
```

### 9.2 Scope（apiKeyAuth 用）

| Scope | 允許 |
|---|---|
| `read` | GET 全部 |
| `project:write` | 改 project 內所有資源 |
| `render:create` | 啟動 Run |
| `subjects:write` | 改 character/location/prop |
| `workspace:admin` | workspace 設定 + member |

API key 帶哪些 scope 在 `/workspaces/{id}/api-keys` 建立時指定，後端對每個 endpoint declare `required scopes`。

### 9.3 Workspace 上下文

所有「非全域」endpoint 必須帶 `X-Workspace-Id: ws_xxx` header，後端用此查 RBAC。沒帶 → 走 user 預設 workspace（從 session 拿）。

---

## 10. Rate limit / 配額

| Tier | per-user | per-workspace | per-IP（unauth） |
|---|---|---|---|
| 一般 GET | 600/min | 6000/min | 100/min |
| 寫入 PATCH/POST | 60/min | 600/min | — |
| 啟動 Run | 12/min | 120/min | — |
| Magic link 申請 | 5/15min | — | 10/15min |
| Public share view | — | — | 300/min |

超限：429 + `Retry-After` + `X-RateLimit-*` header。

---

## 11. 版本策略

- `v1` 寫死路徑（不放 `/v1/` 前綴 — 整體 spec 走 `info.version: 1.0.0`，breaking 改才推 `/v2/`）
- Spec 改動：
  - **additive**（新欄位/新 endpoint）→ minor bump
  - **breaking**（改 enum / 拿掉欄位）→ 推新版 path 並列三個月後棄舊
- `Deprecation` header 通知客戶端：`Sunset: Sat, 31 Dec 2026 23:59:59 GMT`

---

## 12. 工具鏈

### 12.1 後端 scaffold

```bash
# 從 yaml 產 Next.js API route stub
npx openapi-typescript-codegen --input K-openapi.yaml --output src/lib/api-types --client none
# 產出 src/lib/api-types/models/*.ts 直接 import
```

### 12.2 前端 client

```bash
npm i openapi-fetch openapi-typescript
npx openapi-typescript K-openapi.yaml -o src/types/api.d.ts

# 用法
import createClient from "openapi-fetch";
import type { paths } from "@/types/api";
const client = createClient<paths>({ baseUrl: "/api" });
const { data, error } = await client.GET("/panels/{id}", {
  params: { path: { id: "pnl_xxx" } }
});
// data 自動推導 Panel 型別
```

### 12.3 Mock server

```bash
npx @stoplight/prism mock K-openapi.yaml --port 4010
# 前端可在後端寫好前就拿到合規假資料
```

### 12.4 合約測試

```bash
npx dredd K-openapi.yaml http://localhost:3000
# CI 跑，確保實作 response 符合 spec
```

---

## 13. 開工順序

1. **這份 md + K-openapi.yaml 完成** ← 當前
2. CI 加 `dredd` job，commit 自動驗合約 vs 實作
3. 後端跑 codegen 產 type-safe stub，照 Phase 順序填實作
4. 前端跑 codegen + prism mock，並行開工
5. 每加新 endpoint：**改 yaml → run codegen → 寫實作 → 跑 dredd**（強制）

---

## 14. 已知 trade-off

| 決定 | 為何 | 代價 |
|---|---|---|
| RESTful 而非 GraphQL | 121 個 endpoint 多但類型固定，REST 更簡單；GraphQL 對短劇生成沒明顯收益 | 過度 fetch 問題（前端要呼 3 endpoint 才湊齊一頁）—— 用 `?include=characters,locations` 查詢參數補 |
| 不寫 RPC-style action endpoint | `/panels/{id}/regenerate` 而非 `/regeneratePanel` | 多打幾個字 |
| SSE 而非 WebSocket | Render 是單向，SSE 簡單、走 HTTP/2 不開額外端口 | 不能客戶端 push（不需要） |
| 不放 `/v1/` 前綴 | 內部用戶為主，沒 long-tail 客戶要支援舊版 | 萬一將來開 public API 要硬拉前綴 |

---

**下一份：** L-component-inventory.md
