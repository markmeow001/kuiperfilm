# Q · API 路徑唯一真相源（Canonical Paths）

> **拍板：** 2026-05-30（D-4）。B（端點清單）/ K（OpenAPI 合約）/ L（component inventory）三份都以本文件為準。改了 endpoint 路徑必須先改本檔。
>
> **慣例（K-openapi-spec.md §3.1 拍板）：**
> - 資源層級用**複數**：`/projects` 不是 `/project`
> - 動作走 sub-resource：`/runs/{id}/cancel` 而非 `/cancelRun`
> - 批次走 collection action with colon：`/panels:bulk-regenerate`（Google AIP-136 風格）
> - 公開 SSR 短連結保留特例：`/v/{slug}`、`/c/{handle}`

---

## 0. TL;DR

| 統計 | 數量 |
|---|---|
| Endpoint 總數（不含 webhook） | 124 |
| Webhook endpoint | 7 |
| **總計** | **131** |
| 高槓桿（K openapi 寫完整）| 25 |
| Summary-only（K 寫一行）| 99 |
| 公開 endpoint（無 auth）| 12 |
| 需 Workspace context header | 89 |

---

## 1. Panels（mockup 13/08）

| Canonical Path | Method | OperationId | Auth | Workspace ctx |
|---|---|---|---|---|
| `/panels/{id}` | GET | getPanel | editor+ | ✓ |
| `/panels/{id}` | PATCH | updatePanel | editor+ | ✓ |
| `/panels/{id}` | DELETE | deletePanel | editor+ | ✓ |
| `/panels/{id}:regenerate` | POST | regeneratePanel | editor+ | ✓ |
| `/panels:bulk-regenerate` | POST | bulkRegeneratePanels | editor+ | ✓ |
| `/panels/{id}:insert-after` | POST | insertPanelAfter | editor+ | ✓ |
| `/panels/{id}:soft-delete` | POST | softDeletePanel | editor+ | ✓ |
| `/episodes/{id}/panels` | GET | listEpisodePanels | viewer+ | ✓ |

**B 舊（單數）→ Q 新（複數）對映：**
- `/api/panel/{id}` → `/panels/{id}`
- `/api/panel/{id}/regenerate` → `/panels/{id}:regenerate`
- `/api/panel/bulk-regenerate` → `/panels:bulk-regenerate`
- `/api/panel/{id}/delete` → `DELETE /panels/{id}`（不再用 sub-action）
- `/api/panel/{id}/insert-after` → `/panels/{id}:insert-after`

---

## 2. Episodes（mockup 13 集 tab）

| Canonical Path | Method | OperationId | Auth | Workspace ctx |
|---|---|---|---|---|
| `/projects/{id}/episodes` | GET | listProjectEpisodes | viewer+ | ✓ |
| `/projects/{id}/episodes` | POST | createEpisode | editor+ | ✓ |
| `/episodes/{id}` | PATCH | updateEpisode | editor+ | ✓ |
| `/episodes/{id}` | DELETE | deleteEpisode | editor+ | ✓ |
| `/episodes/{id}/reorder` | POST | reorderEpisodePanels | editor+ | ✓ |

---

## 3. Script / Pre-flight（mockup 06/07）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/projects/{id}/script:upload` | POST (multipart) | uploadScript | editor+ |
| `/scripts:analyze` | POST | analyzeScript | editor+ |
| `/scripts/{id}:confirm` | POST | confirmScriptSplit | editor+ |

---

## 4. Voice（mockup 23）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/episodes/{id}/dialogue-lines` | GET | listDialogueLines | editor+ |
| `/dialogue-lines/{id}` | PATCH | updateDialogueLine | editor+ |
| `/dialogue-lines/{id}:synthesize` | POST | synthesizeDialogueLine | editor+ |
| `/episodes/{id}:batch-synthesize` | POST | batchSynthesizeEpisode | editor+ |
| `/voices` | GET | listVoices | viewer+ |
| `/voices/{id}:preview` | POST | previewVoice | viewer+ |

---

## 5. Render Queue（mockup 24）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/episodes/{id}/render-queue` | GET | getRenderQueue | editor+ |
| `/episodes/{id}:start-render` | POST | startEpisodeRender | editor+ |
| `/episodes/{id}:pause-render` | POST | pauseEpisodeRender | editor+ |
| `/episodes/{id}:retry-failed` | POST | retryFailedRenders | editor+ |
| `/runs/{id}` | GET | getRun | viewer+ |
| `/runs/{id}:cancel` | POST | cancelRun | editor+ |
| `/runs/{id}:retry` | POST | retryRun | editor+ |
| `/runs/{id}/events` | GET (SSE) | streamRunEvents | viewer+ |

---

## 6. Final Output / Publish（mockup 25）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/episodes/{id}:compose` | POST | composeEpisodeVideo | editor+ |
| `/episodes/{id}/final` | GET | getEpisodeFinal | editor+ |
| `/episodes/{id}/download` | GET (stream) | downloadEpisode | editor+ |
| `/episodes/{id}:external-publish` | POST | publishToExternalPlatform | editor+ |
| `/episodes/{id}/receipt` | GET | getEpisodeReceipt | editor+ |

**B 補齊 K 漏：** `getEpisodeReceipt` 之前 K 沒列。

---

## 7. Subjects — Character / Location / Prop（mockup 15/16/17）

### 7.1 Character

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/projects/{id}/characters` | GET | listCharacters | viewer+ |
| `/projects/{id}/characters` | POST | createCharacter | editor+ |
| `/characters/{id}` | PATCH | updateCharacter | editor+ |
| `/characters/{id}` | DELETE | deleteCharacter | editor+ |
| `/characters/{id}/appearances` | POST (multipart) | uploadCharacterAppearance | editor+ |
| `/characters/{id}:test-generate` | POST | testGenerateCharacter | editor+ |
| `/characters/{id}/usage` | GET | getCharacterUsage | viewer+ |
| `/characters/{id}:import` | POST | importCharacterFromProject | editor+ |

### 7.2 Location

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/projects/{id}/locations` | GET / POST | listLocations / createLocation | viewer+ / editor+ |
| `/locations/{id}` | PATCH / DELETE | updateLocation / deleteLocation | editor+ |
| `/locations/{id}/views` | POST | addLocationView | editor+ |
| `/locations/{id}/variants` | POST | addLocationVariant | editor+ |

### 7.3 Prop

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/projects/{id}/props` | GET / POST | listProps / createProp | viewer+ / editor+ |
| `/props/{id}` | PATCH / DELETE | updateProp / deleteProp | editor+ |
| `/props/{id}:bind-holder` | POST | bindPropHolder | editor+ |

---

## 8. Share / Public（mockup 31）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/projects/{id}:publish` | POST | publishProject | owner |
| `/v/{slug}` | GET (SSR) | getPublicShare | public |
| `/share/{slug}` | GET (JSON) | getPublicShareJson | public |
| `/share/{slug}:like` | POST | likePublicShare | signed-in |
| `/share/{slug}:clone` | POST | clonePublicShare | signed-in |
| `/share/{slug}/comments` | GET / POST | listComments / createComment | public / signed-in |
| `/comments/{id}` | DELETE | deleteComment | own + admin override |

**特例：** `/v/{slug}` 是 SSR HTML，`/share/{slug}` 是 JSON。前端用前者 SEO，CSR 用後者 fetch。

---

## 9. Discover / Showcase（mockup 32）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/discover/works` | GET | discoverWorks | public |
| `/discover/featured` | GET | discoverFeatured | public |
| `/discover/creators` | GET | discoverCreators | public |
| `/c/{handle}` | GET (SSR) | getCreatorProfile | public |
| `/creators/{handle}` | GET (JSON) | getCreatorProfileJson | public |
| `/creators/{handle}:follow` | POST | followCreator | signed-in |
| `/creators/{handle}:unfollow` | POST | unfollowCreator | signed-in |

---

## 10. Notifications（mockup 29）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/notifications` | GET | listNotifications | signed-in |
| `/notifications/unread-count` | GET | getUnreadCount | signed-in |
| `/notifications/{id}:read` | POST | markNotificationRead | signed-in |
| `/notifications:mark-all-read` | POST | markAllNotificationsRead | signed-in |
| `/notifications/{id}` | DELETE | deleteNotification | signed-in |
| `/users/me/notification-prefs` | GET / PATCH | getNotificationPrefs / updateNotificationPrefs | signed-in |
| `/push-subscriptions` | POST / DELETE | subscribeToPush / unsubscribeFromPush | signed-in |

---

## 11. Versions（mockup 30）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/panels/{id}/versions` | GET | listPanelVersions | viewer+ |
| `/panels/{id}/versions/{vid}:restore` | POST | restorePanelVersion | editor+ |
| `/panels/{id}/versions/{vid}:favorite` | POST | favoritePanelVersion | editor+ |
| `/panels/{id}/versions:compare` | GET | comparePanelVersions | viewer+ |

---

## 12. Users / Account（mockup 28）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/users/me` | GET / PATCH | getCurrentUser / updateCurrentUser | signed-in |
| `/users/me/avatar` | POST (multipart) | uploadAvatar | signed-in |
| `/users/me/language` | PATCH | updateUserLanguage | signed-in |
| `/users/me/password` | PATCH | changePassword | signed-in |
| `/users/me/api-keys` | GET / POST | listUserAPIKeys / createUserAPIKey | signed-in |
| `/users/me/api-keys/{id}` | DELETE | revokeUserAPIKey | signed-in |
| `/users/me:delete` | POST | deleteCurrentUser | signed-in |
| `/users/me:export` | POST | exportUserData | signed-in |

**新加（D-4 補）：** `/users/me:export` GDPR 資料匯出（QA H-4）。

---

## 13. Auth（mockup 19）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/auth/magic-link` | POST | magicLinkRequest | public |
| `/auth/magic-callback` | GET | magicLinkCallback | public |
| `/auth/oauth/{provider}` | GET | oauthStart | public |
| `/auth/oauth/{provider}/callback` | GET | oauthCallback | public |
| `/auth/password-login` | POST | passwordLogin | public |
| `/auth/signup` | POST | signup | public |
| `/auth/invite-request` | POST | requestInvite | public |
| `/auth/logout` | POST | logout | signed-in |

`{provider}` enum: `google` / `github` / `apple` / `wechat` / `feishu`

---

## 14. Workspace（mockup 20/36）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/workspaces` | GET | listWorkspaces | signed-in |
| `/workspaces` | POST | createWorkspace | signed-in |
| `/workspaces/{id}` | GET / PATCH | getWorkspace / updateWorkspace | admin+ |
| `/workspaces/{id}` | DELETE | deleteWorkspace | owner |
| `/workspaces/{id}/members` | GET | listWorkspaceMembers | admin+ |
| `/workspaces/{id}/invites` | POST | inviteToWorkspace | admin+ |
| `/workspaces/{id}/members/{userId}` | PATCH / DELETE | updateMemberRole / removeMember | admin+ |
| `/workspaces/{id}/billing` | GET | getWorkspaceBilling | admin+ / billing |
| `/workspaces/{id}:upgrade` | POST | upgradeWorkspacePlan | owner / billing |
| `/workspaces/{id}/audit-log` | GET | listAuditLog | admin+ |
| `/workspaces/{id}/api-keys` | GET / POST | listWorkspaceAPIKeys / createWorkspaceAPIKey | admin+ |
| `/workspaces/{id}/api-keys/{kid}` | DELETE | revokeWorkspaceAPIKey | admin+ |
| `/workspaces/{id}/edit-requests` | GET | listEditRequests | admin+ |
| `/workspaces/{id}/edit-requests` | POST | createEditRequest | commenter+ |
| `/edit-requests/{id}:approve` | POST | approveEditRequest | admin+ |
| `/edit-requests/{id}:deny` | POST | denyEditRequest | admin+ |
| `/edit-requests/{id}:revoke` | POST | revokeEditRequest | admin+ |
| `/workspaces/{id}/providers` | GET / PUT | listProviderConfigs / updateProviderConfigs | admin+ |
| `/workspaces/{id}/integrations` | GET / POST | listIntegrations / createIntegration | admin+ |
| `/integrations/{id}` | PATCH / DELETE | updateIntegration / deleteIntegration | admin+ |

---

## 15. Admin / System（mockup 18）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/admin/kpi` | GET | getAdminKPI | system-admin |
| `/admin/runs` | GET | listAdminRuns | system-admin |
| `/admin/runs/{id}` | GET | getAdminRunDetail | system-admin |
| `/admin/runs/{id}:retry` | POST | adminRetryRun | system-admin |
| `/admin/providers` | GET | listAdminProviders | system-admin |
| `/admin/queue-health` | GET | getQueueHealth | system-admin |
| `/admin/credit-breakdown` | GET | getCreditBreakdown | system-admin |
| `/admin/users/{id}:impersonate` | POST | impersonateUser | system-admin（audit）|

---

## 16. Onboarding（mockup 26）

| Canonical Path | Method | OperationId | Auth |
|---|---|---|---|
| `/onboarding/state` | GET | getOnboardingState | signed-in |
| `/onboarding/steps/{n}` | POST | completeOnboardingStep | signed-in |
| `/onboarding:skip` | POST | skipOnboarding | signed-in |
| `/onboarding:complete` | POST | completeOnboarding | signed-in |

---

## 17. Webhooks（外部進來）

| Canonical Path | Method | OperationId | 來源 |
|---|---|---|---|
| `/webhook/stripe` | POST | stripeWebhook | Stripe（signature header）|
| `/webhook/provider/{name}` | POST | providerCallback | ark / atlascloud / fal / bobapi / tencent |
| `/webhook/email/bounce` | POST | emailBounceWebhook | Resend / Postmark |
| `/webhook/email/complaint` | POST | emailComplaintWebhook | Resend / Postmark |
| `/webhook/social-publish/{platform}` | POST | socialPublishCallback | douyin / xhs / ig / yt / tiktok |

---

## 18. 差異報告（B vs Q）

### 18.1 B 有 Q 砍掉

無 — Q 完全包含 B 所有 endpoint，只是改路徑慣例。

### 18.2 Q 補齊 B 漏

- `/users/me:export`（GDPR）
- `/comments/{id}` DELETE（B 沒列）
- `/integrations/{id}` PATCH / DELETE（B 沒列）
- `/workspaces/{id}/providers` GET / PUT（B 沒列）
- `/admin/users/{id}:impersonate`（B 沒列 system admin 動作）
- `/episodes/{id}` DELETE（B 沒列）
- `/scripts/{id}:confirm`（B 用 `/api/script/{id}/confirm`，慣例對齊）
- `/webhook/email/complaint`（B 只列 bounce）
- `/webhook/social-publish/{platform}`（B 完全沒列發布 callback）

### 18.3 路徑慣例修正（B → Q 對照表）

| B 舊 | Q 新 | 改動 |
|---|---|---|
| `/api/panel/{id}` | `/panels/{id}` | 複數 + 去 `/api` 前綴 |
| `/api/panel/{id}/regenerate` | `/panels/{id}:regenerate` | colon action |
| `/api/panel/bulk-regenerate` | `/panels:bulk-regenerate` | colon collection action |
| `/api/episode/{id}/render-queue` | `/episodes/{id}/render-queue` | 複數 |
| `/api/episode/{id}/start-render` | `/episodes/{id}:start-render` | colon action（動詞）|
| `/api/run/{id}/cancel` | `/runs/{id}:cancel` | colon |
| `/api/character/{id}/test-generate` | `/characters/{id}:test-generate` | colon |
| `/api/character/{id}/import-from` | `/characters/{id}:import` | 簡化命名 |
| `/api/project/{id}/publish` | `/projects/{id}:publish` | colon |
| `/api/share/{slug}/clone` | `/share/{slug}:clone` | colon |
| `/api/share/{slug}/like` | `/share/{slug}:like` | colon |
| `/api/notifications/{id}/read` | `/notifications/{id}:read` | colon |
| `/api/notifications/mark-all-read` | `/notifications:mark-all-read` | colon collection |
| `/api/user/me` | `/users/me` | 複數 |
| `/api/workspace/{id}` | `/workspaces/{id}` | 複數 |
| `/api/workspace/{id}/invite` | `/workspaces/{id}/invites` | 複數 + sub-resource |
| `/api/workspace/{id}/upgrade` | `/workspaces/{id}:upgrade` | colon |
| `/api/workspace/{id}/audit-log` | `/workspaces/{id}/audit-log` | 複數 |
| `/api/onboarding/skip` | `/onboarding:skip` | colon |
| `/api/onboarding/complete` | `/onboarding:complete` | colon |
| `/api/onboarding/step/{n}` | `/onboarding/steps/{n}` | 複數 |
| `/api/panel/{id}/versions` | `/panels/{id}/versions` | 複數 |
| `/api/panel/{id}/versions/{vid}/restore` | `/panels/{id}/versions/{vid}:restore` | colon |
| `/api/episode/{id}/compose` | `/episodes/{id}:compose` | colon |
| `/api/episode/{id}/download` | `/episodes/{id}/download` | 複數（保留 GET 動詞 path 給 stream）|
| `/api/episode/{id}/publish` | `/episodes/{id}:external-publish` | colon + 改名（區分 project.publish）|

**~30 條路徑改動。** 後端 route 要全改，前端因走 codegen 自動換。

---

## 19. Path 設計檢查表（之後加新 endpoint 必過）

開新 endpoint 前先勾：

- [ ] 資源名稱用**複數**（`/panels` not `/panel`）
- [ ] 是 CRUD？用 HTTP method（GET/POST/PATCH/DELETE），路徑不帶動詞
- [ ] 是動作？用 `:verb` colon action
- [ ] 是批次動作？用 `/resource:bulk-verb` 集合 action
- [ ] 子資源用 `/parent/{id}/children`（複數）
- [ ] 啟動類動作（POST 回 Run）→ 加 `Idempotency-Key` parameter
- [ ] 公開（無 auth）→ `security: []` 明示
- [ ] 需 workspace 上下文 → 加 `X-Workspace-Id` header parameter
- [ ] OperationId 用 camelCase 動詞開頭（`listX` / `getX` / `createX` / `updateX` / `deleteX` / `regenerateX`）
- [ ] Tag 對齊 K openapi 18 個 tag 之一
- [ ] 同步更新本 Q 文件 + K-openapi.yaml + B-api-endpoints.md（B 加 reference 不重覆寫詳細）

---

## 20. 三方對齊狀態

| 文件 | 狀態 | 待辦 |
|---|---|---|
| Q（本檔）| ✅ canonical | — |
| K-openapi.yaml | 🔧 部分對齊（高槓桿 25 endpoint 已寫，96 summary-only 部分需補慣例）| Phase 4 開工前 sed 批次改 |
| B-api-endpoints.md | ⚠️ 全文用舊慣例 | 標記「**已被 Q 取代** — 路徑詳見 Q」並保留作 mockup-to-endpoint 對映參考 |

---

**下一份：** N (security baseline) / O (responsive + 13 拆 component) / P (M 補強情境)
