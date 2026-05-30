# KuiperAI 公開上線重設計 Master Plan

> Status: **Draft v1** · Date: 2026-05-28 · Owner: 主 working session
> Vision: 把 KuiperAI 從「內部團隊工具」升級成「對外可賣的 premium AI 短劇平台」
> Reference: [Artcraft](https://app.getartcraft.com/) (philosophy) + Krea (router UX) + Higgsfield (director controls) + Linear (interface craft)

---

## 1. 為什麼要重做

KuiperAI 目前是內部 10–20 人 invite-only 用，UI 在功能上 OK，但對外 cold visitor 第一眼會覺得「這是個 MVP」而不是「這是個產品」。要公開上線（任何 pricing model）都需要先把視覺/互動工藝拉到跟 Krea / Higgsfield / Linear 同一個聯盟。

**這份計畫不解決：** 產品策略、使用者研究、品牌命名、marketing copy。這是純粹的 UI/UX/工程重設計藍圖。

---

## 2. 對標的 4 個平台 + 偷什麼

| Reference | 角色 | 偷什麼 | 不要學 |
|---|---|---|---|
| **Artcraft** | 哲學基準 | Control-before-generation、dual-track workflow（scratchpad + craft pipeline 同存）、Identity/Location 作為 first-class object | 商業模型（desktop + 開源 + 無 funnel） |
| **Krea AI** | 結構雙胞胎 | Multi-provider router UX、unified prompt + canvas、provider 切換無感 | 過度 chat-mode 化 |
| **Higgsfield** | 導演語言 | 70+ 鏡頭運動 preset、可疊三層、deterministic 命名 | 過度 cinematic preset 壓垮其他工作流 |
| **Linear** | 介面工藝 | 密度、鍵盤導向、單 accent 自律、workflow-stage AI hints、毫秒同步當作 felt-quality | 完全冷感的純生產力風 |

---

## 3. 視覺設計語言（Phase 0 token spec）

### 3.1 雙路線

- **Cinematic Immersive**（**user 確認的主路線**）：所有創作頁面（home / new / script / subjects / storyboard / voice / final / marketing）
- **Studio Dark**（次路線）：所有管理頁面（admin / settings / workspace / billing / profile）

### 3.2 Color tokens（dark-first, WCAG AA verified）

```css
/* Neutrals — 預設畫布 */
--neutral-50:  #FAFAFA;
--neutral-100: #F5F5F5;
--neutral-200: #E5E5E5;
--neutral-300: #D4D4D4;
--neutral-400: #A3A3A3;
--neutral-500: #737373;
--neutral-600: #525252;
--neutral-700: #404040;
--neutral-800: #262626;
--neutral-900: #171717;
--neutral-950: #0A0A0A;  /* default canvas */

/* Primary — cinema marquee */
--primary-400: #FFD96E;  /* hover */
--primary-500: #F5C24A;  /* base, 沿用目前 amber 的延伸 */
--primary-600: #C99A2E;  /* pressed */

/* Accent — AI 生成 moment 專用 */
--accent-500: #7C5CFF;   /* electric violet */
--accent-glow: radial-gradient(#7C5CFF66, transparent 70%);

/* Semantic */
--success: #22C55E;
--warning: #F59E0B;
--error:   #EF4444;
--info:    #3B82F6;

/* Surfaces */
--surface-canvas:  #0A0A0A;
--surface-raised:  #171717;
--surface-overlay: #1F1F1F;   /* modals, popovers */
--surface-glass:   rgba(23, 23, 23, 0.72);  /* + 24px blur, 僅疊在媒體上 */

/* Text */
--text-primary:   #FAFAFA;  /* 18.7:1 on canvas */
--text-secondary: #A3A3A3;  /* 7.2:1 */
--text-tertiary:  #737373;  /* 4.6:1, AA large only */
```

**鐵則：** 一個 view 最多 3 種灰（canvas / raised / overlay），多了就是視覺債。

### 3.3 Typography

```css
font-family: 'Inter', 'Source Han Sans SC', 'PingFang SC', system-ui, sans-serif;
```

- Display: Inter Display + Source Han Sans SC（500/600/700）
- Body: Inter + Source Han Sans SC（400/500）
- Mono: JetBrains Mono

**Scale（1.25 ratio）：** 12 / 14 / 16 / 18 / 20 / 24 / 30 / 36 / 48 / 60 / 72
**Line height：** body 1.6、UI 1.45、display 1.1、**CJK body 1.75**（中文需要更鬆）
**Tracking：** display 30px+ 收 -0.02em、uppercase label 放 +0.04em

**禁用：** Noto Serif SC display、襯線中文 + sans Latin 配對（一眼翻譯感）

### 3.4 Spacing & Layout

- **基本單位 4px**：4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80 / 128
- **容器 max**：1440 (app) / 1280 (content) / 720 (reading)
- **Workspace 標準佈局**：Sidebar 256 + Canvas fluid + Inspector 360 (collapsible)
- **Gutter**：desktop 24 / tablet 16 / mobile 12
- **Storyboard grid**：9:16 native，desktop 3-up / tablet 2-up / mobile 1-up，gap 16

### 3.5 Shape / Elevation / Motion

```css
/* Radius scale — 一條到底 */
--r-chip:  4px;
--r-input: 8px;
--r-card:  12px;
--r-modal: 16px;
--r-hero:  24px;
--r-pill:  9999px;

/* Borders */
border: 1px solid rgba(255, 255, 255, 0.08);  /* raised surface */

/* Elevation — dark mode 靠 surface 升而非 shadow */
--elev-1: 0 1px 2px rgba(0,0,0,0.4);
--elev-2: 0 4px 12px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06);
--elev-3: 0 16px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08);

/* Motion */
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);     /* default */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);    /* page transition */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* reveal only */

/* Duration scale */
--d-hover:   120ms;
--d-state:   200ms;
--d-panel:   320ms;
--d-page:    600ms;
--d-reveal:  1200ms;  /* signature moments */
```

**Respect `prefers-reduced-motion`** — 全部 >200ms 砍掉。

### 3.6 Iconography

- Lucide 或 Phosphor，**1.5px stroke, 20px default, 單一 weight**
- 禁混 filled + outline、禁 chrome 用 emoji（emoji 是 user content 不是 UI）
- Illustration: 委製單色線稿（primary gold accent），只用在空狀態 / onboarding / marketing

### 3.7 三個 Signature Moment（必須做到的高光時刻）

1. **生成中** — full-bleed dark canvas + 9:16 frame 居中 + 紫色 accent-glow 邊框慢呼吸（2s loop）。下方一行 ghost-typing 場景描述。**禁 spinner、禁百分比。** 預估時間用靜默 tertiary 文字。
2. **結果 reveal** — frame 從黑色 600ms fade out，scale 0.96 → 1.0 spring。第一幀 hold 400ms 後 muted autoplay。周圍 chrome 暗到 40% opacity 2 秒讓眼睛鎖住影片。這是多巴胺 hit，保護它。
3. **空狀態 / cold start** — 一張委製線條插畫（場記板 / 空舞台）+ 一句 display type「你的第一部短劇從這裡開始 / Your first drama starts here」+ 一個 primary CTA。**禁 tips list、禁三張範例卡。** 自信來自克制。

### 3.8 Anti-patterns（絕對禁止）

1. 一個 view 超過 3 種灰
2. 漸層按鈕（紫到粉特別禁，ChatGPT-wrapper tell）
3. Chrome / nav / button 用 emoji
4. Glassmorphism 疊在純色上（只是變深灰）
5. Dark mode 卡片用 drop shadow（用 border + surface lift）
6. 同 toolbar 混 filled + outline icon
7. 襯線中文 + sans Latin 混搭
8. AI 生成用 loading spinner
9. 一頁 4 種以上按鈕風格
10. Stock 3D 插畫、isometric 人物

---

## 4. Hybrid 商業模式

```
user → 看到「點數」 → routing → ARK / Tencent VOD / BobAPI / AtlasCloud / fal
```

### 4.1 訂閱階梯（草案）

| Tier | 月費 | 月含點數 | 浮水印 | 可用 provider | 並發 |
|---|---|---|---|---|---|
| Free | $0 | 100（每日上限 20） | 是 | 1（最便宜） | 1 |
| Creator | $19 | 1,500 | 否 | 3 | 2 |
| Studio | $59 | 5,000 | 否 | 全部 5 | 5 |
| Team | $149 | 15,000 + 3 seats | 否 | 全部 + API | 10 |

年付 8 折（業界標準）。
超量加購：每 1,000 點 $X（依成本反推，需要算）。

### 4.2 點數定價邏輯

- 1 集（多鏡複合）= 大約 50 點，涵蓋：
  - 後端 provider 實際成本（pricing JSON 已建好，可直接抓）
  - 毛利目標（建議 60–70% 給 Studio tier，Creator tier 可接受 40–50%）
  - 失敗緩衝（assume 5% 任務失敗，分攤到所有點數）
- **失敗免扣點數**（marketing 武器）— ARK face filter / 跨境 timeout / Seedance error 等都不收

### 4.3 為什麼這樣設計

- 對標 Krea $9/$35/$70/$200 + Higgsfield $15/$49/$129
- 純訂閱會被重度用戶壓爆（Hailuo 教訓）
- 純 PAYG 不適合 B2C creator（Replicate 教訓）
- 純 credit-burn 失敗扣錢會被 Trustpilot 罵爛（Hailuo 1.4/5）

---

## 5. 分階段執行（總計 6–8 週）

### Phase 0 · 設計系統基礎（2–3 天）

**Owner：** 1 個 senior frontend
**輸出：**
- 新 `tailwind.config.ts`（套用 §3.2 ~ §3.5 token）
- 新 `globals.css` / 替換現有 `ui-tokens-glass.css` + `ui-semantic-glass.css`
- Component library v2：`<Button />`、`<Input />`、`<Field />`、`<Card />`、`<Modal />`、`<Inspector />`、`<EmptyState />`、`<GenerationProgress />`、`<MediaReveal />`
- DESIGN.md 升級 v2（merge 這份 token spec）
- Storybook 或 `/dev/components` 預覽頁

**Definition of Done：** 所有 Phase 1+ 頁面只准用這套 token，不准 inline 顏色/字級。

### Phase 1 · 創作核心 6 頁（1.5–2 週）

| # | 路由 | 重點 | 風險 |
|---|---|---|---|
| 1 | `/v2/workspace/[id]/storyboard` | 3-col layout (groups list + canvas + Inspector)，拆 2,994 行 monolith | 高 — 是最複雜的頁面 |
| 2 | `/v2/workspace/[id]/script` | 加 syntax highlight + inline error marker + Inspector for episode split | 中 |
| 3 | `/v2/workspace/[id]/subjects` | Inspector pattern for character/location/prop，row height 28–32px | 中 |
| 4 | `/v2/workspace/[id]/voice` | 三狀態明確（generating / ready / error），preview player 升級 | 低 |
| 5 | `/v2/workspace/[id]/final` | Progress UI + export options + share preview | 低 |
| 6 | `/v2` (home) | Media-first project cards（16:9 thumbnail 主體）+ 第一集 preview hero | 中 |

**順便處理的技術債：**
- 拆 `V2StoryboardClient.tsx` (2,994) / `GroupCard.tsx` (2,496) / `V2SubjectsClient.tsx` (2,034) 進可組合元件
- 補真正的 loading state（shimmer + accent glow）
- 補真正的 empty state（§3.7.3）

### Phase 1.5 · Storyboard R2V/T2I→I2V 架構重構（1.5 週，**跟 Phase 1 並行不可分**）

> 這段是 2026-05-28 user 提出 R2V 應該變預設後追加。本質：把為 Kling 而生的 multi-shot 架構升級成 **R2V-first、4-mode 並存** 的通用框架。
>
> **架構結論：**
> - **R2V** = 新 panel 預設 mode（自動帶 character/location/prop reference）
> - **T2V** = fallback（沒主體需求的鏡頭，例如空鏡、純場景）
> - **T2I→I2V** = power user 進階選項（要極致關鍵幀控制的封面鏡）
> - **R2V + motion ref** = 難動作專用（給參考運鏡片段，繞過文字描述運動的痛點）

#### 1.5A · Schema migration（0.5 天）

```prisma
enum PanelGenerationMode {
  direct_t2v
  r2v_with_subjects        // 預設
  t2i_then_i2v
  r2v_with_motion_ref
}

model NovelPromotionPanel {
  ...
  generationMode      PanelGenerationMode  @default(r2v_with_subjects)
  sceneContext        String?  @db.Text   // 從 description 鎖定的 T2I/T2V prompt
  motionLine          String?  @db.Text   // I2V 動作描述（LLM 反推或 user 編輯）
  keyframeUrl         String?              // T2I→I2V mode 選定的關鍵幀
  keyframeCandidates  Json?                // T2I 4 張候選
  r2vMotionRefUrl     String?              // R2V+motion 的參考運鏡 clip
  perShotProvider     String?              // 單鏡 model override (e.g. "ark::seedance-2.0-r2v")
}
```

**既有 `imageUrl`** 保留為 user 上傳的 reference 用途，跟新 `keyframeUrl`（系統 T2I 產生）區分。
**Backfill：** 既有 panel 預設 `direct_t2v` 不影響現存資料。

#### 1.5B · Prompt template 重寫（1 天）

- 新增 `NP_AGENT_STORYBOARD_R2V_DETAIL` — model-agnostic、不強制英文運鏡詞、不寫 `multi_shot_group`
- 新增 `NP_AGENT_MOTION_LINE_GENERATOR` — 從 `panel.description` + `panel.dialogue` + `panel.cameraMove` 三輸入反推 motion line（給 T2I→I2V 跟 R2V 用）
- 既有 `NP_KLING_AGENT_STORYBOARD_DETAIL` 降級為「Kling provider 專屬 variant」，不再是預設

**路由更新** (`storyboard-prompt-router.ts`)：

```typescript
function pickStoryboardDetailPromptId(provider: string, mode: PanelGenerationMode): PromptId {
  if (provider === 'kling' || provider === 'tencent-vod') return PROMPT_IDS.NP_KLING_AGENT_STORYBOARD_DETAIL
  if (mode === 'r2v_with_subjects' || mode === 'r2v_with_motion_ref') return PROMPT_IDS.NP_AGENT_STORYBOARD_R2V_DETAIL
  return PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL  // generic T2V
}
```

#### 1.5C · Worker routing 重構（3 天，**最高風險**）

- 抽 `getMaxDurationPerShot(provider): number` 替換寫死的 `KLING_OMNI_MAX_TOTAL_DURATION = 15`
- 既有 5 個 `shouldUse*Composite()` 留著，但都走統一 `composeMultiShot()` helper
- 每 panel 依 `generationMode` 走不同 worker path：

| Mode | Worker path |
|---|---|
| `direct_t2v` | T2V worker，無 reference |
| `r2v_with_subjects` | R2V worker，自動 inject `panel.characters[*].referenceImage` + `panel.location.referenceImage` + `panel.props[*].referenceImage` 為 reference array |
| `t2i_then_i2v` | T2I worker → 4 候選存 `keyframeCandidates` → user 選 → I2V worker 吃 `keyframeUrl` + `motionLine` |
| `r2v_with_motion_ref` | R2V worker + `r2vMotionRefUrl` 當 motion guidance |

- B-path / C-path Kling 二分降級為 Kling-only variant，不再是 first-class 路由
- `multi-kling-chunker` 邏輯保留但只 Kling provider 觸發；其他 provider 走各家 native multi-shot

#### 1.5D · Inspector UI 元件拆解（3 天）

把 `V2StoryboardClient.tsx`（2,994 行）拆成這些可組合 component（放 `src/components/storyboard/inspector/`）：

| Component | 職責 |
|---|---|
| `<GenerationModePicker />` | 4 mode 切換 + 每個 mode 即時點數計算 |
| `<PromptDualPanel />` | Scene Context（🔒）+ Motion Line（⚡） |
| `<ElementsBindingRail />` | 自動列 panel 綁定的 Element 縮圖，可改/解綁 |
| `<KeyframeStudio />` | T2I→I2V 專屬：4 候選 → 1 選定 + 獨立 re-roll button |
| `<PerShotModelPicker />` | 從 `useUserModels` 過濾 enabled 清單，單鏡 override |
| `<CinemaPresetRow />` | Higgsfield 風格運鏡 preset，可疊 |
| `<MotionRefDropzone />` | R2V+motion 模式專屬：上傳/挑選參考運鏡 clip |

#### 1.5D-bis · 雙視圖架構（**2026-05-28 user 確認 A**）

Storyboard 步驟的「同一份 panel data」要做兩種視圖，**user 在編輯器頂部 toggle 切換**：

| 視圖 | 預設 | 強項 | 對應 mode |
|---|---|---|---|
| **📝 敘事編輯（NarrativeEditor）** | ✅ | 影視編劇心智模型、inline `@chip`、整集一覽、寫劇本順手 | R2V（主路徑）、T2V |
| **▣ 分鏡卡（CardView）** | | 視覺微調、4 候選圖選擇、per-panel Inspector 細調、單鏡密集編輯 | T2I→I2V、R2V + 運鏡 ref |

切換規則：
- 兩視圖共享同一筆 panel data，切換是純前端 UI 路由（不改 DB）
- R2V mode 的 panel 預設在敘事編輯顯示（chip 嵌進文字、段落獨立 regen）
- T2I→I2V mode 的 panel 在敘事編輯只顯示一行佔位「📷 此段需要選關鍵幀 → 切到分鏡卡」並提供快捷切換
- 分鏡卡 view 可看到所有 panel（不分 mode），但 R2V mode 的 panel 只能改參數不能改文字（要改文字回敘事編輯）

實作：
- 兩視圖共享 `usePanelStore()` hook
- 路由用 `?view=narrative` / `?view=cards` query param 持久化
- 切換時保持選中的 panel/segment（scroll into view）

#### 1.5E · Pre-flight 確認頁（1 天，**新功能**）

新路由 `/v2/workspace/[id]/[episodeId]/pre-flight`，文本分析完跳這頁（design preview 07）：

- 顯示抽出的 Elements（角色/場景/道具）+ 各自 reference 狀態（ready / draft / missing）
- 顯示 scene/shot 拆解 + 預估點數 + 預估時間
- 顯示智能路由策略（哪鏡走哪 provider 的視覺化 bar）
- 「開始生成」按鈕真實燒點 — 在這之前 user 都還能改

**這頁是偷 LTX Studio 的核心 wow** — 燒 GPU 前最後一道修正關。

#### 1.5 風險

| 風險 | 緩解 |
|---|---|
| Worker 重構撞到 prod 跑中的任務 | 用 `legacy_path` flag，新舊並行 1 週後切換 |
| `keyframeCandidates` JSON 在 Postgres 變大 | 限制 4 候選 × 1080×1920 thumb 縮圖（原始存 R2） |
| T2I→I2V mode user 不選圖卡流程 | 1 小時無動作自動選第 1 張（可改） |
| Per-shot model picker 跨 provider config 不一致 | 抽 `normalizeShotConfig(provider, config)` 統一 |

#### 1.5 工時總和

| Sub-phase | 工時 | 主檔案 |
|---|---|---|
| 1.5A Schema | 0.5d | `schema.prisma` + migration |
| 1.5B Prompt | 1d | `storyboard-prompt-router.ts` + 2 個新 prompt template |
| 1.5C Worker | 3d | `multi-shot-video-handler.ts` 重構 + `kling-omni-constants.ts` 抽 |
| 1.5D Inspector | 3d | 拆 `V2StoryboardClient.tsx` + 7 個新 component |
| 1.5E Pre-flight | 1d | 新路由 + 新 page component |
| **總計** | **8.5d ≈ 1.5 週** | |

### Phase 2 · 公開 funnel（1 週）

| # | 路由 | 重點 |
|---|---|---|
| 1 | `/` (landing) | Krea 風 hero（影片自播）+ 6 步流程說明 + Higgsfield 風 showcase + pricing CTA |
| 2 | `/auth/signin`, `/auth/signup` | 暗色 modal + Google OAuth + password show/hide + 明確錯誤 |
| 3 | `/v2/new` | 從 modal 升級成 full-page wizard，3 步：上傳劇本 / 設定 / 確認 |
| 4 | `/pricing` | 4 階梯表 + FAQ + 失敗免扣承諾 + 年付切換 |

### Phase 3 · 管理頁面一致化（1 週）

走 Studio Dark 路線：

- `/admin` 儀表板：queue health 升級 + stat cards 統一卡片風 + real-time refresh 視覺提示
- `/admin/users`、`/admin/runs`：dense table（28px row）、sort affordances、inline action、bulk select
- `/workspaces`：tab pattern（settings / members / billing）取代 922 行 stack
- `/profile`、`/settings`：統一 form layout

### Phase 4 · Mobile 收斂（並行 Phase 2–3）

- 把 `/m/*` 改成 V2 的 responsive 共用元件而不是分叉路由
- Touch target 最小 44×44
- 保留 mobile-revert banner 機制（記憶裡有）
- middleware iPhone/Android UA 跳轉邏輯保留

### Phase 5 · i18n + QA + 上線（1 週）

- 跑現有 extract → translate → plan → apply pipeline 補新增 keys
- 加 CI guard：EN/ZH-CN key parity check
- 跑 `/qa` 全套，目標 prod health ≥ 9.5/10
- pricing page + billing 接通 Stripe（或本地金流）
- soft launch（小流量觀察 1 週）→ 正式公開

---

## 6. 預估工時 + 風險

**總工時：** 6–8 週（1 個 senior frontend + 1 個 designer + 0.5 個 backend）
**最高風險：** Phase 1 storyboard 重構（單檔 2,994 行，重構同時改皮，併行容易出錯）
**第二風險：** i18n 漏 keys 卡上線
**第三風險：** Stripe / 點數系統實作（如果之前完全沒做過）

### 緩解
- Phase 1 用 git worktree 隔離，先重構後改皮，**分兩個 PR**
- i18n 上 CI guard 強制 parity
- 點數系統建議直接抄 Stripe Billing 的 metered usage + Stripe Customer 模型，不要自己造輪子

---

## 7. 還沒決定的事

- [ ] Pricing 階梯確切數字（要算 backend 成本 + 反推毛利）
- [ ] 浮水印做還是不做（Free tier 要有但要好看）
- [ ] 上線地區 / 金流（Stripe 主、支付寶/微信 next？）
- [ ] 是否做 referral / invite credit（建議第二階段）
- [ ] Sora / Veo 等新模型要不要接（multi-provider 故事更強）
- [ ] 是否導入 PostHog / Mixpanel 做 funnel 分析（強烈建議 Phase 2 一起做）

---

## 8. 後續閱讀

- Memory: `project_kuiperfilm_demo.md`（Phase 11 部署狀態）
- Memory: `project_kuiperfilm_i18n_migration_state.md`（i18n 現況）
- Memory: `project_kuiperfilm_workspaces.md`（多租戶現況）
- 本檔 +  `/Users/joshhung/KuiperAI/DESIGN.md`（merge 後 Phase 0 重寫）
