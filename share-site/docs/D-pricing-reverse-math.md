# D · Pricing 反推試算表

> **目標：** 5 家 provider 真實成本 → 點數定價 → 4 階梯訂閱數字反推。**算錯一次可能燒幾個月錢**，所以要先打死。
>
> **狀態：** v1 · 2026-05-29
> **依賴：** REDESIGN_PLAN.md §4 hybrid pricing
> **重要：** 所有 provider 價格基於 2026-05 公開 quote + 內部測試。實作前**要再 sanity check** 一次。

---

## 0. TL;DR

- **1 點 = $0.0015 USD**（user 看到 100 點 ≈ $0.15）
- **1 鏡平均成本 = $0.18**（5s panel × 加權平均 provider）→ **120 點/鏡**
- **1 集 = 平均 10 鏡 × 120 點 = 1,200 點**（粗算，實際因失敗免扣會略低）
- **建議 4 階梯：**
  - Free: $0 · 100 點/天 · 月上限 600
  - Creator: $15/月（年付）· 1,500 點/月
  - Studio: $47/月（年付）· 5,000 點/月 ← **預期主力**
  - Team: $119/月（年付）· 15,000 點/月 + 3 seats
- **毛利目標** 60-70%（Studio tier）— 對照 Krea / Higgsfield 行情

---

## 1. Provider 真實成本（USD per generation）

### 1.1 視訊生成

| Provider | Model | 解析度 | 5s 成本 | 8s 成本 |
|---|---|---|---|---|
| **ARK Seedance 2.0** | t2v / r2v / i2v | 1080×1920 | ~$0.10 | ~$0.16 |
| **AtlasCloud Seedance 2.0** | r2v | 1080×1920 | ~$0.12 | ~$0.20 |
| **fal Seedance Pro** | r2v | 1080×1920 | ~$0.15 | ~$0.24 |
| **BobAPI Seedance 2.0** | r2v / multi-shot | 1080×1920 | ~$0.20 | ~$0.32 |
| **Tencent Kling Omni** | t2v multi-shot 15s | 1080×1920 | $0.50（fixed 15s） | $0.50 |

**加權平均**（按 mockup 24 預期路由比例 ARK 42% / AC 25% / fal 18% / Bob 11% / Kling 4%）：

```
5s panel 平均成本：
  0.42 × $0.10 + 0.25 × $0.12 + 0.18 × $0.15 + 0.11 × $0.20 + 0.04 × $0.50
= $0.042 + $0.030 + $0.027 + $0.022 + $0.020
≈ $0.141 ≈ $0.14
```

### 1.2 T2I（關鍵幀，T2I→I2V mode 用）

| Provider | 4 張候選成本 |
|---|---|
| Seedream 3.0 | ~$0.04 |
| Flux Pro | ~$0.06 |
| ARK Seedream | ~$0.03 |

**T2I→I2V mode 5s panel 成本：** $0.14（I2V）+ $0.04（T2I 4 候選）= **$0.18**

### 1.3 TTS（配音）

| Provider | 1 句（~3s）成本 |
|---|---|
| Tencent CustomVoice | ~$0.002 |
| 火山 ARK TTS | ~$0.0015 |
| AtlasCloud TTS | ~$0.003 |

**1 集 5 句對白 ≈ $0.01**（可忽略相對於視訊成本）

### 1.4 LLM（劇本拆鏡 + motion line 生成）

| Provider | 1 集 LLM 成本 |
|---|---|
| OpenRouter（Claude Sonnet 4.6） | ~$0.05 |
| 火山 ARK（Doubao Pro） | ~$0.03 |

### 1.5 BGM 生成（若 Phase 3 開啟）

| Provider | 1 集成本 |
|---|---|
| Hunyuan Foley | ~$0.02 |

### 1.6 影片合成 / 字幕燒錄（自家 FFmpeg）

| 項目 | 成本（compute + storage） |
|---|---|
| FFmpeg 合成（self-hosted） | ~$0.005 |
| R2 storage（每 GB / 月） | $0.015 |

---

## 2. 點數定價反推

### 2.1 基準：1 鏡平均成本

```
1 panel（5s）真實成本：
  視訊 $0.14
+ T2I（25% 鏡頭走 T2I→I2V）$0.045
+ 攤分 LLM $0.005
+ 攤分 TTS $0.001
+ 合成 storage $0.005
─────────
≈ $0.196 ≈ $0.20 / 5s panel
```

### 2.2 1 點目標美元值

**目標毛利** Studio tier 65%（業界 SaaS 常見區間 60-70%）：

```
1 點賣價 = 1 點成本 / (1 - 毛利)
        = 1 點成本 / 0.35
```

**1 點成本：** 約 $0.0006（panel 成本 $0.20 ÷ 我們想說「1 鏡 ≈ 120 點」）

**1 點賣價：** $0.0006 / 0.35 ≈ $0.0017

**round 到** **$0.0015**（user 看 100 點 = $0.15 比較好記）。

### 2.3 1 鏡點數定價

```
$0.20（1 鏡成本）÷ $0.0015（每點賣價）≈ 133 點/鏡
```

**round 到** 120 點/鏡（含 fail buffer 5%）— 因為要扣失敗免扣的退點數成本。

實際 user 看到的點數 / 鏡會因為 provider / mode / 時長變動：

| 模式 | 5s | 8s | 12s |
|---|---|---|---|
| direct_t2v (ARK) | 80 pt | 130 pt | 200 pt |
| r2v_with_subjects (ARK) | **100 pt** | **160 pt** | 240 pt |
| t2i_then_i2v (4 候選) | 130 pt（含 30 pt T2I） | 190 pt | 270 pt |
| r2v_with_motion_ref | 110 pt | 170 pt | 250 pt |

---

## 3. 4 階梯訂閱反推

### 3.1 預設 user usage（活躍創作者，月度）

| 使用情境 | 量 |
|---|---|
| 每月生成集數 | 5-10 集 |
| 每集 panel | 10-15 個 |
| 平均每點數 | 1,200 pt/集 |
| **月度總用量** | **6,000-18,000 pt** |

### 3.2 階梯設計（年付為基準）

```
Free
  - $0 / 月
  - 100 pt / 天，月上限 600 pt
  - 月成本上限：600 × $0.0006 = $0.36
  - acquisition cost，預期 5-10% 轉付費

Creator
  - 月付 $19 / 年付 $15
  - 1,500 pt / 月
  - 月成本（100% 用滿）：1,500 × $0.0006 = $0.90
  - 月收：$15
  - 毛利：(15 - 0.9 - $1 攤分基礎成本) / 15 ≈ 87%
  - 但實際 user 平均用 70% = 1,050 pt → 毛利 95%
  - 用滿 + 加購預期：$5 額外 / 月

Studio（主力，預期 60% revenue）
  - 月付 $59 / 年付 $47
  - 5,000 pt / 月
  - 月成本（100%）：5,000 × $0.0006 = $3
  - 月收：$47
  - 毛利：(47 - 3 - $3 攤分) / 47 ≈ 87%
  - 實際使用 70% → 毛利 92%

Team
  - 月付 $149 / 年付 $119
  - 15,000 pt / 月 + 3 seats
  - 月成本：15,000 × $0.0006 = $9
  - 月收：$119
  - 毛利：(119 - 9 - $5 攤分) / 119 ≈ 89%
```

### 3.3 對標檢驗

| 平台 | Creator tier | Studio tier | Team tier |
|---|---|---|---|
| KuiperAI（建議） | $19 / $15 | $59 / $47 | $149 / $119 |
| **Krea** | $9 | $35 | $200（Business） |
| **Higgsfield** | $15 (Plus 49 / Ultra 129) | — | $89 (Business) |
| **Pika** | $10 (Standard) | $35 (Pro) | $95 (Plus) |
| **Runway** | $15 | $35 | $99 |

**結論：** 我們 Creator/Studio tier 跟 Krea + Higgsfield 同區間，**價格定位 OK**。Team tier $119 / $149 比 Krea Business $200 便宜，比 Higgsfield $89 貴 — 因為 Team 含 3 seats，per-seat 約 $40-50 是行情。

### 3.4 失敗免扣會計處理

**假設失敗率：** 7%（mockup 24 顯示 2/12 = 16% 失敗，現實上要降到 7% 以下，否則燒錢）

```
1 集渲染 1,200 pt 名義成本：
  - 退失敗點數：1,200 × 7% = 84 pt（user 帳上回來，但成本已燒）
  - 實際成本：1,200 × 1.07 ÷ 0.0006 = $1.30（per 集）
```

**所以毛利率上面算的要打 7% 折扣：**
- Studio tier 真實毛利 92% × (1 - 0.07) ≈ **85%**（仍健康）

### 3.5 超量加購

```
1 包 1,000 pt 加購：$1.5
  - 成本：1,000 × $0.0006 = $0.6
  - 毛利：($1.5 - $0.6) / $1.5 = 60%

1 包 5,000 pt 加購：$6.5（折扣）
  - 成本：5,000 × $0.0006 = $3
  - 毛利：($6.5 - $3) / $6.5 = 54%
```

**為什麼超量加購毛利較低：** 為了讓重度用戶不流失。Krea / Runway 也是這策略。

---

## 4. Free tier 風險控管

### 4.1 防止濫用

| 風險 | 控管 |
|---|---|
| 不停註冊新帳號刷 100 pt/天 | Email + IP + Device fingerprint 多重 dedupe |
| 用 disposable email | 拒收 known disposable domain（用 abstract email validation API） |
| 機器人腳本生成 | 加 CAPTCHA + 第一週 quota 卡更死（30 pt/day） |
| 跨 VPN 換 IP | 累計裝置指紋限制 |

### 4.2 Free → Paid 轉換 levers

| Trigger | 設計 |
|---|---|
| 用滿日 quota | 提示「升級拿 5,000 pt/月，立刻繼續」 |
| 想下載無水印 | 浮水印只有 Free 才有 |
| 想用全部 5 provider | 顯示「升級解鎖另外 4 個 provider」 |
| 想 Public share / clone | 開放（吸引社群成長，後續 nudge 升級） |

預期轉換率：5-10%（業界 freemium 標準）

---

## 5. 月度成本估算（10,000 用戶）

| 階梯 | 用戶數 | per-user 月成本 | 月總成本 |
|---|---|---|---|
| Free | 8,500（85%） | $0.30（平均用 50%） | $2,550 |
| Creator | 800（8%） | $0.90 | $720 |
| Studio | 600（6%） | $3 | $1,800 |
| Team | 100（1%） | $9 | $900 |
| **總** | 10,000 | — | **~$6,000/月** |

| 階梯 | 用戶數 | per-user 月收 | 月總收 |
|---|---|---|---|
| Free | 8,500 | $0 | $0 |
| Creator | 800 | $15 | $12,000 |
| Studio | 600 | $47 | $28,200 |
| Team | 100 | $119 | $11,900 |
| **總** | 10,000 | — | **$52,100/月** |

**毛利：** $52,100 - $6,000 - $5,000（infra/team/legal 攤分）= **~$41,000/月 (78%)**

---

## 6. Stripe 設定

### 6.1 Stripe Products

```
- Free（內部追蹤用，不在 Stripe 建）
- Creator
  - Monthly: $19
  - Annual: $180（= $15/月 × 12）
- Studio
  - Monthly: $59
  - Annual: $564（= $47/月 × 12）
- Team
  - Monthly: $149
  - Annual: $1,428（= $119/月 × 12）
```

### 6.2 加購包 Top-up

```
- 1,000 pt top-up: $1.5
- 5,000 pt top-up: $6.5
- 20,000 pt top-up: $24（per pt 折扣最多）
```

### 6.3 Webhook 事件

| Stripe 事件 | KuiperAI 動作 |
|---|---|
| `customer.subscription.created` | 升級 workspace.plan |
| `customer.subscription.updated` | 改 monthlyCredits |
| `customer.subscription.deleted` | 降回 Free（保留現有 credits 直到月底）|
| `invoice.payment_failed` | 鎖 generation + 通知 |
| `invoice.paid` | 重置 monthlyCredits |

---

## 7. 上線 checklist

- [ ] Stripe Products 建好 + price ID 進 .env
- [ ] Webhook endpoint 上線 + 簽名驗證
- [ ] 加 `usedCredits` reset cron（每月 1 號跑）
- [ ] 加 `failedCreditsRefunded` 寫入路徑（render handler）
- [ ] Free tier 防濫用：CAPTCHA + dedupe + 30 pt/day 第一週
- [ ] Stripe Tax 開（自動算 VAT/GST）
- [ ] 雙語訂閱頁（mockup 05 已有，補英文價格 $19 vs $15）
- [ ] Quota guard middleware 在所有 `project.run.create` endpoint 前
- [ ] Cost monitoring：每天 cron 算當天成本，超過 alert
- [ ] Refund 規則：付費後 7 天可全額退（未用滿 50%）

---

## 8. 開放問題（2026-05-29 拍板）

| 問題 | 決定 |
|---|---|
| Free tier 月上限 | ✅ **100/天 + 月上限 600 pt** |
| Annual 折扣 | ✅ **20%**（Studio: $59 → $47，年付 $564 vs 月付 12 期 $708） |
| Team 第 4+ seat 加價 | ✅ **$25/seat/月** |
| 加購包過期 | ✅ **不過期 roll over**（跟 Krea 一致） |
| Enterprise tier | ✅ **暫不加**（待需求出現再訂面，5 階梯先保持 4 個） |

### 8.1 落地清單

- [ ] Stripe Products 建好（4 階梯 monthly + annual + 3 個 top-up）
- [ ] Workspace.monthlyResetDay 預設 1（schema A 已涵蓋）
- [ ] Free tier 月上限 600 pt 寫進 Quota guard middleware
- [ ] Team seat 加價邏輯：billable seats = max(3, actual member count)
- [ ] 加購包 schema：CreditTopUp 表（new — 列在 schema A 補丁）

---

## 9. Schema 補丁（後續加進 A 文件）

D 拍板後新增的 schema：

```prisma
model CreditTopUp {
  id              String   @id @default(cuid())
  workspaceId     String
  workspace       Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  stripePaymentId String   @unique
  amount          Int                  // 點數量（1000/5000/20000）
  pricePaid       Int                  // 美元 cents（避免浮點）
  usedAmount      Int      @default(0) // 已用
  expiresAt       DateTime?            // null = 永不過期（D 拍板）
  createdAt       DateTime @default(now())

  @@index([workspaceId, usedAmount])  // 找未用完的 top-ups
}
```

**Usage 順序：** 月度 credits 先扣 → top-up 後扣（讓月度 reset 不浪費 top-up）。

---

**4 份規劃文件 + D 拍板完成。** 接下來進真實 React 實作時，這 4 份是 single source of truth。
