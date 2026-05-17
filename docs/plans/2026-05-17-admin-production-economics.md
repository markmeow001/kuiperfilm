# Admin Production Economics Dashboard Plan

**Date**: 2026-05-17
**Status**: Draft — Phase 1 starting immediately, Phase 2/3 pending product decisions
**Owner**: TBD
**Related code**: `src/app/api/admin/per-user-task-usage/route.ts`, `src/app/api/admin/llm-usage-snapshot/route.ts`, `src/lib/billing/`, `prisma/schema.prisma` (`UsageCost`, `NovelPromotionPanel`)

---

## 1. Context

User asked to surface 10 production-economics metrics on the admin dashboard so they can monitor unit economics of the video pipeline:

| # | 指標 | 中文意義 |
|---|---|---|
| 1 | 总生成秒数 | 所有生成的影片秒數總和(包含廢片) |
| 2 | 最终成片秒数 | 進入最終影片的有效秒數 |
| 3 | 成片率 | #2 ÷ #1 |
| 4 | 废片率 | 1 − #3 |
| 5 | 总token消耗 | LLM 累積 token 數 |
| 6 | token/生成秒 | 生成效率(每秒輸出耗多少 token) |
| 7 | token/成片秒 | 真實交付效率(扣掉廢片) |
| 8 | 每分钟真实成本 | 我們付給 provider 的 actual cost / 交付分鐘 |
| 9 | 每分钟交付价格 | 我們向 user 收的價格 / 交付分鐘 |
| 10 | 毛利率 | (#9 − #8) ÷ #9 |

Pipeline 既有 admin observability:
- `/api/admin/per-user-task-usage` — weekly image/video task counts
- `/api/admin/llm-usage-snapshot` + `task-usage-snapshot` — token + bill aggregates
- `/api/admin/runs` — run-level breakdown
- bi-weekly CSV export 已 ship(`project_kuiperfilm_cso_audit_2026_05_16`)

## 2. Goals

- 把 10 個指標其中 4 個(全部已知資料源)立刻 ship,admin 今天就看到 unit economics
- 把 3 個需要「成片 vs 廢片」標記的指標補上 — 走 A/B/C 三方案中之一(待產品拍板)
- 把 3 個需要「交付價格」概念的指標補上 — 走 (i)-(iv) 四方案中之一(待產品拍板)
- 維持既有 admin 頁面 UX 風格(不引入新框架)
- bi-weekly CSV 也吐這 10 個指標(若可算則填數值,不可算填 `N/A`)

## 3. Non-Goals

- 不做 per-task 細節下鑽(已有 `runs` endpoint)
- 不做即時 streaming(每 15 分鐘 cron snapshot 或 on-demand 查詢就夠)
- 不做 user 自己看自己的 economics(本 plan admin-only)
- 不做 alerting / threshold(後續 phase 再說)
- 不做 forecasting / projection — 只給歷史實際數字

## 4. Decision Summary

| 議題 | 方案 | 理由 |
|---|---|---|
| 4 個 ready 指標 | **Phase 1 直接 ship** | 0 schema change,0 產品決策 |
| 「成片」標記方式 | **Phase 2 — A 方案(panel ⭐ 手動標記)** | 最低工程,user 操作成本可接受 |
| 「交付價格」概念 | **Phase 3 — (iv) 全局 benchmark** | 業務還沒對外收費,先取假設值反推 ROI |
| 預設展示週期 | 4 週滾動 | 對齊 `per-user-task-usage` 既有 default |
| Snapshot 策略 | on-demand 查詢 + 每日 cron 緩存 | 4 週聚合 SQL 大概 < 500ms,夠快 |

## 5. Metric Breakdown(三層分類)

### 5.1 Tier A — 立刻可算(Phase 1)

| 指標 | SQL 邏輯 | 來源 |
|---|---|---|
| 总生成秒数 | `SUM(NovelPromotionPanel.duration WHERE videoUrl IS NOT NULL AND deletedAt IS NULL)` | panel duration 已存 |
| 总token消耗 | `SUM(UsageCost.metadata->'$.inputTokens' + UsageCost.metadata->'$.outputTokens')` where billable LLM types | billing pipeline 已收 |
| 每分钟真实成本 | `SUM(UsageCost.cost) / (总生成秒数 / 60)` | UsageCost.cost Decimal |
| token/生成秒 | 总token消耗 / 总生成秒数 | 衍生 |

### 5.2 Tier B — 需要「成片」標記(Phase 2)

| 指標 | 卡點 | 解法(A 方案) |
|---|---|---|
| 最终成片秒数 | 沒有 panel「是否進入最終影片」標記 | `NovelPromotionPanel.includedInFinalCut Boolean @default(false)` + UI ⭐ toggle |
| 成片率 | 同上 | 衍生 |
| 废片率 | 同上 | 衍生 |
| token/成片秒 | 同上 | 衍生 |

**Phase 1 過渡期 — C 方案 proxy:**
- 沒手動標的 panel,先用 `videoUrl IS NOT NULL AND deletedAt IS NULL AND updatedAt = (最新 regenerate)` 當代理
- Dashboard 顯示「成片率 (估)」+ tooltip 提示這是 proxy 不準
- Phase 2 ship 後改用真實標記

### 5.3 Tier C — 需要「交付價格」概念(Phase 3)

| 指標 | 卡點 | 解法 ((iv) 方案) |
|---|---|---|
| 每分钟交付价格 | 沒有 user-charged 概念 | admin 後台填一個全局 benchmark(例:50 RMB/min),存 `SystemConfig.deliveryPricePerMinute` |
| 毛利率 | 同上 | (交付價格 − 真實成本) ÷ 交付價格 |

Phase 1 暫時顯示 `N/A` + tooltip「請於 Phase 3 設定 benchmark」。

## 6. Architecture

### 6.1 新增 endpoint

**`GET /api/admin/production-economics`**

```
Query params:
  weeks       1-12 (default 4)
  groupBy     'global' | 'user' | 'week'  (default 'global')
  format      'json' | 'csv'              (default 'json')

Response (groupBy='global'):
{
  windowStart: "2026-04-20",
  windowEnd:   "2026-05-17",
  metrics: {
    generatedSeconds:    12345.6,
    deliveredSeconds:    8901.2,
    deliveredRatio:      0.721,
    wasteRatio:          0.279,
    totalTokens:         98765432,
    tokensPerGenSecond:  8001.2,
    tokensPerFinalSecond:11094.5,
    realCostPerMinute:   1.234,     // RMB or USD per minute
    deliveryPricePerMinute: null,    // until Phase 3 admin sets benchmark
    grossMargin:         null,
    currency:            "RMB"
  },
  meta: {
    deliveredSource: "proxy" | "manual_flag",
    pricingSource:   "unset" | "global_benchmark",
    snapshotAt:      "2026-05-17T04:55:32Z"
  }
}

Response (groupBy='user'):
{
  windowStart, windowEnd,
  users: [
    { userId, name, ...metrics, meta: {...} },
    ...
  ]
}

Response (groupBy='week'):
{
  weeks: [
    { weekStart, weekEnd, ...metrics, meta: {...} },
    ...
  ]
}
```

### 6.2 SQL 形狀(Phase 1)

```sql
-- 生成秒數(per user, 4w)
SELECT
  pp.userId,
  ISO_WEEK(p.createdAt) AS week,
  SUM(panel.duration) AS gen_seconds
FROM novel_promotion_panels panel
JOIN novel_promotion_projects pp ON pp.projectId = panel.storyboardId  -- 路徑可能要調
WHERE panel.videoUrl IS NOT NULL
  AND panel.deletedAt IS NULL
  AND panel.createdAt >= NOW() - INTERVAL 28 DAY
GROUP BY pp.userId, week;

-- Token 聚合 (per user, 4w)
SELECT
  userId,
  ISO_WEEK(createdAt) AS week,
  SUM(JSON_EXTRACT(metadata, '$.inputTokens')) AS in_tok,
  SUM(JSON_EXTRACT(metadata, '$.outputTokens')) AS out_tok,
  SUM(cost) AS total_cost
FROM usage_costs
WHERE apiType IN (
  -- billable LLM types — confirm with billing/cost.ts catalog
  'llm', 'chat-completions', ...
)
  AND createdAt >= NOW() - INTERVAL 28 DAY
GROUP BY userId, week;
```

Helper:`src/lib/admin/production-economics.ts` 封裝 SQL + 拼裝 + computeDerivatives。

### 6.3 UI

新增 admin 頁面 `src/app/[locale]/admin/economics/page.tsx`:

```
┌─ Production Economics ─────────────────────────────────────────┐
│ 期間:[最近 4 週 ▼]  分組:[整體 ▼]   [下載 CSV]               │
├────────────────────────────────────────────────────────────────┤
│   总生成秒数        12,345.6 s                                  │
│   最终成片秒数       8,901.2 s  ⓘ (估)                          │
│   成片率              72.1%    ⓘ                                │
│   废片率              27.9%                                     │
│   总token消耗      98,765,432                                   │
│   token/生成秒          8,001.2                                 │
│   token/成片秒         11,094.5                                 │
│   每分钟真实成本    ¥1.234                                      │
│   每分钟交付价格    N/A   ⓘ 請於系統設定填入                    │
│   毛利率            N/A                                         │
├────────────────────────────────────────────────────────────────┤
│ 切換 分組=用戶 → 同樣 10 個指標 per-user table                  │
│ 切換 分組=週 → 4 週時序                                         │
└────────────────────────────────────────────────────────────────┘
```

加入既有 admin 側邊欄(`/admin/users`、`/admin/projects` 同層)。

## 7. Schema Changes

**Phase 1**:0 schema change

**Phase 2(A 方案)**:
```prisma
model NovelPromotionPanel {
  // ... existing fields
  includedInFinalCut Boolean @default(false)  // user 手動 ⭐ 標
  finalCutMarkedAt   DateTime?                // 標記時間 (audit)
}
```
Migration:`prisma migrate dev --name add_panel_final_cut_flag`

**Phase 3((iv) 方案)**:
```prisma
model SystemConfig {
  key       String   @id
  value     String   @db.Text
  updatedAt DateTime @updatedAt
}
// Seed: { key: 'deliveryPricePerMinute', value: '50.00' }
// Seed: { key: 'deliveryPriceCurrency', value: 'RMB' }
```
或直接 `process.env.DELIVERY_PRICE_PER_MINUTE`(更簡單,但改 price 要重啟,可接受)

## 8. Phased Rollout

### Phase 1 — Tier A 4 指標(today, 1d)
- helper `src/lib/admin/production-economics.ts`
- endpoint `/api/admin/production-economics` 支援 4 個指標 + Tier B 用 proxy + Tier C 顯示 N/A
- admin 頁面 `/admin/economics`
- CSV export 沿用 既有 pattern
- 單元測試 SQL aggregate + helper math
- 整合測試 endpoint admin auth

### Phase 2 — Tier B 真實成片標記(pending 產品拍板,1.5d)
- schema migration `includedInFinalCut Boolean`
- panel UI 加 ⭐ toggle(在 V2StoryboardClient panel card)
- API `PATCH /api/panels/[id]/final-cut`
- helper 從 proxy 切回真實 flag
- UI tooltip 從「(估)」拿掉

### Phase 3 — Tier C 交付價格(pending 產品拍板,0.5d)
- 走 (iv):admin 後台填 benchmark
  - 新 admin 頁面 `/admin/settings` 或 inline 在 economics 頁面
  - 或直接 env var(更快但改價要 restart)
- helper 算 grossMargin
- UI 把 N/A 換成數字

**總估時:3 天**(if 全部走完)

## 9. Open Questions

1. **Tier A 期間預設 4 週,要不要支援自訂日期區間?**
   - 推薦 Phase 1 只支援 1/2/4/12 週 dropdown,自訂日期 Phase 2+ 再說
2. **token 計算是否含 image / video provider 的隱含 token?**
   - 推薦只算 LLM(text 模型),圖/視頻是 unit-based 不是 token-based
3. **每分钟成本 / 收費 顯示貨幣**
   - 推薦 Phase 1 hardcode RMB,Phase 3 連 currency 一起做成 setting
4. **panel duration NULL 怎麼處理?**(歷史資料可能有空值)
   - 推薦排除(SUM 自動排除 NULL),日誌 warn 一行
5. **Soft-deleted user 的資料是否計入?**(`isActive=false`)
   - 推薦計入,economics 是歷史會計,user 走了帳還在

## 10. Out of Scope

- per-task 下鑽(已有 `/api/admin/runs`)
- alerting(threshold 觸發 webhook)
- forecasting(這週成本預估下週)
- user 自己看 economics
- 多幣別轉換
- 計費對外發票

## 11. Test Plan

### Unit
- SQL aggregate 正確性(panel duration sum、token sum、cost sum)
- 衍生公式(成片率 / token per second / 真實成本 per minute)
- proxy vs flag 兩種 deliveredSeconds 計算路徑
- N/A 顯示邏輯(price 未設)

### Integration
- admin auth required(非 admin → 403)
- groupBy=global/user/week 三種回傳 shape 正確
- CSV export header + 數值對齊

### Manual QA
- prod 真實資料跑出來數字「看起來合理」(成片率 0-100% 之間,token/sec 不要負數)
- 跨時區邊界(週切換時數值不跳)

## 12. Edge Cases

| 場景 | 行為 |
|---|---|
| 用戶無任何活動 | 全部 0,毛利率顯示 N/A(防 NaN) |
| 0 生成秒但有 token | 「token/生成秒 = N/A」,不要除 0 |
| panel videoUrl 存在但 duration NULL | 排除,不計入 |
| UsageCost cost = NULL | 排除 cost,只計 token |
| 同一 panel 多次 regenerate | 用最新一次的 duration(或全加?待確認) |
| 跨集 panel(episode 切換) | 按 panel.createdAt 歸屬週,不切 episode |
| panel includedInFinalCut=true 但 videoUrl=NULL | bug 狀態,exclude + log warn |

## 13. Risk Register

| 風險 | 機率 | 影響 | 緩解 |
|---|---|---|---|
| SQL 跨大表 join 太慢 | 中 | 中 | EXPLAIN + index 評估;> 1s 加 materialized view / cron snapshot |
| 「最新一次 regenerate」定義不清 → 重複計算 duration | 中 | 中 | Phase 2 統一規格,Phase 1 用「panel 唯一 = 1 次計入」 |
| pricing benchmark 設錯,毛利率誤導 | 中 | 低 | Phase 3 UI 提示「benchmark = 假設值」 |
| token metadata 沒填完整(舊任務) | 高 | 低 | 顯示「< X 日前資料不完整」disclaimer |

## 14. Acceptance Criteria

Phase 1 視為 done 當以下都滿足:

- [ ] admin 進 `/admin/economics` 看到 10 個指標(其中 7 個有數字、3 個 N/A)
- [ ] 切「分組=用戶」看到 per-user table
- [ ] 切「分組=週」看到 4 週時序
- [ ] CSV 下載含全部欄位 + N/A 標示
- [ ] 非 admin user 訪問 → 403
- [ ] 「成片率」tooltip 寫明「目前用 proxy,Phase 2 改真實標記」
- [ ] 4 個 Tier A 指標的 SQL 與 helper 都有單元測試

---

**Next step**:Phase 1 立刻啟動,Phase 2/3 等 user 拍板。
