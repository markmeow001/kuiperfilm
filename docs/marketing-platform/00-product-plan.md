# AI 行銷員工(暫名 LocalPulse)— 產品與技術規劃書 v2

> **文件狀態:提案(v2),待人類拍板。**
> v2 為完全重寫:v1 的「AI 行銷影片平台」方向已於 2026-08-20 由產品負責人裁定作廢——**新產品不含任何影片生成功能**。本文件為新方向的 single source of truth 草案;不修改、不影響 `docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md` 的任何內容與排程。

---

## 0. 版本沿革

| 版本 | 日期 | 內容 |
|---|---|---|
| v1 | 2026-08-20 | AI 行銷影片平台(短劇帶貨),北美市場 — **作廢** |
| v2 | 2026-08-20 | AI 行銷員工:趨勢雷達 + 聲譽管理 + 週報執行閉環,加拿大中小企業(華人商家優先) |

作廢理由:產品負責人決定完全脫離影片生成賽道,改做直接解決「商業行銷痛點」的營運型工具。

---

## 1. 一句話定位

**"Your $99/month marketing employee — it reads, thinks, and does."**

給沒有行銷人員的加拿大中小企業一個 AI 行銷員工:每週替老闆看數據、讀趨勢、給三個建議,老闆按一下核准,它就把事做完。

- **目標市場**:加拿大(第一優先:多倫多/溫哥華的**華人商家**——餐廳、美容、診所、留學移民服務、零售;第二階段擴及全體加拿大 local SMB)。
- **不做的事**:不做影片生成、不做通用內容工具、不做廣告投放代操。

## 2. 痛點依據(研究總結)

| # | 痛點(有數據支撐) | 我們的解法 |
|---|---|---|
| 1 | 50% 的 SMB 沒有任何行銷人員;老闆自己當行銷部 | 產品定位就是「員工」而非「工具」:主動做事,不是等人來用 |
| 2 | 只有 41% 團隊能證明行銷 ROI;數據碎在各平台 | 每週人話週報(敘事,不是 dashboard) |
| 3 | 平均訂 4–7 個工具、40% 買了沒用(訂閱疲勞) | 一個訂閱取代趨勢監測 + 評論管理 + 內容草稿多個工具 |
| 4 | 在地生意命脈是 Google 評論與本地搜尋;Podium 實付 $450–600/月、Birdeye $299–449/月/店,小店買不起;便宜替代品($39–75/月)全是單功能 | **$79–149/月**、會思考也會執行的完整閉環 → 定價真空帶 |
| 5 | 華人商家客源在小紅書,主流工具零覆蓋;中國數據工具(千瓜/新紅)不懂加拿大 | 小紅書 × IG × Threads 三平台趨勢雷達,中英法三語 → 核心護城河 |

## 3. 產品核心:四步閉環

```
連接帳號 → ① 看(採集) → ② 說(週報) → ③ 建議(3 Actions) → ④ 執行(一鍵核准) → 回到 ①
```

1. **看(Connect & Watch)**:商家一次性連接 Google Business Profile、Meta(IG)、Threads;系統持續採集自家評論/曝光/貼文成效,以及「行業 × 城市」的平台趨勢。
2. **說(Weekly Brief)**:每週一早上一封 30 秒讀完的敘事週報:「上週 340 人在 Google 搜到你,23 人打電話;評分 4.3 → 4.5;小紅書『多倫多探店』熱度 +40%⋯」
3. **建議(3 Actions)**:每週最多三件事,每件附理由與擬好的草稿(回評論草稿、貼文草稿、評論邀請名單)。
4. **執行(One-click Do)**:核准即發送;永遠 human-in-the-loop,不核准不動作。可走 API 的平台直接發布;小紅書(無發布 API)提供一鍵複製完稿 + 排程提醒。

### 3.1 趨勢雷達(Trend Radar)

按「行業 × 城市」矩陣每日採集三平台熱搜/熱門話題,存為共享快照(同一份「溫哥華 × 餐飲」快照服務所有同類客戶,邊際成本趨近零)。LLM 負責兩件事:與商家的**相關性過濾**、**跨語言轉譯**(小紅書中文趨勢 → 英文摘要給老闆 + 中文成稿供發布)。

| 平台 | 數據管道 | 可行性 |
|---|---|---|
| Threads | 官方 Keyword Search API(公開貼文/topic tag,2,200 查詢/24h),按互動量自建趨勢排行 | ✅ 低難度,官方支援 |
| Instagram | Graph API Hashtag Search(每用戶 7 天 30 個 hashtag;無官方趨勢端點),配額用於每客戶利基標籤組;全局趨勢由第三方數據源補充 | ⚠️ 中難度,配額緊 |
| 小紅書 | 無官方 API。接第三方數據平台(千瓜/新紅/灰豚:熱搜詞排行、話題榜、垂類榜單),以商業授權接入,**不自行爬取** | ⚠️ 中高難度 = 護城河;授權成本待詢價 |

### 3.2 聲譽管理(Reputation)

- GBP 評論同步、AI 回覆草稿(EN/FR/ZH,依評論語言)、回覆率追蹤(影響本地排名)。
- **CASL 合規的評論邀請**(email/SMS):同意紀錄、退訂管理、發送時窗——把合規做成賣點("CASL-compliant by default")。

### 3.3 執行項(Action Engine 首發清單)

回覆 Google 評論/發布 GBP 貼文/發布 IG、Threads 貼文/發送評論邀請/小紅書筆記成稿(複製 + 提醒)。

## 4. 定價草案(CAD 計價,Stripe-only)

| 方案 | 價格(CAD/月) | 內容 |
|---|---|---|
| Starter | $79 | 1 店、週報 + 3 Actions、GBP 評論管理、趨勢雷達(IG + Threads) |
| Pro | $129 | + 小紅書趨勢與成稿、CASL 評論邀請、三語內容 |
| Multi / Agency | $249 起 | 多店/代理商多客戶工作區、白標週報 |

- 目標客群月行銷總預算 < $1,000 → 定價落在 8–15% 佔比,遠低於 Podium 實付價的 1/4。
- Stripe Checkout + Billing + Tax(GST/HST/QST);**CAD 為主幣別**(v1 的 USD 假設隨影片版作廢)。
- AI 用量走內部點數帳本護欄(防濫用),但對用戶呈現為「方案內含」,不賣點數——SMB 討厭點數制(研究痛點之一)。

## 5. 技術架構

### 5.1 可直接重用(內容中立的平台骨架)

| 模組 | 用途 |
|---|---|
| `src/lib/billing/`(UserBalance/Freeze/Transaction) | 訂閱 + 內部用量護欄 |
| Organization / Workspace / WorkspaceMember / AuditLog | 多店家、代理商多客戶 |
| BullMQ workers + run-runtime | 每日趨勢採集 cron、週報批次生成、發送任務 |
| `src/lib/ai-runtime/` + model-pricing catalog | 所有 LLM 調用(週報/草稿/建議/翻譯),遵守「不直連 llm-client」鐵則 |
| prompt i18n guard 機制 | 擴充 `.fr.txt`(法語)與中文簡繁 |
| ApiKey 體系 | 遠期代理商 API |

影片管線(Remotion / Tencent VOD / 分鏡模組)**不使用也不刪除**,與新產品無關。

### 5.2 需新建

| 模組 | 內容 | 工程量 |
|---|---|---|
| 整合層 | GBP API、Meta Graph API(IG)、Threads API、小紅書第三方數據適配器、Twilio SMS、email 發送 | 大(MVP 主體) |
| `TrendSource` 適配器 | threads / instagram / xhs-thirdparty,同 ai-runtime provider 模式(明確指定、不猜測) | 中 |
| 建議引擎 | 規則 + LLM 混合:從快照與商家數據產出每週 3 Actions | 中 |
| 金流 | Stripe Checkout + Billing + Tax + webhook | 中 |
| 週報渲染與寄送 | email 模板 + 站內 | 小 |

### 5.3 Schema 草案(新增,需拍板)

`Plan` / `Subscription` / `PaymentOrder`(Stripe 對帳)、`BusinessProfile`(商家檔案:行業/城市/語言)、`ChannelConnection`(OAuth 憑證,加密)、`TrendSnapshot`(平台 × 行業 × 城市 × 日期,共享)、`ReviewItem`、`ActionItem`(建議 → 核准 → 執行狀態機)、`WeeklyBrief`、`ConsentRecord`(CASL 同意/退訂)。

## 6. 分階段路線圖

| 階段 | 內容 | Exit criteria |
|---|---|---|
| **M0 驗證**(2–4 週) | 英文 landing + waitlist 測價;訪談 5–10 家 GTA/大溫華人商家;向千瓜/新紅索取 API 報價與海外授權條款;申請 GBP / Meta / Threads API 權限 | ≥1 個定價方案有付費意願證據;小紅書數據成本確認 |
| **M1 商業基座** | Stripe 金流 + Subscription schema + 方案配額 | 能真實收錢、開通、續扣、退款 |
| **M2 MVP** | GBP 連接 + 評論管理 + 週報 + 趨勢雷達 v1(Threads + IG 利基標籤)+ 中英雙語 + 3 Actions 閉環 | 10 家 design partner 商家每週實際核准 ≥1 個 Action |
| **M3 護城河** | 小紅書趨勢(第三方數據)+ 小紅書成稿 + CASL 評論邀請(SMS/email)+ 法語 | 華人商家留存 ≥ 80%(月);CASL 流程過法務檢視 |
| **M4 放大** | 代理商多客戶工作區、白標、API | 首個代理商客戶上線 |

每階段完成標準沿用專案慣例:`npm run test:regression` 全綠 + 本文件狀態更新。

## 7. 風險登記

1. **小紅書第三方數據**:授權成本未知、穩定性風險、海外 SaaS 轉售的合約條款需逐字確認 — M0 必驗。
2. **IG 數據合規**:官方配額緊;第三方 IG 數據多踩 ToS 灰區,只選有合規背書的供應商。
3. **平台 API 審核**:GBP / Meta / Threads 的 app review 週期可能拖 M2 時程,M0 就要送件。
4. **「員工」的信任門檻**:自動發布錯內容會直接毀掉商家信任 → 永遠 human-in-the-loop,執行前預覽,首發清單保守。
5. **隱私法**:PIPEDA + Quebec Loi 25(法語市場啟動前)、憑證加密存儲、資料落地(北美區,延續 R2 決策)。

## 8. 待拍板問題(依 AUTONOMY_PROTOCOL,以下不自行決定)

1. **Schema 新增**(§5.3 全部)。
2. **Repo 策略**:新產品放本 repo(重用 billing/org/workers)或拆新 repo?(建議:本 repo 起步,共用骨架,`src/lib/marketing/` 命名空間隔離;拆分留待 M3 後評估。)
3. **品牌名**:暫名 LocalPulse,需定案英文品牌名。
4. **小紅書數據供應商**與授權預算(M0 詢價後決)。
5. **既有 KuiperAI 用戶/點數**與新產品的關係(建議:兩條產品線,互不映射)。
6. **與 ai-runtime master plan 的排程**:M1 是否等 Phase 6 完成(建議:M0 驗證期與 Phase 6 並行,寫 code 的 M1 起等 Phase 6)。
7. **定價數字**:$79/129/249 為草案,以 M0 waitlist 測價修正。

---

*研究來源(痛點數據、競品定價、平台 API 現況)彙整於 2026-08-20 會話紀錄;關鍵數字:LocaliQ 2026 SMB 報告(50% 無行銷人員、52% 預算 <$1,000)、Replifast Podium 定價分析($450–600/月實付)、Meta Threads Keyword Search API 文件(2,200 查詢/24h)、知乎千瓜/新紅/灰豚對比。*
