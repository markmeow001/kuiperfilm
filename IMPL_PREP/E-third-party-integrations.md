# E · 第三方整合規劃

> **目標：** 把 launch 前要申請、整合、設定的所有第三方服務列清單。OAuth 申請週期長（小紅書尤其），現在不啟動 launch 時來不及。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** D-pricing-reverse-math.md
> **重要：** OAuth 申請流程跟價格資訊以該平台 2026-05 公開資料為準，實際申請前要再 verify。

---

## 0. TL;DR

- **5 個 OAuth 要申請**：抖音 / 小紅書 / IG / YT / TikTok（國際）
- **5 個 SaaS 服務要選**：Stripe（金流）/ Resend（Email）/ Web Push API（推播）/ Sentry（錯誤）/ Cloudflare（CDN）
- **3 個 OAuth 申請週期 > 30 天**（小紅書、IG Business、YT Brand Account）
- **建議現在開始申請**：抖音 / 小紅書 / IG / YT 4 個外部發布平台
- **Stripe + Resend** 可以實作時並行接

---

## 1. 一鍵發布外部平台 OAuth

### 1.1 抖音開放平台

| 項目 | 資訊 |
|---|---|
| **官網** | https://developer.open-douyin.com |
| **申請門檻** | 公司主體（境內 ICP 備案）+ 行業資質 |
| **申請週期** | 14-30 天（境內 ICP 備案 + 抖音審核） |
| **API 範圍** | 視頻上傳、定時發布、評論管理 |
| **每日限額** | 視粉絲規模而定，新號 10 部/天 |
| **OAuth scopes** | `video.create`、`video.list`、`item.comment` |
| **沙箱環境** | 有，先用沙箱開發 |
| **預估費用** | 免費 API + 抖音流量主分成（無上架費） |

**Action：**
- 找一個有 ICP 備案的公司主體（KuiperFilm AI Lab 應該有）
- 申請開發者帳號 → 創建應用 → 提交審核
- **應該排在 launch 前 6-8 週啟動**

### 1.2 小紅書開放平台

| 項目 | 資訊 |
|---|---|
| **官網** | https://open.xiaohongshu.com |
| **申請門檻** | 公司主體 + 蒲公英平台帳號（社交門檻最高） |
| **申請週期** | **30-60 天**（社交平台審核 + 商務簽約） |
| **API 範圍** | 筆記發布、視頻發布、評論、私信 |
| **每日限額** | 視商務契約而定 |
| **OAuth scopes** | `note.create`、`note.list`、`message.send` |
| **預估費用** | 商務合作可能要分成或保證金 |

**⚠️ 警告：** 小紅書是 5 個平台裡最難申請的。如果 launch 前 60 天還沒開始申請，**launch 時可能要先不接 / 用「複製連結手動發」替代**。

**Action：**
- 立刻 outreach 蒲公英 BD
- 準備好商務契約、案例集、流量預估
- **launch 前 8-10 週必須啟動**

### 1.3 Instagram Graph API

| 項目 | 資訊 |
|---|---|
| **官網** | https://developers.facebook.com/docs/instagram-api |
| **申請門檻** | Meta Business 帳號 + IG Business/Creator 帳號 |
| **申請週期** | **App Review 7-30 天**（看 scopes 多嚴） |
| **API 範圍** | 視頻 Reels 發布、Stories、評論 |
| **每日限額** | 25 部 IG video/24 hours (per IG Business Account) |
| **OAuth scopes** | `instagram_content_publish`、`instagram_basic`、`pages_show_list` |
| **預估費用** | 免費 |
| **特別要求** | 需要 Privacy Policy URL + Data Deletion URL（GDPR） |

**Action：**
- 註冊 Meta Business + 申請 Graph API
- 寫 Privacy Policy + Data Deletion 頁面（看 G 文件）
- App Review 提交時要錄 demo 影片說明 use case
- **launch 前 4-6 週啟動**

### 1.4 YouTube Data API v3

| 項目 | 資訊 |
|---|---|
| **官網** | https://console.cloud.google.com/apis |
| **申請門檻** | Google Cloud 帳號（最容易） |
| **申請週期** | 7-14 天（quota 提升審核） |
| **API 範圍** | 視頻上傳、Shorts 發布、評論 |
| **每日限額** | 預設 quota 10,000 units/day（上傳 1 部 = 1,600 units → 約 6 部）|
| **OAuth scopes** | `youtube.upload`、`youtube.readonly` |
| **預估費用** | 免費 + quota 超量要申請提升 |

**Action：**
- 創建 Google Cloud project → enable YouTube Data API → 申請 OAuth 認證
- 預估 launch 後流量大會用滿 quota，**先申請提升 quota**（YT 同意通常 5-10 工作天）
- **launch 前 3-4 週啟動**

### 1.5 TikTok for Developers（國際）

| 項目 | 資訊 |
|---|---|
| **官網** | https://developers.tiktok.com |
| **申請門檻** | 公司主體（國際） |
| **申請週期** | 7-14 天 |
| **API 範圍** | Content Posting API（直接發布到 TikTok） |
| **每日限額** | 視帳號級別而定 |
| **OAuth scopes** | `video.publish`、`video.list`、`user.info.basic` |
| **預估費用** | 免費 |

**Action：**
- 跟抖音不同帳號體系，國際版要單獨申請
- **launch 前 4-6 週啟動**（如果 launch 同時面向海外）

---

## 2. Stripe 金流整合

### 2.1 Stripe 帳號設定

| 項目 | 設定 |
|---|---|
| **帳號類型** | Stripe Standard（最快上線）vs Stripe Connect（多 workspace 拆帳，未來考慮） |
| **支援幣別** | USD（國際）+ CNY（境內，需要 Stripe Greater China 帳號） |
| **支付方式** | Card / Apple Pay / Google Pay / Link / Alipay / WeChat Pay |
| **Tax** | 開啟 Stripe Tax 自動算 VAT/GST（歐盟、新加坡、印度等） |
| **發票** | 開啟 Stripe Invoice 自動寄 PDF 發票 |

### 2.2 Products 設定（按 D §6 規格）

```yaml
Products:
  - Creator:
      monthly: $19/month, price_id: prod_creator_monthly
      annual: $180/year, price_id: prod_creator_annual
  - Studio:
      monthly: $59/month, price_id: prod_studio_monthly
      annual: $564/year, price_id: prod_studio_annual
  - Team:
      monthly: $149/month, price_id: prod_team_monthly
      annual: $1428/year, price_id: prod_team_annual
      seat_addon: $25/month per extra seat (above 3)

  - TopUp_1000: $1.5
  - TopUp_5000: $6.5
  - TopUp_20000: $24
```

### 2.3 Webhook events 要 handle

```typescript
// /webhook/stripe
events = [
  'customer.subscription.created',      // 升級 plan
  'customer.subscription.updated',      // 改 plan / 改 seat
  'customer.subscription.deleted',      // 降回 Free
  'customer.subscription.trial_will_end', // 提示 user
  'invoice.payment_succeeded',          // 重置 monthlyCredits
  'invoice.payment_failed',             // 鎖 generation + email
  'invoice.payment_action_required',    // 3D secure
  'checkout.session.completed',         // top-up 完成
  'charge.refunded',                    // 退款處理
];
```

### 2.4 退款政策（落地到 stripe）

```
- 訂閱：付費後 7 天未用滿 50% credits → 全額退（自動）
- 訂閱：付費後 7 天用滿 > 50% → 不退
- Top-up：未使用任何點數 → 14 天內全退
- Top-up：已用任何點數 → 不退
- Failed generation：自動退已扣點數（內部處理，不走 Stripe）
```

### 2.5 預估費率

- Stripe 標準：2.9% + $0.30/transaction（國際卡 +1%）
- Alipay：1.5% + $0.30
- WeChat Pay：1.5% + $0.30

**淨毛利調整：** D 文件算的 78% 毛利要再扣 ~3% Stripe 費 → 實際 **75%**。

---

## 3. Email 通道

### 3.1 服務商選擇

| 服務商 | 月費 | 優點 | 缺點 |
|---|---|---|---|
| **Resend** ★ | Free 100/day, $20 → 50k | 開發者體驗最好，React Email 模板 | 較新，中國送達率未驗證 |
| **SendGrid** | $19.95 → 50k | 老牌，送達率穩 | UI 老、API 不友善 |
| **AWS SES** | $0.10/1k | 最便宜 | 自己處理一切，門檻高 |
| **Postmark** | $15 → 10k | 送達率最高 | 量大時貴 |

**推薦 Resend**（react-email 生態系 + 開發效率高），備用 SendGrid（送達率備援）。

### 3.2 必須發的信件種類

```yaml
Transactional（觸發即發）:
  - Magic link 登入（必須 < 30s 到信箱）
  - 邀請 workspace member
  - 渲染完成
  - 渲染失敗
  - Stripe payment success
  - Stripe payment failed
  - Subscription cancellation confirmation
  - Account deletion request

Marketing（user 可 opt-out）:
  - 每週成果摘要
  - 新功能公告
  - Showcase featured 通知

Compliance（不可 opt-out）:
  - 帳號重大變更（password reset, email change）
  - ToS 重大更新
  - 安全警告
```

### 3.3 模板維護

- 用 react-email 寫模板（雙語：簡中 + 英文）
- 每個模板對應一個 `NotificationType`（schema A）
- 模板儲存在 git，不走 CMS（避免 deploy lag）

---

## 4. Web Push（瀏覽器推播）

### 4.1 技術選擇

- **VAPID** 標準（Web Push API native）
- service worker 處理推送
- 不用第三方（Firebase Messaging 等）— 太重

### 4.2 訂閱流程

```typescript
// 1. user 在 settings 開推送（mockup 28）
// 2. 請求 Notification.requestPermission()
// 3. 取得 subscription = await registration.pushManager.subscribe({
//      userVisibleOnly: true,
//      applicationServerKey: VAPID_PUBLIC_KEY
//    });
// 4. POST /api/push-subscribe with subscription
// 5. Backend 存 subscription，未來 send 時用 web-push library
```

### 4.3 限制

- iOS Safari 16.4+ 才支援 Web Push
- 微信內建瀏覽器不支援 → 給訊息 banner 引導去 Email
- 用戶可隨時 revoke permission，要 graceful handle

---

## 5. 站內通知（In-app）

完全自家做：

```typescript
// 寫入點：每個業務事件 trigger
await prisma.notification.create({
  data: {
    userId,
    type: 'render_done',
    title: t('notification.render_done.title'),  // i18n
    body: t('notification.render_done.body', { episodeName }),
    metadata: { episodeId, projectId },
    actionUrl: `/v2/workspace/${workspaceId}/final/${episodeId}`,
  }
});

// 讀取：mockup 29 query unreadCount + list
// SSE/WebSocket 推送即時更新（可選，增加實作成本）
```

---

## 6. Sentry（錯誤監控）

| 項目 | 設定 |
|---|---|
| **Plan** | Team plan $26/月（10k transactions, 50k errors） |
| **整合** | Next.js + Prisma + worker |
| **特別處理** | LangGraph Runtime exception 要單獨 tag |
| **Alert** | Slack channel + email |
| **Source maps** | 上 prod 時自動 upload |

```typescript
// 必須 capture 的 error
Sentry.captureException(err, {
  tags: {
    provider: 'ark-seedance-2.0',
    mode: 'r2v_with_subjects',
    workspaceId,
    panelId,
  },
  user: { id: userId, email: userEmail },
});
```

---

## 7. CDN / 影片 streaming

### 7.1 靜態資產

- **Cloudflare Pages** 服務前端（已有 R2 帳號）
- **Cloudflare R2** 存影片 + 縮圖
- **Cloudflare Stream** （可選，HLS adaptive bitrate $5/1000 min storage + $1/1000 min delivery）

### 7.2 中國訪問

- **騰訊雲 COS + CDN**（已有）
- 國內外 dual CDN：DNS 切換（CN 走 Tencent，其他走 CF）
- 影片預設用 Tencent VOD（已有 vod.tencentcloudapi.com）

---

## 8. 申請時程表（往 launch 倒推）

假設 launch = T0：

```
T-10 週  抖音 + 小紅書 + IG OAuth 啟動申請
T-8 週   Stripe 帳號開好，Products 設好
T-6 週   YT + TikTok 申請啟動
T-6 週   Resend 帳號 + 模板開發
T-4 週   Web Push VAPID 上線 + sentry 整合
T-3 週   所有 OAuth callback URL 設定到 prod domain
T-2 週   Stripe Tax + Invoice 設定 + 驗證
T-1 週   外部發布 e2e test（用真實帳號）
T0       Launch
```

---

## 9. 成本月度估算（10,000 用戶）

| 項目 | 月費 |
|---|---|
| Stripe 手續費 | ~$1,500（淨收 $52k × 3%） |
| Resend | $20（50k emails/月） |
| Sentry Team | $26 |
| Cloudflare R2 | $30（2 TB storage + egress） |
| Tencent COS + CDN | $50（境內訪客流量） |
| **總** | **~$1,626 / 月** |

---

## 10. 落地清單

- [ ] 立刻 outreach 抖音 + 小紅書 + IG BD（最長週期）
- [ ] Stripe 帳號開好 + 4 階梯 Products 建立
- [ ] Resend 帳號 + react-email 模板（先 transactional 8 個）
- [ ] VAPID public/private key 生成 + 進 .env
- [ ] Sentry project 創建 + integrations
- [ ] CF Pages 連 GitHub repo + 預先設好 OAuth callback URL
- [ ] R2 bucket 分 staging / prod
- [ ] 寫法律頁面（看 G 文件）— IG App Review 需要

---

**下一份：** F-observability-events.md
