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
