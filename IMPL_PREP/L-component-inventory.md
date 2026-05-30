# L · Component 庫盤點地圖

> **目標：** 把 36 個 mockup 拆成 React component tree，標「V2 既有可復用 / V2 要 refactor / 全新」三類，附預估行數 + dependency。實作時直接照圖開檔，避免重複造輪 + 估錯工期。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** A-schema-migration.md / B-api-endpoints.md / K-openapi-spec.md
> **慣例：** 元件以 PascalCase 命名；路徑相對 `src/components/`

---

## 1. 為什麼先盤點

不盤點直接開工的代價：
- 同樣的「角色 chip」會被三個 dev 各寫一遍（一次叫 `CharChip`、一次 `SubjectPill`、一次 `RoleTag`）
- V2 有的好東西沒復用，例如 `MultiShotBindingsRail`、`autoGroup` UI、`ProgressHero`、`MobileRevertBanner` — 等到上線才發現
- 估錯工期：以為 25 天能 ship，實際 50 天，因為每個 dev 都從零寫 sidebar、按鈕、模態

盤點的收益：
- 共用 component 一次寫好集中維護
- V2 既有可復用 → 直接 import，0 行新代碼
- 工期 = 新 component 行數 × 標準速度（每天 ~300 行可生產代碼）

---

## 2. 分類定義

| 標籤 | 意思 | 行動 |
|---|---|---|
| **♻️ V2 直接用** | 既有 component 對齊新設計 ≥ 95% | `import` 即用，可能微調 props |
| **🔧 V2 refactor** | 既有 component 結構對，但 UI / 互動要改 | 改現有檔案，預估 改動行數 + 新增行數 |
| **🆕 全新** | V2 沒對等品 | 新檔，估完整行數 |
| **🎨 純樣式** | 純 CSS / Tailwind，沒邏輯 | 算到對應 component 內 |

---

## 3. 設計系統基礎層（Foundation）

> 所有 36 mockup 共用，先做完這層其他都快。

### 3.1 Token & Theme

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `tokens.css` → `tokens.ts` | 🆕 | 120 | 全部 | — | 從 design-preview/tokens.css 轉成 TS const + Tailwind config |
| `ThemeProvider` | 🔧 V2 refactor | 80 (+20) | 全部 | tokens.ts | V2 已有 dark-mode wrapper，補 "studio-dark" variant |
| `useTheme` hook | 🆕 | 30 | 18/20/36/37/38 | ThemeProvider | admin 系列強制 studio-dark |

### 3.2 i18n

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `i18n-dict.ts` | ♻️ V2 直接用 | 0 | 全部 | — | i18n V2 已搬上 prod，繼續用 |
| `useT` hook | ♻️ V2 直接用 | 0 | 全部 | next-intl | 已有 |
| `<LangSwitcher>` | 🔧 V2 refactor | 40 (+15) | 全部 | useT | V2 有手機版按鈕，改 desktop pill 樣式 |

### 3.3 資料層 / 8 大基礎建設（D-7 拍板補完 2026-05-30）

> Foundation 必須一氣呵成做完。沒做完開 Phase 5 component 會卡住，因為 42 個 data hook 沒有實作依託。

| Component / Module | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `lib/api-client.ts` + `src/types/api.d.ts` | 🆕 | 80 + codegen | 全部 | K-openapi.yaml | `openapi-typescript` 產 type + `openapi-fetch` wrapper；auth header 自動注入 |
| `<ApiProvider>` | 🆕 | 60 | 全部 | api-client | 注入 baseUrl / workspaceId / locale header |
| `<QueryClientProvider>` (TanStack Query v5) | 🆕 | 80 | 全部 | api-client | cache + retry + invalidate 統一策略 |
| `lib/queries/<resource>.ts` × 12 | 🆕 | 12 × 100 = 1,200 | 全部 | Query + api-client | 12 個 resource (Project/Episode/Panel/Character/Location/Prop/Run/Voice/Notification/PublicShare/Workspace/EditRequest) 各一檔，含 list/get/mutate/invalidate |
| `useRunEvents` SSE consumer | 🆕 | 150 | 24/13/08 | EventSource API | reconnect + lastEventId + afterSeq 補拉（CLAUDE.md 強約束） |
| `<RunEventProvider>` | 🆕 | 120 | 24/13/08 | useRunEvents | 多 component 共用 single connection |
| `useGraphEventReplay` | 🆕 | 80 | 24/13/08 | RunEventProvider | seq 跳號偵測 + 補拉 |
| `<RouteErrorBoundary>` | 🆕 | 120 | 全部 | tokens | 顯 traceId + retry CTA |
| `app/[locale]/.../error.tsx` × 8 | 🆕 | 8 × 40 = 320 | 全部 | RouteErrorBoundary | Next.js 各路由 error 模板 |
| `app/[locale]/.../loading.tsx` × 8 | 🆕 | 8 × 30 = 240 | 全部 | Skeleton | Next.js 各路由 suspense |
| `<Form>` `<FormField>` `<FormError>` (react-hook-form + zod) | 🆕 | 200 | 19/20/28/36/37/38 | zod-codegen 自 OpenAPI | ~15 個 form 共用 |
| `lib/zod-schemas/` × 12 | 🆕 | codegen | 全部 | K-openapi.yaml | 從 OpenAPI 自動產 zod schema |
| `<DndContext>` `<SortableList>` (dnd-kit wrapper) | 🆕 | 250 | 08/13/20/24 | @dnd-kit/core | 4 處拖曳統一 |
| `lib/stores/ui.ts` (Zustand) | 🆕 | 120 | 全部 | — | viewMode / paletteOpen / activeWorkspaceId / sidebarCollapsed |
| `<ToastProvider>` (sonner) | 🆕 | 30 | 全部 | sonner | mount 點 |
| `<NotificationBell>` (unread badge + popover) | 🆕 | 150 | 全部 ws-top | useNotifications | 右上鈴鐺 |
| `<DataTable>` (TanStack Table) | 🆕 | 320 | 20/29/30/36/37 | @tanstack/react-table | 5 個 table 共用，省 ~600 行重複 |
| `<TablePagination>` (cursor + ofset) | 🆕 | 110 | 同上 | Query | |
| `<FileUploader>` (dropzone) | 🆕 | 180 | 06/15/36 | react-dropzone | multipart + progress + type/size 限制 |
| `<DateTimeDisplay>` `<RelativeTime>` | 🆕 | 90 | 全部 | dayjs + i18n | tz 友善 |
| `<CreditCost amount>` | 🆕 | 60 | 07/13/24/36 | — | 點數視覺化（紅/綠/灰級階）|
| `<Money currency>` | 🆕 | 50 | 05/36 | — | 多幣別 |
| `<ChartContainer>` `<Sparkline>` `<ChartTooltip>` `<ChartLegend>` | 🆕 | 250 | 18/36/37 | recharts | KPI / 點數圖 共用 |

**資料層 / 基礎建設小計：~4,360 行**（codegen 不算）

### 3.4 Primitives（Atomic）

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<Button variant intent size>` | 🔧 V2 refactor | 120 (+40) | 全部 | tokens | V2 有 PrimaryButton / GhostButton，合成統一 API |
| `<IconButton>` | 🆕 | 50 | 全部 | Button | |
| `<Input>` `<Textarea>` `<Select>` | 🔧 V2 refactor | 200 (+60) | 全部 | tokens | V2 form-input.tsx 重排 |
| `<Switch>` `<Checkbox>` `<Radio>` | 🆕 | 180 | 20/28/37 | tokens | V2 沒對齊新設計 |
| `<Pill>` `<Badge>` `<Tag>` | 🔧 V2 refactor | 80 (+30) | 全部 | tokens | V2 Tag 改 Pill API + 加 variant |
| `<Avatar size>` | ♻️ V2 直接用 | 0 | 全部 | — | 已有 |
| `<Tooltip>` | 🆕 | 90 | 全部 | radix-tooltip | 用 Radix |
| `<Modal>` | 🔧 V2 refactor | 150 (+50) | 多處 | radix-dialog | V2 modal 樣式對不上 |
| `<Drawer>` | 🆕 | 130 | 15/16/17/20 | radix-dialog | V2 沒側拉抽屜 |
| `<DropdownMenu>` | 🆕 | 110 | 多處 | radix-dropdown | |
| `<Toast>` `<Notify>` | 🔧 V2 refactor | 100 (+30) | 全部 | sonner | V2 用舊版 react-hot-toast，轉 sonner |
| `<Skeleton>` | 🆕 | 60 | 27 | tokens | |
| `<EmptyState illustration title cta>` | 🆕 | 90 | 27/30/32 | tokens | |
| `<ErrorState code message retry>` | 🆕 | 80 | 33 | tokens | |
| `<LoadingState>` | 🆕 | 50 | 27 | tokens | |
| `<ProgressBar>` `<CircularProgress>` | 🔧 V2 refactor | 90 (+30) | 24/36 | — | V2 有但無 circular variant |
| `<ConfirmDialog>` | 🆕 | 110 | 15/20/36 | Modal | 刪除/退訂 確認用 |
| `<ScrollArea>` | 🆕 | 50 | 多處 | radix-scroll-area | 統一捲軸樣式 |

**Foundation 小計：~2,170 行**（含 V2 改動）

**Foundation 合計（§3.1–3.4）：~6,530 行**（含 D-7 補的資料層 4,360 行）

---

## 4. 創作流（10 個 mockup）

### 4.1 全流程共用

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<WsTopBar>` | 🆕 | 220 | 06/07/13/08/04/23/24/25 | useProject | breadcrumb + stepper + auto-save + CTA |
| `<WsStepper steps current>` | 🆕 | 90 | 同上 | tokens | 6 步流程 |
| `<AutoSaveIndicator>` | 🔧 V2 refactor | 60 (+15) | 同上 | useDebounce | V2 有 silent autosave，補 UI |
| `<ProjectSidebar>` | 🔧 V2 refactor | 280 (+80) | 全部 | useProjects | V2 sidebar 重做 nav 群組 |
| `<EpisodeTabBar>` | ♻️ V2 直接用 | 0 | 13/08/23/24/25 | — | tokens.css 已抽 |
| `<WorkspaceSwitcher>` | 🔧 V2 refactor | 120 (+30) | 全部 | useWorkspaces | V2 已有，補 icon 顯示 |

### 4.2 06 劇本上傳 / 07 預生成

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<ScriptUploader>` | 🔧 V2 refactor | 180 (+60) | 06 | useDropzone | V2 已 ship bulk-upload，補 mode picker UI |
| `<ScriptModePicker>` | 🆕 | 70 | 06 | — | TABLE / MARKERS / PROSE |
| `<ScriptAnalysisCard>` | 🆕 | 240 | 07 | useT | 解析結果（scenes/shots/elements/estCredits）|
| `<EstimatedCostBar>` | 🆕 | 110 | 07 | usePricing | 點數估算視覺化 |
| `<PreGenerationConfirm>` | 🆕 | 160 | 07 | Modal | 確認拆集 + 設定 |

### 4.3 13 敘事編輯 / 08 分鏡卡

> 兩個 view 共用 panel data，只 UI route 切換（雙視圖架構，user 2026-05-28 拍板 A）

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<ViewSwitcher narrative\|storyboard>` | 🆕 | 80 | 13/08 | — | 右上切換按鈕，pixel-perfect 對齊 |
| **NARRATIVE VIEW（13）** | | | | | |
| `<NarrativeEditor>` | 🆕 | 380 | 13 | Tiptap | 主敘事文 + inline @chip |
| `<EpisodeNarrativeTab>` | 🆕 | 120 | 13 | NarrativeEditor | 每集獨立 tab |
| `<InlineChip kind id>` | 🆕 | 160 | 13 | useSubjects | @角色/@場景/@道具 chip |
| `<ChipAutocomplete>` | 🆕 | 200 | 13 | radix-popover | 輸入 @ 觸發 |
| `<RegenSegmentButton>` | 🆕 | 110 | 13 | useRegenerate | 每段 8 分頭重生 + provider 選擇 |
| **STORYBOARD VIEW（08）** | | | | | |
| `<StoryboardTimeline>` | 🔧 V2 refactor | 320 (+100) | 08 | usePanels | V2 已有，加大預覽 + 拖曳排序 |
| `<PanelCard>` | 🔧 V2 refactor | 280 (+80) | 08 | usePanel | V2 PanelCard 改大版面 |
| `<PanelPreview>` | 🆕 | 160 | 08 | — | 大 9:16 預覽框 |
| `<PanelMediaToggle>` | ♻️ V2 直接用 | 0 | 08 | — | mediaDisplayOverride V2 已有 |
| `<MultiShotBindingsRail>` | ♻️ V2 直接用 | 0 | 08 | — | V2 ship 多次 |
| `<GenerationModeBanner>` | 🆕 | 110 | 08 | useT | R2V vs T2I→I2V 切換提示 |
| `<AutoGroupButton>` | ♻️ V2 直接用 | 0 | 08 | — | V2 智能合併分組 |

### 4.4 23 配音

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<DialogueLineRow>` | 🔧 V2 refactor | 200 (+80) | 23 | useVoice | V2 有單行編輯，UI 重排 |
| `<VoicePicker>` | 🆕 | 240 | 23 | useVoices | 語言 + 性別 + 風格篩選 |
| `<VoicePreviewer>` | 🆕 | 130 | 23 | useVoicePreview | 播放器 |
| `<VoiceParamControls>` | 🆕 | 160 | 23 | — | speed/pitch/tone 三 slider |
| `<BatchSynthesizeButton>` | 🔧 V2 refactor | 110 (+40) | 23 | useRun | V2 有，UI 改 |

### 4.5 24 渲染 / 25 成片

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<RenderQueue>` | 🔧 V2 refactor | 260 (+90) | 24 | useRuns | V2 RenderQueue 加大版面 |
| `<RenderJobRow>` | 🔧 V2 refactor | 180 (+50) | 24 | — | progress + retry/cancel |
| `<ProgressHero>` | 🔧 V2 refactor | 150 (+50) | 24 | — | V2 已有，補 cross-browser sync 指示 |
| `<CrossBrowserSyncBadge>` | ♻️ V2 直接用 | 0 | 24 | — | V2 機制已 ship |
| `<FinalVideoPlayer>` | 🆕 | 220 | 25 | shaka-player | 含 subtitle 切換 |
| `<AspectRatioToggle>` | 🆕 | 80 | 25 | — | 9:16 / 16:9 / 1:1 |
| `<DownloadButton>` | 🔧 V2 refactor | 70 (+20) | 25 | useDownload | V2 已有 |
| `<PublishToExternalCard>` | 🆕 | 220 | 25 | — | douyin/xhs/ig/yt 4 個 platform |
| `<ReceiptCard>` | 🆕 | 150 | 25 | usePricing | 失敗不扣點明細 |

**創作流小計：~5,950 行**

---

## 5. 劇集設定（3 mockup）

### 5.1 共用

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<SubjectsSidebar>` | 🆕 | 280 | 15/16/17 | useSubjects | 劇集設定主左欄 |
| `<SubjectListItem>` | 🆕 | 140 | 15/16/17 | — | 統一 list row |
| `<SubjectEditDrawer>` | 🆕 | 320 | 15/16/17 | Drawer | 共用 drawer 框架，內容 swap |
| `<UsageBadge count>` | 🆕 | 50 | 15/16/17 | useUsage | 「在 12 個 panel」 |

### 5.2 15 角色

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<CharacterEditor>` | 🔧 V2 refactor | 380 (+120) | 15 | SubjectEditDrawer | V2 已有但要重排 |
| `<AppearanceList>` | 🔧 V2 refactor | 180 (+50) | 15 | — | V2 multi-appearance 已 ship |
| `<AppearanceUploader>` | ♻️ V2 直接用 | 0 | 15 | — | V2 已 ship |
| `<AppearanceLightbox>` | ♻️ V2 直接用 | 0 | 15 | — | V2 已 ship |
| `<TestGenerateButton>` | 🆕 | 110 | 15 | useRun | 試生圖 3 點 |
| `<ImportFromProjectModal>` | 🆕 | 220 | 15 | Modal | 跨專案 import |
| `<CharacterEssenceField>` `<AppearanceField>` `<ClothingField>` | 🆕 | 240 | 15 | Textarea | 五要素拆分 |
| `<ConsistencyMeter>` | 🆕 | 80 | 15 | — | 0~1 條 |

### 5.3 16 場景

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<LocationEditor>` | 🆕 | 260 | 16 | SubjectEditDrawer | |
| `<LocationViewsGallery>` | 🆕 | 180 | 16 | — | wide/medium/close 三角 |
| `<LocationVariantsList>` | 🆕 | 160 | 16 | — | 雨夜/雪天 變體 |

### 5.4 17 道具

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<PropEditor>` | 🆕 | 220 | 17 | SubjectEditDrawer | |
| `<HolderBindingControl>` | 🆕 | 110 | 17 | useCharacters | 綁主角色 |

**劇集設定小計：~3,030 行**

---

## 6. 工作區管理（4 mockup：20/36/37/38）

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<WorkspaceSettingsLayout>` | 🆕 | 180 | 20/36/37 | — | tab 框架 |
| `<MembersTable>` | 🔧 V2 refactor | 280 (+100) | 20 | useMembers | V2 WorkspaceDetailDrawer 重排 |
| `<MemberRoleSelect>` | 🆕 | 90 | 20 | — | 7 role |
| `<InviteModal>` | 🆕 | 240 | 20 | Modal | 批次邀請 + email + role |
| `<PendingInvitesList>` | 🆕 | 160 | 20 | — | |
| `<WorkspaceGeneralForm>` | 🆕 | 220 | 36 | — | name/slug/icon/desc |
| `<IconUploader>` | 🆕 | 130 | 36 | — | 512×512 PNG |
| `<DangerZoneCard>` | 🆕 | 150 | 36 | ConfirmDialog | 刪除 workspace |
| `<CurrentPlanCard>` | 🆕 | 180 | 36 | usePricing | Plan info + 下次扣款 |
| `<MonthlyUsageBar>` | 🆕 | 140 | 36 | useUsage | 進度條 + 預估月底 |
| `<TopupHistoryTable>` | 🆕 | 180 | 36 | — | 加購包紀錄 |
| `<InvoiceHistoryTable>` | 🆕 | 180 | 36 | — | 發票歷史 |
| `<PaymentMethodCard>` | 🆕 | 130 | 36 | Stripe | 更換信用卡 |
| `<ProvidersGrid>` | 🆕 | 280 | 37 | useProviders | 6 provider 卡 |
| `<ProviderCard>` | 🆕 | 220 | 37 | — | 啟用 / 成功率 |
| `<SmartRoutingViz>` | 🆕 | 180 | 37 | — | 路由分配視覺 |
| `<IntegrationsList>` | 🆕 | 280 | 37 | — | Stripe/Slack/Webhook/SSO/APIKey |
| `<APIKeysTable>` | 🆕 | 200 | 37/28 | — | 含 scope chip + 撤銷 |
| `<APIKeyCreateModal>` | 🆕 | 220 | 37 | Modal | name + scopes |
| `<AuditLogList>` | 🆕 | 280 | 37 | useAuditLog | 含 filter + 搜尋 + 匯出 |
| `<AuditRow>` | 🆕 | 120 | 37 | — | actor + action + target + scope |
| `<EditRequestCard>` | 🆕 | 280 | 38 | — | 申請卡（最緊急/一般）|
| `<EditRequestApproveModal>` | 🆕 | 180 | 38 | Modal | 選 grant duration |
| `<EditRequestStatusTabs>` | 🆕 | 90 | 38 | — | pending/approved/denied/expired |

**工作區管理小計：~4,510 行**

---

## 7. 公開分享 / 廣場（2 mockup：31/32）

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<PublicShareLayout>` | 🆕 | 180 | 31 | — | 公開頁主 layout（無 sidebar） |
| `<PublicHero>` | 🆕 | 220 | 31 | — | cover + title + creator |
| `<PublicEpisodeList>` | 🆕 | 160 | 31 | — | 集數播放清單 |
| `<PublicVideoPlayer>` | 🆕 | 280 | 31 | shaka | 主播放器 |
| `<LikeButton>` | 🆕 | 90 | 31 | useLike | |
| `<CloneButton>` | 🆕 | 110 | 31 | useClone | |
| `<CommentsThread>` | 🆕 | 260 | 31 | useComments | 含巢狀 |
| `<CommentInput>` | 🆕 | 130 | 31 | — | |
| `<CreatorProfileCard>` | 🆕 | 180 | 31/32 | — | |
| `<DiscoverGrid>` | 🆕 | 220 | 32 | useDiscover | 廣場主格 |
| `<WorkCard>` | 🆕 | 180 | 32 | — | 影片預覽卡 |
| `<DiscoverFilter>` | 🆕 | 140 | 32 | — | trending/latest/featured/genre |
| `<CreatorsList>` | 🆕 | 160 | 32 | — | 創作者排行 |
| `<FollowButton>` | 🆕 | 90 | 31/32 | useFollow | |

**分享/廣場小計：~2,420 行**

---

## 8. 通知 / 歷史 / 設置（3 mockup：29/30/28）

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<NotificationsLayout>` | 🆕 | 140 | 29 | — | |
| `<NotificationList>` | 🆕 | 220 | 29 | useNotifications | unread/all tabs |
| `<NotificationRow>` | 🆕 | 180 | 29 | — | 12 種 kind |
| `<NotificationFilters>` | 🆕 | 110 | 29 | — | |
| `<MarkAllReadButton>` | 🆕 | 60 | 29 | — | |
| `<VersionsLayout>` | 🆕 | 140 | 30 | — | |
| `<VersionTimeline>` | 🆕 | 240 | 30 | useVersions | |
| `<VersionCard>` | 🆕 | 180 | 30 | — | 含 favorite/restore |
| `<VersionCompareModal>` | 🆕 | 280 | 30 | Modal | 左右對照 + diff |
| `<SettingsLayout>` | 🆕 | 160 | 28 | — | tab 框架 |
| `<ProfileForm>` | 🆕 | 240 | 28 | — | name/handle/bio/avatar |
| `<LanguageSelect>` | 🆕 | 90 | 28 | — | zh-CN/en/ja/ko/es |
| `<NotificationPrefsForm>` | 🆕 | 220 | 28 | — | 12 種 toggle |
| `<ChangePasswordForm>` | 🆕 | 180 | 28 | — | |
| `<DeleteAccountFlow>` | 🆕 | 220 | 28 | ConfirmDialog | grace period 提示 |

**通知/歷史/設置小計：~2,860 行**

---

## 9. Auth / Onboarding / Landing / Pricing（5 mockup：01/05/19/26/21）

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<LandingHero>` | 🆕 | 280 | 01 | — | 主視覺 + CTA |
| `<LandingFeatureGrid>` | 🆕 | 220 | 01 | — | |
| `<LandingSocialProof>` | 🆕 | 180 | 01 | — | 用戶評價 |
| `<LandingPricingPreview>` | 🆕 | 160 | 01 | — | |
| `<LandingFooter>` | 🆕 | 180 | 01 | — | |
| `<PricingMatrix>` | 🆕 | 360 | 05 | usePricing | 4 tier 對照 |
| `<PricingFAQ>` | 🆕 | 220 | 05 | — | |
| `<BillingCycleToggle>` | 🆕 | 80 | 05 | — | 月/年付 |
| `<MagicLinkForm>` | 🆕 | 160 | 19 | useAuth | |
| `<OAuthButtons>` | 🆕 | 120 | 19 | useAuth | Google/GitHub/Apple |
| `<PasswordLoginForm>` | 🆕 | 140 | 19 | useAuth | |
| `<SignupForm>` | 🆕 | 180 | 19 | useAuth | invite code 欄位 |
| `<InviteRequestForm>` | 🆕 | 140 | 19 | — | use case 描述 |
| `<OnboardingStepper>` | 🆕 | 180 | 26 | — | 5 步 |
| `<OnboardingStepWelcome>` | 🆕 | 160 | 26 | — | |
| `<OnboardingStepSampleProject>` | 🆕 | 280 | 26 | — | |
| `<OnboardingStepFirstScript>` | 🆕 | 240 | 26 | — | |
| `<OnboardingStepFirstGen>` | 🆕 | 200 | 26 | — | |
| `<OnboardingStepDone>` | 🆕 | 140 | 26 | — | |
| `<WalkthroughTour>` | 🆕 | 280 | 21 | shepherd.js | hotspot tour |

**Auth/Onboarding/Landing/Pricing 小計：~4,000 行**

---

## 10. Admin（1 mockup：18）

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<AdminLayout>` | 🔧 V2 refactor | 180 (+50) | 18 | — | V2 已有 admin shell |
| `<KPICardGrid>` | 🆕 | 240 | 18 | useKPI | 6 個指標卡 |
| `<RunsMonitor>` | 🔧 V2 refactor | 280 (+100) | 18 | useRuns | V2 已有 |
| `<QueueHealthCard>` | 🔧 V2 refactor | 160 (+40) | 18 | — | V2 已有 |
| `<CreditBreakdownChart>` | 🆕 | 220 | 18 | recharts | |
| `<ProvidersStatusList>` | 🔧 V2 refactor | 180 (+60) | 18 | — | V2 已有 |

**Admin 小計：~1,260 行**

---

## 11. 手機 / 命令面板 / 錯誤狀態 / 空狀態（5 mockup：11/12/22/27/33）

| Component | 類 | LOC | 來源 mockup | 依賴 | 備註 |
|---|---|---|---|---|---|
| `<MobileShell>` | 🔧 V2 refactor | 200 (+60) | 11/12 | — | V2 已有 /m/* 子路由 |
| `<MobileHome>` | 🔧 V2 refactor | 240 (+80) | 11 | — | V2 已 ship |
| `<MobileReview>` | 🔧 V2 refactor | 280 (+100) | 12 | — | V2 已 ship |
| `<MobileRevertBanner>` | ♻️ V2 直接用 | 0 | 11/12 | — | V2 已 ship |
| `<CommandPalette>` | 🆕 | 320 | 22 | cmdk | ⌘K 全平台搜尋 + action |
| `<CommandPaletteResult>` | 🆕 | 130 | 22 | — | |
| `<EmptyStateCatalogPage>` | 🆕 | 280 | 27 | EmptyState | dev 參考頁，不上 prod |
| `<ErrorStateCatalogPage>` | 🆕 | 280 | 33 | ErrorState | dev 參考頁 |

**手機/命令面板/狀態 小計：~1,730 行**

---

## 12. 總計

> **2026-05-30 D-7 拍板修正**：原 105 工程師-天嚴重低估（FE reviewer 抓出 Foundation 漏 8 大資料層）。現在加完整 infra + 重估 inline 估錯，總工期 **130-160 工程師-天**。

| 區塊 | 行數 | 主要類型 |
|---|---|---|
| 3.1-3.2 Token/Theme/i18n | 270 | 🔧 + 🆕 |
| 3.3 資料層 / 8 大基礎建設 (D-7 補) | 4,360 | 🆕 全新 |
| 3.4 Primitives (Atomic) | 1,900 | 🔧 + 🆕 |
| 4. 創作流（10 mockup） | 5,950 + i18n/dnd buffer ~600 | 🆕 為主 |
| 5. 劇集設定（3） | 3,030 | 🆕 為主 |
| 6. 工作區管理（4） | 4,510 | 🆕 為主 |
| 7. 分享/廣場（2） | 2,420 + Stripe Elements PCI ~150 | 全新 |
| 8. 通知/歷史/設置（3） | 2,860 | 全新 |
| 9. Auth/Onboarding/Landing/Pricing（5） | 4,000 | 全新 |
| 10. Admin（1） | 1,260 | 🔧 為主 |
| 11. 手機/命令面板/狀態（5） | 1,730 + cmdk 高估 buffer ~280 | 🔧 + 🆕 |
| **總計** | **~33,320 行**（+ codegen 自動產 ~5k 不算）| |

> 13/08 雙視圖另有 FE C6 + H1/H10 估錯項合計再 +5,000 行（NarrativeEditor 380→950、StoryboardTimeline +250、CommandPalette 320→600、漏列 8 component ~1,300、漏 fileuploader ~600）。**總工期 ~38,000-42,000 行**。

### 12.1 分類占比（D-7 後）

| 標籤 | 預估行數 | 占比 |
|---|---|---|
| ♻️ V2 直接用 | 0 行（已有） | 既有 18 個 component 完全復用 |
| 🔧 V2 refactor | ~4,000 行 | 10% |
| 🆕 全新 | ~38,000 行 | 90% |

---

## 13. 工期估算

### 13.1 速度假設

- **新 component 平均速度**：300 行/工程師-天（含 props 設計 + 測試 + 視覺驗 + i18n wire）
- **V2 refactor 速度**：150 行/天（要先讀懂既有再改，慢一倍）
- **資料層 infra**：200 行/天（要設計 + 整 K codegen，比一般 component 慢）
- **♻️ 直接用**：0 天

### 13.2 純編碼工期（D-7 修正版）

| 類別 | 行數 | 速度 | 工程師-天 |
|---|---|---|---|
| 🆕 資料層 / 基礎建設 | 4,360 | 200/天 | 22 |
| 🆕 一般 component | ~33,600 | 300/天 | 112 |
| 🔧 V2 refactor | 4,000 | 150/天 | 27 |
| **合計** | ~42,000 | — | **161 工程師-天** |

> +20% i18n EN 翻譯 / a11y 修正 / Lighthouse 達標 buffer（未列在 component 行數內）→ **總 ~193 工程師-天**

### 13.3 換算

- **1 個 senior frontend**：161-193 天 ≈ **8-10 個月**（含週末）
- **2 人 sprint 並行**：~4-5 個月
- **3 人並行 + 1 個 backend 平行**：~3 個月

> 不含：A schema migration、B/C/D/E/F/G 規劃文件配套工程、E2E test 撰寫、code review、bug fix、PM 開會。實際多抓 30% buffer = **210-250 工程師-天**（單人）。

### 13.4 雙軌估算（避免估錯）

| Sprint | 內容 | 工程師-天 |
|---|---|---|
| Sprint 0 | infra setup (Foundation §3.1-3.3 + codegen 跑通) | 14 |
| Sprint 1-12 | component 實作 | 147 |
| **合計** | | **161 天 + 20% buffer = 193 天** |

---

## 14. 開發順序建議

> **Phase 編號規範（D-8 拍板）：** README Phase 0-10 為唯一來源。L 的 Week 編號是「實作週」對應到 **README Phase 4-5（實作 RBAC + API + frontend）**。

按依賴 → 解鎖度 排：

| L Week | README Phase | M Phase | 工作 |
|---|---|---|---|
| Week 1-2 | Phase 4 起點 | M Phase 1 (Auth) 共享 Foundation | **Foundation**：tokens.ts / ThemeProvider / Primitives / API client / TanStack Query / SSE consumer / form lib / dnd / store / boundary / i18n integration（**8 大基礎建設一氣呵成**）|
| Week 3-4 | Phase 5 | M Phase 1 + 3 共享 | **創作流共用**：WsTopBar / WsStepper / ProjectSidebar / EpisodeTabBar |
| Week 5-7 | Phase 5 | M Phase 3 | **13 + 08 雙視圖**：InlineChip / NarrativeEditor / StoryboardTimeline |
| Week 8-9 | Phase 5 | M Phase 2 | **劇集設定 15/16/17**：SubjectsSidebar / 三種 Editor |
| Week 10-11 | Phase 5 | M Phase 2 + 6 | **工作區 20/36/37/38**（含 EditRequest 38）|
| Week 12-13 | Phase 5 | M Phase 4 | **23 配音 + 24 渲染 + 25 成片** |
| Week 14 | Phase 5 | M Phase 1 | **Auth/Onboarding** |
| Week 15-16 | Phase 5 | M Phase 5 + 跨 Phase | **分享/廣場/通知/歷史/設置** |
| Week 17 | Phase 5 | M Phase 7 | **Landing/Pricing/Admin/手機** |
| Week 18-20 | Phase 9 (Soft launch) | M cross-cutting | **整合 + bug + polish** |

---

## 15. 共用 component 強制清單

> 寫新檔前先查這份。發現重複造輪 → 必須先抽到 `src/components/_primitives/`

| 看到要做的東西 | 先用 |
|---|---|
| 「我要做一個按鈕」 | `<Button>` |
| 「我要做一個卡片」 | 用 `<div className="card">` + tokens，不要新建 |
| 「我要做一個 modal」 | `<Modal>` 或 `<ConfirmDialog>` |
| 「我要做一個側拉抽屜」 | `<Drawer>` |
| 「我要做一個下拉選單」 | `<DropdownMenu>` |
| 「我要做一個 chip」 | `<Pill>` 或 `<Badge>` |
| 「我要做一個 toast」 | `<Toast>` |
| 「我要做一個 tooltip」 | `<Tooltip>` |
| 「我要做一個 form input」 | `<Input>` `<Textarea>` `<Select>` `<Switch>` |
| 「我要做一個進度條」 | `<ProgressBar>` `<CircularProgress>` |
| 「我要做一個 skeleton 載入」 | `<Skeleton>` |
| 「我要做一個 empty state」 | `<EmptyState>` |
| 「我要做一個錯誤頁」 | `<ErrorState>` |
| 「我要做一個 @chip」（角色/場景/道具） | `<InlineChip>` |
| 「我要做一個 audit row」 | `<AuditRow>` |
| 「我要顯示「使用次數」badge」 | `<UsageBadge>` |

---

## 16. 已知 trade-off

| 決定 | 為何 | 代價 |
|---|---|---|
| 用 Radix UI 而非自己刻 modal/dropdown | a11y 直接給足，省 200+ 行 + 鍵盤導航 + focus trap | bundle +30KB |
| Tiptap 編輯 13 narrative 而非 lexical / textarea | inline @chip 用 Mark/Node 自然 + i18n 完整 | bundle +80KB |
| Shaka player 而非 video.js | DASH/HLS 雙協議自適應 | bundle +60KB |
| cmdk 而非自己刻 command palette | 配 fuzzy 搜尋 + 鍵盤 + 動畫一條龍 | bundle +12KB |
| recharts 而非 d3 直接刻 | KPI / breakdown 圖快 | bundle +90KB |
| sonner 取代 react-hot-toast | 動畫更好 + ARIA 完整 + maintain 中 | 0（取代）|
| Drawer 不復用 Modal 而獨立 | 動畫方向 + 行為差異大 | 多 +130 行 |

---

**下一份：** M-e2e-scenarios.md
