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

## Q-004 [Pre-existing guard fail] `no-api-direct-llm-call` 抓到 `safe-rewrite/route.ts` 直連 LLM

- **Phase**: Phase 6 範疇（AI route 不准旁路 worker）
- **症狀**: `npm run check:no-api-direct-llm-call` 報：
  ```
  [no-api-direct-llm-call] Found forbidden direct LLM execution in production API routes
    - src/app/api/novel-promotion/[projectId]/safe-rewrite/route.ts:56 forbidden direct chatCompletion* call
    - src/app/api/novel-promotion/[projectId]/safe-rewrite/route.ts:74 forbidden direct chatCompletion* call
  ```
- **跟本輪改動的關係**: 無。本輪是合併 `feature/multi-user`（多人系統 K1-K6 + 整合測試），未動 `safe-rewrite` 路徑。
- **可能原因**: 跟 Phase 6 AI runtime unification 同時的遺留路由，尚未遷移到 `createRun` → worker handler。
- **建議**: 由負責 Phase 6 / Phase 8 的 owner 處理，把 safe-rewrite 改走 worker；不在多人系統範疇。
- **狀態**: 待確認
- **建立時間**: 2026-04-28

---

## Q-003 [Pre-existing test fail] worker handler 測試 prisma mock 缺欄位

- **背景**: 跑 `npm run test:unit:all` 時有 3 個 test fail，全在 worker handler 範疇：
  - `tests/unit/worker/panel-image-task-handler.test.ts`：`prismaMock.novelPromotionPanel.update` 期望被呼叫一次，但實際呼叫參數對不上。
  - `tests/unit/worker/script-to-storyboard.test.ts`（2 個 case）：`TypeError: Cannot read properties of undefined (reading 'deleteMany')`，發生在 `src/lib/workers/handlers/script-to-storyboard.ts:153` 的 `prisma.novelPromotionStoryboard.deleteMany(...)` — 看起來測試的 prisma mock 漏了 `novelPromotionStoryboard` model。
- **跟本輪改動的關係**: 無。本輪只動了 `standards/capabilities/image-video.catalog.json` 跟新增 `QUESTIONS.md`，這兩個檔案都不在這幾個失敗測試的 import / 依賴鏈裡。
- **可能原因**: 看起來是之前某個 commit 改了 prisma schema（加 `novelPromotionStoryboard` model）但沒同步更新測試的 prisma mock factory；或是 panel handler 的呼叫時序最近改過但測試 expectation 沒跟上。
- **狀態**: 待確認 — 屬於 Phase 8（複雜鏈路遷移：story_to_script_run / script_to_storyboard_run）的範疇，可能正在進行中所以暫時紅燈。
- **建立時間**: 2026-04-28

---

## Q-005 [安全/架構決策] MediaObject 沒 ownership 欄位 → styleReferenceImages owner check 是空殼

- **Phase**: Phase 11.5（風格 lock）— code-reviewer 第一輪 BLOCK 點 #2
- **背景**:
  - Phase 11.5 加 `NovelPromotionProject.styleReferenceImages: String? @db.Text`（JSON array of MediaObject id），透過 PATCH `/api/projects/[projectId]/style-profile` 寫入
  - implementer 寫的 `assertReferenceImagesOwned` 在 `src/app/api/projects/[projectId]/style-profile/route.ts:35-57` 只做 `mediaObject.findMany({ where: { id: { in: mediaIds } } })`，比對 `rows.length === mediaIds.length`
  - **問題**：`prisma/schema.prisma` 的 MediaObject 沒有 `userId` / `uploadedBy` / `creatorId` 任何 ownership 欄位 → 上面那個 check 只能驗 id 存在，不能驗誰擁有
  - **後果**：任何登入用戶能把別人的 MediaObject id 寫進自己 project 的 styleReferenceImages，下一次生圖會用別人的圖當風格 reference → 跨 user 圖片洩漏 / 越權引用
  - 同樣問題也存在於 `loadStyleProfile` (`src/lib/style-profile/loader.ts:69-92`)，loader 也沒做真實 owner 過濾
- **選項**:
  - **A. 給 MediaObject 加 `uploadedByUserId` 欄位**（schema 改動 → AUTONOMY_PROTOCOL §4 hard stop）
    - 優點：根本解；ownership 一階可查；後續其他資源也能用
    - 缺點：DB migration、既有 row 要 backfill（透過 `Project → User` 反查或標 NULL+寬鬆策略）；MediaObject 被多處共享時「誰是 uploadedBy」可能模糊
  - **B. 透過間接鏈驗 owner**（例如 MediaObject → 任一 Generation/Variant → Project → User）
    - 優點：不動 schema
    - 缺點：MediaObject 跟 Generation 是 N:M（透過 LegacyMediaRefBackup），間接鏈複雜，每次驗證多 join；對「孤立 MediaObject」(直接 upload 沒進 generation)無解
  - **C. 限制 styleReferenceImages 只接受「曾經由本 user upload 的 image」並用 upload audit log**
    - 優點：明確語意
    - 缺點：需要 upload audit table；目前不一定有
  - **D. 暫時禁用 styleReferenceImages（API 直接拒絕非空陣列）**直到 Q 解決
    - 優點：最小改動；不洩漏
    - 缺點：UI 已有 reference image uploader，砍掉等於 11.5 sub-task 缺一塊
- **我的傾向**: A，因為 codebase 任何資源最終都會碰到 ownership 問題，越早建立 single-source-of-truth 越好。MediaObject 加 `uploadedByUserId` + 既有 row 透過 Project→User 反查 backfill；新 row 在 upload 時填好。
- **狀態**: **已解決（user 拍板 A）**
- **建立時間**: 2026-04-28
- **解決時間**: 2026-04-28
- **拍板紀錄**: user 選 A — 加 `MediaObject.uploadedByUserId String? @db.VarChar(36)` + `uploader User? @relation("MediaObjectUploader")` + `@@index([uploadedByUserId])`（落盤於 `prisma/schema.prisma:965-989`）
- **對應 commit 範圍（working tree，未 commit）**:
  - `prisma/schema.prisma`（line 965-989 加欄位 + relation + index；User model 加反向 relation）
  - `src/app/api/projects/[projectId]/style-profile/route.ts:48-50`（用 `uploadedByUserId: userId` 過濾真實 ownership，不再是空殼 length 比對）
  - `src/lib/style-profile/loader.ts:35, 65-105`（loader 同樣用 `row.uploadedByUserId !== projectOwnerUserId` 真實過濾，跳過孤立 / 他人 row）
  - `src/lib/media/service.ts`（MediaObject 寫入路徑全面填 `uploadedByUserId`）
  - `scripts/migrations/backfill-media-object-uploader.ts`（新；既有 row 透過 Generation/Project → User 反查回填，孤立 row 標 NULL+log）
  - `tests/unit/media/service.test.ts` 5 tests + `tests/unit/style-profile/backfill-media-object-uploader.test.ts` 涵蓋
- **相關檔案**:
  - `prisma/schema.prisma`（MediaObject model + Project / User 關聯）
  - `src/app/api/projects/[projectId]/style-profile/route.ts`（真實 owner 過濾）
  - `src/lib/style-profile/loader.ts`（真實 owner 過濾）
  - `src/lib/media/service.ts`（upload 寫入點）
  - `scripts/migrations/backfill-media-object-uploader.ts`（一次性回填）

## Q-006 [架構決策] artStyle / artStylePrompt「唯讀遺留」具體含義

- **Phase**: Phase 11.5 — code-reviewer 第一輪 BLOCK 點 #1
- **背景**:
  - Phase 11.5 計畫 Q-3 user 拍板「artStyle / artStylePrompt 唯讀遺留」
  - implementer 解讀為「移除 3 個寫入點 + 保留 schema 欄位」
  - **但讀取邏輯沒移除**：image/video handler 仍呼叫 `getArtStylePrompt(models.artStyle)` append 到 prompt 結尾
  - **同時** styleProfile.positivePrompt prepend 到開頭
  - 最終 prompt = `{styleProfile.positivePrompt}\n\n{userPrompt}，{getArtStylePrompt(artStyle)}`
  - 違反強約束「不打補丁」「不做兼容層」
  - 而且寫入也沒完全移除：`/api/novel-promotion/[projectId]/route.ts:271` 仍允許 PATCH `artStyle`、前端 `useWorkspaceStageRuntime.ts:100 onArtStyleChange` 仍存在
- **選項**:
  - **A. 完全停用 artStyle / artStylePrompt**：
    - 移除所有寫入點（route.ts PATCH validator 把 artStyle 拿掉、前端 onArtStyleChange + ArtStyleSelector 砍掉）
    - 移除所有讀取點（handler 不再呼叫 `getArtStylePrompt`，prompt 純走 styleProfile）
    - 既有 schema 欄位保留（向下兼容 / migration trace），但生產 code 完全不碰
  - **B. 保留現狀（雙系統並行）**：違反強約束，不可接受
  - **C. 保留 read 但移除 write**：read 邏輯放 fallback（styleProfile null 時才用 artStyle）— 變成「隱式回退」也違反強約束
- **我的傾向**: A。Q-3 字面就是「唯讀遺留 = 不寫不讀，欄位保留留 trace」。implementer 漏掉 read 那邊。
- **狀態**: **已解決（user 拍板 A）**
- **建立時間**: 2026-04-28
- **解決時間**: 2026-04-28
- **拍板紀錄**: user 選 A — 完全停用 artStyle / artStylePrompt：write/read 全砍 + UI 4 處 `ART_STYLES` selector 全砍 + chokepoint 接 injector 重構；schema 欄位保留作 deprecated trace（N+2 release 移除，已登記為 P2 ⏸ 子任務）
- **對應 commit 範圍（working tree，未 commit）**:
  - 寫入路徑全砍：
    - `src/app/api/novel-promotion/[projectId]/route.ts`、`src/app/api/novel-promotion/[projectId]/{location,episodes/[episodeId],voice-lines,generate-character-image}/route.ts`、`src/app/api/asset-hub/{characters,picker,voices}/route.ts` PATCH validator 把 artStyle 欄位拿掉
  - 讀取路徑全砍：
    - `src/lib/workers/handlers/{character-image-task-handler,location-image-task-handler,panel-image-task-handler,panel-variant-task-handler,asset-hub-image-task-handler,asset-hub-modify-task-handler,reference-to-character,image-task-handlers-core,image-task-handler-shared,analyze-novel}.ts` + `src/lib/workers/video.worker.ts`：worker 端 `getArtStylePrompt` 0 呼叫
    - `src/lib/workers/utils.ts`：`resolveImageSourceFromGeneration` / `resolveVideoSourceFromGeneration` 改接 styleProfile 參數
  - chokepoint 接 injector：
    - `src/lib/ai-runtime/index.ts:11`、`src/lib/ai-runtime/style-profile-injector.ts`（新；inject 順序：positive prepend / negative prepend / reference image inject when supported）
  - UI 4 處 `ART_STYLES` selector 全砍：
    - `src/components/shared/assets/character-creation/CharacterCreationForm.tsx`、`src/components/shared/assets/LocationCreationModal.tsx`、`src/components/ui/config-modals/ConfigEditModal.tsx`、`src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/AddLocationModal.tsx`、`src/app/[locale]/workspace/asset-hub/components/AddLocationModal.tsx`、`src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/{ConfigStage,NovelInputStage,WorkspaceHeaderShell}.tsx` + 相關 controller / runtime hook 砍 `onArtStyleChange`
  - `useWorkspaceStageRuntime.ts` 砍 `onArtStyleChange` 並把 styleProfile 接上 ConfigStage
- **相關檔案**:
  - `src/lib/ai-runtime/{index.ts,style-profile-injector.ts}`
  - 所有 `src/lib/workers/handlers/*-task-handler*.ts` + `src/lib/workers/utils.ts` + `src/lib/workers/video.worker.ts`
  - `src/app/api/novel-promotion/[projectId]/**/*.ts` + `src/app/api/asset-hub/**/*.ts`
  - `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/{ConfigStage,NovelInputStage,WorkspaceHeaderShell}.tsx` + `useWorkspaceStageRuntime.ts`
  - `src/components/shared/assets/character-creation/CharacterCreationForm.tsx` 等 UI ART_STYLES 砍除點

## Q-007 [計畫範圍] 4 preset vs 15+ artStyle enum 不對齊 → migration 沉默資料失落

- **Phase**: Phase 11.5 — code-reviewer 第一輪 REQUEST CHANGES #8
- **背景**:
  - Phase 11.5 計畫的 4 個 preset：`realistic` / `american-comic` / `anime` / `thick-paint`
  - **但** `src/lib/constants.ts:160-260` 列的 `artStyle` enum 至少有 15 個值：`xianxia` / `ink-wash` / `korean-webtoon` / `pixar-3d` / `cg-epic` / `urban-anime` / `campus-cartoon` / `chinese-comic` / `isekai-anime` / `korean-historical` / `korean-urban` / `cg-urban` / `game-cg` 等
  - migration script 對 4 preset 之外的 row 做 `skippedUnknownArtStyle` 處理 → silent skip
  - **後果**：這些 row 的 `stylePositivePrompt` 永遠 null → 之後生圖完全沒風格鎖（user 視角是「啊風格沒了」）
  - 違反「不靜默吞錯」精神
- **選項**:
  - **A. plan scope 外（不遷）+ 明確 UI 通知**：UI 開 styleProfile panel 時若 user 的 artStyle 屬於 unmapped 11 個值，顯示「這個風格還沒對應 styleProfile preset，請手動設定」
    - 優點：明確語意；不偷塞
    - 缺點：要做 UI；user 還是要手填
  - **B. 加 fallback 把 unmapped artStyle 灌進 stylePositivePrompt**：用既有 `getArtStylePrompt(artStyle)` 的字串當 fallback positive
    - 優點：所有 row 都有風格鎖；migration 無遺珠
    - 缺點：等於把舊系統的 prompt 字串複製進新系統（但概念上是「一次性遷移」不是「兼容層」）
  - **C. 一次補完 4 → 15 個 preset**：把所有 enum 都對應 preset
    - 優點：完美
    - 缺點：要寫 11 個 preset 的 positive + negative；需要美術 / 風格設計參與
- **我的傾向**: B。一次性 migration 把舊字串遷進新欄位是合理的，這是「遷移」不是「並行」。preset 數量擴充到 15 個留下個 phase 做。
- **狀態**: **已解決（user 拍板 B）**
- **建立時間**: 2026-04-28
- **解決時間**: 2026-04-28
- **拍板紀錄**: user 選 B — 加 fallback 把 unmapped artStyle（11 個非 4-preset 值）灌進 `stylePositivePrompt`，使用既有 `getArtStylePrompt(artStyle)` 的字串作為一次性 migration 的 fallback positive。**這是「遷移」不是「兼容層」**，遷完即可砍 artStyle 欄位（已登記為 P2 ⏸ 子任務）
- **對應 commit 範圍（working tree，未 commit）**:
  - `scripts/migrations/migrate-artstyle-to-style-profile.ts`（新；4 preset 直接對應，11 個 unmapped enum fallback 用 `getArtStylePrompt(artStyle)`，無 silent skip）
  - `src/lib/style-profile/presets.ts`（4 preset：realistic / american-comic / anime / thick-paint）
  - `tests/unit/style-profile/migration.test.ts`（涵蓋 mapped + unmapped fallback 兩條 path）
- **相關檔案**:
  - `src/lib/style-profile/presets.ts`（4 preset）
  - `src/lib/constants.ts`（artStyle enum）
  - `scripts/migrations/migrate-artstyle-to-style-profile.ts`
  - `lib/prompts/novel-promotion/getArtStylePrompt`（fallback 來源；migration 跑完待 P2 砍）

## Q-008 [UX/實作] StyleProfilePanel 沒 prefill + Save 會清空既有資料

- **Phase**: Phase 11.5 — code-reviewer 第一輪 REQUEST CHANGES #4
- **背景**:
  - implementer 偏離點 #5：StyleProfilePanel 接 initial props 但 ConfigStage 永遠傳 `null`
  - 結果：user 已經設過 stylePositivePrompt，下次打開 panel 看到全空，按 Save → 後端收到 `{ stylePositivePrompt: null, ... }` → 既有資料被清空
  - 嚴重資料損失 bug
- **選項**:
  - **A. 加 GET endpoint + UI fetch 初始值**（最完整）
    - 優點：用戶體驗對；改動範圍清楚
    - 缺點：多一個 API；多一次 request；mutation invalidate query 流程要對齊
  - **B. UI 只送 dirty 欄位**（不 fetch，但 Save 只送 user 動過的）
    - 優點：不需 GET endpoint
    - 缺點：UI 變複雜（要 track dirty state）；user 仍看不到既有值
  - **C. 暫時 disable Save 按鈕直到 user 至少改一個欄位**
    - 優點：最小改動
    - 缺點：UX 還是不好；user 看不到既有值
- **我的傾向**: A。這是 styleProfile UI 的核心交互，省不掉。GET endpoint + react-query 的 standard pattern。Q-6「UI 簡單版」應該是「先不加 token 預估警告」，不是「不接 GET」。
- **狀態**: **已解決（user 拍板 A）**
- **建立時間**: 2026-04-28
- **解決時間**: 2026-04-28
- **拍板紀錄**: user 選 A — 加 GET endpoint + UI fetch 初始值，避免 Save 清空既有資料的資料損失 bug
- **對應 commit 範圍（working tree，未 commit）**:
  - `src/app/api/projects/[projectId]/style-profile/route.ts`（GET handler，含 ownership check）
  - `src/lib/query/hooks/useStyleProfile.ts`（新；react-query 抓初始值）
  - `src/lib/query/mutations/updateStyleProfile.ts`（PATCH，invalidate query 對齊）
  - `src/lib/query/keys.ts`（新增 styleProfile query key）
  - `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/ConfigStage.tsx`（接 `useStyleProfile` 把資料 prefill 進 panel）
  - `src/app/[locale]/workspace/[projectId]/components/StyleProfilePanel.tsx`（accept initial props from parent）
  - `tests/integration/api/style-profile.test.ts` 13 tests pass（GET + PATCH 雙路徑覆蓋）
- **相關檔案**:
  - `src/app/[locale]/workspace/[projectId]/components/StyleProfilePanel.tsx`
  - `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/ConfigStage.tsx`
  - `src/lib/query/{hooks/useStyleProfile.ts,mutations/updateStyleProfile.ts,keys.ts}`
  - `src/app/api/projects/[projectId]/style-profile/route.ts`

## Q-009 [計畫範圍] Phase 11.5 是否包含 variant / modify handler？

- **Phase**: Phase 11.5 — code-reviewer 第一輪 REQUEST CHANGES（範圍問題）
- **背景**:
  - implementer 接了 4 個 image/video handler：`character-image-task-handler` / `location-image-task-handler` / `panel-image-task-handler` / `video.worker`
  - **但** `panel-variant-task-handler.ts` / `asset-hub-modify-task-handler.ts` / `image-task-handlers-core.ts` / `modify-asset-image-task-handler.ts` 也走 `resolveImageSourceFromGeneration`，全部沒接 styleProfile
  - 結果：Variants（panel 重新生圖）跟 Modify（用戶調整）的圖風格不會跟 baseline 一致
  - master plan 字面寫「全片所有 image / video generate 自動 inject style」— 嚴格說 variant / modify 也算「全片」
- **選項**:
  - **A. 本 Phase 11.5 範圍擴大到 variant / modify**
    - 優點：完整；user 看到的所有圖風格一致
    - 缺點：本輪 implementer 工作量增加；可能引出更多測試需求
  - **B. 留到 Phase 11.5.x 子任務做**
    - 優點：本輪 scope 收斂
    - 缺點：上線後一段期間 variants 會有風格漂移問題
- **我的傾向**: A。Phase 11.5 主目標就是「全片風格一致」，漏掉 variant / modify 等於主目標沒達成。範圍擴大但 implementation pattern 跟既有 4 個 handler 一樣，工作量可控。
- **狀態**: **已解決（user 拍板 A）**
- **建立時間**: 2026-04-28
- **解決時間**: 2026-04-28
- **拍板紀錄**: user 選 A — 本 Phase 11.5 範圍擴大到 variant / modify / asset-hub-modify，全部接 styleProfile injector，確保「全片風格一致」主目標達成
- **對應 commit 範圍（working tree，未 commit）**:
  - `src/lib/workers/handlers/panel-variant-task-handler.ts`（接 chokepoint）
  - `src/lib/workers/handlers/asset-hub-modify-task-handler.ts`（per-user / per-project sentinel：`global-asset-hub` 跳過 styleProfile，真實 projectId 才載入）
  - `src/lib/workers/handlers/image-task-handlers-core.ts`（共用 chokepoint 路徑）
  - `src/lib/workers/handlers/asset-hub-image-task-handler.ts`、`reference-to-character.ts`（順手砍 `getArtStylePrompt`）
  - `tests/unit/worker/{panel-variant-task-handler,modify-image-reference-description,image-task-handlers-core}.test.ts` 全部加涵蓋 styleProfile inject 行為
- **相關檔案**:
  - `src/lib/workers/handlers/panel-variant-task-handler.ts`
  - `src/lib/workers/handlers/asset-hub-modify-task-handler.ts`
  - `src/lib/workers/handlers/image-task-handlers-core.ts`
  - `src/lib/workers/handlers/asset-hub-image-task-handler.ts`
  - `src/lib/workers/handlers/reference-to-character.ts`

---

## 額外整理：Phase 11.5 第一輪 reviewer 抓到的不需要 user 拍板的 issues（implementer 二輪要修）

這些不是「待確認」級別，是明確的修補項，列在這裡留 trace：

### Bug-1: capability-catalog guard 紅
- **狀態**: **已修補**
- **解決時間**: 2026-04-28
- 症狀：`npm run check:capability-catalog` 168 issue，`config-center-guards` 整串 fail
- 根因：`scripts/check-capability-catalog.mjs:6-21` 的 allow-list 沒同步 `supportNegativePrompt` / `supportReferenceImage`
- 修補紀錄：把 allow-list 從 TS contract（`src/lib/model-config-contract.ts`）讀取，避免兩個 source of truth；`scripts/check-capability-catalog.mjs` 與 `src/lib/model-config-contract.ts` 同步擴充；`standards/capabilities/{catalog.example,image-video.catalog}.json` 同步補欄位；`npm run check:config-center-guards` 全綠

### Bug-2: video-worker test 假綠燈
- **狀態**: **已修補**
- **解決時間**: 2026-04-28
- 症狀：`tests/unit/worker/video-worker.test.ts:283` 讀 `generationArg.prompt`，但實際在 `generationArg.options.prompt`
- 結果：`'' || ''` 永遠等於空字串，`expect.not.toMatch(/VIDEO_STYLE_POS/)` trivially true
- 修補紀錄：path 改正為 `generationArg.options.prompt`，並補 styleProfile inject / null-fallback 兩條 case；test 全綠

### Bug-3: integration test fixture vs Zod schema 不一致
- **狀態**: **已修補**
- **解決時間**: 2026-04-28
- 症狀：`tests/integration/api/style-profile.test.ts:61, 109` 用 `'media-1'` / `'media-not-mine'`，但 route 的 Zod 強制 UUID
- 結果：兩條 test 直接 422，沒驗證業務
- 修補紀錄：fixture 換成合法 UUID + mock `prisma.mediaObject.findMany` 控制返回；13 tests 全綠（含 Q-005 ownership 雙路徑：自家 row 通過、他人 row 拒絕、孤立 row 拒絕）

### Bug-4: injectStyleProfile + workers/utils.ts styleProfile 參數變 dead code
- **狀態**: **已修補**
- **解決時間**: 2026-04-28
- 症狀：純函式 `injectStyleProfile` + `resolveImageSourceFromGeneration / resolveVideoSourceFromGeneration` 的 `styleProfile?` 參數從未在 production 被讀取
- 修補紀錄：選「接上 chokepoint」路線 — `src/lib/ai-runtime/index.ts:11` re-export `injectStyleProfile`，chokepoint 在實際 dispatch 前呼叫 injector；`src/lib/workers/utils.ts` 的 `resolve*FromGeneration` 把 styleProfile 真實 forward 給 chokepoint；`tests/unit/worker/chokepoint-style-injection.test.ts` 5 tests pass

### Bug-5: tsconfig + vitest 加 `@/scripts` alias
- **狀態**: **已修補**
- **解決時間**: 2026-04-28
- implementer 自報 deviation #6
- reviewer 沒明確 BLOCK 但提醒：alias 改動須確認不影響其他 alias 解析
- 修補紀錄：`tsconfig.json` + `vitest.config.ts` 同步加 `@/scripts` alias；grep 確認沒衝突；migration test 透過此 alias import `scripts/migrations/*`；commit message 將明寫「為 migration test 加 @/scripts alias」

### Bug-6: location-image-task-handler.test.ts:128/147 typing error
- **狀態**: **已修補**
- **解決時間**: 2026-04-28
- `vi.fn` 推導為 undefined 時 cast 報錯
- 修補紀錄：給 `vi.fn` 加泛型參數；`tests/unit/worker/location-image-task-handler.test.ts` 全綠；`npx tsc --noEmit -p tsconfig.json` 0 errors

---

## Phase 11.1 設計決策（已落實）

> 註：Phase 11.1 user 拍板的 Q-1 / Q-2 / Q-3 / Q-4 屬於 phase-architect 範疇的「當輪設計選擇」，不是 QUESTIONS.md 一般的「跨輪未解 / 架構決策」。輕量化記錄在此給未來接手的人 trace。差別：QUESTIONS.md 主體是長期未解，本段是 phase 內已落地。

- **Q-1 C：ProjectSettings 顯示「自訂 / 未設定」+ 參考圖數，不反推 preset 名（避免 hardcode 對照表）**
  - 落實：`ProjectSettings.tsx` 渲染 styleProfile 唯讀 badge — `parseReferenceImageCount(referenceImageObjectIds)` 解 JSON 出參考圖數；`isCustom` 透過 styleProfile 是否有 positivePrompt 或 referenceImage 決定顯「自訂」或「未設定」
  - 不做：不反推 preset 名（master plan 原 Phase 11.1 寫的「artStyle」已過時，Phase 11.5 / Q-006 拍板 A 已完全停用 artStyle / artStylePrompt）
  - 測試：`tests/unit/components/ProjectSettings.test.tsx` 8/8 ✅

- **Q-2 B：切集保留 URL stage param（不重置）**
  - 落實：`EpisodeTabBar` 切集時保留現有 stage param（user 在 storyboard 切第 2 集仍停在 storyboard），讓用戶能跨集對比同 stage
  - 不做：不重置回 config / 不重置回第一個 stage
  - 測試：`tests/integration/workspace-page.test.tsx` regression case 守住

- **Q-3 B：reorder API 拆 Phase 11.1.5**
  - 落實：本 Phase 11.1 子任務 4「API 層補 episode CRUD 完整性檢查」邊界縮減為 GET / POST / DELETE 完整性；PATCH 重排序拆出去獨立子任務
  - 拆出去的子任務含：reorder API（transaction 處理 episodeNumber `@@unique` 約束）+ EpisodeTabBar drag-and-drop UI + optimistic update 回滾
  - 理由：reorder transaction 邏輯獨立、UI drag-and-drop 工作量明顯 > 單一 API 端點

- **Q-4 A：完全停止「自動跳第一集」effect**
  - 落實：移除既有「進 project 自動 redirect 到第一集」effect（`page.tsx`）；user 進 project 永遠先看 `OverviewView` dashboard
  - 不做：不做「最後造訪集」記憶（避免 localStorage 同步成本）/ 不做「無集時自動建第一集」（讓 user 主動點「+ 新建集」）
  - 測試：`tests/integration/workspace-page.test.tsx` regression case 守住「進 project 看到 OverviewView，不自動跳到 first episode workspace」

---

## Phase 11.2 設計決策（已落實）

> 註：Phase 11.2 user 拍板的 Q-1 / Q-2 / Q-3 / Q-5 屬於 phase-architect 範疇的「當輪設計選擇」，不是 QUESTIONS.md 主體的「跨輪未解 / 架構決策」。同 Phase 11.1 模式輕量化記錄在此給未來接手的人 trace。

- **Q-1 A：junction = SoT，panels.characters 是 panel 屬性（角色出場記錄），不是 episode 索引**
  - 落實：「列 episodes by character」一律走 `getEpisodesForCharacter(characterId)` 反查 `EpisodeCharacter` junction；`panels.characters` 仍保留作為「該 panel 出場了哪些角色」的 panel 屬性，不被當成 episode-character 關係源
  - 不做：不做雙寫雙讀（避免 source of truth 拉扯）；不刪 panels.characters（panel 編輯 UI 仍需要它）
  - 測試：`tests/unit/lib/episode-asset-bridge.test.ts` 22 cases 守住 junction reverse-lookup；`npm run check:no-multiple-sources-of-truth` 全綠

- **Q-2 B：name 解析三層 fallback（精確 → case-insensitive → aliases JSON）**
  - 落實：`linkEpisodeCharactersFromPanel` 從 panel.characters JSON 解出 character 名後，依序：
    1. `findFirst({ name: { equals: x } })` 精確
    2. `findFirst({ name: { equals: x, mode: 'insensitive' } })` 大小寫不敏感
    3. `findFirst({ aliases: { contains: x } })` 比對 aliases JSON
  - 找不到不抛錯，log warning 跳過（避免 storyboard transaction 因為某個 panel 用了不存在的 character 名而整批 rollback）
  - 不做：不做 fuzzy match / Levenshtein（避免錯配）；不自動建立缺失 character（這是 panel 端的污髒 prompt 問題，不該由 junction layer 補洞）
  - 測試：`tests/unit/lib/episode-asset-bridge.test.ts` 三條 fallback path 各有獨立 case；找不到 asset 的 warning path 也覆蓋

- **Q-3 C：role 用 enum/string 區分 'auto-from-panel' / 'manual' / 'imported-from-global'**
  - 落實：`EpisodeCharacter.role` 用 `String?` 而非 Prisma enum，取值 `'auto-from-panel'` | `'manual'` | `'imported-from-global'`；用 String 避免後續擴增 role 時要 ALTER TABLE
  - 本輪只實作 `auto-from-panel` writer（storyboard handler 自動寫入）；`manual` 跟 `imported-from-global` 欄位就緒但寫入路徑拆 Phase 11.2.5 ⏸
  - 註：`imported-from-global` **預期不會大量出現** — import 是「把 global asset 拷進 project asset library」，跟 episode 無關；junction 只在 storyboard handler 偵測到 panel 引用時寫，role 仍是 `auto-from-panel`。`imported-from-global` 只在「user 在 episode 詳情手動 link 一個剛 import 的 character」時用得到，邏輯拆 11.2.5
  - 測試：`tests/unit/lib/episode-asset-bridge.test.ts` 驗 `auto-from-panel` 寫入；`tests/unit/worker/storyboard-junction.test.ts` 驗 worker handler e2e 寫入

- **Q-5 B：import-character endpoint 簽名 `POST /api/projects/[projectId]/import-character` body `{globalCharacterId, includeAppearances?}`，返回完整 character object**
  - 落實：endpoint body shape 不用 `characterId`（避免跟既有 NovelPromotionCharacter id 命名衝突）；用 `globalCharacterId` 明確表達「來源是 global 庫」
  - 返回完整 character object（含 appearances 若 `includeAppearances=true`）讓 UI 可立即渲染，不需再多打一個 GET — 對應 Q-8 同樣的 API design 原則「single round-trip 給足 UI 能用的資料」
  - import-location 對稱：body `{globalLocationId, includeImages?}`，返回完整 location object
  - 不做：不做 batch import（一次一個 asset；batch 拆 11.2.5 若需要）
  - 測試：`tests/integration/api/projects/import-character.test.ts` 8 cases；`tests/integration/api/projects/import-location.test.ts` 8 cases
