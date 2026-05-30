# H · Marketing 與 Launch 策略

> **目標：** 把上線時要做的 messaging、target audience、launch 通路、廣告策略全列。Launch 不是「按 deploy」— 是 30 天密集 campaign。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** D-pricing（4 階梯數字）+ G-legal（公開內容合規）

---

## 0. TL;DR

- **定位：** KuiperAI = 「让短剧创作者从剧本到成片，3 分钟出第一版」的 AI 影视工厂
- **3 大目標客戶：** 個人短劇創作者 / 小型工作室 / 品牌行銷
- **Launch 主戰場（中文圈）：** 小紅書 / 抖音 / 微信公眾號 / X / Product Hunt
- **Launch 預算：** ~$15,000（廣告 $8k + KOL $4k + PR $3k）
- **Launch 30 天目標：** 5,000 註冊 / 500 付費 / $15k MRR

---

## 1. Brand Positioning

### 1.1 一句話定位

```
中文：把剧本变成短剧 — 3 分钟出第一版
英文：From script to short drama — first cut in 3 minutes
```

### 1.2 為什麼選「短劇」這個 niche

| 為什麼 | 細節 |
|---|---|
| **市場急速成長** | 2025 中國短劇市場 $5B，2026 預估 $10B（QuestMobile） |
| **痛點清晰** | 創作者真實 pain：剪 1 集要 3 天，AI 可降到 30 分鐘 |
| **競品空缺** | Krea / Higgsfield 通用、沒專做短劇；Dreamina 後端強但 UI 弱 |
| **變現路徑** | 短劇平台分潤（拍片人有現金流）、品牌廣告（B2B 訂單） |

### 1.3 跟對手差異化

| | KuiperAI | Krea | Higgsfield | Dreamina |
|---|---|---|---|---|
| **垂直焦點** | 短劇 | 通用視訊 | 通用視訊 | 通用視訊 |
| **多 provider router** | ✅ 5 家 | ✅ 5 家 | ❌ 自家 | ❌ 自家 |
| **角色一致性（R2V）** | ✅ 預設 | 半自動 | ✅ Soul ID | 半自動 |
| **失敗免扣點數** | ✅ | ❌ | ❌ | ❌（最常被罵） |
| **多語 TTS 配音** | ✅ 5 語言 | ❌ | ❌ | ✅ |
| **一鍵發布平台** | ✅ 抖音/小紅書/IG/YT | ❌ | ❌ | ✅ |

**獨家賣點（Top 3）：**
1. **失敗不扣點** — 業界首發、可寫進 marketing 標語
2. **5 模型同個畫布** — 不被單家綁架
3. **短劇導演級控制**（70+ 鏡頭運動 preset，偷 Higgsfield Cinema Studio）

---

## 2. Target Audience（3 大族群）

### 2.1 個人短劇創作者（70% 量）

```yaml
Profile:
  - 22-35 歲
  - 已在小紅書 / 抖音 發過影片
  - 有 1,000+ 粉絲（micro-influencer）
  - 想拍劇但被剪輯時間卡死
  - 預算敏感：$15-50/月可接受

Persona: 林夕
  小紅書 8 萬粉，週末拍懸疑短劇，自編自導自演
  痛點：1 集要 3 天剪輯，週末只能出 1 集
  目標：1 天剪 1 集，週更 5 集

Reach via:
  - 小紅書 KOL 合作（找 5-50 萬粉的剪輯/AI 類創作者）
  - YouTube 創作者教學
  - 抖音 AI 視訊話題標籤
```

### 2.2 小型工作室（20% 量、60% 收入）

```yaml
Profile:
  - 2-10 人團隊
  - 接廣告 / MCN 短劇代工
  - 月接案 5-20 集
  - 工具預算 $200-2000/月

Persona: 霧城工作室（虚构）
  3 人 + 1 業務，接 MCN 短劇代工
  月產 12 集，每集 $500 客戶費
  痛點：人力是 bottleneck，想用 AI 接更多單

Reach via:
  - LinkedIn outreach
  - 抖音 MCN 商務合作
  - 影視論壇（虎扑 / 数英网）
```

### 2.3 品牌行銷（10% 量、30% 收入潛力）

```yaml
Profile:
  - 電商 / 消費品牌 marketing
  - 想做品牌短劇廣告（vs 純素材剪輯）
  - 預算 $2000-10000/單次 campaign

Persona: 品牌方主管
  飲料品牌新品上市，想拍系列短劇引流小紅書
  痛點：傳統製作 1 個月 + $50k，AI 可壓到 1 週 + $5k
  目標：season 6 集，2 週內全套出

Reach via:
  - 直銷團隊（launch 後 3 個月開始）
  - LinkedIn ads（targeting marketing 標題）
  - 案例研究（找 1-2 個願意背書的品牌）
```

---

## 3. Messaging Hierarchy

### 3.1 主標題 (H1)

```
中：把剧本变成短剧 — 3 分钟出第一版
英：Script to short drama in 3 minutes
```

### 3.2 副標題 (H2)

```
中：上传剧本，AI 帮你拆镜、选角、配音、出片。
英：Upload script, AI handles shots, casting, voice, output.
```

### 3.3 三個 Value Prop

| Prop | 一句話 | 截圖位置 |
|---|---|---|
| **快** | 一集 30 分鐘 vs 傳統剪輯 3 天 | 配音前後對比 video |
| **省** | $50/月 vs 外包剪輯 $500/集 | Pricing 對比表 |
| **穩** | 失敗不扣點 + 5 家 model 互補 | Trust badges |

### 3.4 信任元素

- 「失敗不扣點數 · 業界首發」（首頁 badge）
- 「5 家視訊模型同個畫布」（pricing 頁）
- 「無需信用卡開始」（landing CTA 下）
- 創作者引述（landing showcase）
- 媒體報導（launch 後補）

### 3.5 反訴求（避免被當「假 AI 廣告」）

- 不說「100% 取代人」（會被嫌假）
- 不說「比 Krea 好」（會被告）
- 不顯示完美無瑕的影片（會被嫌不真實）
- **顯示真實創作者的真實作品**（refer to mockup 31）

---

## 4. Launch Plan（30 天）

### 4.1 Pre-launch（T-14 → T0）

```yaml
T-14 週:
  - 找 20 個微網紅（5,000-50,000 粉）內測
  - 給 6 個月 Studio plan 免費換評測

T-10 週:
  - 內測 user 開始發創作
  - 蒐集 50+ 影片作品

T-8 週:
  - Press release 寫好
  - 預告 landing page 上線（收 email）
  - Twitter / 小紅書 開官方帳號

T-4 週:
  - 早鳥優惠開放（Lifetime 50% off）
  - 邀請名單發 invite code（5,000 個）

T-1 週:
  - Product Hunt 預告
  - 媒體 outreach（36kr / TechCrunch / The Verge / Decoder）
  - YouTuber 評測影片排好（同日 launch）
```

### 4.2 Launch Day (T0)

```yaml
06:00 PT  Product Hunt 上線（搶當日 #1）
09:00 PT  Twitter / X 帖子 + 創辦人 thread
10:00 PT  Hacker News 主動 submit
12:00 PT  小紅書 + 微博官方號發文
14:00 PT  Email 通知 5,000 邀請名單
全天     YouTuber / TikToker / 小紅書 KOL 同步推
17:00 PT  Discord / WeChat 群 launch party
```

**目標：** PH #1, HN front page, 24h 內 1,500 註冊

### 4.3 Post-launch（T+1 → T+30）

```yaml
T+1 to T+7:
  - 每天 1 篇 launch post-mortem
  - 創作者作品 spotlight（每天精選 1 個）
  - 客服全力應對

T+8 to T+14:
  - 上線首批 case studies（3-5 個成功創作者）
  - SEO content 開始（每週 2 篇）
  - 廣告投放開（小額測試）

T+15 to T+30:
  - 觀察 retention cohort
  - 第 1 次 A/B test（onboarding flow）
  - 媒體跟進報導
  - Reddit AMA（r/StableDiffusion / r/Filmmakers）
```

---

## 5. Channel Strategy（投放管道）

### 5.1 中文圈優先

| 平台 | 投放方式 | 月預算 | 預期 ROAS |
|---|---|---|---|
| **小紅書** | KOL 種草（5-50萬粉，5-15 條/月） | $3,000 | 3-5× |
| **抖音 / 巨量引擎** | 信息流 + KOL feed | $2,000 | 2-4× |
| **微信公眾號** | 大號軟文（影視 / AI 類） | $1,000 | 2-3× |
| **B 站** | UP 主合作 | $500 | 3-4× |
| **微博** | 話題運營 | $200 | 1-2× |

### 5.2 國際

| 平台 | 投放方式 | 月預算 | 預期 ROAS |
|---|---|---|---|
| **Twitter / X** | 創辦人 thread + 廣告 | $1,500 | 2-3× |
| **Reddit ads** | r/StableDiffusion / r/Filmmakers | $500 | 2× |
| **YouTube** | Pre-roll + 創作者贊助 | $1,500 | 2-3× |
| **Google Search** | "ai short drama generator" 等 | $1,000 | 3-5× |
| **Product Hunt** | Launch sponsoring | $300 | 直接流量 |

### 5.3 月度 marketing 總預算

```
- Paid ads:        ~$12,000/月
- KOL/influencer:  ~$4,000/月
- Content/SEO:     ~$2,000/月
- PR:              ~$1,500/月
- Tools:           ~$500/月
總:                ~$20,000/月
```

**目標：** Month 3 達到 1,500 paid users，MRR $50k+，marketing 自負盈虧。

---

## 6. SEO 策略

### 6.1 主關鍵字

```yaml
高轉換:
  - "AI 短剧 生成"
  - "短剧脚本 AI"
  - "AI script to video"
  - "short drama AI generator"

中轉換:
  - "AI 视频生成 工具"
  - "Seedance 2.0 教程"
  - "Kling AI 多镜头"

長尾:
  - "小红书短剧 制作教程"
  - "如何用 AI 拍 1 分钟短剧"
  - "AI 角色一致性 工具"
```

### 6.2 內容策略

每週 2 篇：
- 1 篇教程（how-to）
- 1 篇案例研究（creator story）

每月 1 篇深度比較（vs Krea / Higgsfield / Dreamina）— 不貶低，但展示我們的 niche 強項。

### 6.3 Backlink

- 媒體報導（36kr / TechCrunch）
- 創作者作品署名（每個成片自動 watermark + 帶 backlink）
- 開源元件 GitHub（i18n library / Cinema preset library 可開源）

---

## 7. Creator Program（早期重點）

### 7.1 Launch 前 50 個創作者

```yaml
Criteria:
  - 1,000+ 粉絲（任何平台）
  - 過去 30 天有發創作
  - 願意每週發 1 個 KuiperAI 作品

Benefits:
  - 6 個月 Studio plan 免費
  - 早期 logo 標籤
  - 官方號 reshare
  - 收入分成 30%（Public showcase 觀看分潤）
```

### 7.2 持續扶持機制

- Monthly creator spotlight（landing showcase rotate）
- Discord/WeChat 群（互相切磋）
- Beta access（新功能先試）
- Annual creator summit（線上 + offline）

---

## 8. PR 策略

### 8.1 媒體 target list

**中文：**
- 36 氪 / 虎嗅 / 雷鋒網（科技類）
- 烽火戏诸侯 / 一鸣视频（影視類）
- 数英网 / Top数字传播（廣告類）

**英文：**
- TechCrunch（AI / Startup）
- The Verge（AI consumer）
- Decoder podcast
- a16z / Sequoia blog（如果有融資角度）

### 8.2 PR 角度

| Angle | 對誰說 |
|---|---|
| **「失敗不扣點業界首發」** | 消費科技媒體（user 友善議題） |
| **「5 家模型 router」** | 技術媒體（架構議題） |
| **「短劇 AI 規模化」** | 商業媒體（產業議題） |
| **「中國團隊 vs 矽谷工具」** | 中文媒體（地緣議題） |

---

## 9. Launch 30 天目標

| 指標 | 30 天目標 |
|---|---|
| 註冊 | 5,000 |
| Activation（first episode） | 750 (15%) |
| Paid conversion | 500 (10% of activated) |
| MRR | $15k |
| 公開作品 | 3,000+ |
| Twitter followers | 5,000 |
| 小紅書 followers | 10,000 |
| 媒體報導 | 5+ 篇 |
| Discord/WeChat | 1,000 |

---

## 10. 落地清單（按時程）

**T-12 週：**
- [ ] Brand positioning lock + messaging final
- [ ] Persona profiles 寫好
- [ ] 找 PR agency（或自己 outreach）
- [ ] 開始 inventory 50 個 launch 創作者

**T-8 週：**
- [ ] 預告 landing page（收 email）
- [ ] 官方 Twitter / 小紅書 / 微博 開
- [ ] Press kit 寫好（logo / screenshots / fact sheet）
- [ ] PR list 50+ contacts

**T-4 週：**
- [ ] Product Hunt 預告 + maker profile
- [ ] 早鳥 invite code 寄出
- [ ] YouTuber 評測影片 outreach + 寄試用

**T-1 週：**
- [ ] 媒體 embargo 信寄出
- [ ] 廣告 creative 準備好（10+ 版本 A/B）
- [ ] 客服腳本 + FAQ
- [ ] Launch day timeline 排好

**T0：** 看 §4.2 Launch Day timeline

**T+30：** Retro + 看數據 + 下季度策略

---

**下一份：** I-creator-onboarding-templates.md
