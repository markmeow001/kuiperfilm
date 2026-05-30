# N · Security Baseline

> **目標：** Tech Lead M-2 + QA 多項 critical 都點出「13 份文件沒人寫 security」。本文件統一規範 CSP / CORS / log redaction / secret rotation / GDPR 流 / CSAM detection / 速率限制 / 失敗不扣點 ledger。
>
> **狀態：** v1 · 2026-05-30
> **依賴：** A-schema-migration.md / G-legal-compliance.md / K-openapi-spec.md
> **適用範圍：** 從 Phase 4 RBAC service 開工就要套用

---

## 0. TL;DR — Launch 前必須過的 12 條 gate

| # | gate | 為何必須 |
|---|---|---|
| 1 | CSP enforce header（非 Report-Only）| 阻止 XSS / clickjacking |
| 2 | CORS allowlist 明確（無 `*`）| 防 token 外洩 |
| 3 | 所有 secret 走 envelope encryption（KMS DEK + AES-GCM）| 雲端 console 看不到原文 |
| 4 | Log redaction（無 PII / token / password 進日誌）| 合規 + 內鬼防 |
| 5 | Audit log 全寫入（30 種 action）| 法律證據鏈 + 內部稽核 |
| 6 | Stripe webhook signature 驗證 + replay 防護 | 防偽造扣費 |
| 7 | Provider webhook HMAC 驗證 + 時間窗 | 防偽造 task 結果 |
| 8 | Rate limiting 所有 endpoint（4 級階梯）| 防 DoS + 帳號爆破 |
| 9 | GDPR/CCPA/PIPL 三項 endpoint（export / delete / consent）| 合規 |
| 10 | CSAM 自動偵測（PhotoDNA）+ 違規通報流程 | 法律強制 |
| 11 | 失敗不扣點 ledger（append-only）| D 拍板核心政策 |
| 12 | Secret rotation 90 天 cron + 告警 | 縱深防禦 |

---

## 1. Content Security Policy（CSP）

### 1.1 Header（Production）

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{request-nonce}' https://js.stripe.com;
  style-src 'self' 'nonce-{request-nonce}';
  img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://*.cos.ap-shanghai.myqcloud.com;
  media-src 'self' blob: https://*.r2.cloudflarestorage.com https://*.cos.ap-shanghai.myqcloud.com;
  font-src 'self' data:;
  connect-src 'self' https://api.kuiperfilmailab.com wss://realtime.kuiperfilmailab.com https://api.stripe.com;
  frame-src 'self' https://js.stripe.com https://hooks.stripe.com;
  worker-src 'self' blob:;
  manifest-src 'self';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
  report-uri https://csp-report.kuiperfilmailab.com/report;
  report-to csp-endpoint;
```

### 1.2 nonce 策略

- 每 SSR request 產生 base64 隨機 nonce（16 bytes）
- Next.js middleware 注入 `<script nonce="...">` 跟 `<style nonce="...">`
- 不用 `'unsafe-inline'` / `'unsafe-eval'`

### 1.3 cutover 計畫

| 階段 | 期 | 設定 |
|---|---|---|
| Soft launch（前 7 天）| Week 1 | `Content-Security-Policy-Report-Only` 收 violation report 14 天 |
| Tighten | Week 2-3 | 看 report 補 allowlist；改 enforce |
| Production gate | Week 3+ | Enforce CSP，違規直接擋 |

### 1.4 報告處理

- POST `/csp-report` → 結構化進 ClickHouse
- Daily digest：top 10 違規 source；超 5 個 unique violation 觸發 Slack alert
- 違規分類：第三方注入 / 開發遺漏 nonce / 真正攻擊

---

## 2. CORS 規則

### 2.1 allowlist（嚴格）

```typescript
const ALLOWED_ORIGINS = [
  'https://kuiperfilmailab.com',
  'https://www.kuiperfilmailab.com',
  'https://app.kuiperfilmailab.com',
  'https://staging.kuiperfilmailab.com',
  // dev 環境動態加入 localhost:3000-3999
];

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : 'null',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Workspace-Id, X-API-Key, Idempotency-Key, If-Match',
  'Access-Control-Max-Age': '86400',
  'Vary': 'Origin',  // 必要否則 CDN cache 鎖死
});
```

### 2.2 禁止項

- ✗ `Access-Control-Allow-Origin: *`
- ✗ Wildcard subdomain `*.kuiperfilmailab.com`（防 subdomain takeover）
- ✗ Credentials 開但 origin 不檢
- ✗ 公開 endpoint（discover / share）不用 credentials → 改 `'Access-Control-Allow-Origin': '*'` 但同時 `'Access-Control-Allow-Credentials': 'false'`

### 2.3 Webhook 例外

`/webhook/*` 不需 CORS（外部服務 server-to-server，不走 browser）。middleware 直接 skip。

---

## 3. Secret 管理

### 3.1 分層

| 層 | 範例 | 儲存 |
|---|---|---|
| 平台 secret | Stripe API key / Resend SMTP / PhotoDNA key | Vault / AWS Secrets Manager |
| Provider secret | ARK accessKey / fal token / Tencent SecretId | DB `ProviderConfig.apiKeyCiphertext`（KMS envelope）|
| User OAuth token | 抖音/小紅書 access token | DB `Integration.oauthAccessToken`（KMS envelope）|
| User API key | sk_live_xxx | DB `APIKey.keyHash`（SHA-256 hash only）|
| Session cookie | kp_session | HttpOnly + Secure + SameSite=Strict |

### 3.2 Envelope encryption

```
[plaintext secret]
  → AES-256-GCM(data_key) = ciphertext
[data_key]
  → KMS.Encrypt(master_key) = wrapped_data_key
DB: store ciphertext + wrapped_data_key + iv
```

Master key 在 AWS KMS / Tencent KMS（不離開 HSM）。

### 3.3 Rotation 政策

| Secret 類型 | rotation 週期 | 自動化 |
|---|---|---|
| Stripe webhook secret | 90 天 | Stripe API rotate + redeploy |
| Provider API key | 90 天 | 工程手動 + cron 告警 |
| User OAuth token | refresh on expiry（一般 < 1h）| OAuth refresh flow |
| Session cookie | 24h sliding | 自動 |
| Magic-link token | 15 min single-use | 自動 |
| API key | user 自己決定 expiry，建議 ≤ 365 天 | UI 提醒 |

### 3.4 leak 處理 SOP

1. 偵測：GitGuardian / git pre-commit hook scan + canary token
2. **立即 revoke + rotate**（5 分鐘內）
3. Audit log：誰、何時、影響範圍
4. 通知：受影響 workspace owner（email + in-app banner）
5. Postmortem：在 incidents/{date}-{title}.md

---

## 4. Log Redaction

### 4.1 禁止入日誌欄位（pino 內建 redact）

```typescript
const logger = pino({
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'req.headers.cookie',
      'req.body.password',
      'req.body.token',
      'req.body.secret',
      'req.body.creditCard.*',
      'res.body.user.email',           // 列表 endpoint email 也 redact
      '*.apiKey',
      '*.accessToken',
      '*.refreshToken',
      '*.stripeCustomerId',            // PII
      '*.userId',                       // PII，改記 hash
      'user.phone',
      'user.address',
    ],
    censor: '[REDACTED]',
  },
});
```

### 4.2 ID hash 規則

- `userId` 在 log 出現 → `usr_hash:<sha256(salt+id)[:8]>`
- `email` 不可記原文 → `email:<sha256[:8]>@redacted`
- workspace / project ID 可記（不算 PII）

### 4.3 example

```jsonc
// 進日誌
{
  "level": "info",
  "msg": "panel.regenerate.completed",
  "panelId": "pnl_01HQTC...",
  "workspaceId": "ws_01HQT9...",
  "userId_hash": "usr_hash:a7f9c3d2",   // 不是原 ID
  "creditsActual": 120,
  "provider": "ARK_SEEDANCE_2",
  "duration_ms": 12450
}
```

### 4.4 ClickHouse / Sentry sink 雙保險

- 應用層 redact（pino）
- ClickHouse insert 前 redact filter
- Sentry SDK 設 `beforeSend` 二次 redact
- 三層任一 fail 都不會送原文

---

## 5. 失敗不扣點 Credit Ledger

### 5.1 為什麼要 ledger（append-only）

D 拍板「失敗不扣點」是核心商業政策。Cumulative `Workspace.creditsRefunded` 欄位（V2 現有）無法：
- 按 run 反查為什麼退款
- 月底對帳
- 7 年會計法保留

### 5.2 schema（A 已補 §2.3.x，本文件補 CreditLedger model）

```prisma
model CreditLedger {
  id            String      @id @default(cuid())
  workspaceId   String
  workspace     Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Restrict)  // 不可刪
  userId        String?
  user          User?       @relation(fields: [userId], references: [id], onDelete: SetNull)

  kind          CreditEntryKind   // 流水類型
  credits       Int         // 正 = 加入；負 = 扣除
  balanceAfter  Int         // denormalize 餘額（含 sub-ledger 月度/加購）

  // 來源
  runId         String?     // 任務扣費 / 退款
  topUpId       String?     // 加購點數
  subscriptionId String?    // 月度發放
  refundForRunId String?    // 退款指向哪個原 run

  reason        String      @db.VarChar(500)  // 人類可讀說明
  metadata      Json?       // 結構化資料（provider response code 等）

  createdAt     DateTime    @default(now())
  // 故意沒 updatedAt — append-only

  @@index([workspaceId, createdAt(sort: Desc)])
  @@index([runId])
  @@index([kind, createdAt])
}

enum CreditEntryKind {
  monthly_grant          // 月度配額發放（subscription）
  topup_purchase         // 加購包購買
  run_charge             // 任務啟動扣費
  run_refund_failed      // 失敗自動退款
  run_refund_cancel      // user cancel 退款
  manual_grant           // admin 補貼
  manual_deduction       // admin 扣除
  expiration             // 月度配額過期
  plan_transition        // 升降級 proration
}
```

### 5.3 寫入規則

- **App 層只能 append，不能 UPDATE / DELETE**（Prisma middleware enforce）
- 每筆 ledger 對應 1 個業務動作
- run 扣費 + 失敗退款 = 2 筆 entry（不抵銷成 0 筆）
- `balanceAfter` 寫入時鎖 workspace row（`SELECT FOR UPDATE`）防 race

### 5.4 對帳 query

```sql
-- 月底對帳：每 workspace 該月 ledger 加總 = 餘額變化
SELECT
  workspaceId,
  SUM(credits) AS net_change,
  COUNT(*) FILTER (WHERE kind = 'run_refund_failed') AS failed_refunds,
  SUM(credits) FILTER (WHERE kind = 'run_charge') AS gross_spend
FROM CreditLedger
WHERE createdAt >= '2026-05-01' AND createdAt < '2026-06-01'
GROUP BY workspaceId;
```

---

## 6. Webhook 驗簽 + Replay 防護

### 6.1 Stripe webhook

```typescript
import Stripe from 'stripe';

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature');
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!,
      300  // 5 min tolerance
    );
  } catch (e) {
    logger.warn('stripe.webhook.invalid_signature', { sig });
    return new Response('invalid signature', { status: 400 });
  }

  // Replay 防護：用 event.id 當 idempotency key
  const seen = await db.processedWebhookEvent.findUnique({ where: { id: event.id } });
  if (seen) return new Response('duplicate', { status: 200 });
  await db.processedWebhookEvent.create({ data: { id: event.id, kind: 'stripe' } });

  // 處理
  switch (event.type) { /* ... */ }
}
```

### 6.2 Provider webhook（自家 HMAC）

```typescript
export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  const provider = params.name;
  const sig = req.headers.get('x-provider-signature');
  const ts = req.headers.get('x-provider-timestamp');
  const body = await req.text();

  // 1. 時間窗 5 分鐘
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
    return new Response('stale', { status: 400 });
  }

  // 2. HMAC 驗簽
  const secret = await getProviderSecret(provider);
  const expected = hmacSha256(secret, `${ts}.${body}`);
  if (!timingSafeEqual(sig!, expected)) {
    logger.warn('provider.webhook.invalid_sig', { provider });
    return new Response('invalid signature', { status: 401 });
  }

  // 3. Replay 防護：用 taskId+status 當 key
  const payload = JSON.parse(body);
  const replayKey = `${provider}:${payload.taskId}:${payload.status}`;
  if (await isProcessed(replayKey)) {
    return new Response('duplicate', { status: 200 });
  }
  await markProcessed(replayKey, { ttl: 86400 });

  // 處理
  return handleProviderCallback(provider, payload);
}
```

### 6.3 ProcessedWebhookEvent table

```prisma
model ProcessedWebhookEvent {
  id          String   @id    // event.id (Stripe) / hash (Provider)
  kind        String           // stripe / provider / email
  source      String?          // provider name
  processedAt DateTime @default(now())
  expiresAt   DateTime         // 24h TTL，過期 cron 刪
}
```

---

## 7. Rate Limiting

### 7.1 階梯

| 層 | 限制 | Bucket key | 工具 |
|---|---|---|---|
| Per-IP unauth | 100/min GET / 30/min POST | IP | Upstash Ratelimit |
| Per-user signed-in | 600/min GET / 60/min POST | userId | Upstash Ratelimit |
| Per-workspace | 6000/min GET / 600/min POST | workspaceId | Upstash Ratelimit |
| Per-action 特例 | magic-link 5/15min per email | email | Redis sliding window |
| Per-action 特例 | password-login 5/15min per IP+email | composite | Redis sliding window |
| Render 啟動 | 12/min user / 120/min ws | userId / wsId | Redis token bucket |
| Public share view | 300/min per slug | slug | Edge cache + ratelimit |

### 7.2 回應

429 + headers：
```
Retry-After: 60
X-RateLimit-Limit: 600
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1717123200
```

### 7.3 burst handling

- Token bucket：burst 1.5×、refill linear
- 觸發 80% 軟警告（log + slack monitor），未到 100% 不擋

---

## 8. GDPR / CCPA / PIPL 三項

### 8.1 必備 endpoint

| Endpoint | 用途 |
|---|---|
| POST `/users/me:export` | 匯出全 PII（JSON + media 連結）；非同步 24h；email 通知下載 |
| POST `/users/me:delete` | 軟刪除 + 30 天 grace period；期內可復原 |
| GET `/users/me/consent` | 看當前同意項（行銷信、追蹤等）|
| PATCH `/users/me/consent` | 改同意；audit log 紀錄 |

### 8.2 Export 內容

```jsonc
{
  "user": { "name", "email", "createdAt", "language", "publicHandle", "publicBio" },
  "workspaces_owned": [...],
  "workspaces_member": [...],
  "projects": [...],
  "panels": [...],         // 不含其他人 panel
  "characters": [...],
  "locations": [...],
  "props": [...],
  "runs": [...],
  "credit_ledger": [...],
  "shares": [...],
  "comments_made": [...],
  "comments_received_on_owned_share": [...],
  "notifications": [...],
  "audit_log_actor_self": [...],   // 自己當 actor 的 audit
  "consent_history": [...]
}
```

### 8.3 Delete 流（30 天 grace）

| Day | 行動 |
|---|---|
| 0 | user 申請刪除 → User.deletedAt = now、所有 session revoke、email 確認 |
| 0-30 | grace period：可登入 → 強制 unsuspend；不可創新內容 |
| 30 | cron 跑 hard delete：cascade 刪 owned projects/characters etc；audit log `actorName='[deleted-user-{hash}]'` 保留；share/comment 改 anonymous |
| 30+ | 法律保留（billing audit 7 年）：留 hash 化的 actorId |

### 8.4 Consent 項

```typescript
interface UserConsent {
  marketingEmail: boolean;          // 預設 false（GDPR opt-in）
  productUpdates: boolean;          // 預設 true（service email）
  analyticsTracking: boolean;       // 預設 true（必要 service）
  thirdPartyAnalytics: boolean;     // 預設 false（PostHog / GA4 細粒度）
  aiTrainingOptOut: boolean;        // 預設 false（我們不訓 user data）
}
```

### 8.5 CCPA「Do Not Sell」

- 即使我們沒賣 user data，CCPA 規定 footer 要有「Do Not Sell My Personal Information」連結
- 連結指向 `/privacy/ccpa` 解釋 + opt-out 表單

### 8.6 PIPL（中國個資法）

- 中國 user 跨境傳輸 → 必須有合法基礎 + 用戶 explicit consent
- 個資 controller 在大陸境內（KuiperAI 香港 entity → 申請存取需走 PIPL liaison）
- 14 歲以下需家長同意（產品 ToS 限 16+，所有 user 視同成年）

---

## 9. CSAM Detection

### 9.1 強制掃描範圍

- 所有 user 上傳圖（character appearance / location view / prop / cover）
- AI 生成的 panel image + video keyframe（每 1 秒 sample）
- 公開分享頁的封面

### 9.2 工具

**Microsoft PhotoDNA**（首選，業界標準）
- 每張 image 算 robust hash
- 對比 NCMEC + Interpol hashlist
- 命中 → 自動 reject + 凍結 user + NCMEC tipline 通報（法律強制）

備援：Thorn Safer / Hive Moderation。

### 9.3 違規處理 SOP

1. PhotoDNA hash match → 立即：
   - reject upload + return generic error（不洩漏為何）
   - 鎖 user account（status=locked）
   - 隔離 image 進 cold storage（合規證據）
2. 自動 NCMEC report（法律 24h 內）
3. 內部安全小組調查（48h）
4. 確認後：永久封鎖 + audit log + legal team 通報
5. 誤判申訴流程：附帳號 email + 連結到客服

### 9.4 audit

- 每張掃過的 image 寫入 `ImageScanLog`（hash / result / scannedAt / model）
- 月度合規報告

---

## 10. Audit Log Retention

### 10.1 雙軌

| Scope | 保留 | 法律依據 |
|---|---|---|
| workspace（member / settings / model）| 90 天 | 內部稽核 |
| project（panel / character 改動）| 90 天 | 內部稽核 |
| billing（升降級 / 退款 / 加購）| 7 年 | 會計法（中華民國商業會計法 §38 / 美國 IRS 7 年）|
| api（API key 使用）| 1 年 | 安全鑑識 |

### 10.2 Cron 過期

```sql
-- 每天 03:00 跑
DELETE FROM AuditLog WHERE expiresAt < NOW() AND scope != 'billing';

-- billing 移 cold storage（S3 Glacier / COS Archive）
COPY (SELECT * FROM AuditLog WHERE scope='billing' AND createdAt < NOW() - INTERVAL '90 days')
TO 's3://kuiperfilm-audit-cold/{year}/{month}/billing.jsonl';
DELETE FROM AuditLog WHERE scope='billing' AND createdAt < NOW() - INTERVAL '90 days';
```

### 10.3 不可篡改

- AuditLog 表 trigger 禁止 UPDATE/DELETE（除 retention cron）
- 每筆 hash 鏈：`row_hash = sha256(prev_row_hash + row_content)`（可選，提供 tamper-evidence）

---

## 11. 應用層 Threat Model

### 11.1 OWASP Top 10 對映

| OWASP | KuiperAI 對策 |
|---|---|
| A01 Broken Access Control | RBAC service 中央化 + 7 role 矩陣（C-rbac）+ middleware enforce |
| A02 Cryptographic Failures | Envelope encryption + TLS 1.3 only + HSTS preload |
| A03 Injection | Prisma parameterized + zod input validation + no raw SQL |
| A04 Insecure Design | 本文件 + threat model review per Phase |
| A05 Security Misconfiguration | CSP / CORS / Headers 嚴格；no `debug=true` in prod |
| A06 Vulnerable Components | Renovate weekly + npm audit CI gate + Snyk |
| A07 Auth Failures | Magic-link + rate limit + lockout + 2FA optional |
| A08 Software/Data Integrity Failures | SRI for CDN + webhook sig + immutable infra |
| A09 Security Logging Failures | 本文件 §4 + audit log |
| A10 SSRF | Provider callback URL 白名單 + 解析後檢 IP（block private ranges）|

### 11.2 Headers strict baseline

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
X-Frame-Options: DENY  # 配合 CSP frame-ancestors 'none'
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

---

## 12. CI Security Gates

```yaml
jobs:
  secret-scan:
    - run: gitleaks detect --config .gitleaks.toml
  dependency-audit:
    - run: npm audit --audit-level=moderate
    - run: snyk test --severity-threshold=high
  iac-scan:
    - run: checkov -d .  # docker-compose / Dockerfile
  sast:
    - run: semgrep --config p/owasp-top-ten
  license:
    - run: license-checker --failOn 'GPL;AGPL;SSPL'
```

PR gate：所有 job 綠才能 merge。

---

## 13. Incident Response SOP

### 13.1 分級

| Sev | 範例 | 響應 |
|---|---|---|
| P0 | 用戶資料外洩 / 平台全當機 | 15 min 內 ack；全員 on-call |
| P1 | 失敗扣點未退 / RBAC 漏洞 | 1h 內 ack；當班工程 |
| P2 | 慢查詢 / 偶發 5xx | 4h 內 ack |
| P3 | UI bug / 文案錯 | 1 工作日 |

### 13.2 P0 流程

1. **0-5 min**：偵測（Sentry / monitor / user report）
2. **5-15 min**：incident commander 指派、status page 更新
3. **15-60 min**：圍堵（rollback / kill switch / 限流）
4. **1-24h**：根因分析
5. **24-72h**：修復 + 通知受影響 user
6. **72h-7d**：Postmortem（blameless）
7. **7-30d**：執行 action items

### 13.3 Status page

`status.kuiperfilmailab.com` — Statuspage.io / 自家 worker
- 7 個 component（Auth / Storyboard / Render / Voice / Share / Billing / Admin）
- 過去 90 天 uptime
- Incident 公告

---

## 14. Pen Test / Bug Bounty

### 14.1 Launch 前一次 pen test（外包）

- Cobalt.io / HackerOne 私人專案
- 範圍：production-like staging
- 時程：launch 前 4 週開始，2 週測試 + 2 週修正
- 預算：$8k-15k

### 14.2 Bug Bounty（GA 後）

- HackerOne / Bugcrowd public program
- 報酬：
  - Critical（RCE / 大量資料外洩）：$2,000-5,000
  - High（auth bypass / RBAC / SSRF）：$500-2,000
  - Medium（XSS / CSRF）：$100-500
  - Low（info disclosure）：$50-100
- 排除：DoS / 社交工程 / 物理

---

## 15. 對映檢查表（D-x 拍板對映）

- D-1 7 role → RBAC matrix 中央化 service（§11.1 OWASP A01）
- D-2 砍 enterprise → schema cleanup（無遺留 attack surface）
- D-3 credits 雙軌 → CreditLedger 雙軌（§5）
- D-4 Q-paths-canonical → SSRF 白名單對齊
- D-5 補 7 model → AuditLog / APIKey scheme（§10）
- D-6 主術語 → log message i18n（無敏感詞洩漏）
- D-7 Foundation 補 → ErrorBoundary 不洩 traceId 含 PII
- D-8 Phase 統一 → Pen test 與 launch phase 對齊

---

## 16. 失敗案例庫（內部 wiki）

- **2026-05-03 worker TDZ 循環 import outage**：cf [[project_kuiperfilm_circular_import_outage]] — guard 已加
- **2026-05-12 Tencent VOD image API schema drift**：cf memory note
- **2026-05-16 Bull-Board prod 默認無認證**：fail-closed 已 ship
- **2026-05-16 storyboard FK race**：episode-level conflict guard 已 ship
- **2026-05-22 ARK 跨境 base64 60s timeout**：asset:// 預註冊 + signed URL

---

**下一份：** O（responsive + 13-narrative 拆 component）
