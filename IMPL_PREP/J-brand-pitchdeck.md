# J · 品牌資產 + Pitch Deck

> **目標：** Launch 前必須有的視覺品牌資產（logo / 字型 / 品牌指南）+ 給投資人 / BD / 媒體用的 pitch deck outline。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** H-marketing（messaging）+ D-pricing（商業數字）

---

## 0. TL;DR

- **Logo 設計需求**：3 個方向（minimal text / icon-based / hybrid），預算 $1,500-3,000 外包
- **品牌指南** 一份雙語：色彩 / 字型 / Logo 用法 / 語氣
- **Pitch deck** 15 頁：給投資人 / 給 BD / 給媒體 3 個版本
- **社群媒體 assets**：profile / cover / template 全套
- **簡報 template** Slidev/Keynote，給內部用

---

## 1. Logo 設計

### 1.1 現況問題

目前 33 個 mockup 用「K」字 placeholder（金色漸層方塊），不是真實 logo。Launch 前必須換真實品牌。

### 1.2 Logo 設計需求 brief

```yaml
品牌精神:
  - 短劇 / 影視 / 創作（不是純科技）
  - 信任（失敗免扣、不被綁架）
  - Premium（不是廉價 AI 工具）
  - 國際化（中英文都 OK）

設計約束:
  - 須在 16×16 px favicon 仍清楚
  - 黑/白單色版必須能用
  - 中英雙語版（中文 KuiperAI / 英文 KuiperAI）
  - 不可有 AI / 大腦 / 神經網路 cliché

色調:
  - 主色：warm gold #F5C24A（cinema marquee）
  - 副色：electric violet #7C5CFF（AI moment）
  - 但 logo 本身可以 mono
```

### 1.3 3 個探索方向

**方向 A · Minimal wordmark**

```
KuiperAI
```

字型：自訂 / Inter Display ExtraBold 修改
- 像 Linear / Vercel / Stripe 走法
- 「Kui」前 3 字微調，最後 「per」收尾
- A 跟 I 可融合視覺 hook

**方向 B · Icon + wordmark**

```
[符號] KuiperAI
```

符號方向：
- 「K」字結合鏡頭框（短劇）
- 「K」字結合波形（聲音 / 創作）
- 「片」字（中文）抽象化

**方向 C · Animated wordmark**（網頁 hero 用）

- KuiperAI 字標 logo 配合 cursor blink
- 或字母逐個 fade in（generation 感）

### 1.4 外包建議

| 路線 | 預算 | 時間 |
|---|---|---|
| **99designs contest** | $1,500-3,000 | 7-14 天 |
| **Toptal Designer** | $3,000-8,000 | 2-4 週 |
| **自家 Figma 摸 + brand guideline** | $0 | 1 週但品質取決於 |
| **創辦人朋友圈找 designer** | $1,000-2,000 | 2 週 |

**推薦：** Toptal 找 senior brand designer（如果有資金）/ 否則 99designs。

### 1.5 交付物

```
final-logo/
├── primary/
│   ├── kuiper-logo.svg              主版本
│   ├── kuiper-logo-mono-black.svg
│   ├── kuiper-logo-mono-white.svg
│   ├── kuiper-icon-only.svg
│   └── kuiper-icon-favicon.ico
├── horizontal/
├── vertical/
├── chinese/
│   └── kuiper-zh-logo.svg
├── usage-guide.pdf                    用法指南
└── source.fig                          Figma source file
```

---

## 2. 完整品牌指南

### 2.1 結構

```
KuiperAI Brand Guidelines（v1）
├── 1. 品牌精神
│   - Mission / Vision / Values
│   - Brand archetype（Creator + Sage）
├── 2. Logo
│   - Primary / Variants
│   - Clear space + min size
│   - Don'ts（avoid stretch / recolor / 加 effects）
├── 3. 色彩系統
│   - Primary palette（既有 tokens.css）
│   - Semantic colors
│   - Accessibility（WCAG AA）
├── 4. 字型
│   - Display: Inter Display
│   - Body: Inter
│   - Mono: JetBrains Mono
│   - CJK: Source Han Sans SC
│   - Type scale
├── 5. Iconography
│   - Lucide / Phosphor 1.5px stroke
│   - 圖示設計原則
├── 6. Imagery
│   - 影片風格指南（Cinematic Immersive）
│   - Photography style（人物 / 場景）
│   - Illustration style（empty states）
├── 7. Voice & Tone
│   - 對 user 的語氣（friendly + competent）
│   - 中英文細節
│   - 禁止用詞（不用「神器」「Magic」「魔法」這類）
├── 8. Applications
│   - 社群媒體（Twitter / LinkedIn / 小紅書 / 微博 / IG / YT cover）
│   - Email signature
│   - Slack profile
│   - 簡報 template
│   - 名片 / 信封（如需要）
└── 9. Examples & Anti-patterns
```

### 2.2 雙語版本

簡中 + 英文兩份 PDF。

### 2.3 工具

- **Figma** community brand guideline template
- 或 **Notion** 直接 publish 一個 brand site（更新方便）

---

## 3. 投資人 Pitch Deck

### 3.1 結構（15 頁，Series A 標準）

```yaml
P1. Cover
  - "KuiperAI: Script to short drama in 3 minutes"
  - Founder name / date

P2. Problem
  - 短劇市場 2025 $5B → 2026 $10B
  - 創作者痛：1 集剪輯 3 天，成本高
  - 工作室痛：人力 bottleneck，接單上限
  - 品牌痛：傳統影視製作 4 週 + $50k

P3. Solution
  - 從劇本 → 成片 30 分鐘
  - 5 家視訊模型 router（不被綁架）
  - R2V 角色一致性（業界共同弱點）

P4. Demo（最重要）
  - 30 秒影片：上傳劇本 → 看到分鏡 → 看到成片
  - 真實 Studio plan user 的作品

P5. Market
  - TAM: $10B（短劇 + 廣告 + 教育 + 個人創作）
  - SAM: $1.5B（AI 視訊工具）
  - SOM: $50M（短劇垂直）

P6. Product
  - 33 mockup 全景圖
  - 創作流 6 步
  - 雙語 i18n

P7. Traction（早期）
  - 註冊 / 付費 / MRR / NPS
  - 創作者 testimonials
  - 媒體報導

P8. Business Model
  - 4 階梯訂閱（Free / Creator $15 / Studio $47 / Team $119）
  - 加購點數
  - B2B 直銷（Team / Enterprise）

P9. Competition Matrix
  - vs Krea / Higgsfield / Dreamina
  - KuiperAI 獨家：失敗免扣 + 多 router + 短劇焦點

P10. Go-to-Market
  - 中文圈優先（小紅書 / 抖音）
  - 創作者 program
  - B2B sales 18 個月後啟動

P11. Financials（3 年 projection）
  - Year 1: 30k users / $50k MRR
  - Year 2: 200k users / $400k MRR
  - Year 3: 800k users / $2M MRR

P12. Team
  - Founders backgrounds
  - 創辦人為什麼有資格做這個
  - Advisors

P13. Use of Funds（如果在募資）
  - 60% Engineering（5 sentinel hire）
  - 20% Marketing
  - 10% Compliance / Legal
  - 10% Runway buffer

P14. Vision（5 年）
  - 從短劇平台 → AI 影視製片廠
  - 廣告 / 教育 / 微電影 多 vertical
  - 開放 marketplace（剪輯師 / 編劇 / 配音）

P15. Contact + CTA
  - 聯絡方式
  - 邀請 sneak peek
  - 後續會議邀請
```

### 3.2 設計要求

- 16:9 ratio（投影/視訊用）
- 一頁一個重點（不密集塞文字）
- 多用 mockup 截圖（最有說服力）
- 數字加大字顯示（單頁 1-2 個 KPI）
- 暗色背景配合品牌（用 tokens.css）

### 3.3 工具

- **Pitch.com**（最快、雲端協作）
- **Keynote**（Mac 用、品質高）
- **Slidev**（dev 友善、可程式碼控制）

---

## 4. BD / Sales Deck（給工作室客戶用）

### 4.1 差異於投資人版

- 不講估值 / financials
- 多講「你怎麼用 KuiperAI 賺更多」
- 加 ROI calculator（手動 vs AI 成本對比）
- 客戶 case study + testimonial 為主

### 4.2 結構（10 頁）

```yaml
P1. Cover
P2. 你（工作室 / 品牌）的痛
P3. KuiperAI 怎麼解
P4. 1 集成本對比表
  - 傳統剪輯 $500/集
  - KuiperAI Studio $1.5/集（5,000 點 ÷ 1,200 點/集）
P5. Case Study A（個人創作者）
P6. Case Study B（小型工作室）
P7. 月度 ROI 計算
  - 假設你月接 5 集
  - 傳統：$2,500 成本 + 15 工時
  - KuiperAI：$47 + 2 工時 / 集 = 10 工時
  - 你省 $2,453 + 5 工時 = $2,953/月
P8. 上線體驗（demo 步驟）
P9. 定價
P10. CTA: 免費試用 14 天
```

---

## 5. 媒體 Press Kit

### 5.1 內容

```yaml
press-kit/
├── company-fact-sheet.pdf       1 頁：公司資訊、創辦人
├── product-overview.pdf         5 頁：產品介紹
├── press-release.docx           Launch news release（中英）
├── ceo-bio.pdf
├── screenshots/
│   ├── landing.png
│   ├── creator-workflow.png
│   ├── narrative-editor.png
│   └── final-output.png
├── product-videos/
│   ├── 30s-overview.mp4
│   ├── 60s-feature-tour.mp4
│   └── 3min-deep-dive.mp4
├── logo-pack/                   logo 全套
└── high-res-photos/             創辦人 / 辦公室
```

### 5.2 雙語

中英文兩套，分開資料夾。

### 5.3 公開連結

- press@kuiperai.com 信箱
- /press 頁面（press kit download）
- 媒體查詢回應 SLA: 24 小時

---

## 6. 社群媒體 Assets

### 6.1 每個平台需求

| 平台 | Avatar | Cover | Post template |
|---|---|---|---|
| Twitter / X | 400×400 | 1500×500 | 1200×675 |
| LinkedIn | 400×400 | 1584×396 | 1200×627 |
| 小紅書 | 200×200 | 870×400 | 1080×1440 |
| 微博 | 180×180 | 920×300 | 1024×1024 |
| Instagram | 320×320 | — | 1080×1080 / 1080×1350 |
| YouTube | 800×800 | 2560×1440 | 1280×720 thumbnail |
| Discord | 512×512 | 960×540 | — |

### 6.2 Post template（給 marketing team 重用）

```yaml
Type 1: Feature announcement
  - Header: 功能名 + emoji
  - Body: 1-2 句話講價值
  - Visual: mockup 截圖（已有 33 個）
  - CTA: 連結到 docs

Type 2: Creator spotlight
  - Header: @creator 標籤
  - Body: 創作者引述
  - Visual: 他們的成片
  - CTA: 看作品

Type 3: Educational
  - Header: 教學主題
  - Body: 1-2 個 tip
  - Visual: GIF / before-after
  - CTA: docs 連結
```

---

## 7. 簡報 Template

### 7.1 內部用 Slidev template

```yaml
theme: kuiper-dark
features:
  - Cinematic Immersive 色系
  - Cover slide（K logo + title）
  - Section divider
  - Content slide（左圖右文 / 大標 / 列表）
  - Stats slide（大數字）
  - Quote slide（創作者引述）
  - Q&A slide
  - End slide（CTA）
```

### 7.2 設計要求

- 跟 mockup 一致（用 tokens.css palette）
- 中英雙語切換
- Open source on GitHub（投資人 / 內部都能用）

---

## 8. Launch 用 PR 套裝

### 8.1 媒體查詢回應模板

```
Hi [Media Name],

Thanks for reaching out about KuiperAI.

KuiperAI is the AI short drama generator that takes creators from
script to final cut in 3 minutes. We launched on [date] and have
since served [X] creators producing [Y] episodes.

Happy to chat. Available [times].

Best,
[Founder name]
[Email]
```

### 8.2 預先準備的故事 angles

1. **「中國團隊 vs 矽谷 AI 工具」** — 文化垂直
2. **「失敗免扣是業界首發」** — User-friendly angle
3. **「5 家模型 router」** — Tech angle
4. **「短劇市場規模化」** — Business angle
5. **「創作者經濟新工具」** — Creator economy angle

每個 angle 預先寫好 200 字 quote 給媒體用。

---

## 9. 落地清單

### 9.1 Pre-launch（T-12 → T-1 週）

- [ ] Logo 外包 brief + designer 找好（T-12）
- [ ] Logo 終稿 + 全套 variant（T-8）
- [ ] 品牌指南雙語起草（T-6）
- [ ] 品牌指南 review + publish（T-4）
- [ ] 投資人 Pitch Deck 15 頁 final（T-4）
- [ ] BD Sales Deck 10 頁 final（T-3）
- [ ] Press Kit 雙語完成（T-2）
- [ ] 社群媒體 assets 全套（T-2）
- [ ] 簡報 template 完成（T-2）
- [ ] Launch press release 雙語（T-1）

### 9.2 Launch Day

- [ ] Logo 換進所有 mockup（取代 K placeholder）
- [ ] Press kit 上線 /press
- [ ] 媒體查詢 email 啟用

### 9.3 Post-launch

- [ ] Pitch deck 隨時更新最新數據
- [ ] 月度 brand audit（檢查 logo 用法是否正確）
- [ ] 每月新增 1 個 case study 進 Sales Deck

---

## 10. 預估成本

| 項目 | 一次性 | 月度 |
|---|---|---|
| Logo 外包（Toptal） | $5,000 | — |
| 品牌指南設計 / 排版 | $1,500 | — |
| Press Kit 影片製作 | $3,000 | — |
| 簡報 template 設計 | $1,000 | — |
| 社群媒體 assets 設計 | $1,500 | — |
| 創辦人 photoshoot | $500 | — |
| PR Agency retainer（可選） | — | $3,000 |
| **總** | **$12,500** | **$3,000（可選）** |

---

**H + I + J 完成。** 加上 A + B + C + D + E + F + G，共 **10 份規劃文件**。

完整的「實作前 + launch 前」想清楚階段結束。

下一步：找律師 / 找 designer / 啟動 OAuth 申請 → 同時開動 Phase 2 schema migration。
