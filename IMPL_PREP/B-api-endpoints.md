# B · API 端點清單

> ⚠️ **2026-05-30 之後：本文件的「路徑」欄位已過時** — 全文用單數路徑 + 動詞 sub-path（v1 慣例）。新慣例（複數 + colon action）見 **[Q-paths-canonical.md](./Q-paths-canonical.md)** 為唯一真相源。
>
> 本檔保留作「mockup → endpoint」對映參考。路徑名稱請對照 Q 的 §18.3 「路徑慣例修正對照表」翻譯。
>
> **目標：** 把 33 個 mockup 對應的 backend endpoints 全列。實作 React component 時直接查表，不用每寫一個 component 都回頭設計 API。
>
> **狀態：** v1.1 · 2026-05-30（路徑慣例已被 Q 取代，內容仍為對映表）
> **依賴：** A-schema-migration.md / Q-paths-canonical.md
> **慣例：** ~~RESTful（GET / POST / PATCH / DELETE）+ resource-based path~~ → 改見 Q §19 設計檢查表

---

## 0. 既有 API 保留（不動）

KuiperAI 現有的 `/api/admin/*`、`/api/workspace/*`、`/api/novel-promotion/*` 等保留。本文件**只列新增/改動**。

---

## 1. 創作流（mockup 06/07/13/08/04/23/24/25）

### Panel CRUD（mockup 13/08）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 13/08 | `/api/panel/{id}` | GET | editor+ | — | `Panel` 完整含 versions[] |
| 13 | `/api/panel/{id}` | PATCH | editor+ | `{ description?, sceneContext?, motionLine?, generationMode?, perShotProvider?, targetDuration? }` | `Panel` |
| 13 | `/api/panel/{id}/regenerate` | POST | editor+ | `{ provider, mode, asNewVersion: bool }` | `Run` |
| 13 | `/api/panel/bulk-regenerate` | POST | editor+ | `{ panelIds[], provider, mode }` | `Run[]` |
| 13 | `/api/panel/{id}/delete` | DELETE | editor+ | — | `204` |
| 13 | `/api/panel/{id}/insert-after` | POST | editor+ | `{ description }` | `Panel` |

### Episode（mockup 13 集 tab）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 13 | `/api/project/{id}/episode` | POST | editor+ | `{ title?, scriptText? }` | `Episode` |
| 13 | `/api/episode/{id}` | PATCH | editor+ | `{ title?, scriptText?, status? }` | `Episode` |
| 13 | `/api/episode/{id}/reorder` | POST | editor+ | `{ panelIds[] }` | `200` |

### Script / Pre-flight（mockup 06/07）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 06 | `/api/project/{id}/upload-script` | POST | editor+ | `multipart: file` | `{ episodes[] }` |
| 06 | `/api/script/analyze` | POST | editor+ | `{ scriptText, projectId }` | `{ scenes, shots, elements, estCredits }` |
| 07 | `/api/script/{id}/confirm` | POST | editor+ | `{ confirmedSplit, settings }` | `{ episodeIds[] }` |

### Voice（mockup 23）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 23 | `/api/episode/{id}/dialogue-lines` | GET | editor+ | — | `DialogueLine[]` |
| 23 | `/api/dialogue-line/{id}` | PATCH | editor+ | `{ text?, voiceId?, tone?, speed?, pitch?, language? }` | `DialogueLine` |
| 23 | `/api/dialogue-line/{id}/synthesize` | POST | editor+ | — | `{ audioUrl, duration }` |
| 23 | `/api/episode/{id}/batch-synthesize` | POST | editor+ | — | `Run` |
| 23 | `/api/voices/library` | GET | editor+ | `?language=zh-CN` | `Voice[]` |
| 23 | `/api/voice/preview` | POST | editor+ | `{ voiceId, text }` | `{ audioUrl }` |

### Render Queue（mockup 24）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 24 | `/api/episode/{id}/render-queue` | GET | editor+ | — | `RenderJob[]` |
| 24 | `/api/episode/{id}/start-render` | POST | editor+ | — | `200` |
| 24 | `/api/episode/{id}/pause-render` | POST | editor+ | — | `200` |
| 24 | `/api/episode/{id}/retry-failed` | POST | editor+ | — | `200` |
| 24 | `/api/run/{id}/cancel` | POST | editor+ | — | `200` |
| 24 | `/api/run/{id}/retry` | POST | editor+ | — | `Run` |

### Final Output（mockup 25）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 25 | `/api/episode/{id}/compose` | POST | editor+ | `{ aspectRatio, subtitleBurnIn: bool, bgm?: url }` | `Run` |
| 25 | `/api/episode/{id}/final` | GET | editor+ | `?aspect=9:16` | `{ videoUrl, duration, size, format }` |
| 25 | `/api/episode/{id}/download` | GET | editor+ | `?aspect=9:16&withSubs=true` | `Stream` |
| 25 | `/api/episode/{id}/publish` | POST | editor+ | `{ platform: "douyin\|xhs\|ig\|yt", credentials }` | `{ externalUrl }` |
| 25 | `/api/episode/{id}/receipt` | GET | editor+ | — | `Receipt` |

---

## 2. 劇集設定（mockup 15/16/17）

### Character

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 15 | `/api/project/{id}/character` | GET | editor+ | — | `Character[]` |
| 15 | `/api/project/{id}/character` | POST | editor+ | `{ name, essence?, appearance?, clothing?, voiceId? }` | `Character` |
| 15 | `/api/character/{id}` | PATCH | editor+ | `{ name?, essence?, appearance?, clothing?, consistency? }` | `Character` |
| 15 | `/api/character/{id}` | DELETE | editor+ | — | `204` |
| 15 | `/api/character/{id}/appearance` | POST | editor+ | `multipart: file, description` | `Appearance` |
| 15 | `/api/character/{id}/test-generate` | POST | editor+ | `{ appearanceId? }` | `{ imageUrl, cost: 3 }` |
| 15 | `/api/character/{id}/usage` | GET | editor+ | — | `{ panelId, episodeId, scene }[]` |
| 15 | `/api/character/{id}/import-from` | POST | editor+ | `{ sourceCharacterId, sourceProjectId, isLinked: bool }` | `Character` |

### Location / Prop（同 Character 結構）

| Mockup | Endpoint | Method |
|---|---|---|
| 16 | `/api/project/{id}/location` | GET / POST |
| 16 | `/api/location/{id}` | PATCH / DELETE |
| 16 | `/api/location/{id}/view` | POST（wide/medium/close 視角）|
| 16 | `/api/location/{id}/variant` | POST（時段變體）|
| 17 | `/api/project/{id}/prop` | GET / POST |
| 17 | `/api/prop/{id}` | PATCH / DELETE |
| 17 | `/api/prop/{id}/bind-holder` | POST `{ characterId }` |

---

## 3. 公開分享 / 廣場（mockup 31/32）

### PublicShare（mockup 31）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 25/31 | `/api/project/{id}/publish` | POST | owner | `{ visibility, password?, expiresAt? }` | `PublicShare` |
| 31 | `/v/{slug}` | GET | public | — | `Page` (SSR) |
| 31 | `/api/share/{slug}` | GET | public | — | `PublicShareView`（不含敏感資料） |
| 31 | `/api/share/{slug}/like` | POST | signed-in | — | `{ likeCount }` |
| 31 | `/api/share/{slug}/clone` | POST | signed-in | — | `{ newProjectId }` |
| 31 | `/api/share/{slug}/comment` | GET | public | `?cursor=` | `Comment[]` |
| 31 | `/api/share/{slug}/comment` | POST | signed-in | `{ body, parentId? }` | `Comment` |

### Discover / Showcase（mockup 32）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 32 | `/api/discover/works` | GET | public | `?filter=trending&genre=mystery&cursor=` | `Work[]` |
| 32 | `/api/discover/featured` | GET | public | — | `Work[]` |
| 32 | `/api/discover/creators` | GET | public | `?cursor=` | `Creator[]` |
| 32 | `/api/creator/{handle}` | GET | public | — | `CreatorProfile` |
| 31/32 | `/api/creator/{handle}/follow` | POST | signed-in | — | `{ following: true }` |
| 31/32 | `/api/creator/{handle}/unfollow` | POST | signed-in | — | `{ following: false }` |

---

## 4. 通知（mockup 29）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 29 | `/api/notifications` | GET | signed-in | `?filter=unread&cursor=` | `Notification[]` |
| 29 | `/api/notifications/unread-count` | GET | signed-in | — | `{ count }` |
| 29 | `/api/notifications/{id}/read` | POST | signed-in | — | `200` |
| 29 | `/api/notifications/mark-all-read` | POST | signed-in | — | `200` |
| 29 | `/api/notifications/{id}` | DELETE | signed-in | — | `204` |
| 28 | `/api/user/notification-prefs` | GET / PATCH | signed-in | `{ render_done?, weekly_digest?, ... }` | `Prefs` |

### Push subscription（service worker）

| Endpoint | Method | Auth | Body |
|---|---|---|---|
| `/api/push-subscribe` | POST | signed-in | `{ endpoint, keys }` |
| `/api/push-unsubscribe` | POST | signed-in | `{ endpoint }` |

---

## 5. 歷史版本（mockup 30）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 30 | `/api/panel/{id}/versions` | GET | editor+ | — | `PanelVersion[]` |
| 30 | `/api/panel/{id}/versions/{vid}/restore` | POST | editor+ | — | `Panel`（current 變成 vid） |
| 30 | `/api/panel/{id}/versions/{vid}/favorite` | POST | editor+ | — | `200` |
| 30 | `/api/panel/{id}/versions/compare` | GET | editor+ | `?a=v1&b=v3` | `Diff` |

---

## 6. 設置（mockup 28）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 28 | `/api/user/me` | GET / PATCH | signed-in | `{ name?, avatarUrl?, publicHandle?, publicBio? }` | `User` |
| 28 | `/api/user/avatar` | POST | signed-in | `multipart: file` | `{ avatarUrl }` |
| 28 | `/api/user/language` | PATCH | signed-in | `{ language }` | `200` |
| 28 | `/api/user/password` | PATCH | signed-in | `{ old, new }` | `200` |
| 28 | `/api/user/api-keys` | GET / POST | signed-in | `{ name, scopes[] }` | `APIKey` |
| 28 | `/api/user/api-keys/{id}` | DELETE | signed-in | — | `204` |
| 28 | `/api/user/delete` | POST | signed-in | `{ password, reason? }` | `200`（soft delete + grace period） |

---

## 7. Auth（mockup 19）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 19 | `/api/auth/magic-link` | POST | public | `{ email }` | `200` |
| 19 | `/api/auth/magic-callback` | GET | public | `?token=` | `Redirect + Session` |
| 19 | `/api/auth/oauth/{provider}` | GET | public | — | `Redirect to provider` |
| 19 | `/api/auth/oauth/{provider}/callback` | GET | public | `?code=` | `Redirect + Session` |
| 19 | `/api/auth/password-login` | POST | public | `{ email, password }` | `Session` |
| 19 | `/api/auth/signup` | POST | public | `{ email, name, inviteCode? }` | `Session` |
| 19 | `/api/auth/invite-request` | POST | public | `{ email, useCase }` | `200` |
| 19 | `/api/auth/logout` | POST | signed-in | — | `200` |

---

## 8. Workspace / Admin（mockup 18/20）

### Workspace（mockup 20）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 20 | `/api/workspace/{id}` | GET / PATCH | admin+ | `{ name?, plan?, ... }` | `Workspace` |
| 20 | `/api/workspace/{id}/members` | GET | admin+ | — | `Member[]` |
| 20 | `/api/workspace/{id}/invite` | POST | admin+ | `{ emails: [{email, role}] }` | `Invite[]` |
| 20 | `/api/workspace/{id}/member/{userId}` | PATCH / DELETE | admin+ | `{ role? }` | `Member \| 204` |
| 20 | `/api/workspace/{id}/billing` | GET | admin+ | — | `BillingState` |
| 20 | `/api/workspace/{id}/upgrade` | POST | owner | `{ targetPlan, annual: bool }` | `Stripe.Session` |
| 20 | `/api/workspace/{id}/audit-log` | GET | admin+ | `?cursor=` | `AuditLog[]` |

### Admin（mockup 18）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 18 | `/api/admin/kpi` | GET | admin | `?range=24h` | `KPI` |
| 18 | `/api/admin/runs` | GET | admin | `?filter=failed&cursor=` | `Run[]` |
| 18 | `/api/admin/runs/{id}` | GET | admin | — | `RunDetail` |
| 18 | `/api/admin/runs/{id}/retry` | POST | admin | — | `Run` |
| 18 | `/api/admin/providers` | GET | admin | — | `Provider[]` |
| 18 | `/api/admin/queue-health` | GET | admin | — | `QueueHealth` |
| 18 | `/api/admin/credit-breakdown` | GET | admin | `?range=24h` | `CreditBreakdown` |

---

## 9. Onboarding（mockup 26）

| Mockup | Endpoint | Method | Auth | Body | Returns |
|---|---|---|---|---|---|
| 26 | `/api/onboarding/state` | GET | signed-in | — | `{ step, completed[] }` |
| 26 | `/api/onboarding/step/{n}` | POST | signed-in | `{ data }` | `{ nextStep }` |
| 26 | `/api/onboarding/skip` | POST | signed-in | — | `200` |
| 26 | `/api/onboarding/complete` | POST | signed-in | — | `200` |

---

## 10. Webhook（外部進來）

| 來源 | Endpoint | 用途 |
|---|---|---|
| Stripe | `/webhook/stripe` | 訂閱 / 退款 / 失敗 |
| ARK / Tencent / AtlasCloud / fal / BobAPI | `/webhook/provider/{name}` | 任務 callback |
| Email provider | `/webhook/email/bounce` | 信件退回追蹤 |

---

## 11. 統計

| 類別 | endpoint 數 |
|---|---|
| 創作流 | ~35 |
| 劇集設定 | ~20 |
| 公開分享 / 廣場 | ~12 |
| 通知 | ~8 |
| 歷史版本 | ~4 |
| 設置 | ~8 |
| Auth | ~8 |
| Workspace / Admin | ~15 |
| Onboarding | ~4 |
| Webhook | ~7 |
| **總計** | **~121 個新 endpoint** |

工程預估：每天平均 3-4 個 endpoint（含 test）→ 約 **30 個工作天**（1.5 個月）。

---

**下一份：** C-rbac-matrix.md
