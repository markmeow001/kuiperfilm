# Tencent VOD AIGC 整合 — 交接文件

> 這份是 2026-04-28 session 結束時的 handover，給接續開發的 Claude session 或人類工程師閱讀。

## 一句話摘要

KuiperAI 已接入騰訊雲 VOD AIGC（Kling、Vidu、Nano Banana 等 10+ 模型），程式碼 + UI 都完成，**等使用者拿到 SubAppId / AIGC 白名單後直接在介面填憑證即可使用**。剩 Task 23（capabilities/pricing catalog）沒做。

## 當前 git 狀態

```
e623a13 fix(tencent-vod): 把 tencent-vod 加進 UI provider 白名單
3e4c947 feat(tencent-vod): UI 多欄位憑證輸入
045a90b feat(tencent-vod): 接入騰訊雲 VOD AIGC（Kling/Vidu/Nano Banana 等）
38da730 refactor(brand): 完成 B+C 區徹底去 waoowaoo 化（DB/secrets/encryption）
aa53aa5 refactor(brand): 完成 A 區去 waoowaoo 化（程式碼/字串/文件/腳本）
dd7c6f8 WIP: snapshot before KuiperAI rename
```

工作區未追蹤的 `CLAUDE.md`、`AUTONOMY_PROTOCOL.md`、`.mcp.json` 是團隊既有規範檔，不是這次工作。

## Tencent VOD 整合 — 已做的

### 後端

| 檔案 | 內容 |
|---|---|
| `src/lib/generators/video/tencent-vod.ts` | TencentVODVideoGenerator（Kling/Vidu/Hailuo/PixVerse/GV/OS/Jimeng/Hunyuan） |
| `src/lib/generators/image/tencent-vod.ts` | TencentVODImageGenerator（GEM/OG/Qwen/SI/Kling-image/Vidu-image/Jimeng/Hunyuan） |
| `src/lib/generators/factory.ts` | 加 `case 'tencent-vod'` 路由 |
| `src/lib/generators/{image,video}/index.ts` | export 新 generator |
| `src/lib/async-poll.ts` | 加 `TENCENTVOD:VIDEO|IMAGE:taskId` 解析 + `pollTencentVODTask`（DescribeTaskDetail） |
| `package.json` | 加依賴 `tencentcloud-sdk-nodejs-vod ^4.1.224` |

### 前端

| 檔案 | 內容 |
|---|---|
| `src/app/[locale]/profile/components/api-config/types.ts` | 加 tencent-vod 進 `PRESET_PROVIDERS` + zh locale 名 |
| `src/app/[locale]/profile/components/api-config/provider-card/ProviderTencentVODFields.tsx` | 4 欄位專用 UI（SecretId/SecretKey/SubAppId/Region 下拉） |
| `src/app/[locale]/profile/components/api-config/provider-card/ProviderBaseFields.tsx` | 偵測 providerKey 切換到專用 UI |
| `src/app/[locale]/profile/components/api-config/ProviderCard.tsx` | 把 onUpdateApiKey 傳給 BaseFields |
| `src/app/[locale]/profile/components/api-config-tab/hooks/useApiConfigFilters.ts` | 加 tencent-vod 進 `MODEL_PROVIDER_KEYS` 白名單（不加會被濾掉看不到） |

## 關鍵設計決策

1. **Provider key**: `tencent-vod`（kebab-case，跟 `kieai-kling`、`gemini-compatible` 一致）
2. **憑證儲存**: apiKey 欄位存加密 JSON：
   ```json
   {"secretId":"AKID...","secretKey":"...","subAppId":1500044236,"region":"ap-guangzhou"}
   ```
   後端 `getProviderConfig` 解密 → JSON.parse 取 4 個欄位
3. **模型命名**: `ModelName-ModelVersion`（split on first `-`）
   - 例：`Kling-3.0`、`Kling-3.0-Omni`、`Vidu-q3-mix`、`GEM-3.1`
4. **externalId 格式**: `TENCENTVOD:VIDEO:taskId` / `TENCENTVOD:IMAGE:taskId`

## 還沒做

### Task 23: capabilities/pricing catalog

`standards/capabilities/image-video.catalog.json` 跟 `standards/pricing/image-video.pricing.json` 還沒加 Tencent VOD 模型條目。**不做也能用**，只是模型選擇器的解析度/時長/長寬比下拉會缺正確選項，會 fallback 到泛用值。

要做的話需要每個 Tencent 模型一筆 entry，包含：
- modelType（image / video）
- provider: `tencent-vod`
- modelId（如 `Kling-3.0`）
- capabilities.{image,video}.{resolutionOptions, durationOptions, aspectRatioOptions, ...}
- pricing 對應金額（見騰訊雲 AIGC 價格指南）

### End-to-end 實測

等使用者拿到 SubAppId 等資訊後做。

## 使用者還沒拿到的東西（4 件）

| 項目 | 沒這個會發生什麼 |
|---|---|
| **SubAppId**（11 位數字） | API 必填欄位，少了直接 400 |
| **中國站 vs 國際站** | 國際站要切換 SDK：`tencentcloud-sdk-nodejs-intl-en`，endpoint 改 `vod.intl.tencentcloudapi.com` |
| **AIGC 白名單** | 沒開白 → API 回 `FailedOperation` 拒絕 |
| **CAM 權限** | 子帳號要授權 `vod:CreateAigcImageTask` / `vod:CreateAigcVideoTask` / `vod:DescribeTaskDetail` |

使用者已說明憑證是內部人員給的，要他向那位內部人員問齊上述 4 件。

## 跑專案

```bash
cd ~/KuiperAI
docker compose up -d --build  # 完整 build 大約 5-10 分鐘
# 訪問 http://localhost:13000/zh
```

### 測試帳號（dev）

| 欄位 | 值 |
|---|---|
| 用戶名 | `josh` |
| 密碼 | `kuiper123` |
| Role | admin（DB 直接改的，看 API 配置區需要 admin role） |

### 環境變數位置

`.env`（已在 .gitignore，本機才有）含 4 個全新隨機 secrets：
- NEXTAUTH_SECRET
- API_ENCRYPTION_KEY
- CRON_SECRET
- INTERNAL_TASK_TOKEN

`docker-compose.yml` 內 mysql password = `kuiper123`，DB name = `kuiper`。

### Docker container 對應

| Container | Port | 內部用 |
|---|---|---|
| `kuiper-app` | 13000 → 3000 / 13010 → 3010 | Next.js + Workers + Bull Board |
| `kuiper-mysql` | 13306 → 3306 | MySQL 8.0 |
| `kuiper-redis` | 16379 → 6379 | Redis 7 |

### Volume

- `kuiperai_mysql_data`（新，乾淨）
- `kuiperai_redis_data`（新）
- `waoowaoo_mysql_data` 跟 `waoowaoo_redis_data` 是舊的孤立 volume，可以 `docker volume rm` 清掉

## 使用者使用流程（拿到憑證後）

1. 登入 → 進 Profile → 點側邊「API 配置」
2. 找 **「騰訊雲 VOD AIGC ⭐」** provider 卡片
3. 填 4 欄位：SecretId、SecretKey、SubAppId、Region 下拉
4. 加自訂模型（如 `Kling-3.0` type=video，或 `GEM-3.1` type=image）
5. 工作區選用該模型 → 觸發生成 → factory → TencentVOD generator → SDK CreateAigcVideoTask → 回 TENCENTVOD:VIDEO:taskId → worker 用 pollTencentVODTask 輪詢 → DescribeTaskDetail → 寫結果

## 之前做錯的地方（避免重蹈覆轍）

1. ❌ 一開始 AI 把 Tencent VOD 接到 `~/Documents/huobao-drama/`（Go+Vue 老版專案，已停用，docker 沒在跑）
   - 用戶以為 `huobao-drama` 是當前專案，AI 沒先驗證跑哪個 container 就動工
   - **教訓**：先 `docker ps` 確認哪個 container 在跑，再決定碰哪個 codebase
   - 那 3 個錯的 commit 已 tag 為 `archive/tencent-vod-go-poc` 在 `~/Documents/huobao-drama/`，master 已 reset 回原點

2. ❌ 第一次只加 PRESET_PROVIDERS，UI 沒顯示
   - 原因：`useApiConfigFilters.ts` 有獨立的 `MODEL_PROVIDER_KEYS` 白名單
   - **教訓**：加新 provider 要同時更新 PRESET_PROVIDERS + MODEL_PROVIDER_KEYS

## 已知技術 debt（不急）

- Tencent client 沒做 retry/timeout 自定義（用 SDK 預設值）
- 沒有 server-side 的 task 進度 stream（用既有 async-poll worker 輪詢，已能用）
- `/api/user/api-config` GET 端點回 plaintext apiKey（**安全洞**，整個 KuiperAI 都有，不只 Tencent，已在 ProviderTencentVODFields 做 SecretId mask 顯示）
- Capabilities/pricing catalog 缺 Tencent 模型條目（Task 23）

## 給下個 AI session 的速啟提示

```
我們在 KuiperAI 專案做 Tencent VOD 接入。
看 git log 最近 6 個 commit，主要工作都在那。
讀 HANDOVER_TENCENT_VOD.md 了解全貌。
還有 task 23 (catalog/pricing) 沒做，等 SubAppId 拿到才能 e2e 測試。
測試帳號：josh / kuiper123 (admin)
專案啟動：docker compose up -d --build (port 13000)
```
