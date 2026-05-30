# I · 創作者 Onboarding + 樣板劇本庫

> **目標：** Launch 時新 user 不會「打開不知道做什麼」。提供 6-12 個可一鍵 clone 的樣板劇本 + 完整教學內容 + 社群運營。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** A-schema（templates 機制）+ H-marketing（creator program）

---

## 0. TL;DR

- **6 個 launch 樣板劇本**（covers 短劇主流類型，含完整角色設定 + 場景 + 對白）
- **5 段教學影片**（YouTube 上架，每段 3-5 分鐘）
- **3 層文檔知識庫**（快速入門 / 深度教程 / API 參考）
- **2 個社群**（Discord 國際 + WeChat 群中文）
- **Creator badges**（解鎖系統，激勵長期創作）

---

## 1. 6 個樣板劇本（Launch 必備）

### 1.1 「霧城獵人」· 都市懸疑

```yaml
Template ID: tpl-mystery-fog-city
Genre: 都市懸疑 / 短劇
Duration: ~60s (8 panels)
Mode: R2V_with_subjects（主力）

Elements 預設:
  Characters:
    - 林夜（主角）: 獵人，男 28，深沉
    - 怪物：黑霧形體
  Locations:
    - 巷弄（夜，霧）
    - 巷盡頭
  Props:
    - 油燈
    - 手槍

Script preview:
  「夜，霧城東區巷弄。@林夜 持 @油燈 步入。
   遠處低吼，@林夜：『這霧不對勁⋯⋯』」

Why 這個樣板:
  - 角色少（2）容易上手
  - 場景一致（巷弄）
  - 對白少（5 句）
  - 已是 mockup 主軸，無縫 demo
```

### 1.2 「時光寄信人」· 都市奇幻

```yaml
Template ID: tpl-fantasy-letter
Genre: 都市奇幻
Duration: ~75s (10 panels)
Mode: T2I→I2V（用於關鍵幀美感）

Elements:
  Characters:
    - 阿信（主角）: 郵差，男 35，溫暖
    - 老婆婆: 70 歲，慈祥
  Locations:
    - 老街郵局
    - 雪夜街道
  Props:
    - 信封
    - 郵車

特色: 多 keyframe 細節（適合 T2I→I2V 展示）
```

### 1.3 「沙漠遺骨」· 古裝懸疑

```yaml
Template ID: tpl-period-desert
Genre: 古裝懸疑
Duration: ~90s (12 panels)
Mode: R2V_with_motion_ref（鏡頭運動複雜）

Elements:
  Characters:
    - 古星圖（主角）: 考古學家，男 40
    - 沙漠盜匪 ×3
  Locations:
    - 沙漠遺址
    - 古墓內
  Props:
    - 火把
    - 古地圖
    - 短刀

特色: 動作場景多，展示 motion ref 能力
```

### 1.4 「深海訪客」· 科幻短劇

```yaml
Template ID: tpl-scifi-deep-sea
Genre: 科幻
Duration: ~60s (8 panels)
Mode: R2V_with_subjects

Elements:
  Characters:
    - 深海科學家（主角）
    - 神祕生物
  Locations:
    - 潛水艇內
    - 深海
  Props:
    - 潛水頭盔
    - 探照燈

特色: 視覺風格獨特（藍黑色調）展示 style preset
```

### 1.5 「便利店悸動」· 都市愛情

```yaml
Template ID: tpl-romance-convenience
Genre: 都市愛情
Duration: ~45s (6 panels)
Mode: R2V_with_subjects

Elements:
  Characters:
    - 男孩（高中生）
    - 女孩（高中生）
  Locations:
    - 便利店夜
    - 街角
  Props:
    - 飯糰
    - 雨傘

特色: 短而精，新手友善（6 panels）
```

### 1.6 「品牌新品上市」· 廣告短劇樣板

```yaml
Template ID: tpl-brand-launch
Genre: 廣告 / 品牌
Duration: ~30s (4 panels)
Mode: R2V_with_subjects + 真實 product 圖

Elements:
  Characters:
    - 品牌 spokesperson
  Locations:
    - 都市街景
    - 室內
  Props:
    - 品牌 product placeholder

特色: 給品牌方看「我們可以拍廣告」
       明確 commercial use 範例
```

---

## 2. 樣板劇本實作

### 2.1 Schema 補丁（補進 A 文件）

```prisma
model ProjectTemplate {
  id              String   @id @default(cuid())
  slug            String   @unique          // tpl-mystery-fog-city
  name            String                    // "霧城獵人"
  genre           String                    // "都市懸疑"
  description     String   @db.Text

  // 預設內容（snapshot of Project + Episodes + Characters + Locations + Props）
  contentJson     Json                      // 完整可 clone 的 state

  // Stats
  cloneCount      Int      @default(0)
  rating          Float    @default(0)

  // Featured
  isFeatured      Boolean  @default(false)
  featuredOrder   Int?

  // 預覽
  previewVideoUrl String?
  thumbnailUrl    String?

  createdAt       DateTime @default(now())

  @@index([genre, isFeatured])
}
```

### 2.2 Clone 流程

```typescript
// /api/template/{slug}/clone
async function cloneTemplate(slug: string, userId: string, workspaceId: string) {
  const template = await prisma.projectTemplate.findUnique({ where: { slug } });

  // 1. 創建新 project
  const project = await prisma.novelPromotionProject.create({
    data: {
      title: `${template.name}（我的版本）`,
      workspaceId,
      ownerId: userId,
      templateClonedFrom: slug,
    }
  });

  // 2. 從 contentJson 復原 episodes / characters / locations / props
  await replayTemplateContent(project.id, template.contentJson);

  // 3. 不立刻生成 — 留給 user 看劇本 / 改 element 後再 trigger
  return project;
}
```

### 2.3 樣板更新政策

- 樣板每月 review，新增 2-3 個熱門 genre
- 創作者作品可申請為 community template（rev share 50%）

---

## 3. 教學影片內容

### 3.1 5 段官方影片（YouTube + B站 + 小紅書）

**01 · 60s 上手影片**（必看）

```yaml
Title: "60 秒搞懂 KuiperAI · 从剧本到成片"
Length: 60 秒
內容:
  0-10s: 「短劇創作者 30 分鐘出 1 集」hook
  10-25s: 上傳劇本 / 點分析
  25-40s: 看到自動拆鏡 + Elements
  40-55s: 點開始生成 / 看見成片
  55-60s: 「開始你的第一集」CTA
```

**02 · 3 分鐘樣板選擇**

```yaml
Title: "從 6 個樣板找你的第一部短劇"
Length: 3 分鐘
內容:
  講解 6 個樣板適合什麼類型創作者
  一鍵 clone + 改劇集設定 + 渲染
```

**03 · 5 分鐘角色 / 場景設定教學**

```yaml
Title: "劇集設定 · 角色 / 場景 / 道具 完整教學"
Length: 5 分鐘
內容:
  - 怎麼從劇本抽出 elements
  - 多 appearance 切換
  - Reference 圖品質要點（真人臉政策）
  - 跨專案匯入
```

**04 · 4 分鐘配音教學**

```yaml
Title: "5 語言 TTS 配音 + 對白優化"
Length: 4 分鐘
內容:
  - 對白選音色 / 改情緒
  - 多語切換
  - 自動對齊到分鏡
```

**05 · 4 分鐘成片發布**

```yaml
Title: "一鍵發抖音 / 小紅書 / IG / YT"
Length: 4 分鐘
內容:
  - 三種 aspect ratio 切換
  - 字幕燒錄
  - 一鍵發到各平台
  - 公開廣場 vs 私人連結
```

### 3.2 進階系列（每月更新）

- 「鏡頭運動 Cinema Preset 70+ 解析」
- 「R2V vs T2I→I2V 什麼時候選哪個」
- 「失敗如何 debug」
- 「劇本怎麼寫 AI 才不會出錯」

---

## 4. 知識庫結構

### 4.1 三層架構

```
KuiperAI Docs
├── 快速入門（Quick Start）
│   ├── 5 分鐘上手
│   ├── 從樣板開始
│   ├── 自己寫第一個劇本
│   └── 第一個成片發布
├── 深度教程（Tutorials）
│   ├── 劇本寫作技巧
│   ├── Element 設計
│   ├── R2V vs T2I→I2V 選擇
│   ├── 多鏡頭運動
│   ├── 配音細節
│   └── 後期合成
├── 平台功能（Features）
│   ├── 每個 mockup 對應一篇 deep dive
└── API 參考（Developers，Team plan）
    ├── REST API
    ├── Webhook
    └── 程式碼範例
```

### 4.2 工具選擇

- **Docusaurus**（自家託管 + React-based + i18n 內建）
- 或 **GitBook**（最快上線、SaaS）

### 4.3 雙語策略

- 簡中為主（覆蓋 70% user）
- 英文同步維護（國際 SEO + 英文 user）
- 翻譯流程：簡中先寫 → DeepL/Claude 翻 → 人工 review → publish

---

## 5. 社群運營

### 5.1 Discord（國際）

```yaml
頻道結構:
  📌 公告 / Announcements
  👋 自我介紹 / Introductions
  💡 想法 / Ideas-feedback
  🎬 作品分享 / Showcase
  🆘 求救 / Help
  📚 教學 / Resources
  🐛 Bug 回報 / Bug-reports
  🌐 i18n 翻譯協作
  🎭 #zh-cn（中文房）

開放時間 (PT): 09:00-18:00 工程師輪值
週末: 創作者社群輪值

特殊機制:
  - Verified Creator 角色（10+ 作品）
  - Early Access 角色（內測 user）
  - Top Contributor 月度評選
```

### 5.2 WeChat 群（中文）

```yaml
群結構:
  1. 主群 (200 人滿封)
  2. 創作者 VIP 群 (Studio+ 訂閱)
  3. 工作室 B2B 群 (Team 訂閱)
  4. 開發者群 (API user)

入群:
  - 主群：免費，掃 QR
  - VIP 群：訂閱 Studio+ 自動拉
  - B2B 群：銷售 outreach
  - 開發者群：申請 API key 自動拉

運營:
  - 每週 1 次社群活動（直播 / AMA）
  - 創作者作品週榜
  - 月度創作大賽
```

### 5.3 小紅書 / 微博官方號

```yaml
小紅書 (@KuiperAI官方):
  - 每天 1 篇創作者作品 reshare
  - 每週 1 篇教學
  - 每月 1 次大型活動
  目標: launch 後 6 個月 5 萬粉

微博:
  - 主要做話題互動
  - 不主推 launch 流量
  - launch 後做 PR 槓桿
```

---

## 6. Creator Badges 系統

### 6.1 解鎖系統設計

```yaml
Newbie Badges (任何人可解):
  🎬 First Cut    - 完成第一個 episode
  ✨ First Share  - 第一次 public share
  📚 Library Builder - 創建第一個 Element

Creator Badges (難度增加):
  🏆 Episode Master - 累計 10 個 episode
  🎭 Cast Director - 創建 5 個 character
  🎨 Cinematic Eye - 使用 50 個 Cinema preset
  💎 Studio Quality - 任一作品 1k+ likes

Pro Badges (重度創作者):
  👑 Series Maker - 完成 5 集連續劇集
  🌟 Top 100 - 入選月榜 top 100
  💼 Brand Partner - 接到品牌方訂單

Special Badges (限時 / 活動):
  🎂 Launch Day - 註冊在 launch 24h 內
  🏆 OG - 註冊在 launch 前 30 天
  🌍 Polyglot - 用 3+ 語言 TTS 創作
```

### 6.2 Badge 顯示位置

- 公開頁 creator card（mockup 31）
- 廣場 work card meta（mockup 32）
- Profile page
- Discord role auto-sync

### 6.3 獎勵機制

```yaml
Badge 累計獎勵:
  10 badges → 50 點數
  25 badges → 200 點數 + Discord VIP role
  50 badges → 1000 點數 + 創作者 spotlight 候選
  100 badges → 「Verified Creator」終身認證 + 免費 Studio plan 終身
```

---

## 7. Launch Week 內容日曆

```yaml
Day -7 (Sun):
  - "Why we built KuiperAI" 創辦人故事

Day -6:
  - 首批 50 創作者 spotlight 預告

Day -5:
  - 6 個樣板 demo 全集

Day -4:
  - 失敗免扣承諾 deep dive

Day -3:
  - 5 模型 router 技術揭秘

Day -2:
  - 創作者邀請函（公開版）

Day -1:
  - Launch 倒數 + 早鳥 invite code

Day 0 LAUNCH:
  - Product Hunt + HN + 全平台同步

Day +1:
  - Launch 數據公開 + 感謝信

Day +2 to +7:
  - 每天 1 個創作者 spotlight
  - 每天 1 個技術 deep dive

Day +8 to +14:
  - 案例研究 ×3
  - SEO content 開始

Day +30:
  - 30 天 retrospective + 公開數據
```

---

## 8. 落地清單

### 8.1 Pre-launch（T-8 → T-1 週）

- [ ] 6 個樣板劇本內容寫好（含完整 element 預設）
- [ ] 樣板 schema migration + clone API
- [ ] 5 段教學影片錄製 + 雙語字幕
- [ ] Docusaurus 知識庫架構 + 20+ 文章
- [ ] Discord server 開好 + Bot 設定
- [ ] WeChat 群 QR code + 群規
- [ ] 小紅書 / B 站 / Twitter 官方號開
- [ ] Badge 系統 schema + 解鎖邏輯
- [ ] Launch week 內容日曆排好

### 8.2 Launch Day

- [ ] 6 個樣板出現在 onboarding step 2
- [ ] Discord 入口 link 在 footer
- [ ] WeChat 群 QR 在 sidebar
- [ ] 5 段教學影片 embed 在 docs

### 8.3 Post-launch（T+1 → T+30）

- [ ] 每天創作者作品 spotlight
- [ ] 每週 1 次社群活動
- [ ] 第一個 case study（找 1 個成功創作者）
- [ ] Badge 解鎖通知測試
- [ ] 知識庫 article 累計 50+

---

## 9. 預估成本

| 項目 | 一次性 | 月度 |
|---|---|---|
| 6 樣板劇本創作（外包編劇） | $3,000 | — |
| 5 教學影片製作（自家 + 外包後製） | $2,000 | — |
| Docusaurus host (CF Pages 免費) | — | $0 |
| Discord Bot 開發 | $500 | — |
| 社群運營（兼職） | — | $2,000 |
| 翻譯（簡中 → 英文） | — | $500 |
| **總** | **$5,500** | **$2,500** |

---

**下一份：** J-brand-pitchdeck.md
