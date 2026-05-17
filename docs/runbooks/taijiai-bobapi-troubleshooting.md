# BobAPI (taijiai.online) 排錯 SOP

**Last updated**: 2026-05-17
**Owner**: 任何接手 BobAPI / Seedance 2.0 整合的 session
**Related memory**: `project_kuiperfilm_taijiai_seedance_blocked`
**Related code**: `src/lib/generators/video/taijiai.ts`, `scripts/taijiai-*.ts`

---

## 用這份 runbook 的時機

當 user 反映「Seedance 2.0 生成失敗 / BobAPI 接不起來 / 供應商說我們沒接好」時,**先跑這份 SOP 再動 code**。

歷史上 BobAPI 相關事故 100% 都是 token / 分組 / 餘額問題,**不是** codebase 問題。本 SOP 的目的是 5 分鐘內收集足夠證據把球丟回供應商,**不要再回頭改 generator / async-poll / test-connection 程式碼**(已 2026-05-16 完整對齊 wiki)。

---

## Quick triage(5 分鐘判斷)

### Step 0:確認 wiring 沒被人動過

```bash
git log --oneline -- src/lib/generators/video/taijiai.ts src/lib/async-poll.ts src/lib/generators/factory.ts | head -10
```

預期最後 4 個 commit 應該還在:`5438bf8`(model id), `87d9680`(⚡), `07edf1a`(smoke), `85d49d5`(主整合)。如果有人疊新 commit,先回頭看那個 commit 有沒有改壞。

### Step 1:跑 forensics 確認 DB 裡的 key 字面正確

```bash
ssh root@137.184.64.179 'docker exec kuiper-app sh -c "cd /app && npx tsx scripts/taijiai-key-forensics.ts"'
```

看 output 末段「SUSPICIOUS CHARS SUMMARY」:

- ✓ 全乾淨 → 跳 Step 2
- ✗ 有可疑字元 → IM 軟體吃字 / 智能引號 / NBSP 等。請 user **重新 `<a>` 全選刪掉 → 手動逐字打 → 存**(不要用貼上)再跑一次

### Step 2:跑 full smoke 確認三步流程

```bash
ssh root@137.184.64.179 'docker exec kuiper-app sh -c "cd /app && npx tsx scripts/taijiai-full-smoke.ts"'
```

三步全綠 → e2e 通了,直接告訴 user 可以下任務
任一步 401「无效的令牌」/「Invalid token」→ 跳 Step 3

### Step 3:用 token fingerprint 判斷 token 註冊狀態

**這是診斷關鍵 trick**(2026-05-17 沉澱):

| 你發送的 | BobAPI 回應 message | 意義 |
|---|---|---|
| **沒帶** `Authorization` header | `"Invalid token"`(英文) | gateway 認為「無 token」 |
| 用 garbage `sk-this-is-fake-...` | `"Invalid token"`(英文) | gateway 認為「token 不存在於後台」 |
| 用真實的 user token | **`"无效的令牌"`(中文)** | **token 在後台有註冊,但被拒收** |

從 droplet 跑:

```bash
KEY="<user 的 51 字元 key>"

# 沒 auth
curl -s -X GET https://www.taijiai.online/v1/models | head -c 200; echo

# garbage
curl -s -H "Authorization: Bearer sk-fake-xxx" https://www.taijiai.online/v1/models | head -c 200; echo

# 真 key
curl -s -H "Authorization: Bearer $KEY" https://www.taijiai.online/v1/models | head -c 200; echo
```

**判讀**:
- 三個都英文 `"Invalid token"` → token 完全沒在 BobAPI 後台註冊 → 請 user 確認 token 是不是貼錯,或供應商是不是給了不存在的 token
- 真 key 拿到**中文「无效的令牌」** → token 在後台**有註冊但被拒收** → 跳 Step 4

### Step 4:跑完整 5-combination matrix 收齊證據

中文「无效的令牌」確認後,跑這個 bash 收齊 5 個 request id 給供應商:

```bash
KEY="<user 的 51 字元 key>"
echo "=== KEY length: ${#KEY} ==="

# 兩個 URL × GET /v1/models
for HOST in www.taijiai.online taijiai.online; do
  echo "GET https://$HOST/v1/models"
  curl -s -o /tmp/r.txt -w "  HTTP %{http_code}\n" -H "Authorization: Bearer $KEY" "https://$HOST/v1/models"
  head -c 200 /tmp/r.txt; echo
done

# POST /v1/videos with 兩個 model id × 兩個 URL
BODY_FAMILY='{"model":"seedance-2.0","duration":4,"ratio":"16:9","generate_audio":false,"prompt":"test","content":[{"type":"text","text":"a coffee cup"},{"type":"image_url","role":"first_frame","subject_type":"generic","image_url":{"url":"https://picsum.photos/seed/x/1280/720"}}]}'
BODY_720='{"model":"seedance-2.0-720p","duration":4,"ratio":"16:9","generate_audio":false,"prompt":"test","content":[{"type":"text","text":"a coffee cup"},{"type":"image_url","role":"first_frame","subject_type":"generic","image_url":{"url":"https://picsum.photos/seed/x/1280/720"}}]}'

for HOST in www.taijiai.online taijiai.online; do
  echo "POST https://$HOST/v1/videos  (model=seedance-2.0)"
  curl -s -o /tmp/r.txt -w "  HTTP %{http_code}\n" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "$BODY_FAMILY" "https://$HOST/v1/videos"
  head -c 200 /tmp/r.txt; echo
done

echo "POST https://www.taijiai.online/v1/videos  (model=seedance-2.0-720p)"
curl -s -o /tmp/r.txt -w "  HTTP %{http_code}\n" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "$BODY_720" https://www.taijiai.online/v1/videos
head -c 200 /tmp/r.txt; echo
```

期待輸出:全 5 個都 401「无效的令牌」+ 5 個不同的 request id。**全部 401 = 供應商側問題 confirmed**。

---

## 給供應商的證據包範本

把上面 5 個 request id 替進去這段、直接貼給供應商。**重點:強迫他用後台截圖回應,不接受口頭「token 有效」**。

```
請貴方協助,我們已用 5 種組合驗證,全部 401「无效的令牌」,
證明問題不在我方接入方式,而在貴方 token / 後台設定:

Token(從你給的字串字字相同,51 字元):
  <USER_KEY>

測試方式:macOS 終端直接 curl,完全沒經過我方任何代碼
我方 IP:137.184.64.179(DigitalOcean NYC1 droplet)

測試矩陣(全 401):
  - A1: GET  https://www.taijiai.online/v1/models   request id <A1>
  - A2: GET  https://taijiai.online/v1/models       request id <A2>
  - B1: POST https://www.taijiai.online/v1/videos
        body.model = "seedance-2.0" (對齊 wiki Section 6 範例)   request id <B1>
  - B2: POST https://taijiai.online/v1/videos
        body.model = "seedance-2.0"                              request id <B2>
  - C1: POST https://www.taijiai.online/v1/videos
        body.model = "seedance-2.0-720p" (對齊 wiki Section 1)  request id <C1>

response body 一律是:
  {"error":{"code":"","message":"无效的令牌","type":"new_api_error"}}

關鍵指紋:
  - 用「不存在」的 token 你們會回 "Invalid token"(英文)
  - 用我這把 token 你們回「无效的令牌」(中文)
  → 證明此 token 在貴方後台有註冊,但被 gateway 拒收

請貴方在後台直接 lookup 上述 token string,並提供截圖:
  1. token 的 status(enabled / disabled / 過期?)
  2. token 所屬分組名稱(請確認確實是「banana Pro 官转」)
  3. 該分組的可用 model 清單(必須含 seedance-2.0-720p)
  4. token 餘額 / quota 狀態
  5. IP 137.184.64.179 是否在任何黑名單

「token 是有效的」這個結論需要伴隨後台截圖,否則我們無法區分:
  (a) 你看的是別把 token
  (b) token 在後台顯示 valid 但 gateway 拒收
  (c) token 沒分到正確分組所以無法調 seedance-2.0-720p
```

---

## 最常見的 5 個 root cause(按機率排序)

1. **token 餘額用完**(最像 — user 自己說「用完用量就會沒用」)
2. **token 沒分配到 `banana Pro 官转` 分組** — wiki Section 1 規定必須在此分組
3. **token 被後台手動 disable**(供應商可能誤操作)
4. **token 過期 / 試用期結束**
5. **IP 風控**(droplet `137.184.64.179` 被列入限流) — 機率最低,但 user IP / VPS IP 變動時可能撞到

---

## 我方 wiring 對照表(2026-05-17 已 100% 對齊 wiki)

| Wiki 規範 | 我方實作 |
|---|---|
| Base URL `https://www.taijiai.online/` | ✓ `TAIJIAI_BASE_URL` in `taijiai.ts` |
| `Authorization: Bearer <key>` | ✓ |
| POST `/v1/videos` | ✓ |
| GET `/v1/videos/{video_id}` | ✓ |
| body.model `seedance-2.0-720p`(Section 1) | ✓ 預設值;可被 `options.modelId` 覆寫 |
| body shape `{model, duration, ratio, generate_audio, prompt, content[]}` | ✓ |
| content[]: text / image_url / video_url / audio_url | ✓ 4 種都接 |
| role: reference_image / first_frame / last_frame | ✓ |
| subject_type: generic / person | ✓ via `isPersonReference` opt-in |
| duration clamp 4-15 | ✓ `clampDuration` helper |
| ratio whitelist | ✓ `normaliseRatio` helper |
| 輪詢 status: queued / processing / completed / failed | ✓ `queryTaijiaiTaskStatus` |
| 輪詢頻率 3-5s | ✓ 沿用 `pollAsyncTask` 排程 |

**不要再去改 taijiai.ts**。撞到 401 一律走本 SOP。

---

## Smoke scripts cheat sheet

| 用途 | 指令 |
|---|---|
| 字元級檢查 DB 裡的 key | `docker exec kuiper-app npx tsx scripts/taijiai-key-forensics.ts` |
| 只跑 GET 探針(快) | `docker exec kuiper-app npx tsx scripts/taijiai-smoke.ts` |
| 三步完整 e2e(GET models / POST video / GET poll) | `docker exec kuiper-app npx tsx scripts/taijiai-full-smoke.ts` |
| 全 5-combination matrix | 見 Step 4 的 bash block |

---

## 不阻擋 user 的話術

當供應商修不動 / 拖延時間,user 可以走 fal 備援:

> BobAPI 那邊還在等供應商查,你可以先用 fal Seedance 跑。
> 1. 去 fal.ai 開帳號拿 key(信用卡綁定即可)
> 2. /profile → API Config → 視頻模型 tab → FAL 卡片 → 貼 key → ⚡ 驗
> 3. 把 project 的 video model 從 `taijiai::seedance-2.0-720p` 換成
>    `fal::bytedance/seedance-2.0/image-to-video`
> 4. 跑一支真實片

fal Seedance code 在 commit `3b737c6`(若未 deploy 則先 `./deploy.sh update`)。

---

## 歷史 timeline

| 日期 | 事件 |
|---|---|
| 2026-05-16 | 完成 BobAPI 整合 ship(`85d49d5` → `5438bf8`,5 個 commit) |
| 2026-05-16 | 第一輪測試:5 種 combo 全 401「无效的令牌」,供應商說 token valid |
| 2026-05-17 | 用 fingerprint trick 證明 token 有註冊但被拒收;**確認 100% 供應商側問題** |
| 2026-05-17 | 完成 fal Seedance 備援 ship(`3b737c6`,7 個單元測試) |
| 待補 | 供應商修 token / re-issue → 跑 full smoke 即驗 |
