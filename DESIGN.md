# KuiperAI Design System

> Source of truth for visual + interaction language of `art.kuiperfilmailab.com`.
> 不是 pixel-perfect spec — 是「決策骨架」。具體 token 值落在 `src/styles/ui-tokens-glass.css`。
>
> Inspired-by 不是 clone-of。參考行業 norm + 影視 AI 工具的共同語言，避開特定品牌獨有的識別元素。

---

## 0. 設計哲學

KuiperAI 不是 SaaS 工作流，是**創作者的工作台**。

| 我們是什麼 | 我們不是什麼 |
|---|---|
| Studio / Cockpit / IDE | Dashboard / Onboarding funnel |
| 為「持續返回的創作者」設計 | 為「首次轉換的訪客」設計 |
| Cinematic、緊湊、職業感 | Friendly、寬鬆、消費級 |
| 內容（分鏡圖 / 影片）是主角 | UI chrome 是主角 |
| Hands-on：拖拉、覆寫、調權重 | Prompt-and-pray |

這個哲學貫穿後面所有決策。當在「酷」與「易上手」之間取捨時，**選酷**。

---

## 1. 視覺定位：Cinematic IDE

三個關鍵詞：

- **Cinematic**：深色為底、內容發光、配色克制、敘事感
- **IDE**：多 panel、密度高、contextual inspector、weak chrome
- **Craft**：可見的工具感（權重、版本、seed、覆寫）— 反黑盒

行業 norm 抄沒風險（深色 + sidebar + media-first card + shimmer loading），這些**直接做**。

獨特氣味（IDE 桌面隱喻、local-first 氛圍、特定品牌語彙）— **參考精神，自己長**。

---

## 2. 色彩系統

### 2.1 背景三階層（near-black → 微亮）

| 層 | 用途 | Vibe |
|---|---|---|
| L0 Canvas | 主視口、影片預覽外層 | 最深，趨近純黑但有微藍底 |
| L1 Surface | sidebar、toolbar、列表卡片底 | 中深 |
| L2 Elevated | 浮動 panel、modal、inspector、popover | 略亮 |

**不做大面積白色背景。** 深色一致到底（行銷頁 hero 例外可破例）。

分層**靠背景階差**而非 border。Border 出現時應該細到 0.5px 等級且偏深，僅作為「真的需要 affordance 邊界時」的訊號。

### 2.2 Accent：電光青藍

當前的 `amber-400` 橘棕當主 accent**置換為冷色青藍**（electric blue / cyan-leaning blue 區間，~`#3B9BFF`～`#5B6EFF` 之間視 contrast 取值）。

理由：
1. 影視 AI 工具 2026 共同語言（Luma / Runway / Higgsfield 共通）
2. 冷色 + 深背景 = cinematic
3. 暖色 amber 給人「咖啡店」感，與 cinematic 定位衝突

Accent **使用密度要克制**。原則：
- Primary CTA、active state、focus ring、loading shimmer 高光、品牌 logo glow
- 不用於：純 informational 訊息、卡片邊框、表格 stripe

### 2.3 輔助色

| 用途 | 取色原則 |
|---|---|
| Success | muted teal / sea green，**不用螢光綠** |
| Warning | muted amber，僅用於警告（保留 amber 作為次要訊號） |
| Danger | muted crimson，避免血紅 |
| Info | accent 同色但降彩度 |

**色彩飽和度天花板**：除了 logo glow 與生成中的 shimmer，其他地方 saturation 不超過 70%。Neon 級全平台禁用。

### 2.4 留白 vs 內容色

內容（分鏡縮圖、影片、上傳的劇照）**保有原本飽和度**。UI chrome 讓位給內容。
這意味著 cinematic LUT 風（暗藍 + 鏽橘）的使用者素材在我們界面中會自然發光。

---

## 3. 字體系統

維持當前 stack（無需更換）：

| 角色 | 字體 | 權重 |
|---|---|---|
| Display / Hero | Poppins | 700-800 |
| UI heading | Geist Sans / Poppins | 600-700 |
| Body | Open Sans / Geist Sans | 400 |
| Numeric / code | Geist Mono | 400 |

### 字級對比要強

- Display：48-72px，字距 -0.02em，重黑
- UI heading：14-16px，字距 0，semibold
- Body：13-14px（**比目前略小**，IDE 節奏）
- Hint：11-12px，opacity 0.6

**標題與 body 對比拉到 4-5 倍**（display 60px vs body 13px）— 創造職業工具感。

---

## 4. Spacing 與密度

### 4.1 兩種密度模式

| 模式 | 用途 | Row height / gutter |
|---|---|---|
| **Comfortable** | 行銷頁、auth、profile、空狀態 | 16-24px gutter, 40-48px row |
| **Dense** (default) | workspace 內所有頁 | 4-8px gutter, 28-32px row |

當前 KuiperAI 全站偏 Comfortable。Workspace 內所有頁面**降密度到 Dense**。

### 4.2 Spacing scale

維持 8-grid（4 → 8 → 12 → 16 → 24 → 32 → 48 → 64）。
Workspace 內元件**預設用前半截**（4-16）。Hero / 行銷區用後半截（24-64）。

### 4.3 Radius

- 4-6px：button、input、chip、panel
- 8-12px：card、modal
- 16-24px：hero CTA、特殊強調

**Radius 整體往下調**（當前 KuiperAI 偏大）。圓潤感 → 工具感。

---

## 5. Layout 原則

### 5.1 Workspace 四區骨架

```
┌──────────────────────────────────────────────────────┐
│ TopBar：專案名 / Episode tabs / Render queue 狀態  ⚙  │
├──────┬───────────────────────────────────┬───────────┤
│      │                                   │           │
│ Sid  │   Stage（分鏡 / 預覽 / 編輯主畫面）│ Inspector │
│ ebar │                                   │ (選什麼   │
│      │                                   │  出什麼)  │
│      │                                   │           │
├──────┴───────────────────────────────────┴───────────┤
│ Bottom：Queue / History / Logs（可收）                │
└──────────────────────────────────────────────────────┘
```

當前的 step-based sidebar（home → script → subjects → storyboard → voice → final）**保留**，但視覺從「教學流程」改成「工作台分頁」— 不強調進度條，強調當前位置。

### 5.2 Inspector 是一等公民

選 panel / 角色 / shot 時，**右側 Inspector 出現對應參數**：
- model、seed、weight、duration、resolution
- 覆寫值用粗體 + 「✏ 已改」chip 標示（這個 KuiperAI 已經有 — 強化它）
- 重生按鈕在 Inspector 底部固定

### 5.3 List vs Canvas

- 列表頁（v2 Home、Subjects）：**media-first card grid**，每張卡 16:9 縮圖打頭
- Canvas 頁（Storyboard、Final）：縮圖 → 主預覽 → Inspector 三欄

---

## 6. 元件原則

### 6.1 既有 primitive 全留

- `GlassButton` / `GlassInput` / `GlassField` / `GlassTextarea`
- `GlassChip` / `GlassSurface` / `GlassModalShell`
- `glass-segmented` / `glass-toggle`

這套 primitive 結構正確，**只調 token、不重寫**。

### 6.2 Button hierarchy

| 層級 | 樣式 | 用法 |
|---|---|---|
| Primary | accent fill + subtle glow | 每頁只一個（主要 CTA） |
| Secondary | L2 surface + border | 次要動作 |
| Ghost | 無背景 + hover 變 L2 | toolbar 圖示按鈕 |
| Danger | muted crimson tint | 破壞性 |

按鈕**不爆色** — 不要螢光綠 / 飽和橙。

### 6.3 必加元件（目前缺）

| 元件 | 用途 |
|---|---|
| `ShimmerSurface` | AI 生成中佔位（取代 spinner） |
| `JobQueueChip` | 頂列顯示「3 個任務生成中 / 預估 2:30」 |
| `InspectorPanel` | 右側 contextual property 容器 |
| `KeyboardHint` | 顯示快捷鍵（IDE 必備） |
| `ToolbarGroup` | 圖示按鈕成組，弱邊框 |

### 6.4 Icon system

維持 `lucide-react` + `AppIcon` registry。
**統一線寬 1.5px**（目前可能混用）。Active 圖示填 accent，inactive 走 L2 + 0.7 opacity。

---

## 7. 動效語言

### 7.1 三類動效

| 類別 | 時長 | Easing | 範例 |
|---|---|---|---|
| Micro | 100-150ms | ease-out | hover、focus、按下 |
| Transition | 200-300ms | cubic-bezier(0.16, 1, 0.3, 1) | panel 切換、modal 開合 |
| Generative | 持續 | linear shimmer | AI 生成中佔位 |

當前 `globals.css` 內的 keyframes（slide-up / fade-in / scale-in / shimmer）**保留**，補上 shimmer 的 accent 配色。

### 7.2 Shimmer 是 AI 工具的呼吸

任何「等 5 秒以上」的 AI 任務 → **shimmer 取代 spinner**。
原則：
- Shimmer 走 accent 同色光帶
- 不顯示百分比進度條（除非真的能算），用「狀態文字 + shimmer」
- 提供「背景跑」按鈕（user 可離開頁面，job queue 持續跑）

### 7.3 不做什麼

- 無 bounce、無 spring 反彈
- 無 framer-motion stagger 出場（用 CSS @keyframes 夠）
- 無頁面切換的全螢幕 fade（直接切，IDE 不需要儀式感）

---

## 8. 狀態設計

每個畫面定義 5 種狀態：

| 狀態 | 視覺 |
|---|---|
| Empty | 含**單一明確 CTA**（不是 illustration + 三行 onboarding 文案）。一句話 + 一個 primary button。 |
| Loading | Shimmer 佔位 + 模糊預期內容形狀 |
| Generating | Shimmer + 「狀態文字 + 預估時間 + 取消按鈕」 |
| Error | 紅色 chip + 友善文 + 「重試 / 看詳情」雙按鈕（**不暴露 raw stack trace** 給普通用戶，給 ops hover tooltip） |
| Success | 不彈祝賀 modal。換頁 + 頂列 toast「完成」+ 縮圖入列 |

**Loading 不轉圈圈、Error 不嚇人、Success 不慶祝** — IDE 風氣。

---

## 9. 文案 tone

| Do | Don't |
|---|---|
| 「重新生成這一鏡」 | 「✨ 讓 AI 再來一次！」 |
| 「Seed 已固定」 | 「鎖定隨機性 🔒」 |
| 「3 個任務排隊中」 | 「正在為你努力中～」 |
| 「導出 .mp4」 | 「下載你的傑作」 |

繁簡英三語都遵守同一原則：**直接、技術、不撒嬌**。

emoji 禁用於 UI chrome（chat-like input 可以例外）。

---

## 10. 反模式 / 紅線

### 10.1 設計反模式（不要做）

- ❌ 明亮白色背景 + 高飽和卡通 illustration
- ❌ 彩虹漸層 / multi-color gradient
- ❌ 圓潤大 radius（>16px on workspace）
- ❌ Spinner 轉圈（用 shimmer）
- ❌ 全螢幕 modal onboarding tour（給 docs 連結）
- ❌ 進度條打 1% → 99%（真的有真實進度才用）

### 10.2 IP 紅線（避免抄到出事）

研究的 reference 站有獨特氣味，**借精神不借形體**：

- ❌ 直接搬其 logo / wordmark 字型曲線
- ❌ 複製其特定 icon set / illustration
- ❌ 抄其文案口號（"crafting not prompting" 這類）
- ❌ 1:1 還原其 layout 像素位置
- ✅ 「深色 + cyan accent + IDE 多 panel + cinematic 內容」**這是行業 norm，安全**
- ✅ Shimmer loading、media-first card、Inspector 模式 **全是公開設計模式**

---

## 11. 改造路線圖

### Phase 1：色系切換（2-4 小時）
動 `ui-tokens-glass.css` + `ui-semantic-glass.css`：
- Accent: amber → electric blue
- 背景三階層加深
- Glow 點綴位置確認（logo、primary CTA、focus ring）
- 雙 theme（dark / light）但 light 給行銷頁用、workspace **強制 dark**

**驗收**：v2 Home + Storyboard + Final 三頁直接看是否 vibe 對

### Phase 2：v2 Storyboard 頁 IDE 化（1-2 天）
最高 ROI 頁面：
- 3 欄改為明確 L0/L1/L2 階層
- 加 Inspector 區（contextual）
- 密度提高（row height 32px、gutter 8px）
- Shimmer 取代既有 loading
- Empty state 改 IDE 風

**驗收**：能在這頁完成「打開 → 看分鏡 → 改 prompt → 重生」沒有任何「教學感」

### Phase 3：v2 Home + New Project（1 天）
- 卡片改 media-first 16:9 縮圖
- 列表密度提高
- 新建專案上傳區改 IDE 風（檔案 chip + 解析結果列表）

### Phase 4：Admin 統一（0.5 天）
- Admin tokens 對齊
- 表格改 dense（28-32px row）

### Phase 5：Motion 統一（0.5 天）
- 全站 shimmer 取代 spinner
- 過渡時長對齊（150 / 250ms）

**總工時估**：5-7 個工作天，可分散在多個 session 做。

---

## 12. 維護原則

- 新元件**先進 primitive**（在 `components/ui/primitives/`），再被頁面使用
- 新 token**改 `ui-tokens-glass.css`**，不要 inline color
- 任何「特例樣式」必須在 PR 描述寫理由
- DESIGN.md 是 source of truth — 改設計決策**先改這份再改 code**

---

*Last updated: 2026-05-27*
*Reference research: agents analysed industry video-AI tools + cinematic IDE patterns from Linear/Figma/DaVinci/Blender lineage.*
