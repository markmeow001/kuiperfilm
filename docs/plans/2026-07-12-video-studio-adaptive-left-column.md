# Video Studio 左欄模組化重構 — 按模型自適應 + @ 選單綁定

> 2026-07-12 · user 批准（對標 Higgsfield 式 per-model UI，截圖 3 張）· branch feat/kling-o3-playground

## 問題

左欄「參考圖片 / 參考影片 / 參考文字 / 主體綁定」四區恆顯示、全模型同一套 → 冗長、跟所選模型無關的區塊造成困惑（user:「一直覺得這邊很麻煩」）。

## 設計

### 按模型分三個家族（`videoModelFamily(modelKey)`）

| 家族 | 判定 | 左欄模組 |
|---|---|---|
| `kling-o3` | `::kling-o3-` | Prompt 卡（@選單+高亮）→ `[@ Elements (N/6)]` 彈窗按鈕 → 參考影片槽 → chips |
| `seedance` | atlascloud seedance/wan、fal bytedance/seedance | Prompt 卡 → 統一「上傳媒體」卡（圖+影片同格）＋命名＋首幀/風格切換 → chips |
| `frames` | 其他（fal kling i2v、tencent、minimax、vidu…） | Prompt 卡 → 首幀＋尾幀兩槽（lastFrameUrl 管線既有）→ chips |

- 參考文字：全家族收成 prompt 卡下方「＋參考文字」摺疊列。
- chips 列：時長 / 比例 / 解析度（有選項才顯示）/ 🔊 音效開關，緊湊單行。
- Kling 的鬆散（未命名）參考圖 UI 移除 —— 綁定一律走 Elements（可 1-4 圖/主體）；後端能力保留。
- 保留琥珀-stone 配色與現有中央 stage/歷史/右欄。

### @ 選單

- prompt 內打 `@` → textarea 下方浮出候選列（點選插入）：kling=主體名；seedance=命名圖名＋@imageN/@video1。
- Esc / 點外面關閉。v1 錨定在 textarea 下緣（不做 caret 座標鏡射）。

### Elements 彈窗

- `[@ Elements (N/6)]` 按鈕開 modal，內容即現有 ElementBindingsPanel（名字+1-4 圖+色點）。

### 🔊 音效開關（新管線）

- controller `soundOn`（預設開）→ submission `generateAudio` → route（boolean 驗證）→ payload → worker → generator（kling `!==false`；seedance `generate_audio`）。

### 尾幀（frames 家族）

- controller `endFrame` 狀態 + 上傳 → submission `lastFrameUrl`（route/worker 既有管線，UI 補上）。

## 不做

- model 卡片/整頁佈局照抄、caret 定位 @ 選單、multi-shot toggle（Kling multi_prompt 未接）、圖片 studio。
