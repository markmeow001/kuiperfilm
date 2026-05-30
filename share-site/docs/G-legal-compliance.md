# G · 法律 / 合規規劃

> **目標：** 把上線前法律文件、AI 生成內容著作權、隱私合規（GDPR/中國個資法）、平台規則風險全列。**這份文件不能取代律師諮詢** — 是給工程跟 PM 做合規入口的 checklist。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** D-pricing（退款）+ E-integrations（IG 要 Privacy URL）
> **強烈建議：** launch 前找律師 review ToS / Privacy 至少 1 次。

---

## 0. TL;DR

- **5 份法律文件雙語**：ToS / Privacy Policy / Cookie Policy / Refund Policy / Acceptable Use Policy
- **3 個地區合規**：GDPR（歐盟）/ CCPA（加州）/ 中國個人信息保護法
- **AI 生成內容著作權**：採「user owns the output」+ 平台保留 sample 使用權
- **真人臉 reference 政策**：禁止使用未授權真人 → 把 ARK face filter 觸發轉成正向告知
- **敏感內容禁令**：暴力 / 兒少 / 仇恨 / 政治 / 自我傷害 → 內容過濾 + 申訴流程
- **launch 前必須**：ToS + Privacy + Cookie + DMCA 4 份；其他可後補

---

## 1. 必備法律文件清單

### 1.1 Terms of Service（ToS / 服務條款）

**雙語結構：**

```
1. 接受條款（Acceptance）
2. 服務說明（Service Description）
3. 帳戶（Account）
   - 註冊條件（18+ 或有監護人同意）
   - 帳戶安全責任
   - 帳戶停權與刪除
4. 訂閱與付款（Subscription & Billing）
   - 4 階梯方案說明
   - 自動續訂 + 取消方式
   - Annual prepay 不分期退款（D §2.4 政策）
   - 失敗免扣點數承諾
5. 使用者內容（User Content）
   - User 持有自己上傳的劇本 / 角色設定 / 影片 ownership
   - 授權 KuiperAI 處理、儲存、CDN 分發
   - User Showcase opt-in 才公開
6. AI 生成內容（AI Generated Content）   ← 重點
   - 模型 output ownership 歸 user
   - 平台 30 天內保留 cache（為了重生 / debugging）
   - User 保證 input（劇本 / reference 圖）有合法權利
   - 真人臉 reference 必須 user 證明授權
7. 禁止使用（Prohibited Use）
   - 兒少 / CSAM
   - 暴力 / 恐怖主義
   - 真人 deepfake / 騷擾
   - 仇恨內容
   - 商業 spam
   - 反向工程模型
8. 退款政策（連結到 Refund Policy）
9. 智慧財產權（IP）
   - KuiperAI 平台、品牌、技術屬 KuiperAI
   - User content 屬 user
10. 免責聲明（Disclaimer）
    - As-is service
    - 不保證模型輸出品質
    - 不保證第三方服務可用性
11. 責任限制（Limitation of Liability）
    - 上限 12 個月訂閱費 or $100（取較高）
12. 賠償（Indemnification）
13. 修改條款
14. 終止
15. 適用法律與管轄（推薦：加州法 + 仲裁；中國用戶單獨子協議）
16. 聯繫資訊
```

**版本管理：** ToS 每次大改要 email 通知所有 user 30 天前。

### 1.2 Privacy Policy（隱私權政策）

**結構：**

```
1. 蒐集的資訊
   - 帳戶資訊（email, name, avatar）
   - 創作內容（劇本、角色、生成的影片）
   - 使用資料（活動記錄、cookie、device fingerprint）
   - 付款資訊（透過 Stripe，我們不存信用卡）
2. 蒐集方式
   - User 主動提供
   - 自動收集（cookie / analytics / log）
   - 第三方（OAuth provider 給的 profile）
3. 使用方式
   - 提供服務
   - 改善產品
   - Marketing（user 可 opt-out）
   - 客服
   - 法律遵循
4. 分享給誰
   - Service providers（Stripe / Resend / Cloudflare / Sentry / PostHog / GA4 / 5 AI providers）
   - 法律要求
   - 業務轉讓
5. 儲存位置與期限
   - 全球：Cloudflare CDN + R2
   - 中國：Tencent COS（境內 user 預設）
   - 期限：帳號刪除後 30 天 hard delete（PanelVersion 保留 90 天統計）
6. User 權利
   - 訪問（請求資料 copy）
   - 修改
   - 刪除（GDPR right to be forgotten）
   - 資料可攜
   - 不接收 marketing
   - opt-out cookie
7. Cookie 使用（連結 Cookie Policy）
8. 兒童隱私（13 歲以下不收集）
9. 國際資料傳輸（依 EU SCCs）
10. 安全措施
11. 變更通知
12. 聯繫方式 + DPO（如適用）
```

### 1.3 Cookie Policy

簡短文件（< 1 頁）：

```
- Essential cookies（不能 opt-out）
  - session_token
  - csrf_token
  - kp-lang（i18n）
- Analytics cookies（可 opt-out）
  - PostHog (ph_*)
  - GA4 (_ga, _gid)
- Preferences
  - theme（如果未來加 light mode）
```

**首次訪問顯示 cookie banner**（歐盟 / 加州 user 必須）。

### 1.4 Refund Policy

對齊 D §2.4：

```
- 訂閱：付費後 7 天未用滿 50% credits → 全額退（自動）
- 訂閱：付費後 7 天用滿 > 50% → 不退
- Top-up：未使用 → 14 天內全退
- Top-up：已用 → 不退
- Failed generation：自動退點（不需要 user 申請）
- 帳號違規被停權：不退
```

### 1.5 Acceptable Use Policy (AUP)

詳細禁令清單（從 ToS §7 展開）：

```yaml
絕對禁止:
  - 兒少色情 (CSAM) → 立刻刪 + 通報 NCMEC
  - 真實兒童畫像
  - 真實未授權人物 deepfake
  - 暴力威脅 / 恐怖主義 / 自殺鼓吹
  - 商業反詐詐騙
  - 仇恨言論（基於種族 / 性別 / 性向 / 宗教）

需審核:
  - 政治人物 / 公眾人物視覺生成
  - 醫療診斷或建議
  - 法律意見
  - 真實品牌 logo 使用

允許但 watermark:
  - 一般成人創作
  - 模仿風格（致敬而非欺騙）
```

**執行：** AI 內容過濾（用 ARK / Tencent 既有） + 用戶舉報 + 人工 review。

---

## 2. 地區合規重點

### 2.1 GDPR（歐盟，2018）

**Data Controller / Data Processor：** KuiperAI 是 controller（決定處理目的）

**6 個關鍵 user rights：**

| 權利 | 落地 |
|---|---|
| 訪問權（Right of Access） | 提供 export.json（user 所有 data）API |
| 修正權（Right to Rectification） | Settings 直接改 |
| 刪除權（Right to be Forgotten） | 28-settings 「刪除帳號」按鈕 |
| 處理限制 | 「暫停帳號但保留 data」flow |
| 資料可攜 | export.json 標準格式 + 連結到競品 import |
| 反對處理 | 「不接收 marketing」toggle |

**Data deletion infra：**

```typescript
// Trigger user-initiated deletion
// 1. mark user.deletedAt = now()（soft delete）
// 2. 30 天 grace period（讓 user 反悔）
// 3. cron 每天跑 hard delete：
//    - User row + cascading（projects, panels, votes, comments）
//    - R2 objects（影片、角色 reference 圖）
//    - Stripe customer marked deleted
//    - PostHog identifyDelete()
//    - 但 Stripe invoice 保留（會計法定 7 年）
```

**DPA（Data Processing Agreement）：** 跟每個 sub-processor 簽 — Stripe, Cloudflare, Resend, Sentry, PostHog, 5 AI providers。

**DPO（Data Protection Officer）：** 公司規模 < 250 員工通常不強制，但歐盟 user 多時建議掛一個（外包 ~$3k/年）。

### 2.2 CCPA（加州，2018）

類似 GDPR 但更寬鬆：

- 加 「Do Not Sell My Personal Information」 link（即使我們不賣資料，也要顯示）
- 加州 user 可請求 12 個月內收集的 data list
- 12 個月內不得歧視拒絕請求的 user

### 2.3 中國個人信息保護法（PIPL，2021）

**特別注意：**

- **境內 user 資料境內儲存**（Tencent COS 已備案）
- **跨境傳輸需 user 明示同意**（在 onboarding 加 checkbox）
- **不得使用 algorithm 歧視性自動決策**（pricing 不能因 user 屬性差別）
- **重要平台 / 處理大量資料時需安全評估**（10,000 user 後考慮申請）
- **未成年人（14 歲以下）需監護人同意**（在 signup 加年齡 gate）

### 2.4 ICP 備案（如果境內 hosting）

- art.kuiperfilmailab.com 域名已備案？要 verify
- 如果沒備案 → 用境外 domain + CN 用 CDN

---

## 3. AI 內容相關特殊條款

### 3.1 真人臉 reference 政策（重要！）

對應已知問題（ARK face filter）：

```yaml
User flow:
  1. User 上傳真人照當 reference
  2. 系統警告 modal:
     "您上傳的照片包含真人臉。請確認：
      - 您本人？✓
      - 已獲得照片主人書面授權？✓
      您同意以下責任轉移：
      "
  3. 用 ARK 等 provider 時自動 face filter check
  4. 觸發 face filter → 退點 + 通知：「未認證真人臉」
  5. 提供「申請 ARK 真人認證」流程連結
```

### 3.2 AI 生成內容版權聲明

**雙語顯著聲明（在影片 watermark / metadata 嵌入）：**

```
"此內容由 KuiperAI 生成（粵 / Generated with KuiperAI）"
```

每段 panel 的 metadata 進 EXIF（影片）/ Schema.org tag（網頁分享）。

### 3.3 商標 / 品牌使用

User 用 LV / Nike / 中文公司名等真實品牌做劇集 → 灰色地帶：

- 致敬風格 OK
- 直接模仿要求 user 自負責
- 收到 cease & desist 立刻配合下架

### 3.4 名人 / 政治人物

- 直接生成 = 禁
- 自動 face detection（用 Tencent / 火山既有 API） → 提示 user 換 face

---

## 4. DMCA / 著作權侵權處理

**必須有：DMCA Agent（網站底部 publish 連絡資訊 + email）**

流程：

```
1. 收 DMCA notice email (dmca@kuiperai.com)
2. 24 小時內 acknowledge
3. 48 小時內：
   - 移除涉嫌侵權內容
   - 通知 user
4. User 可 counter-notice（10 天內）
5. 若無 counter-notice → 永久下架 + 警告
6. User 累計 3 次 strike → 帳號停權
```

---

## 5. 兒少保護（重點）

**法律強制要求：**

```yaml
Signup:
  - 年齡 gate（13 歲以下不准註冊）
  - 13-18 歲限制：
    - 不能 share to public
    - 不能 upgrade（要監護人）
    - 不能 share 到外部社交

Detection:
  - User upload 內容 → 用 PhotoDNA / 第三方 service 掃 CSAM
  - 視訊 frame 抽樣 hash 比對
  - 違規即刻：
    1. 移除 + permanent ban
    2. 24 小時內報告 NCMEC（美國 CyberTipline）
    3. 保留 evidence
```

---

## 6. 帳號 / 內容 moderation

### 6.1 三級 escalation

```yaml
Level 1: 自動（algorithm）
  - 內建 ARK / Tencent 安全 API
  - 違禁字檢測

Level 2: 用戶舉報
  - 24 小時內 review
  - 嚴重案件升 Level 3

Level 3: 人工 review
  - 內部 trust & safety team
  - 違規結果記錄
  - Strike 制：3 strikes → ban
```

### 6.2 申訴流程

User 被 ban / 內容下架 → 可 appeal：

```
1. 透過 settings 「申訴」按鈕
2. 寫 reason
3. 內部 review (3-5 工作天)
4. 結果 email 通知
```

---

## 7. 商業合規

### 7.1 稅務

- Stripe Tax 開啟自動算 VAT/GST
- 美國 sales tax（如果 US-incorporated）
- 中國增值稅（境內 entity）

### 7.2 反洗錢 / KYC

- 訂閱層級不需要 KYC（Stripe 處理）
- 大額 top-up（>$10k 月）→ Stripe 可能要 KYC

### 7.3 出口管制

- AI 模型技術可能受美國 export control（EAR）
- 別賣到 OFAC sanctioned 國家（伊朗 / 北韓 / 古巴 / 敘利亞 / 俄羅斯）
- Stripe / Cloudflare 預設 block sanctioned IPs

---

## 8. Incident response（資料洩漏 / 安全事件）

**準備好 runbook：**

```yaml
T+0: 發現
  - 停止洩漏源
  - 通知 cofounder + 法律顧問

T+24h: 評估
  - 影響範圍
  - 哪些 user 被影響
  - 哪些 data 涉及

T+72h: 通知（依 GDPR 義務）
  - 監管機關通報
  - User notification（透過 email + in-app）

T+1 week: 公開報告
  - Status page 發 incident report
  - 應對措施
  - 補救方案
```

---

## 9. 技術合規 checklist

- [ ] 所有 password hash with bcrypt/argon2（不存 plain）
- [ ] HTTPS-only（HSTS preload）
- [ ] CSP header 嚴格
- [ ] SQL injection prevention（Prisma 用 prepared statement）
- [ ] XSS prevention（React escape + CSP）
- [ ] CSRF token
- [ ] Rate limiting（防暴力破解）
- [ ] Audit log 重要 action（admin / billing / delete）
- [ ] Secrets 用 env vars，不 commit
- [ ] Dependency CVE scanning（GitHub Dependabot）

---

## 10. Launch 前法律 checklist

**必須完成（launch 前 4-6 週）：**

- [ ] ToS 雙語起草 → 律師 review → publish
- [ ] Privacy Policy 雙語 → 律師 review → publish
- [ ] Cookie Policy + banner
- [ ] DMCA Agent 設定 + email + 流程
- [ ] Refund Policy 公開
- [ ] AUP 公開
- [ ] DPA 跟所有 sub-processor 簽
- [ ] CSAM detection infra（PhotoDNA 或 Cloudflare Stream Moderation）
- [ ] Face detection on user upload（用 Tencent 既有 API）
- [ ] Age gate signup
- [ ] CCPA opt-out link
- [ ] Subject Access Request endpoint（GDPR）
- [ ] Account deletion flow + 30 天 grace period
- [ ] Status page（statuspage.io 或自家）
- [ ] Incident response runbook

**Launch 後 30 天內補：**

- [ ] SOC 2 Type I 啟動（給企業客戶用）
- [ ] ISO 27001 規劃
- [ ] EU representative（如果 user > 250 in EU）
- [ ] 內部 trust & safety team SOP

---

## 11. 預估成本

| 項目 | 一次性 / 月度 |
|---|---|
| 律師 ToS / Privacy review | $5,000 一次性 |
| DPO outsourced | $3,000 / 年 |
| ICP 備案（如需） | $0（自家辦） |
| PhotoDNA / Cloudflare Moderation | $500 / 月 |
| 安全保險（cyber liability） | $300 / 月（$1M coverage） |
| **總** | **$5,000 + $800/月** |

---

## 12. 落地清單（按 launch 倒推）

```
T-10 週  律師找好（用 Atrium / Clerky 等線上服務）
T-8 週   ToS / Privacy 雙語草稿
T-6 週   律師 review 第 1 輪
T-5 週   實作 GDPR / CCPA endpoints（export / delete）
T-4 週   律師 review 第 2 輪 + 最終定稿
T-3 週   DMCA Agent + 流程 + email
T-2 週   Cookie banner + Refund Policy + AUP 公開
T-1 週   Status page + Incident runbook
T0       Launch
T+30 天  SOC 2 啟動
```

---

**E + F + G 三份補完。** 加上 A + B + C + D，完整的 7 份規劃文件 + README 已就位。

實作 React 之前的「想清楚」階段結束。下一步進真實 Phase 2（schema migration）+ Phase 3（RBAC）+ Phase 4（按 mockup 依序實作 API + frontend）。
