# Kuiper AI 表演驅動角色重製計畫 v2.1

> 日期：2026-07-19  
> 狀態：融合修訂版／執行前規格  
> 適用範圍：Live Composite、Canvas、Playground、素材庫、導演台  
> 唯一生成通路：AtlasCloud Seedance 2.0  
> 核心目標：保留真人演員的表情、情緒、眼神、口型、身體動作與時間節奏，重新生成另一個 AI 角色與全新場景；演員身份不必出現在輸出中。

## 0. 已確認決策

1. 演員是「表演驅動者」，不是最終畫面必須保留的角色。
2. 最終人物的臉、髮型、身形、妝容、服裝、武器與身份都可以重新生成。
3. 特效妝與換裝第一階段歸入「AI 角色設計」，不建立保留真人身份的獨立局部換妝／換裝產品線。
4. Track B「表演驅動全幀重繪」是產品主線；Track A 綠幕 keying／合成是拍攝前處理、可靠合成與品質基礎。
5. 本階段只使用 AtlasCloud 的 Seedance 2.0，不走 ARK、不走 fal，也不把 Kling 當作自動備援。
6. 模型不可用或能力不符合時必須顯式失敗，不得自動切換供應商或模型。
7. 背景圖片只是概念圖／參考圖；Track B 的正式成品由 Seedance 全幀生成動態人物與動態場景。

## 1. 產品定位

Live Composite 升級為「AI 實拍重製工作區」。使用者上傳真人表演影片，再提供 AI 角色與場景參考，平台將原表演轉移到新的角色與世界。

### 1.1 必須保留的表演訊號

- 臉部表情與細微情緒。
- 眼神方向、眨眼與視線轉移。
- 口型、說話節奏、停頓及呼吸節奏。
- 頭部轉動、傾斜及身體重心。
- 身體姿勢、肢體動作、走位及動作時間。
- 原始鏡頭長度、剪接點及攝影機語言。
- 原始音訊或精確的音訊時間軸。

### 1.2 可以重新生成的內容

- 人物身份、五官、年齡、性別與身形。
- 髮型、髮色、妝容、傷妝及奇幻造型。
- 服裝、盔甲、材質、鞋、配件及武器。
- 背景、天空、建築、環境物件、天氣與特效。
- 光線、接觸陰影、反射、景深、顆粒及動態模糊。

### 1.3 第一版不承諾

- 任意長度、任意運鏡、任意多人遮擋都能一次成功。
- 逐像素保留原人物；Track B 本質上是全幀生成。
- 第一版原生 4K 長影片。
- 任意一兩幀的生成式局部重算。
- 不經人工檢查即可交付的多人、快速打鬥或長鏡頭。

第一版範圍：單一主要演員、綠幕或乾淨背景、4–15 秒、固定或緩慢運鏡；快速預覽使用 480p／720p，正式驗收輸出使用 1080p，4K 在通過品質檢查後升頻。

## 2. 唯一模型與供應商契約

### 2.1 執行模型

只允許以下兩個 AtlasCloud Seedance R2V 模型：

- `atlascloud::seedance-2.0-fast-r2v`
  - 用途：快速預覽與低成本試片。
  - 時長：4–15 秒。
  - 解析度：480p、720p。
- `atlascloud::seedance-2.0-r2v`
  - 用途：正式預覽與最終生成。
  - 時長：4–15 秒。
  - 解析度：480p、720p、1080p。

本階段不使用：

- ARK Seedance。
- fal Seedance。
- BobAPI／taijiai Seedance。
- Kling O1、O3 或 3.0 Omni。
- Runway 或其他新 SaaS。

若未來要新增任何通路或模型，必須另開計畫，確認 API 契約、費用、素材政策與資料保存方式；不得在本工作流中加入隱式 fallback。

### 2.2 AtlasCloud R2V 已知輸入能力

- `reference_images`：1–9 張。
- `reference_videos`：1–3 支，參考影片總長不得超過 15 秒。
- `reference_audios`：1–3 支，且必須同時存在圖片或影片參考。
- `prompt`：以素材順序引用，例如 `image 1`、`video 1`，不是 `@Image1`。
- `duration`：4–15 秒。
- `resolution`：依 Standard／Fast 能力限制。
- `ratio`：畫面比例。
- `generate_audio`：可開關原生音訊生成。
- `watermark`、`return_last_frame`：依現有 Driver 傳遞。

Seedance 2.0 AtlasCloud 路線不支援：

- `seed`。
- `camera_fixed`。
- `negative_prompt`。
- 通用的「表演權重／角色權重／場景權重」數值欄位。

未知欄位可能被供應商忽略，因此 UI 不得顯示實際無法傳送的控制滑桿。

### 2.3 參考素材順序契約

平台必須固定素材順序並將映射顯示給使用者：

- `video 1`：真人完整表演影片，唯一動作、表情、口型與攝影機參考。
- `video 2`：可選的穩定臉部近景表演參考影片。
- `audio 1`：原始台詞／同期聲，若模型生成音訊需要參考。
- `image 1–3`：AI 角色正面、側面、背面或 3/4 角度。
- `image 4–5`：服裝、妝容、武器與細節。
- `image 6`：背景概念圖。
- 其餘圖片：必要的光影、材質或場景補充，總數不得超過 9。

任一素材缺失或順序變動都必須重新產生 prompt 映射，不得沿用舊 prompt。

### 2.4 參考影片 15 秒配額

AtlasCloud 對 `reference_videos` 採所有影片合計最多 15 秒的限制。配額分配必須以完整保留主要表演為優先：

- `video 1` 長度等於目標鏡頭長度，不得為了加入其他參考而裁短主要表演。
- `video 2` 的可用上限為 `15 秒 - video 1 長度`。
- `video 2` 只裁取最重要的情緒、眼神或口型節拍，不要求放入完整臉部近景影片。
- 若剩餘配額不足以形成有效的臉部參考，停用 `video 2`，並在 UI 顯示原因及剩餘秒數。
- 「有效臉部參考」的最低秒數不是已知的 AtlasCloud 契約，必須由 B0 benchmark 驗證；在驗證前不得把推測值宣稱為模型限制。

目標鏡頭超過 11 秒時，第一版預設停用 `video 2`，但此門檻屬產品預設值，不是供應商限制；B0 通過後可依實測結果調整。

## 3. Track B：表演驅動全幀角色重製

Track B 是主要商業展示功能。

### 3.1 使用者流程

`上傳表演影片 → 表演分析 → 設計 AI 角色 → 建立場景概念圖 → 組合 AtlasCloud R2V 輸入 → 4 秒快速預覽 → 完整鏡頭生成 → 表演品質比較 → 問題區段重算 → 音訊與輸出`

### 3.2 表演分析

瀏覽器端使用現有能力或新增 MediaPipe Face Landmarker：

- 人物遮罩：只作人物 ROI、構圖及品質提示。
- Pose：擷取身體骨架、重心、肩線、髖部與動作範圍。
- Face landmarks：擷取臉部位置、頭部姿態、嘴型、眼睛與表情變化。
- 音訊：保存原始聲音與時間碼。
- 鏡頭分析：確認是否固定、緩慢移動或超出 MVP 支援範圍。

Face landmarks 不直接送入 AtlasCloud。它們用於：

- 穩定臉部裁切。
- 建立可選的臉部近景參考影片。
- 輸入／輸出表情及口型比較。
- 問題時間碼偵測。
- 未來專用 face-driver 的資料基礎。

「現有 Selfie Segmenter 對 Track B 已足夠」只是一項待驗證假設。B0 benchmark 必須確認粗人物 ROI 是否能實際改善輸出；第一版仍要求綠幕或乾淨背景。

### 3.3 AI 角色設計

妝容與服裝不是保留真人像素的局部修改，而是最終 AI 角色設定的一部分。

角色設定至少包含：

- 角色身份與臉部設計。
- 髮型、髮色與年齡。
- 妝容、傷妝、皮膚材質與特殊效果。
- 身形與比例。
- 服裝、盔甲、材質、鞋及配件。
- 武器與可互動道具。
- 多角度參考圖及禁止漂移的視覺特徵。

角色參考圖應先在 Canvas／素材庫建立並核准，再送入 R2V。修改角色設計會產生新版本，不覆蓋舊角色或舊生成結果。

### 3.4 場景設計

使用者先建立背景概念圖，確認世界觀、構圖、透視、光線與色調。此圖片只作 Seedance 的場景參考，不直接充當 Track B 的影片背景。

Track B 由 Seedance 全幀生成：

- AI 角色。
- 動態背景。
- 攝影機運動。
- 場景光影。
- 人物與環境互動。

Track B 不再強制執行 `generate-background-video → composite-shot`。這兩個任務只屬於 Track A 的傳統合成分支。

### 3.5 Prompt 組裝原則

Prompt 必須清楚標示素材順序。例如：

> Use video 1 as the sole reference for performance timing, facial emotion, gaze direction, lip movement, body motion, prop trajectory, framing and camera movement. Replace the performer completely with the character defined by images 1–5. Use image 6 as the visual reference for the environment. Preserve the exact order and timing of actions from video 1. Do not add new actions, change the shot duration, or retain the original performer's identity.

因 AtlasCloud 沒有數值權重欄位，「表演優先」「角色一致性優先」只能透過 prompt 模板及參考素材品質控制。UI 必須標示為文字指令策略，不宣稱是模型原生權重。

### 3.6 預覽與正式生成

- 快速預覽：`seedance-2.0-fast-r2v`，4 秒，480p／720p。
- 正式預覽：`seedance-2.0-r2v`，完整鏡頭，720p。
- 正式生成：`seedance-2.0-r2v`，完整鏡頭，1080p。
- 4K：正式 1080p 結果通過驗收後再升頻。

Fast 結果只用於判斷角色方向、構圖和動作可讀性，不視為最終品質基準。Standard 生成失敗時不得自動改用 Fast。

## 4. 問題區段重算

AtlasCloud Seedance 最短生成 4 秒，因此「局部重算」定義為時間區段重算，不是任意一幀 inpainting。

流程：

1. 品質檢查標出錯誤時間碼。
2. 將問題區段向前後擴展成至少 4 秒，且不得超過 15 秒。
3. 保存原鏡頭 timecode、音訊時間及前後銜接參考；前一生成區段應開啟 `return_last_frame` 並保存返回的末幀。
4. 將前一區段末幀放入下一區段的 `reference_images`，在 prompt 中明確標示為視覺銜接參考，再提交該區段的 R2V 任務。
5. 比較接縫前後的角色身份、動作、光線、攝影機與音訊。
6. 通過後再拼回完整鏡頭；未通過則保留失敗版本並顯示原因。

第一版不承諾無縫拼接任意動作。區段邊界應優先選擇動作停頓、切鏡、遮擋或低運動位置。

`return_last_frame` 只提供「軟性視覺連續性」：它可協助下一區段維持角色外觀、構圖、光線與動作方向，但 AtlasCloud R2V 目前沒有將該圖片硬性指定為下一區段首幀的契約，因此不得在 UI 或驗收規格中宣稱逐像素首尾幀鎖定。若未來要求硬性無縫接續，必須另行驗證支援首幀／末幀鎖定的生成路線或加入傳統過渡處理。

## 5. Track A：綠幕與傳統合成脊椎

Track A 為拍攝前處理、可靠換景及生成失敗時的專業合成基礎；它不是 Track B 的自動 fallback。

### 5.1 綠幕 Keying 1.0

- 綠／藍幕顏色取樣。
- 色彩距離、容差與亮度範圍。
- 溢色消除、邊緣收縮、羽化與去污染。
- Garbage matte、holdout matte。
- 半透明 alpha、時序平滑與問題影格修正。
- 原片、alpha、去背、生成、合成檢視。
- Keying 參數保存與還原。

綠幕對 Track B 的價值是減少背景干擾，讓 Seedance 更清楚讀取演員輪廓、動作、武器與道具；不要求將髮絲級 alpha 直接送入 Seedance。

### 5.2 動態背景合成

Track A 可獨立生成或上傳背景影片，再以傳統 alpha 合成保留原演員。它服務需要保留真人像素的其他場景，但不是本計畫的核心角色替換成果。

正式背景可採：

- 固定攝影機＋環境微動。
- 2.5D 深度視差。
- 完整 AI 背景影片。

第一版只支援固定或緩慢運鏡；手持和大幅運鏡需要獨立 matchmove 研究。

## 6. AtlasCloud 單一路線 Benchmark

本計畫不做跨供應商比較，只比較 AtlasCloud Seedance 2.0 Standard 與 Fast，並測試不同參考素材與 prompt 配置。

### 6.1 測試素材

至少兩組固定素材：

1. **表情組**：10 秒台詞、眼神變化、眨眼、平靜轉爆發或哭轉笑。
2. **動作組**：10 秒跳躍、轉身、快速手部動作、持武器或與替代道具互動。

兩組都應優先使用綠幕或乾淨背景，保留原始音訊。

### 6.2 測試變因

- Standard／Fast。
- 只有完整表演影片。
- 完整表演影片＋角色多視角圖片。
- 完整表演影片＋臉部近景參考影片＋角色圖片。
- 加入／不加入背景概念圖。
- 不同素材順序與 prompt 模板。
- 480p、720p；Standard 另測 1080p。

付費測試分成兩層，不得一次展開完整組合矩陣：

**最小測試集（6 組）**

- 使用一支固定表演素材。
- Standard／Fast 各測三種輸入策略：完整表演影片、完整表演影片＋角色圖片、完整表演影片＋角色圖片＋背景概念圖。
- 先用共同的短時長與解析度比較表演保真、角色替換、場景重建、成功率及成本。

**擴充測試集**

- 只有最小測試集至少一組達到 B0 門檻，且取得新一輪費用批准後才執行。
- 加入第二支動作素材、臉部近景 `video 2`、不同素材順序、prompt 模板、720p／1080p 及完整鏡頭測試。
- 每次擴充前列出新增組數、單次預估成本與最高總預算，不得以完整排列組合自動提交。

### 6.3 評分指標

- 表情與情緒保真度。
- 口型及音訊同步。
- 眼神、眨眼與頭部方向。
- 身體動作時間誤差。
- 武器及道具軌跡。
- AI 角色身份一致性。
- 服裝、妝容及配件穩定性。
- 背景、透視與攝影機一致性。
- 閃爍、破臉、手部錯誤與額外肢體。
- 任務成功率。
- 每個「可採用秒」的實際成本。
- 提交到完成的實際時間。

Benchmark 是付費生成，執行前必須取得使用者明確批准。未批准時只完成測試素材、prompt、任務契約及評分工具，不觸發供應商請求。

### 6.4 真人素材政策閘門

在任何付費 benchmark 執行前，必須確認 AtlasCloud 對 `reference_videos` 含真人臉、表演素材、身份替換及授權內容的書面政策，並保存查核日期、政策來源與適用模型。不得沿用 ARK、fal、Kling 或其他供應商的政策推論 AtlasCloud 行為。

首次付費提交同時作為 AtlasCloud 實際上傳檢測層的驗證：

1. 素材必須具備演員授權，並使用專門的最小測試素材。
2. 若請求被政策或上傳檢測拒絕，保存安全化錯誤與 request ID，立即停止 B2 及後續批次。
3. 不以改寫 prompt、切換模型、拆分請求或其他方式繞過拒絕。
4. 轉入政策確認、供應商協商或架構重估；在問題解除前維持研究狀態。

## 7. UI／UX 工作流

Track B 左側採七步引導：

1. **表演素材**：上傳綠幕／乾淨背景影片，顯示 4–15 秒限制。
2. **表演分析**：人物 ROI、pose、臉部、音訊與鏡頭檢查。
3. **AI 角色**：角色臉、髮型、身形、妝容、服裝、武器與多角度參考。
4. **AI 場景**：背景描述與背景概念圖。
5. **快速預覽**：4 秒 Fast、480p／720p。
6. **品質檢查**：原始表演與生成結果並排、時間碼問題列表。
7. **正式輸出**：Standard 720p／1080p、音訊、區段重算與升頻。

每個生成步驟必須顯示：

- 本次會保留的表演訊號。
- 本次會重新生成的內容。
- 實際模型 ID 與 AtlasCloud Provider。
- 參考圖片、影片、音訊的順序映射。
- `reference_videos` 已使用秒數、剩餘秒數，以及 `video 2` 可用／停用原因。
- 時長、解析度、音訊選項、預估費用及預估時間。
- 原始版本、Fast 預覽、Standard 版本與問題區段版本。
- 供應商錯誤原文的安全化摘要，不得顯示假成功。

UI 不顯示：

- Seed 控制。
- Camera fixed。
- Negative prompt。
- 不存在的表演／外觀數值權重。
- ARK、fal、Kling 或其他 Provider 選項。

## 8. 系統架構

### 8.1 任務路徑

Track B：

`analyze-performance → prepare-atlascloud-references → submit PLAYGROUND_VIDEO → poll AtlasCloud → quality-check → align-audio → upscale-export`

Track A：

`key-green-screen → generate／upload-background-video → composite-shot → harmonize → quality-check → export`

MVP 優先重用現有 `PLAYGROUND_VIDEO` task spine、AtlasCloud Worker、任務狀態、計價、資產與歷史，不先建立新的 `generate-character` task type。若現有 payload 無法保存領域資料，再提出明確的契約變更與測試，不以 UI 假任務取代後端狀態。

### 8.2 非破壞性資料

每個專案保存：

- 原始表演影片 asset ID。
- 原始音訊及時間碼。
- 人物 ROI、pose、face landmark 與分析版本。
- 臉部近景參考影片 asset ID。
- AI 角色多角度圖片、服裝、妝容、武器與版本。
- 背景概念圖與版本。
- AtlasCloud 參考素材順序映射。
- Prompt 模板、實際 prompt、模型 ID、時長、解析度與音訊設定。
- AtlasCloud request ID、狀態、錯誤、延遲、用量及費用。
- Fast、Standard、區段重算與最終輸出 asset ID。
- 品質檢查時間碼及處置結果。
- 演員表演授權紀錄。

所有生成結果建立新版本，不覆蓋原始影片、角色設定、背景概念圖或已核准成果。

### 8.3 顯式失敗原則

- AtlasCloud key 未設定：啟動或提交時顯式失敗。
- 模型未啟用：不可提交，也不切換到其他模型。
- 參考圖片超過 9 張：提交前顯式失敗。
- 參考影片超過 3 支或總長超過 15 秒：提交前顯式失敗。
- Fast 要求 1080p：提交前顯式失敗。
- 時長小於 4 秒或大於 15 秒：提交前顯式失敗。
- UI 傳入 seed、camera_fixed、negative_prompt 或權重欄位：契約驗證失敗，不靜默刪除。
- AtlasCloud 任務失敗／逾時：保存 request ID 與錯誤狀態，不建立假結果。

## 9. 實作階段

### Phase 0：命名、入口與契約修正

- Live Composite 改為「AI 實拍重製」。
- Track B 設為主入口。
- 「AI 生成背景」改為「背景概念圖」。
- 只顯示 AtlasCloud Seedance 2.0 Fast／Standard。
- 建立素材順序映射與能力 gate。
- 移除不存在的權重、seed、camera fixed、negative prompt 控制。

驗收：使用者能理解真人只提供表演，最終人物與場景會被重新生成；UI 不出現無法執行的模型或參數。

### Phase 1：B0 Benchmark 準備與執行

- 建立兩組標準測試素材。
- 建立 AtlasCloud Standard／Fast prompt 模板。
- 建立參考素材組合矩陣。
- 建立表情、口型、動作與一致性評分表。
- 完成 AtlasCloud 真人參考影片政策查核與首次上傳檢測方案。
- 先執行 6 組最小測試集；達標並重新取得預算批准後才展開擴充測試集。
- 驗證計價與任務保存。
- 取得付費測試批准後執行。

驗收：確認至少一組 AtlasCloud Seedance 配置能辨識原表演的情緒轉折、口型節奏及主要動作；若不能，停止 B1，不以 UI 包裝成可用功能。

### Phase 2：Track B MVP

- 上傳與表演分析。
- Face Landmarker 與臉部參考影片產生。
- AI 角色與場景參考管理。
- 4 秒 Fast 預覽。
- Standard 完整鏡頭生成。
- 原片／生成片並排比較。
- 品質問題時間碼。
- 4 秒以上區段重算。
- 原始音訊保留及輸出。

驗收：10 秒、單人、綠幕／乾淨背景影片能生成指定 AI 角色與場景；盲測可辨識輸入的情緒轉折、口型節奏、眼神及主要身體動作。

### Phase 3：Track A Keying 與動態背景

- 綠幕 Keying 1.0。
- 溢色、邊緣與時序修正。
- 背景影片上傳／生成。
- 傳統 alpha 合成、光影與音訊輸出。

此階段與 Track B 共用素材和播放器，但不得把 Track A 輸出當作 Track B 的自動 fallback。

### Phase 4：產品化與批次

- 角色庫與跨鏡頭角色版本。
- 分鏡 shot list 批次生成。
- Fast／Standard／區段版本比較。
- 可採用率、每採用秒成本及生成時間報告。
- 授權欄位及專案權限。
- 1080p 通過後升頻 4K。

## 10. 測試與驗收

至少包含：

- 單元測試：素材映射、時長、解析度、能力 gate、prompt 組裝及序列化。
- 契約測試：只允許 AtlasCloud Seedance R2V；禁止 ARK、fal、Kling 和未知 Provider。
- Worker 測試：`reference_images`、`reference_videos`、`reference_audios` 的具體值與順序。
- 費用測試：Fast／Standard 使用正式 pricing catalog，不在 UI 寫死費用。
- 整合測試：上傳、提交、輪詢、成功／失敗／逾時、保存、刷新後還原及輸出。
- 視覺驗收：固定時間碼比較表情、口型、眼神、動作、角色、服裝與場景。
- 回歸測試：現有 Live Composite 專案、Canvas handoff、素材庫與 Playground 不被破壞。

付費供應商 E2E 不得在一般測試或部署中自動觸發。

## 11. 第一個交付里程碑

> 上傳一段 10 秒、單人、綠幕或乾淨背景的真人表演影片；擷取人物 ROI、pose、臉部表演與原始音訊；綁定 AI 角色多角度圖片、服裝／妝容／武器參考及背景概念圖；先以 AtlasCloud Seedance 2.0 Fast 生成 4 秒預覽，再以 AtlasCloud Seedance 2.0 Standard 生成完整 1080p 鏡頭。輸出人物身份與場景均可完全改變，但情緒轉折、眼神、口型節奏、身體動作與鏡頭時間必須可辨識地保留；問題以至少 4 秒區段重新生成，最終保留原始音訊並可升頻至 4K。

若 B0 benchmark 無法證明上述表演保真度，MVP 必須停在研究狀態，不得對外宣稱已具備演員替換能力。

## 12. 並行開發邊界

若由多個 Agent 並行：

- Track B 負責人：表演分析、AtlasCloud reference 組裝、生成工作流與品質比較。
- Track A 負責人：綠幕 keying、背景影片、Canvas 合成與 harmonization。
- 共用契約只由一位負責人修改：Live Composite types、專案 timeline、Playground payload、Task type／route catalog。
- 不允許兩條工作同時修改 `LiveCompositeClient.tsx`；應先拆出 workflow controller 與獨立 panels。
- 每個切片各自完成測試後，依「共用契約 → Track B → Track A → 完整 regression」順序整合。

本文件只定義計畫，不授權新增 Provider、執行付費 benchmark、提交、推送或部署。
