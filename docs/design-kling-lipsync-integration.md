# Design Doc — Kling 對口型（lip_sync）整合

> **Status:** Draft / Awaiting decision
> **Author:** AI session (Anthropic CLI)
> **Date:** 2026-05-01
> **Discovered during:** E2E test on art.kuiperfilmailab.com (project `57f45350-44c0-46b1-aab4-acf69e08dbf8`)

## TL;DR

Kling 3.0/3.0-Omni 的 `AudioGeneration: Enabled` 會生**模型自決定的環境/敘事音**，**不保證 word-perfect 講出 prompt 裡的對白**。要讓角色精準唸出劇本對白（例如「妳要的證據，我找到了。」），騰訊 VOD 提供的解法是 `SceneType: lip_sync` — 屬於 Kling 的內建後處理，不是 fal 開源那個 lipsync。

本 doc 提案在 panel video 後加一個 `PANEL_LIP_SYNC` stage，**有對白 panel** 自動跑 TTS + Kling lip_sync，產出有正確對白的 `panel.lipSyncVideoUrl`，stitch 時優先採用。

**P0 決策卡點：** TTS（音色合成）的 provider 還沒選（騰訊 TTS / Vidu voice / Fal IndexTTS 三選一）。Design doc 寫完，下一步就是**等 user 決定 TTS provider** 才能動工。

---

## 1. 背景與問題

### 1.1 觀察到的現象

E2E 測試（2026-05-01）跑短劇本 → 17 個 panel → 每個 panel 用 `tencent-vod::Kling-3.0-Omni` 生視頻：

- panel #12 prompt：`young man leaning forward... speaking with subtle gestures`
- panel #12 srtSegment（從劇本切出）：`「妳要的證據，我找到了。」`
- panel #12 視頻有 AAC stereo 音軌（Kling 生的）
- **但 prompt 裡沒帶實際對白文字** — Kling 只看到「young man speaking」，內容由模型自由發揮

### 1.2 docx 規格證實

`【通用】VOD_AIGC服务接入指南.docx` 3.9.1 能力表：

| 能力 | Kling 3.0 / 3.0-Omni |
|---|---|
| 文/圖生視頻 | ✅ |
| 多鏡頭 | ✅ |
| 主體控制 | ✅ |
| **聲音控制（指定音色）** | **❌** |

→ Kling 3.0/Omni 主流程**無法指定**對白與音色。

### 1.3 docx 給的方案 — 3.6 對口型 (lip_sync)

```
SceneType: "lip_sync"
ExtInfo: {
  AdditionalParameters: {
    face_choose: [{
      face_id: 0,
      sound_file: "https://.../tts.mp3",  ← 自己 TTS 的對白音檔
      sound_start_time: 0,
      sound_end_time: 5000,
      sound_insert_time: 0,
      sound_volume: 2,
      original_audio_volume: 0
    }]
  }
}
```

→ 把對白 TTS 後當輸入，Kling 把嘴型對到指定臉上，輸出新視頻。

### 1.4 跟 fal `kling-video/lipsync` 的差別

| 項目 | 騰訊雲 Kling lip_sync | Fal kling-video lipsync |
|---|---|---|
| 走 KuiperAI 哪個 provider | `tencent-vod` | `fal` |
| API call | VOD `CreateAigcVideoTask` SceneType=lip_sync | fal-ai/kling-video/lipsync |
| 帳號計費 | 騰訊雲（同主帳號） | fal（獨立信用卡） |
| 在 KuiperAI 角色 | **本 doc 提議啟用** | 預留給未來「全開源版」分支 |
| 用戶當前設定 | 未啟用 | `lipSyncModel: fal::fal-ai/kling-video/lipsync/audio-to-video` |

⚠️ **不要把兩者搞混**。本 doc 提案啟用第一條，第二條留著不動。

---

## 2. 設計目標

### Goals
1. ✅ 有對白的 panel 視頻講出 word-perfect 對白（角色聲音、嘴型同步）
2. ✅ 沒對白的 panel 維持目前 Kling Omni 的環境/敘事音（不退化）
3. ✅ 失敗安全：lip_sync 出錯 → fallback 用原 Omni 視頻，pipeline 不中斷
4. ✅ 成本可控：只對有對白的 panel 跑（一段短劇 17 panel 通常 2-5 段對白）
5. ✅ 角色聲音一致：同角色跨 panel/集數音色穩定

### Non-Goals
- ❌ 不替換 Kling Omni 主流程（後處理而非取代）
- ❌ 不動到 fal lipsync 那條保留路徑
- ❌ 不在這個 phase 處理多人同框 panel（face_id 0 一律取首臉，多人對話初版略過）
- ❌ 不做即時 stream，全程仍是非同步任務

---

## 3. 架構

### 3.1 Pipeline 位置

```
[1] Novel text  ──→  analyze-novel (LLM)
                          ↓ characters, locations
[2] Episode    ──→   clips-build (LLM)
                          ↓ clips
[3] Clips      ──→   script-to-storyboard (LLM)
                          ↓ panels (含 dialogueText 欄位 ← 新)
[4] Panels     ──→   panel image gen (Tencent VOD GEM-3.1)
                          ↓ panel.imageUrl
[5] Panels     ──→   panel video gen (Tencent VOD Kling-Omni)
                          ↓ panel.videoUrl
[6 NEW] dialogue panels ──→ TTS → Kling lip_sync
                          ↓ panel.lipSyncVideoUrl
[7] Episode    ──→   FFmpeg stitch
                     優先用 lipSyncVideoUrl，沒有則用 videoUrl
                          ↓ episode.stitchedVideoUrl
```

**[6 NEW]** = 本 doc 主要新增。其他都已存在。

### 3.2 為什麼是後處理而非取代

選項比較：

| 方案 | 描述 | 優劣 |
|---|---|---|
| A. 取代 | 對白 panel 直接走 lip_sync 不跑 Omni | ❌ lip_sync 需要 base video，沒有先跑 Omni 就沒有底 |
| **B. 後處理（採用）** | Omni 跑完後，對白 panel 再跑一次 lip_sync | ✅ 兩段視頻都留，可 toggle 對比 |
| C. 平行跑 | Omni + lip_sync 同時送 | ❌ lip_sync API 需要 video URL 當輸入 |

→ B 是 docx 的設計意圖（schema 已預留 `lipSyncVideoUrl`）。

### 3.3 Worker 與 task 結構

```
新增 task type:  TASK_TYPE.PANEL_LIP_SYNC
新增 worker:     src/lib/workers/handlers/panel-lipsync.ts
新增 generator:  TencentVODVideoGenerator.generateLipSync(...)
新增 cascade:    panel video done → 自動 submit panel-lipsync task（若有 dialogueText）
```

Cascade 點：在 `video-panel.ts` worker 完成 callback 加：
```ts
if (panel.dialogueText && panel.dialogueText.trim()) {
  await submitTask({ type: TASK_TYPE.PANEL_LIP_SYNC, targetId: panel.id, ... })
}
```

### 3.4 panel-lipsync worker 流程

```
1. 讀 panel:
   - panel.videoUrl (原 Omni 視頻)
   - panel.dialogueText
   - panel.characterId  → 找 character.voiceId

2. 生 TTS 音檔:
   - input: dialogueText + character.voiceId
   - output: audio_url (上傳到 R2)
   - 算 audio duration

3. 構造 Kling lip_sync 請求:
   {
     SubAppId, ModelName: "Kling", ModelVersion: "3.0",
     Prompt: "对口型",
     SceneType: "lip_sync",
     FileInfos: [{Type:"Url", Category:"Video", Url: panel.videoUrl, ReferenceType:"base"}],
     ExtInfo: JSON.stringify({
       AdditionalParameters: JSON.stringify({
         face_choose: [{
           face_id: 0,
           sound_file: audio_url,
           sound_start_time: 0,
           sound_end_time: audio_duration_ms,
           sound_insert_time: 0,
           sound_volume: 2,
           original_audio_volume: 0
         }]
       })
     })
   }

4. 提交 → externalId: TENCENTVOD:VIDEO:taskId

5. async-poll → DescribeTaskDetail → 拿到 lipSyncVideoUrl

6. 寫回:
   panel.lipSyncVideoUrl = result.videoUrl
   panel.lipSyncVideoMediaId = mediaId
   panel.lipSyncTaskId = taskId
```

### 3.5 Stitch 修改

`stitch-mp4` worker 收集 panel videoUrl 時改為：
```ts
const url = panel.lipSyncVideoUrl || panel.videoUrl
```

優先 lipSync，沒有則用原 Omni。

---

## 4. Schema 改動

### 4.1 新增欄位（最小改動）

`prisma/schema.prisma`:

```diff
model NovelPromotionPanel {
  ...
+ dialogueText  String? @db.Text  // 由 LLM 在 storyboard 時填，觸發 lip_sync 用
+ // 新欄位 — 補在現有 lipSync* 三欄旁邊
  lipSyncTaskId      String?
  lipSyncVideoUrl    String?
  lipSyncVideoMediaId String?
+ lipSyncFailed      Boolean @default(false) // fallback 標記
+ lipSyncFailReason  String? @db.Text
}
```

`dialogueText` 是觸發訊號；`lipSyncFailed` 用來避免無限 retry。

### 4.2 已存在的欄位（重用）

- `NovelPromotionCharacter.voiceId` — 已存在，TTS 用
- `NovelPromotionCharacter.customVoiceUrl` — 已存在（自定義音色）
- `NovelPromotionPanel.lipSyncVideoUrl` — 已存在
- `NovelPromotionPanel.lipSyncVideoMediaId` — 已存在
- `NovelPromotionPanel.lipSyncTaskId` — 已存在

### 4.3 Migration

```bash
npx prisma migrate dev --name add_panel_dialogue_text_for_lipsync
```

向後相容：既有 panel 的 `dialogueText` 為 null → 不觸發 lip_sync。

---

## 5. 對白偵測（最重要的設計決策）

### 5.1 三個方案

| 方案 | 描述 | 準確度 | 工程量 |
|---|---|---|---|
| **A. LLM script-to-storyboard 時直接輸出（採用）** | prompt 加要求：每個 panel 含 `dialogueText` 欄位（無對白為空） | 高 | 改 prompt + schema |
| B. 後端 regex 解析 srtSegment | 看「」的內容 | 中 — 旁白 vs 對白分不出 | 小 |
| C. UI 手動標 | 用戶逐 panel 設 | 高 | 大（UX） |

### 5.2 採用 A 的理由

LLM 在切鏡頭時已經知道每個 panel 對應原文哪段、誰在說、誰在做，**順便輸出 dialogueText 是 prompt-level 改動，不是新邏輯**。

### 5.3 Prompt 改動範圍

`lib/prompts/novel-promotion/script-to-storyboard.zh.txt` + `.en.txt` 加：

```
每個 panel 物件除了現有欄位外，加：
- "dialogueText": String — 該 panel 中角色說出的對白原文（要 word-for-word 跟劇本一致）。
  如果該 panel 是旁白/動作描述/反應鏡頭（角色沒有開口講話），dialogueText 為空字串 ""。
  不要把 srtSegment 的內容當對白 — srtSegment 是字幕，dialogueText 是 character 真的開口講的話。
```

範例（panel #12, 17）：
```
✅ panel #12: dialogueText = "妳要的證據，我找到了。"  // 陳子睿真的講出來
✅ panel #13: dialogueText = ""                       // 林婉如反應鏡頭，沒講話
✅ panel #0:  dialogueText = ""                       // 全景開場，旁白引述場景
```

### 5.4 Guard

`scripts/guards/prompt-i18n-guard.mjs` 會擋雙語不同步，記得 zh + en 一起改。

---

## 6. TTS（音色合成）— P0 卡點

### 6.1 為什麼這是卡點

Kling lip_sync **只負責對嘴**，不生 voice。對白文字 → 音檔的步驟必須由其他服務做。**TTS provider 還沒選定。**

### 6.2 三個候選

| Provider | 優 | 劣 |
|---|---|---|
| **A. 騰訊雲 TTS** （`tts.tencentcloudapi.com`） | 同帳號計費；中文音色多；內網低延遲 | 要查 quota / 跟 VOD AIGC quota 是否共享；docx 沒詳細列在 AIGC 文件 |
| B. Vidu voice library | 已有 voice ID 系統（`character.voiceId` 欄位本來給 Vidu 用）；Kling 主體那邊 voiceId 也有引用 | Vidu API 跟 Kling lip_sync 是兩個系統，要橋接；中文音色不確定夠多 |
| C. Fal IndexTTS-2 | 已配在用戶 default audio model；獨立服務，不撞騰訊 quota | 額外 fal 帳號計費；中文質量待驗 |

### 6.3 推薦 A（騰訊雲 TTS）

理由：
1. 跟 VOD AIGC 同主帳號 → secrets/SubAppId 可重用
2. 可用 SSML 控制語速、停頓
3. 騰訊有「精品音色」（自然度高）
4. lip_sync 的 audio file URL 走騰訊 R2 內網（更快）

風險：要先確認跟 VOD AIGC 共用什麼 quota。

### 6.4 Voice ID mapping

```
character.voiceId  String?
  - 預設 null → fallback 系統推薦（騰訊「101001」標準女聲 / 「101002」標準男聲）
  - 用戶可在角色卡 UI 選音色
  - 推薦預設：根據 character.profileData.gender 自動派
```

### 6.5 P0 決策：等 user 拍板 TTS provider 才能動工

---

## 7. Face detection（多人 panel 的後續課題）

### 7.1 問題

Kling lip_sync 的 `face_id` 是 Kling 自己偵測的順序。多人同框時要選對。

### 7.2 初版策略：只支援單人對白 panel

對「panel 裡只有一個角色講話」的 panel 做 lip_sync。多人對話 panel：
- 標 `lipSyncFailed = true, lipSyncFailReason = "MULTI_SPEAKER_NOT_SUPPORTED"`
- stitch fallback 用原 Omni 視頻

判定：`panel.characters.length === 1 && panel.dialogueText`

### 7.3 後續迭代（不在本 phase）

接 Kling **人脸识别 API**（docx 提到「Kling 人脸识别」能力，需單獨開白）→ 拿臉位置→ 多人按角色配對 face_id。

---

## 8. UI 改動（最小集）

### 8.1 必做

- 角色卡新增「音色」下拉（從 voice catalog 選）
- panel 卡顯示三狀態：`lip_sync_pending` / `lip_sync_done` / `lip_sync_failed`
- panel 詳情頁加「對比 Omni 原版 / lip_sync 版」toggle

### 8.2 後做

- 用戶手動 override dialogueText（LLM 抽錯時可改）
- 整集 lip_sync 開關（dev 階段可關 lip_sync 省成本）

---

## 9. 失敗模式 + Fallback

| 失敗 | 處理 |
|---|---|
| TTS 失敗 | panel.lipSyncFailed = true，stitch 用原 Omni |
| Kling lip_sync 失敗（rate limit / 模型錯） | 同上 |
| 對白內容違規（騰訊 ContentReview 擋） | 標 reason，user 看到後可改 dialogueText |
| 多人 panel | 跳過 lip_sync（標 reason） |
| 對白超長（音檔 > panel video 時長） | TTS 加速 OR 截斷對白前 N 字 OR 標 reason |
| TTS audio 跟 video 時長不匹配 | docx 的 sound_insert_time 控位移；超過則 fallback |

**核心原則：lip_sync 是 enhancement，失敗絕不阻塞主流程**。

---

## 10. 成本估算

每個對白 panel 的成本：
- TTS（騰訊）: ~$0.001 / 短句
- Kling lip_sync 視頻: ~$0.21（1080P 5s 等同 Kling Omni 普通視頻定價）
- → **約 $0.21 per dialogue panel**

短劇 1 集 17 panel，假設 3-5 個對白 panel：
- 額外成本 $0.6 ~ $1.0 / 集
- 對比整集生成總成本（17 image $0.7 + 17 video $3.6）= $5+，多 15-20%

可接受。

---

## 11. 實作分解 / 工作量

### Phase 1 — Schema + LLM（半天）
- [ ] migration: `dialogueText` + `lipSyncFailed` + `lipSyncFailReason`
- [ ] script-to-storyboard prompt 加 dialogueText 規格（zh + en 同步）
- [ ] 測試：跑一個 episode 看 LLM 有沒有正確抽 dialogueText

### Phase 2 — Backend lip_sync stage（一天）
- [ ] `TencentVODVideoGenerator.generateLipSync()` method
- [ ] `TASK_TYPE.PANEL_LIP_SYNC` 註冊
- [ ] `panel-lipsync.ts` worker handler
- [ ] cascade trigger（video-panel done → submit lipsync）
- [ ] async-poll 對 TENCENTVOD:VIDEO:* lip_sync task 處理（沿用既有路徑）

### Phase 3 — TTS 接入（半天 ~ 一天）
- ⏸ **Block on user 拍板 TTS provider**
- [ ] 對應 provider client（建議騰訊 TTS）
- [ ] character.voiceId 從用戶 config 讀
- [ ] audio 上傳 R2 拿 URL

### Phase 4 — Stitch 整合（半天）
- [ ] stitch-mp4 worker 改用 `panel.lipSyncVideoUrl || panel.videoUrl`
- [ ] 處理「lip_sync 進行中、video 已 ready」邊界
- [ ] e2e 重跑驗證 panel #12、#13 對白音

### Phase 5 — UI（一天）
- [ ] 角色卡音色選單
- [ ] panel 狀態顯示
- [ ] 對比 toggle

**合計：3-4 個工作天**（卡 P0 TTS 決策）。

---

## 12. 與其他 phase / pipeline 的關係

### 既有 Phase 12.7 FFmpeg stitch
本 doc 不改 FFmpeg 邏輯，只改 source URL 選擇。

### Phase 12.5 SRT / 字幕
SRT 寫的是 srtSegment（字幕），跟 dialogueText 不同概念。字幕仍照 srtSegment 印。

### Stage D（Session A 在做）
Stage D 走 Kling Omni t2v + multi_shot=intelligence。本 doc 不衝突 — Omni 生視頻 → 對白 panel 補 lip_sync 後處理是同樣後置 stage。

### 多造型（Phase 11.4）
角色多 appearance → 每個 appearance 可選不同 voiceId。voiceId 應該存在 character 還是 appearance？**建議 character** — 同角色不應換音。但留個 design hook 供未來改。

### Hunyuan LLM 遷移
不衝突。dialogueText 是 prompt 規格，跟用哪家 LLM 無關。

---

## 13. Open Questions（等 user 回答）

| # | 問題 | 影響 |
|---|---|---|
| Q1 | TTS provider 選哪個？（騰訊 / Vidu / Fal） | 卡 Phase 3 動工 |
| Q2 | character.voiceId 預設策略？（按 gender / 用戶選 / LLM 推薦） | 影響角色卡 UI |
| Q3 | 多人對話 panel 是否在這個 phase 做 face detection？ | 範圍 |
| Q4 | dev 階段是否需要「整集關掉 lip_sync」開關？ | UI 範圍 |
| Q5 | 對白超長/超短時要不要重生 TTS（變速）？還是直接 fallback？ | 失敗模式 |
| Q6 | lipSyncVideoUrl 跟 videoUrl 的存取權是否需要差別？ | 應該不用，但 confirm |

---

## 14. 變更歷史

| 日期 | 內容 | 作者 |
|---|---|---|
| 2026-05-01 | Draft v1 — 觀察 e2e 後初稿 | AI session (Anthropic CLI) |

---

## 15. 結論 + Next Step

**這 doc 已能讓 P1+P2 動工**（schema + backend stage 的 80%），只差 TTS provider 決定。

建議步驟：
1. **User 決定 Q1（TTS provider）** ← 最大 unlocker
2. AI session 寫 Phase 1（schema migration + LLM prompt 更新）
3. AI session 寫 Phase 2（backend lip_sync 後處理）
4. AI session 寫 Phase 3（接 TTS）
5. e2e 重跑同一個 project 57f45350，驗證 panel #12 對白音為精準的「妳要的證據，我找到了。」
6. 接 Phase 4 + 5
