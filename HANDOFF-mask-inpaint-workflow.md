# HANDOFF — 遮罩工作流補完（Claude 側，2026-07-17）

## Codex 核驗紀錄（2026-07-17）

- 已核對 Git 歷史：`9bfd586` → `ad3dd6b` → `62a7145` → `0f66126` → `e259341` → `b006973`，六個 commit 皆位於 `9a35a89` 之後；`b006973` 已在遠端基線，用來修正 server 漏驗 mask 節點／邊而導致畫布儲存被拒的問題。
- 已核對檔案邊界：Claude 的遮罩／局部重繪／實拍合成修改，與 Codex 尚未提交的 Voice workspace 檔案沒有重疊。
- Claude 工作流視為「程式已提交並進入遠端基線、尚未完成正式部署條件」；部署前仍需完成本文件第 5 節的 Prisma、模型啟用與 CORS 條件。
- Codex 後續回到 Voice workspace；不改動上述六個 commit 的遮罩實作，除非另有明確需求。
- Voice 目前狀態：真實資料查詢、音色綁定、台詞分析、單句／批次生成、下載、情緒提示與強度儲存均已接線；production build 成功，尚未 commit／push／部署。

> 給 Codex：這份說明 Claude 這輪在 `feat/kling-o3-playground` 上做了什麼、
> 哪些 commit 是 Claude 的、工作樹裡剩下的未提交檔案全部是你（voice workspace）的。
> Claude 的東西**已全部 commit**，沒有動 voice 相關任何檔案。

## 1. Claude 的 6 個 commit（`9a35a89` 之後，均已提交；`b006973` 已在遠端基線）

| SHA | 內容 |
|---|---|
| `9bfd586` | fix(canvas): MaskNode 幾何對齊（畫布面板改用底圖真實長寬比）+ 底圖失效偵測（maskDrawnOnSig）+ 鎖定 gate + pointercancel 修復；新增 `canvas-mask.ts`（栅格化純函式庫）|
| `ad3dd6b` | fix(composite): live-composite 審查掃出的 5 缺陷全修 — CRITICAL：MediaRecorder 建立前取消 → export promise 永不 settle 整頁死鎖；HIGH×2：AI 掃描期間手動編輯被 stale closure 覆蓋、分析 seek 無 timeout；MEDIUM：MediaPipe segmenter 不釋放；LOW：錯誤訊息 |
| `62a7145` | feat(playground): `maskImage` 貫通 spine — 複用 `PLAYGROUND_IMAGE` 無新 task type；AtlasCloud `openai/gpt-image-1/edit`（全家唯一有 `mask_image` 的模型）；route 四重校驗；capability contract/catalog/pricing/PRESET_MODELS/guard 白名單五處登記 |
| `0f66126` | feat(canvas): mask→image 連線（portType `mask-image`）+ MediaNode 局部重繪閉環（前端五道閘 → 栅格化 PNG 上傳 → `{referenceImages:[底圖], maskImage}` 提交）|
| `e259341` | feat(composite): `LiveCompositeProject` 新表 + `/api/live-composite/projects` CRUD + 前端手動儲存/開啟 + 導出物選畫布存入資產庫 |
| `b006973` | fix(canvas): server validation 補上 mask 節點與 `mask-image` 邊，避免含遮罩的畫布儲存整包被拒並靜默遺失 |

## 2. Claude 動過的檔案範圍（全在上面 6 個 commit 裡）

- `src/app/[locale]/canvas/`：`lib/canvas-types.ts`、`lib/canvas-connections.ts`、`lib/canvas-mask.ts`（新）、`nodes/MaskNode.tsx`、`nodes/MediaNode.tsx`
- Canvas 儲存校驗補丁：`src/app/[locale]/canvas/CanvasClient.tsx`、`src/lib/canvas/canvas-validation.ts`、`tests/unit/canvas/canvas-validation.test.ts`
- `src/app/[locale]/live-composite/`：全目錄（含新檔 `ProjectPanel.tsx`、`SaveToLibraryDialog.tsx`、`useLiveCompositeProjects.ts`、`lib/` 下 4 個新檔）
- `src/app/api/playground/run/route.ts`、`src/app/api/live-composite/`（新目錄）
- `src/lib/`：`generator-api.ts`、`model-config-contract.ts`、`generators/image/atlascloud.ts`、`workers/handlers/playground-image.ts`、`query/mutations/playground-mutations.ts`
- `prisma/schema.prisma`（**只在檔尾追加** `LiveCompositeProject` model，沒動既有 model）
- `standards/capabilities/image-video.catalog.json`、`standards/pricing/image-video.pricing.json`（各插入 atlascloud/gpt-image-1 一條）
- `src/app/[locale]/profile/components/api-config/types.ts`（PRESET_MODELS 加 gpt-image-1 一行）
- `scripts/check-capability-catalog.mjs`（image 白名單加 `supportMaskEdit`）
- `tests/`：`unit/canvas/`（canvas-mask 新、connections/toolbox 補）、`unit/live-composite/`（26→53）、`unit/generators/atlascloud-image-mask-edit.test.ts`（新）、`unit/worker/playground-task-handler.test.ts`（+2 案例）、`integration/api/playground-run-mask.test.ts`（新）、`integration/api/live-composite-projects.test.ts`（新）、`contracts/route-catalog.ts`（登記 2 條新路由）、`unit/components/AiMaskPanel/CompositeExportPanel`（補案例）

## 3. 目前工作樹的未提交檔案 = 全部是 Codex 的（voice workspace）

```
 M messages/en/v2Voice.json
 M messages/zh/v2Voice.json
 M src/app/[locale]/v2/workspace/[projectId]/voice/V2VoiceClient.tsx
 M tests/unit/ui/kuiper-visual-system.test.ts
?? src/app/[locale]/v2/workspace/[projectId]/voice/*（9 個新檔）
?? tests/unit/ui/voice-workspace-helpers.test.ts
```

Claude 沒碰以上任何一個；Codex 照常提交即可，不會跟這 6 個 commit 衝突
（檔案集完全不相交）。`HANDOFF-playground-r2v-fix.md` 是舊案已結的過時文件，可刪。

## 4. 驗證狀態

- `npm run test:regression`：**1917/1921 綠**。4 紅全是登記已久的既有紅，與本輪無關：
  - `tests/unit/usage/task-categorizer.test.ts`（`register_ark_asset` 未歸類）
  - `tests/unit/worker/modify-image-reference-description.test.ts`（styleProfile 寫實注入後斷言過時）
  - `tests/unit/api-config/preset-coming-soon.test.ts` ×2（Seedance 2.0 coming-soon 斷言過時）
- `npm run test:guards`：exit 0 全綠
- `check:config-center-guards`：除既有的 seedance-2.0 pricing tiers 警告（**視頻域，可能歸 Codex**）外通過
- `tsc --noEmit`：本輪檔案 0 錯（另有 4 個舊測試檔的既有嚴格性錯誤未動）

## 5. 部署待辦（push 之後）

1. prod 跑 `npx prisma db push`（新表 `LiveCompositeProject`）
2. /profile 啟用 **GPT Image 1 (局部重繪)**（不啟用 picker 不出現，整條鏈路無感）
3. R2/COS bucket CORS 允許 app origin GET（開啟遮罩專案時前端 fetch baseMask PNG）
4. gpt-image-1 定價暫 flat $0.05（比照 gpt-image-2），跑量後核對 AtlasCloud 實際帳單

## 6. 關鍵設計事實（避免後續踩坑）

- **gpt-image-1 是 AtlasCloud 全家唯一支援 `mask_image` 的模型**（schema CDN 驗證過；
  gpt-image-2/edit、nano-banana 系列都沒有 mask 欄位）。mask 語意：**PNG 透明區 = 重繪區**。
- gpt-image-1/edit 的底圖欄位名是 **`image`**（gpt-image-2 是 `images`）——generator 已分派，別統一。
- 局部重繪**沒有開新 task type**，走 `PLAYGROUND_IMAGE` + payload `maskImage`；
  billing/佇列/資產庫白名單全部沿用，6 登記點不用動。
- 遮罩座標 contract：normalized 0-1 對齊**完整底圖**（繪製面板 aspect = 底圖 natural 比例），
  栅格化在 1000×1000 viewBox 空間畫完再縮放到 natural 尺寸，與 SVG 預覽逐像素一致。

## 7. Codex 後續補完（2026-07-18～19，尚未提交）

- 前景遮擋：新增獨立 occlusion timeline、MagicTouch 點選物件、人工 keep/erase 修正；預覽、單幀與影片輸出共用同一遮擋合成路徑。
- 追蹤 2.0：人物遮罩品質估算、warning/lost 區段、可保存的 X/Y 校正關鍵影格與時間插值。
- 光影匹配：本機抽樣實拍影格，自動建議曝光／對比／飽和度／色溫；另有柔焦、邊緣融光與接地陰影控制，全部可保存並進入輸出。
- 動作參考：本機 MediaPipe Pose Landmarker（CPU/WASM）擷取髖部位置、軀幹比例、肩線旋轉與信心值，可分析目前影格或整段；驅動整個 2D／透明影片角色圖層。沒有 rig 的單張 PNG 不宣稱能產生四肢變形。
- 本機模型：`magic-touch.tflite` 與 `pose-landmarker-lite.task` 均放在 `public/models/live-composite/`，來源與 SHA-256 見同目錄 README。
- 向後相容：`occlusionKeyframes`、追蹤校正、appearance 與 motion 欄位在 wire schema 都是 optional；舊專案開啟時建立空遮擋 timeline 並套用外觀預設。
- 驗證：Live Composite 單元／API 71 綠、DOM 64 綠、guards 全綠、TypeScript 與 production build 通過；無頭 Chrome 實測 Pose 產生關鍵影格、自動畫面匹配改值、人物追蹤品質顯示與合成 PNG 下載。
- Voice workspace 仍依先前決定排在最後驗收，本輪沒有修改 Voice 檔案。
