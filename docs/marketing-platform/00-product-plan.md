# KuiperAI 行銷平台 — 產品與技術規劃書(提案)

> **文件狀態:提案(Proposal),尚未拍板。**
> 依 `AUTONOMY_PROTOCOL.md`,本文所有 schema 變更與新 Phase 皆屬架構決策,需人類確認後才動工。
> 本文不屬於 `docs/ai-runtime/` 重構文件集;商業層開發必須架在 ai-runtime 統一重構完成的路徑之上,不得旁路。

日期:2026-08-20
撰寫:Claude(基於 codebase 盤點 + 市場痛點網路研究)

---

## 1. 一句話定位

**「品牌一致的行銷內容工廠」** — 從劇本/商品資訊一路到可投放的短影音成品,一個訂閱取代四個工具,計費透明、失敗退點、成效可歸因。

- **B2B**(主力營收):電商賣家、品牌行銷團隊、行銷代理商 — 團隊方案 + API。
- **B2C**(漏斗上層):自媒體創作者、小微電商 — 點數制 + 場景模板。

## 2. 市場痛點 → 產品支柱對照

(痛點來源:2026 年 Atlantic Re:think/Contentful 425 位行銷決策者調查、HubSpot State of GenAI、Adobe 社群抱怨、台灣行銷人雜誌短影音系列報導、訂閱疲勞統計。詳見研究紀錄。)

| # | 市場痛點 | 數據佐證 | 我們的產品支柱 | 現有基礎 |
|---|---|---|---|---|
| P1 | 內容同質化、沒有品牌記憶點,被平台演算法判為無效內容 | 53% 行銷人難以突圍;「內容太薄太通用」是抱怨第一名 | **品牌資產庫**:角色/風格/聲音/色彩鎖定,跨素材一致 | `GlobalCharacter`、`VisualStyle`、`VoicePreset`、style-library |
| P2 | 生成失敗照扣點、計費黑箱、退款難 | Adobe Firefly 等社群大量抱怨 | **透明計費**:生成前成本預估、失敗自動退點、修改折扣 | `BalanceFreeze`(預扣/釋放)、`model-pricing` catalog |
| P3 | 工具太碎(人均 4–7 個 AI 訂閱、月花 $100–200)、整合疲勞 | 50% 團隊同時用 6–10 個工具;40% SaaS 買了閒置 | **一條龍工作流**:劇本→分鏡→影片→配音→多平台輸出,單一訂閱 | run-runtime pipeline、BullMQ workers、Remotion |
| P4 | ROI 證明不了(僅 41% 能證明,且逐年下滑) | 數據碎片化、管理層要看業務成果 | **成效歸因報表**(B2B):素材→投放→轉換追蹤 | `UsageCost`、billing/reporting(需大幅擴充) |
| P5 | 學習曲線高、導入爛尾 | 89% 團隊自認有 AI 技能缺口 | **場景模板庫**:產業別 × 平台別開箱即用,不給空白 prompt 框 | prompt 模板系統、`Skill`/`SkillInstallation` |

**反面訊號(定位紅線)**:單純「AI 生圖生影片」是紅海且口碑下滑。「更好的模型」不可防禦;差異化只能建立在 P1–P5 的平台能力上。

## 3. 產品範圍(三階段)

### 階段 A — 垂直深化:「AI 行銷影片工作室」(建議起點)
把現有短劇/影片能力包裝成行銷產品:
- 短影音廣告、商品宣傳片、社群短劇(帶貨劇情)。
- 新增:行銷場景 prompt 模板(電商/餐飲/美妝/教育 × TikTok/Reels/Shorts)、多尺寸輸出(9:16 / 1:1 / 16:9)、品牌 kit(logo、色碼、字體、slogan 掛到 Workspace)。
- **不需要**新基礎設施,主要是模板 + 前台包裝 + 商業層。

### 階段 B — 橫向擴充:「行銷內容套件」
同一 runtime 上加輕量能力,每個 = 一個 worker handler + prompt 模板:
- 廣告文案/社群貼文/EDM 生成(純文字,便宜、高頻,拉 DAU)。
- 商品圖/banner 生成與改圖。
- 素材多版本 A/B 變體(同腳本 × 不同 hook/開場)。

### 階段 C — 開放市集(遠期,先不動工)
以 `Skill`/`SkillInstallation` 機制讓第三方上架行銷 AI 工具,平台抽成。前提:階段 A/B 已有付費用戶基數。

## 4. 定價模型草案

**混合制:訂閱(含月配點數)+ 加購點數包。** 這是 AI 影音類的市場慣例,但我們用三個差異化承諾打 P2 痛點:

1. **失敗不扣點**:任務終態為 failed → `BalanceFreeze` 全額釋放(機制已存在,寫進產品承諾)。
2. **生成前報價**:提交任務前顯示預估點數(pricing catalog 已可支撐)。
3. **修改折扣**:同一 run 的重生成(regenerate)按折扣計費,而非全額重扣。

### 方案表(草案,金額待市場驗證)

| 方案 | 對象 | 月費(USD) | 含點數 | 關鍵功能 |
|---|---|---|---|---|
| Free | 試用 | 0 | 少量一次性 | 浮水印輸出、公開模板 |
| Creator | 個人創作者 | ~19 | 中 | 去浮水印、全模板、1 個品牌 kit |
| Pro | 小微電商/自由行銷人 | ~49 | 高 | 多品牌 kit、A/B 變體、優先佇列 |
| Team | 品牌團隊/代理商 | ~199 起/席次計 | 團隊池 | Workspace 協作、審批流、成效報表 |
| Enterprise / API | 中大型企業 | 議價 | 用量計費 | API key、SLA、專屬模型配置、SSO |

- 點數消耗沿用 `model-pricing` catalog 的成本 + 目標毛利率(建議 60–70%,影片類毛利低於文字類,需分開定價)。
- Team/Enterprise 是營收主力;Free/Creator 是獲客漏斗。
- 台灣/華語市場收單:綠界或藍新;國際:Stripe。建議先只接 Stripe(工程量最小),華語收單列為後續。

## 5. 技術盤點

### 5.1 直接重用(已存在,不動)

| 能力 | 位置 |
|---|---|
| 點數帳本:餘額/預扣/流水/冪等 | `UserBalance`、`BalanceFreeze`、`BalanceTransaction` + `src/lib/billing/`(ledger/cost/money/reporting) |
| 多租戶 | `Organization`、`Workspace`、`WorkspaceMember`、`ProjectCollaborator`、`AuditLog`、`InviteCode` |
| API 產品化 | `ApiKey`、`ApiKeyUsage` + `src/lib/api-keys/` |
| AI 執行引擎 | run-runtime(GraphRun/GraphStep/GraphEvent)+ BullMQ workers + `src/lib/ai-runtime/` |
| 模型定價/能力目錄 | `src/lib/model-pricing/`、`model-capabilities` |
| 品牌資產雛形 | `GlobalCharacter`、`GlobalVoice`、`VisualStyle`、`LightingPreset`、style-library |
| 市集雛形 | `Skill`、`SkillInstallation` |

### 5.2 需新增(全部待拍板)

| 模組 | 說明 | 工程量 |
|---|---|---|
| **金流收單** | Stripe Checkout + webhook → 入點/開訂閱。目前 codebase **完全沒有**收單整合 | 中 |
| **訂閱/方案 schema** | `Plan`、`Subscription`、`PaymentOrder`、`QuotaGrant`(月配點數的發放/過期/重置) | 中 |
| **品牌 kit** | Workspace 層級的 logo/色碼/字體/語調設定,注入所有生成任務 | 小–中 |
| **行銷模板庫** | 產業 × 平台 prompt 模板(遵守 `.zh.txt`/`.en.txt` 雙語同步 guard) | 小(內容工作為主) |
| **多尺寸輸出** | Remotion 輸出 9:16/1:1/16:9 變體 | 小–中 |
| **成效歸因報表** | 素材 UTM/匯出 → 投放平台數據回流(先手動 CSV,後 API) | 大(Phase M3 才做) |
| **對外配額/限流** | API 與 Free 方案的 rate limiting | 小 |

### 5.3 Schema 草案(示意,待拍板後細化)

```prisma
model Plan {           // 方案定義(Free/Creator/Pro/Team/Enterprise)
  id            String  @id
  key           String  @unique   // "creator" | "pro" | ...
  monthlyCredits Decimal
  priceUsd      Decimal
  features      String  @db.Text  // JSON feature flags
  active        Boolean @default(true)
}

model Subscription {   // 使用者/組織 × 方案
  id                String   @id @default(uuid())
  ownerType         String   // "user" | "organization"
  ownerId           String
  planKey           String
  status            String   // active | past_due | canceled
  currentPeriodEnd  DateTime
  externalRef       String?  // Stripe subscription id
}

model PaymentOrder {   // 收單訂單(訂閱首購/續扣/點數包)
  id             String   @id @default(uuid())
  userId         String
  kind           String   // "subscription" | "credit_pack"
  amountUsd      Decimal
  creditsGranted Decimal?
  status         String   // pending | paid | failed | refunded
  provider       String   // "stripe"
  externalRef    String?  @unique
  idempotencyKey String?  @unique
}

model QuotaGrant {     // 月配點數批次(支援過期與重置,與加購點數分離)
  id        String   @id @default(uuid())
  userId    String
  source    String   // "subscription" | "purchase" | "promo"
  amount    Decimal
  remaining Decimal
  expiresAt DateTime?
}
```

> 設計原則:**收單(PaymentOrder)與帳本(BalanceTransaction)分離**,以 `externalOrderId` 對帳;月配點數走 `QuotaGrant` 先進先出扣抵,不污染現有 `UserBalance` 語義。細節待拍板後寫入正式設計文件。

## 6. 分階段路線圖

**前置依賴:ai-runtime 統一重構(現行 master plan)完成到商業層可依賴的程度。商業層一律走 `createRun` → worker → run-runtime,不得旁路(鐵則)。**

| Phase | 內容 | 出場條件(exit criteria) |
|---|---|---|
| **M0 定價與方案設計** | 確定方案表、點數匯率、毛利模型;人類拍板 schema | 拍板文件簽核 |
| **M1 商業層地基** | Plan/Subscription/PaymentOrder/QuotaGrant schema + Stripe Checkout/webhook + 配額扣抵邏輯 | `npm run test:regression` 全綠;BILLING_MODE ON/OFF 皆測 |
| **M2 行銷產品層** | 品牌 kit、行銷模板庫(雙語)、多尺寸輸出、定價頁/onboarding、失敗退點與生成前報價的產品化呈現 | 首批內測用戶可完整走完「註冊→訂閱→生成→輸出」 |
| **M3 B2B 深化** | Team 方案審批流、成效歸因報表 v1(UTM + CSV 回流)、API 方案(重用 ApiKey) | 首個付費 Team 客戶 |
| **M4 擴充/市集** | 文案/圖片輕量能力、Skill 市集商業化評估 | 依 M2/M3 數據決定 |

## 7. 風險與開放問題(需人類拍板)

1. **schema 變更**(第 5.3 節全部)— 依 AUTONOMY_PROTOCOL 必須拍板。
2. **收單商選擇**:先 Stripe-only 或同步接綠界/藍新?(影響 M1 範圍)
3. **定價數字**:方案表金額與點數匯率需市場驗證(建議先做 landing page + waitlist 測價)。
4. **品牌名**:行銷產品線是否沿用 KuiperAI 或另立品牌?
5. **既有短劇用戶**:現有點數/用戶如何映射到新方案(grandfather 條款)?
6. **合規**:對外開放後的內容審核(廣告法規、名人肖像、平台政策)與退款政策,M2 前必須有明確方案。
7. **與 master plan 的排程關係**:M1 是否等 ai-runtime Phase 6 完成後才開工,或並行?(建議:等,避免蓋在會拆掉的路徑上。)

## 8. 研究來源(痛點依據)

- Umgum — AI Marketing in 2026(Atlantic Re:think/Contentful 425 人調查)
- HubSpot — State of Generative AI in Marketing
- Brafton — 4 Biggest Challenges in AI Content Creation 2026
- Adobe Community — Firefly 影片生成扣點爭議多篇
- 行銷人雜誌(marketersgo.com)— 2026 短影音行銷系列報導
- SQ Magazine / GoNextMarketer — AI Marketing ROI 統計
- TechRT / Soloa — Subscription Fatigue 統計 2026
