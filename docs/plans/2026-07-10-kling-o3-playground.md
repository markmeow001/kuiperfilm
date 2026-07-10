# Kling O3 R2V（具名 elements）接入 Playground — 設計 spec

> 2026-07-10 · user 已批准 A–E 段 · branch `feat/kling-o3-playground`（基於 feature/phase-11）

## 目標

Playground 新增 AtlasCloud 的 Kling Video O3（std + pro）reference-to-video：
**綁定具名主體（人物/場景，≤6 個，各 1–4 張圖）+ 文字 prompt 生影片**。

## A. 範圍

- 接：`kwaivgi/kling-video-o3-std/reference-to-video`、`kwaivgi/kling-video-o3-pro/reference-to-video`
  （**正式付費 slug，不帶 `-test`** — schema default 的 `-test` 是 AtlasCloud 沙箱，Seedance schema 無此後綴可證非通病）
- 計費：走用戶 AtlasCloud API key（與 Seedance 同一把、同 `/model/generateVideo` 端點）。O3 Pro R2V 約 $0.095/run。
  playground quote 對無 pricing entry 模型 fail-open 回 0 — 先不加 pricing entry，跑通後再拍板。
- 不接（這輪）：video_refer 型 element、multi_shot/multi_prompt、video-edit(V2V)、主分鏡 pipeline。

## B. 架構

```
Playground UI（主體綁定區 0/6）
  → POST /api/playground/run  payload 加 elements: [{name, imageKeys[]}]
  → submitTask(projectId='playground', payload)
  → worker handlePlaygroundVideoTask：簽名 element 圖 → 名字→token 替換 → generateVideo()
  → factory 'atlascloud' → AtlasCloudSeedanceVideoGenerator 內部 Kling O3 分支
  → POST /model/generateVideo（同端點、同 key、同 queryAtlasCloudTaskStatus 輪詢）
```

- `ATLASCLOUD_MODEL_MAP` 加 `kling-o3-std-r2v` / `kling-o3-pro-r2v`。
- `isKlingO3Slug()` 分流 body builder：Kling 分支送 `prompt / elements / images / aspect_ratio / duration / sound`；
  **不送** Seedance 的 `ratio / reference_images / generate_audio / watermark / return_last_frame / resolution`。
- Catalog：`api-config/types.ts` 加 2 個 video entry（provider `atlascloud`）；playground picker 走 useUserModels 過濾，需 admin 啟用。

## C. elements → token 綁定

- Kling API element 形狀：`{element_name, reference_type:'image_refer', frontal_image, refer_images[]}`，
  prompt 以 `<<<element_N>>>`（1-based，依 elements 陣列順序）引用。API 無人物/場景分類欄位 — 分類只是 UI 命名。
- UI：「主體綁定（0/6）」區，每主體 = 名字（必填、不重複）+ 1–4 張圖（第 1 張 = frontal_image，其餘 = refer_images）。沿用 upload-reference 上傳。
- 用戶在 prompt 直接打名字；**伺服器端**（worker，純函數 `src/lib/playground/element-tokens.ts`）把名字替換成 token：
  全字匹配、長名優先（避免 `Vera` 吃掉 `VeraMom`）、中文名直接子串匹配。
- 有 element 但 prompt 沒提到任何名字 → 前端送出前軟提示（不擋）。

## D. 驗證 / 錯誤處理

- route：elements ≤6、name 非空不重複、imageKeys 每個 1–4、沿用 key-prefix 安全檢查。
- generator 守衛只擋 schema 真實限制（duration 3–15、images ≤7/有 video ≤4、elements ≤6），
  其餘讓 AtlasCloud 原始錯誤透出（bug #1 教訓：不做比 schema 嚴的守衛）。

## E. 測試（TDD）

- `tests/unit/playground/element-tokens.test.ts`：純函數（全字/長名優先/中文/未命中不動）。
- `tests/unit/generators/atlascloud-kling-o3.test.ts`：mock fetch —
  ① std/pro slug 正確且不帶 `-test` ② elements 組裝（frontal=第1張）③ 不送 Seedance 欄位 ④ 上限守衛。
- route 驗證測試 + 既有 generators 套件迴歸。

## 決策記錄

| 決策 | 選擇 |
|---|---|
| 落點 | Playground（不動主 pipeline） |
| 綁定深度 | 具名 elements（真綁定） |
| prompt 引用 | 打名字，自動換 token |
| 變體 | std + pro 都接 |
| 付費確認 | 非免費版；user API key per-run 計費 |
