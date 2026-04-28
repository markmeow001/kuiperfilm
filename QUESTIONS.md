# Open Questions

## Q-001 [資料缺口] Tencent VOD AIGC 模型計費單價

- **Phase**: 不在 master plan 內（Tencent VOD 整合，handover 文件中標為 Task 23 的 pricing 部分）
- **背景**:
  - capability catalog 已加 39 個 Tencent VOD 模型條目（Kling/Vidu/Hailuo/PixVerse/GV/OS/Jimeng/Hunyuan video + GEM/OG/Qwen/SI/Kling-image/Vidu-image/Jimeng-image/Hunyuan-image）。
  - pricing catalog (`standards/pricing/image-video.pricing.json`) 尚未加。
  - pricing schema 強制每個 tier 要有具體 `amount`（人民幣或美元視 provider 而定），且每個 tier 的 `when` 條件必須對應 capability 已宣告的 option 欄位。
- **缺什麼**:
  - 騰訊雲 AIGC 各模型的單價表，最少需要每組 (resolution, duration, generateAudio) 組合對應的金額。
  - 不確定計費幣別（騰訊雲 AIGC 用 RMB/秒？還是按生成次數？）。SDK doc 沒說明。
- **選項**:
  - A. 等使用者貼官方價目表（內部接洽人應該有），我直接補上 pricing 條目。
  - B. 從騰訊雲官網「AIGC 計費」公開頁面抓最新價目表（如果有公開頁），自行對照填入。
  - C. 暫時不加 pricing 條目 — 系統在沒有 pricing 條目時行為待確認（可能會在計費階段 fallback 到 0 或拋錯，需要先測）。
- **我的傾向**: A，因為價目表是動態的，使用者拿到的內部文件最權威。在 e2e 測試實際燒到費用前不影響功能。
- **狀態**: 待確認
- **建立時間**: 2026-04-28
- **相關檔案**:
  - `standards/pricing/image-video.pricing.json`（要新增 39 條 entry）
  - `standards/capabilities/image-video.catalog.json`（已加 39 條 entry，pricing tier 的 when 欄位需對應這裡的 options）
  - `src/lib/generators/{video,image}/tencent-vod.ts`（generator 規格參考）

### 補充：capability catalog 已加的 39 個模型

Video（26 個）：
- Kling: 1.6, 2.0, 2.1, 2.5, 2.6, O1, 3.0, 3.0-Omni
- Vidu: q2, q2-pro, q2-turbo, q3, q3-pro, q3-mix, q3-turbo
- Hailuo: 02, 2.3, 2.3-fast
- PixVerse: v5.6, v6, c1
- GV: 3.1, 3.1-fast
- OS: 2.0
- Jimeng: 3.0pro
- Hunyuan: 1.5

Image（13 個）：
- GEM: 2.5, 3.0, 3.1
- OG: image2_low, image2_medium, image2_high
- Qwen: 0925
- SI: 4.5, 5.0-lite
- Kling: 2.1
- Vidu: q2
- Jimeng: 4.0
- Hunyuan: 3.0

---

## Q-002 [環境問題] 缺 ripgrep 導致 `npm run test:guards` 無法執行

- **背景**: `scripts/check-api-handler.ts` 用 `execSync('rg --files src/app/api ...')` 掃描 API handler。
- **症狀**: `/bin/sh: rg: command not found` → `npm run test:guards` 失敗（也連帶讓 `npm run test:regression` 中斷在第一步）。
- **影響**: 跟本輪 catalog 改動無關。Pre-existing。
- **建議解法**: `brew install ripgrep`（macOS）後重跑即可。
- **狀態**: 待確認（要不要正式裝、或者讓 guard script fallback 到 grep）
- **建立時間**: 2026-04-28

## Q-003 [Pre-existing test fail] worker handler 測試 prisma mock 缺欄位

- **背景**: 跑 `npm run test:unit:all` 時有 3 個 test fail，全在 worker handler 範疇：
  - `tests/unit/worker/panel-image-task-handler.test.ts`：`prismaMock.novelPromotionPanel.update` 期望被呼叫一次，但實際呼叫參數對不上。
  - `tests/unit/worker/script-to-storyboard.test.ts`（2 個 case）：`TypeError: Cannot read properties of undefined (reading 'deleteMany')`，發生在 `src/lib/workers/handlers/script-to-storyboard.ts:153` 的 `prisma.novelPromotionStoryboard.deleteMany(...)` — 看起來測試的 prisma mock 漏了 `novelPromotionStoryboard` model。
- **跟本輪改動的關係**: 無。本輪只動了 `standards/capabilities/image-video.catalog.json` 跟新增 `QUESTIONS.md`，這兩個檔案都不在這幾個失敗測試的 import / 依賴鏈裡。
- **可能原因**: 看起來是之前某個 commit 改了 prisma schema（加 `novelPromotionStoryboard` model）但沒同步更新測試的 prisma mock factory；或是 panel handler 的呼叫時序最近改過但測試 expectation 沒跟上。
- **狀態**: 待確認 — 屬於 Phase 8（複雜鏈路遷移：story_to_script_run / script_to_storyboard_run）的範疇，可能正在進行中所以暫時紅燈。
- **建立時間**: 2026-04-28
