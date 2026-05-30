# F · 觀測 / 事件 schema 規劃

> **目標：** 把 funnel、事件 schema、KPI、cost tracking 全列。先定好 schema，否則上線後追資料才補事件，會「資料缺哪段」永遠回不來。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** B-api-endpoints.md
> **核心原則：** event-first（每個 user action 都是事件） + 不用第三方猜測（自家也 log 一份）

---

## 0. TL;DR

- **主 Funnel：** Visitor → Signup → First Project → First Generation → First Share → Upgrade（6 個關鍵 milestone）
- **2 個 analytics provider**：**PostHog**（產品事件 + funnel）+ **GA4**（marketing attribution + SEO）
- **自家 log 一份**：所有 critical event 進 `AnalyticsEvent` DB 表（schema 補丁見 §6）
- **6 個關鍵 KPI**：DAU/WAU/MAU、Activation Rate、Retention Cohort、ARPU/ARPPU、LTV/CAC、Provider cost per generation
- **Error tracking**：Sentry（E 文件已涵蓋）

---

## 1. 主 Funnel 定義

### 1.1 Visitor → Signup（公開層）

```yaml
events:
  - landing_viewed                  # GA4 + PostHog
  - landing_hero_cta_clicked        # 哪個 CTA 點得最多
  - showcase_video_played           # showcase 影響度
  - pricing_viewed                  # 從哪頁進 pricing
  - pricing_tier_hovered            # 預示 conversion intent
  - signup_started                  # 進 19-auth 頁
  - signup_method_chosen            # magic-link / google / github
  - signup_completed                # 完成註冊
  - email_verified                  # magic link 點開
  - invite_requested                # 沒 invite 申請的
```

**Conversion rate 目標：**
- landing_viewed → signup_started: **8%**
- signup_started → signup_completed: **70%**
- signup_completed → email_verified: **85%**

### 1.2 Signup → First Project

```yaml
events:
  - onboarding_started               # mockup 26
  - onboarding_step_completed        # step1/2/3/4
  - onboarding_skipped                # 哪一步跳掉
  - onboarding_completed
  - first_project_created            # T0 啟動 Activation 計算
  - first_project_from_template      # 從範本（vs 從零）
```

**Activation 定義：** 註冊後 7 天內 `first_project_created`。目標 **40%+**。

### 1.3 First Project → First Generation

```yaml
events:
  - script_uploaded                  # 06
  - script_pasted                    # 06
  - script_analyze_clicked           # 07 入口
  - script_analyzed                  # 分析完成
  - elements_extracted               # 顯示在 07
  - element_edited                   # 進 15/16/17
  - generation_confirmed             # 07 →
  - first_panel_generated            # 第一個 panel 真的生成完
  - first_episode_completed          # 整集 render done
```

**Activation 進階定義（North Star）：** 註冊後 7 天內完成 `first_episode_completed`。目標 **15%+**。

### 1.4 First Generation → First Share

```yaml
events:
  - episode_downloaded               # 25
  - episode_published_internal       # 內部分享連結
  - episode_published_external       # 一鍵發抖音/小紅書/IG/YT
  - share_link_copied                # 31 → 內部分享
  - showcase_published               # 公開到 32 廣場
  - first_share                      # 任何 share 行為（aggregated）
```

**Sharing rate 目標：** First episode → first_share **35%+**（社群成長關鍵）

### 1.5 First Share → Upgrade

```yaml
events:
  - credits_low_shown                # 通知低於 20% 點數
  - upgrade_modal_opened             # 點數不足 / 想用 advanced feature
  - upgrade_tier_chosen              # 選哪個 tier
  - upgrade_billing_cycle_chosen     # monthly vs annual
  - stripe_checkout_started          # 跳 Stripe
  - upgrade_completed                # webhook 觸發
  - upgrade_cancelled                # 降回 free
```

**Free → Paid 目標：** 30 天內 **5-10%**（業界 freemium 標準）

---

## 2. 完整事件 schema

### 2.1 共通屬性

每個事件都應該有：

```typescript
{
  // Identity
  userId: string | null,
  sessionId: string,
  anonId: string,            // 未登入時用
  workspaceId: string | null,

  // Context
  page: string,              // "13-narrative-editor"
  referrer: string,
  utm_source / utm_medium / utm_campaign,
  device: { type, os, browser, viewport },
  language: 'zh' | 'en',

  // Timing
  timestamp: ISO8601,
  client_ts: ISO8601,        // user 端時間
  server_ts: ISO8601,        // 後端時間（for sequencing）

  // Event-specific
  ...properties
}
```

### 2.2 創作流事件詳細 schema

```typescript
// Generation 成功
type EventGenerationSucceeded = {
  panelId: string;
  episodeId: string;
  projectId: string;
  mode: 'direct_t2v' | 'r2v_with_subjects' | 't2i_then_i2v' | 'r2v_with_motion_ref';
  provider: string;          // 'ark::seedance-2.0'
  duration: number;          // panel 時長
  cost: number;              // 實際扣點
  latency_ms: number;
  versionNumber: number;     // 是這個 panel 的第幾版
};

// Generation 失敗
type EventGenerationFailed = {
  panelId: string;
  mode: string;
  provider: string;
  errorCode: string;         // 'PRIVACY_INFO' | 'TIMEOUT' | 'QUOTA' | ...
  errorMessage: string;
  fallbackProvider?: string; // 自動 fallback 用了哪個
  refundedCredits: number;
};

// 重生
type EventPanelRegenerated = {
  panelId: string;
  trigger: 'user_button' | 'mode_change' | 'param_change' | 'bulk_retry';
  fromVersionId: string;
  toVersionId: string;
  costDelta: number;
};
```

### 2.3 商業事件

```typescript
type EventStripeCheckout = {
  tierFrom: 'free' | 'creator' | ...;
  tierTo: 'creator' | 'studio' | 'team';
  cycle: 'monthly' | 'annual';
  amountCents: number;       // 付了多少（cents）
  seats?: number;            // Team tier
  source: 'credits_low' | 'feature_gated' | 'cta_pricing_page' | 'admin_pushed';
};
```

---

## 3. KPI Dashboard

### 3.1 必看 6 個 KPI

| KPI | 計算 | 目標 |
|---|---|---|
| **DAU / WAU / MAU** | distinct users active in last 1/7/30 days | 線性成長 |
| **Activation Rate** | signup 後 7 天內 first_episode_completed | 15%+ |
| **D1/D7/D30 Retention** | 註冊後第 1/7/30 天回訪 | 40/20/10 |
| **ARPU / ARPPU** | revenue / total users vs paid users | ARPU $5 / ARPPU $40 |
| **LTV / CAC** | lifetime revenue / acquisition cost | LTV:CAC ≥ 3 |
| **Provider cost / generation** | actual cost / total generations | < $0.20 / 5s panel |

### 3.2 Funnel 看板

```yaml
Marketing funnel:
  Visitor → Signup → First Project → First Generation → First Share → Upgrade
  100k    →  8k    →  3.2k         →  2k              →  700        →  100

Conversion at each step:
  - Visitor → Signup:        8.0%
  - Signup → First Project:  40%
  - First Project → Gen:     62.5%
  - Gen → Share:             35%
  - Share → Upgrade:         14% （high signal user）
  Overall: Visitor → Upgrade = 0.1%
```

### 3.3 Cohort retention

按註冊月 cohort 看 retention curve：

```
        | Week 1 | Week 2 | Week 4 | Week 8 | Week 12
Jan 2026|  80%   |  45%   |  30%   |  22%   |  20%
Feb 2026|  82%   |  48%   |  32%   |  ...
```

Provider cost 也要 cohort：新 user 平均 5 episode/月，老 user 8 episode/月。

---

## 4. 工具選擇

### 4.1 PostHog（產品事件 + funnel）

| 項目 | 設定 |
|---|---|
| **Plan** | $0 → 1M events/月 free，$0.31/100k events 以後 |
| **特點** | Self-host 可選（敏感資料） |
| **整合** | Next.js + frontend SDK + backend `posthog-node` |
| **特別功能** | Session replay（看 user 真實操作）、A/B test、Feature flags |

```typescript
// frontend
import { usePostHog } from 'posthog-js/react';
const posthog = usePostHog();
posthog.capture('generation_succeeded', { panelId, mode, provider, cost });

// backend
import { PostHog } from 'posthog-node';
const ph = new PostHog(process.env.POSTHOG_KEY);
ph.capture({ distinctId: userId, event: 'render_completed_server', properties: {...} });
```

### 4.2 GA4（marketing + SEO）

| 項目 | 設定 |
|---|---|
| **Plan** | Free |
| **用途** | Acquisition channel attribution、organic search、page views |
| **整合** | Next.js + gtag |

**為什麼 PostHog + GA4 兩個都要：** GA4 marketing 強但 product event 弱，PostHog product event 強但 marketing attribution 弱。互補。

### 4.3 自家 AnalyticsEvent 表（**必須有**）

不要 100% 依賴第三方 — 失聯時關鍵資料不能掉。

```prisma
// 補丁進 A schema
model AnalyticsEvent {
  id              String   @id @default(cuid())
  eventName       String                 // 'generation_succeeded'
  userId          String?
  workspaceId     String?
  sessionId       String?

  properties      Json                   // event-specific payload

  // Timing
  clientTimestamp DateTime
  serverTimestamp DateTime @default(now())

  // For debugging
  ipHash          String?                // hashed IP，不存原文
  userAgent       String?

  @@index([eventName, serverTimestamp])
  @@index([userId, serverTimestamp])
  @@index([workspaceId, serverTimestamp])
}
```

**只記關鍵事件**（不是全部 PostHog 事件）— 避免表暴漲：
- generation_succeeded / failed
- upgrade_completed
- first_episode_completed
- first_share
- account_deleted

每 30 天 archive 到 cold storage（S3 Glacier / R2）。

---

## 5. Cost tracking（內部，不對外）

### 5.1 Run 表加欄位（補丁進 A schema）

```prisma
// 補丁 — 既有 Run 表（從 LangGraph runtime）
model GraphRun {
  // ... 既有欄位 ...

  // ─── Cost tracking 新增 ───
  estimatedCost   Float?      // dispatch 前估
  actualCost      Float?      // 實際扣的（USD cents）
  providerCost    Float?      // 我們對 provider 的成本（USD cents）
  marginPct       Float?      // (actualCost - providerCost) / actualCost
}
```

### 5.2 Cost dashboard（mockup 18 admin 用）

```yaml
日 / 週 / 月 視角：
  總點數燒掉：sum(actualCost)
  總成本：sum(providerCost)
  毛利率：avg(marginPct)
  失敗率：count(status=failed) / count(*)
  失敗退點：sum(refundedCredits) where status=failed

Per provider 拆解：
  ARK Seedance 2.0 ........ 42% rev / 38% cost / 65% margin
  AtlasCloud r2v ........... 25% rev / 22% cost / 68% margin
  fal Seedance Pro ......... 18% rev / 20% cost / 55% margin   ← 低
  BobAPI Seedance .......... 11% rev / 13% cost / 50% margin   ← 低
  Tencent Kling Omni ........ 4% rev /  7% cost / 30% margin   ← 應該降使用比例
```

**Alert 規則：**
- 單 user 24h 點數消耗 > 10,000 pt → 通知（可能濫用）
- 整體當日成本 > 預期 130% → email cofounder
- 某 provider 連續失敗率 > 10% → 5 分鐘 alert

---

## 6. 第三方 cost：分析工具花費

| 工具 | 月費 | 必要？ |
|---|---|---|
| PostHog Cloud | $0 (1M events) → $50 | 必要 |
| GA4 | $0 | 必要 |
| Sentry Team | $26 | 必要 |
| Plausible（替代 GA4，更尊重隱私） | $9 → 100k pageview | 可選 |
| Hotjar / Microsoft Clarity | $0 → $39 | 可選（有 PostHog session replay 不需要） |

**月度預估：** $76 / 月（PostHog + Sentry）

---

## 7. 落地清單

- [ ] PostHog cloud project 創建 + frontend SDK + backend SDK
- [ ] GA4 property 創建 + gtag.js 加進 layout
- [ ] AnalyticsEvent 表 migration（補丁進 A）
- [ ] GraphRun cost tracking 欄位（補丁進 A）
- [ ] 寫 event-fire helper：`fireEvent(eventName, props)` 同時送 PostHog + 自家
- [ ] 主 funnel 6 個 milestone 全部 wire
- [ ] Activation rate / Retention cohort dashboard 建好（PostHog 內建）
- [ ] Cost tracking dashboard 進 mockup 18 admin
- [ ] Alert（單 user 濫用 / provider 失敗率 / 整體成本超限）

---

**下一份：** G-legal-compliance.md
