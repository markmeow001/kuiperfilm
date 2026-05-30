# IMPL_PREP — 實作前規劃文件集

> KuiperAI 公開上線重設計 — 真實 React 實作前的 7 份規劃文件。

## 文件總覽

| # | 文件 | 行數 | 內容 | 優先 |
|---|---|---|---|---|
| A | [Schema Migration](./A-schema-migration.md) | ~600 | 5 既有表加欄位 + 7 新表 + 4 enum + backfill 策略 | **P0**（必先） |
| B | [API 端點清單](./B-api-endpoints.md) | 265 | 121 個新 endpoint，按 mockup 對應 | P0 |
| C | [RBAC 權限矩陣](./C-rbac-matrix.md) | 304 | Org/Workspace/Project × 8 Role × 30 Action | P0 |
| D | [Pricing 反推試算](./D-pricing-reverse-math.md) | 340+ | 5 provider 成本 → 點數 → 4 階梯（5 拍板鎖好） | P0 |
| E | [第三方整合](./E-third-party-integrations.md) | ~440 | OAuth（抖音/小紅書/IG/YT/TikTok）+ Stripe + Email/Push/Sentry | P1 |
| F | [觀測 / 事件 schema](./F-observability-events.md) | ~400 | Funnel + 事件 schema + KPI + Cost tracking | P1 |
| G | [法律 / 合規](./G-legal-compliance.md) | ~480 | ToS / Privacy / GDPR / 中國個資法 / DMCA / 兒少 | P1 |
| H | [Marketing 與 Launch 策略](./H-marketing-launch-strategy.md) | ~460 | Brand positioning / 3 target audience / launch 30 天 / channel 預算 | P2 |
| I | [創作者 Onboarding + 樣板劇本](./I-creator-onboarding-templates.md) | ~440 | 6 樣板劇本 / 5 教學影片 / 知識庫 / Discord / Badge 系統 | P2 |
| J | [品牌資產 + Pitch Deck](./J-brand-pitchdeck.md) | ~440 | Logo 外包 brief / 品牌指南 / 投資人 Pitch / BD Sales / Press Kit | P2 |
| K | [OpenAPI 3.1 合約](./K-openapi-spec.md) + [yaml](./K-openapi.yaml) | 537 + 1,766 | 25 高槓桿 endpoint 完整 spec + 30 共用 schema + 96 個 path summary | **P0** |
| L | [Component 庫盤點地圖](./L-component-inventory.md) | 525 | 36 mockup → React component tree + Foundation 8 大資料層 + 工期 161-193 工程師-天 | **P0** |
| M | [E2E 測試情境集](./M-e2e-scenarios.md) | 600 | 7 Phase × happy + edge + 跨 Phase；定義「完成」標準 | **P0** |
| Q | [Q-paths-canonical 路徑唯一來源](./Q-paths-canonical.md) | 414 | 124 + 7 endpoint canonical paths；B 改 reference Q；30 條對映表 | **P0** |
| N | [N-security-baseline](./N-security-baseline.md) | 590 | CSP/CORS/secret rotation/log redaction/CreditLedger/CSAM/GDPR/OWASP 對映/Pen test | **P0** |
| O | [O-responsive + 13/08/36/37/38 拆 component](./O-responsive-component-spec.md) | 470 | 5 斷點 token + 36 mockup × 4 mode + 13 拆 8 個 sub + 08 拆 7 + 36/37/38 各 4-8 | **P1** |
| P | [P-test-scenarios-extended](./P-test-scenarios-extended.md) | 700 | M 補強：Idempotency / 失敗不扣點 ledger / Stripe sig / RBAC 矩陣 / 跨 ws leak / SSE seq / DST 等 25 章 | **P0** |

**總 ~10,500 行可實作藍圖。**

## 實作順序建議

```
Phase 0：寫 17 份規劃文件       ✅ 已完成（A-G 工程實作前 + H-J launch + K-M 合約/盤點/E2E + Q 路徑 + N/O/P 補丁）

Phase 1：你 review + 拍板        ✅ D-1~D-8 全拍板（2026-05-30）；A/B/C/D/K/L/M/Q 全部已對齊
        - E/F/G 大多預設選擇，看完有不對的點告訴我
        - N/O/P 是 5-reviewer 報告抓出的安全 / UX / 測試補強

Phase 2：對外申請啟動           🟡 launch 前 6-10 週必須
        - 抖音 / 小紅書 / IG / YT / TikTok OAuth
        - Stripe 帳號 + Products
        - 律師找好 + ToS/Privacy 起草

Phase 3：跑 Schema migration (A §3 15 步)
        - staging 跑完 backfill 比對 row count
        - 生產跑前 pg_dump backup

Phase 4：實作 RBAC service + middleware (C §5)

Phase 5：依 mockup 順序實作 API + frontend (B)
        - 主路徑：06 → 07 → 13 → 08 → 23 → 24 → 25
        - 元素編輯：15 → 16 → 17
        - 公開層：31 → 32
        - 系統層：18 / 28 / 29

Phase 6：Stripe + Webhook + 通知 infra (D §6 + E §3-§5)

Phase 7：觀測 wire up + cost tracking (F)

Phase 8：法律文件 publish + compliance endpoint (G)

Phase 9：Soft launch（內測 1 週觀察）

Phase 10：Public launch 🎉
```

## D pricing 5 拍板（2026-05-29）

- ✅ Free 600 pt 月上限
- ✅ Annual 20% 折扣
- ✅ Team 第 4+ seat $25/月
- ✅ 加購包不過期 roll over
- ✅ Enterprise tier 暫不加

## 月度預估（10,000 用戶）

| 項目 | 月成本 |
|---|---|
| Provider AI costs | $6,000 |
| Stripe 手續費 (~3%) | $1,500 |
| Email / Push / Sentry / CDN / Analytics | $200 |
| Compliance / Safety services | $800 |
| Hosting (Cloudflare + Tencent) | $80 |
| **總成本** | **~$8,600 / 月** |
| 總收入 | $52,100 |
| **淨毛利** | **$43,500 (~84%)** |

## 相關設計文件

- `/Users/joshhung/KuiperAI/REDESIGN_PLAN.md` — 整體重設計 master plan
- `/Users/joshhung/KuiperAI/DESIGN.md` — 視覺設計 token
- `/Users/joshhung/KuiperAI/design-preview/` — 33 個 mockup（雙語）
