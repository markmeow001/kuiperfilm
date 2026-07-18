# Kuiper 平台後續優先順序（2026-07-18）

## 已確認決策

- Voice 功能程式與正式部署先維持目前版本。
- Voice 正式端到端驗收延後到平台主要功能完成後，列入最終整合驗收，不占用近期開發順位。
- 除非 Voice 出現阻斷其他流程的錯誤，近期不繼續擴充 Voice。

## 目前完成基線

- 導演台自由視角、鏡頭 POV、AI blocking、走位預演與導演路由已完成。
- Canvas 遮罩資料、局部重繪鏈路、Live Composite 專案儲存與輸出素材庫已完成程式整合。
- Canvas 的右鍵選單、多選工具列、對齊／分布、群組／解組、鎖定、圖層、快速新增、生成狀態與 Undo／Redo 已完成，不再列為待辦。
- Playground 參考影片 R2V 的舊 Bug #1、#2 均已完成；`HANDOFF-playground-r2v-fix.md` 僅為歷史記錄。
- v2 首頁、建立流程、劇本、角色／場景／道具、分鏡、Voice、成片、Canvas 與 Playground 已完成第一輪 UI 改版。

## 1–6 執行結果（2026-07-18 完成程式階段）

### P0：先讓現有核心能力真正可用

1. ✅ **遮罩／局部重繪正式環境啟用**
   - 正式管理設定已確認啟用 `gpt-image-1`。
   - 正式鏈路採同源 asset proxy／伺服器簽名讀取底圖，不要求瀏覽器直接跨域讀 R2／COS。
   - 遮罩任務、來源底圖、透明 mask 與 worker 參數已有行為測試。
   - 實際帳單校正保留為正式使用後的營運校正，不為測試額外觸發付費供應商請求。

2. ✅ **導演台、Canvas、Live Composite 串接補齊**
   - 導演輸出會保存鏡頭、走位與 blocking metadata。
   - 分鏡節點可建立導演台 handoff 並開啟 3D blocking。
   - Live Composite 儲存後可透過 import intent 直接建立 Canvas 影片節點。
   - Canvas 節點 metadata 保留來源、shot／sequence 與版本關係，供 Previz、AI 影片及實拍素材共用。
   - 本階段完成資料與節點串接；高階虛擬角色自動 tracking／動作合成仍屬後續專業合成能力，不假裝已由簡單節點串接取代。

### P1：補完整創作閉環

3. ✅ **Canvas 圖像編輯補齊**
   - Crop、Outpaint。
   - 編輯結果保留為新節點／新版本，不覆蓋來源。

4. ✅ **Canvas Assistant（安全第一版）**
   - 全域助理與選中節點的迷你輸入器。
   - 能以嚴格契約建立、更新、連線與排版；限制最多 12 個操作，拒絕刪除與未知欄位。
   - 生成、群組與分鏡等高影響動作仍由既有 Canvas 明確工具執行，Assistant 不會繞過任務／計費／確認鏈路直接執行。
   - AI 動作必須可預覽、確認與復原。

### P2：一致性與技術債

5. ✅ **平台 UI 第二輪一致化**
   - 檢查 Profile、管理後台、工作區／團隊、設定中心、素材庫與 Live Composite。
   - 統一字級、密度、空狀態、按鈕階層、窄螢幕／行動版行為。

6. ✅ **測試基線整理**
   - 修正既有 regression 與 API integration 的過時 mock／斷言。
   - 統一 Playground 計價來源，整理舊 PlaygroundRun 歷史與 workspaceId 傳遞。

## 本輪主要落地內容

- Canvas：導演 metadata、分鏡 handoff、Live Composite import intent、Crop／Outpaint 新版本節點、Assistant 預覽／確認／Undo。
- Playground：個人／工作區切換、`workspaceId` 任務與歷史隔離、估價與實際 billing freeze 共用同一套計價函式。
- UI：新增 Studio Dark 語意樣式，套用 Profile、管理後台、工作區、素材庫與 Live Composite，並改善窄螢幕排列。
- 模型設定：補齊 ARK Seedance 2.0／Fast 的能力目錄，使 resolution／generateAudio tier 與計價目錄一致。
- 測試基線：更新多人專案權限、editor 資產寫入、episode 關聯及媒體簽名等過時 mock／斷言。

## 驗證紀錄（2026-07-18）

- `npm run test:unit:all -- --reporter=dot --silent`：249 files / 1966 tests 全通過。
- `npm run test:integration:api -- --reporter=dot --silent`：全通過。
- `npm run test:integration:chain -- --reporter=dot --silent`：5 files / 14 tests 全通過。
- `npm run test:guards`：API、LLM、prompt、專案權限、worker startup、route／task type coverage 全通過。
- `npm run check:config-center-guards`：model key、provider、capability、pricing 全通過。
- `npx tsc --noEmit`：通過。
- `npm run lint`：0 errors（仍有 23 個既有 warnings）。
- `npm run build`：完成正式 Next.js production build；本機未常駐 Redis 造成 page-data 階段連線日誌噪音，但未影響產物，Redis 任務鏈已由 Docker integration 通過。

## 最終整合驗收

- 等上述主要工作完成後，再一起執行跨頁面正式環境 E2E。
- Voice 的「建立角色 → 綁定台詞 → 試聽 → 合成 → 儲存／刷新後復原」放在此階段驗收。
- 同階段驗證導演台、Canvas、遮罩重繪、Live Composite、Playground 與素材庫的跨工作區資料流。
