# 三軌收斂計畫 — Track Consolidation（2026-06-12）

> 背景：user 發現待辦（PR-D2/D3/D4、PR #6、Q-004/Phase 9.1）看不出「在修什麼」。
> 根因分析後結論：平台同時有三條軌道並行、各自有 Phase 編號、互不對應。
> 本文件是收斂後的單一執行順序，取代 PR-D 編號系統。

## 產品目標（北極星）

AI 短劇製作平台，未來多人使用 + 商業化：

- 核心管線：劇本分析 → 角色/場景/道具分析生圖 → Seedance 分段分鏡 → 生視頻
- 附加：獨立文生圖 / 圖生視頻（Playground）
- 策略：**先把新框架做好，再把 V2 遷移過去**

## 三條軌道（收斂前）

| 軌道 | 計畫文件 | 進度 |
|---|---|---|
| ① 後端 Runtime 統一 | `docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md` | Phase 6/7/8/10 半完成；**Phase 9 全量遷移擱置** |
| ② 公開上線重設計 | `REDESIGN_PLAN.md` + `IMPL_PREP/` | Phase 0 ✅、Phase 2.5 Skill ✅；**Phase 1 / 1.5 未動** |
| ③ Storyboard layout 實驗 | mockup 13（無正式計畫） | /v3 /v4 淘汰、/v5 PR-D1 已 ship（PR #7） |

## 判定結果

| 項目 | 判定 | 理由 |
|---|---|---|
| PR #6（A1+A2 Playground billing） | ✅ 必要，馬上合 | 堵 6/02 燒錢沒圖漏財洞；sidecar 設計，Phase 9.1 可機械替換 |
| PR #7（D1 /v5 唯讀 preview） | ⚠️ 可合，定性為草圖 | +382 行 0 動現有 surface；但**未用 Phase 0 v2 components**，違反 Phase 0 DoD —— 它是 layout 參考，不是新框架的一部分 |
| PR-D2 / D3（@chip + Tiptap 編輯器） | ❌ 現在不做 | 蓋在 V2 資料層 + preview 路徑上；Phase 1.5A schema migration 後全要重寫；功能歸併進 Phase 1.5D-bis |
| PR-D4（07-pre-generation 頁） | ⚠️ 功能必要，改名 | 它就是 Phase 1.5E，要做在正式流程上，不做在 /v5 |
| Q-004 + Phase 9.1 | ✅ 必要 | 多人 + 商業化要求所有生成走同一條 Task spine |
| /v3 /v4 preview 路徑 | 🗑️ 刪除 | layout 已被 mockup 13 淘汰，無外部引用（已 grep 驗證） |

## 根因（為什麼會亂）

1. **沒有單一 spine** — PR-A/PR-D 編號是 session 臨時發明，跟兩套 Phase 編號互不對應。
2. **最高風險核心被繞開** — REDESIGN_PLAN 自標最高風險 = Phase 1（拆 2,994 行 monolith）+ 1.5C（worker 重構），連續多個 session 都在做外圍。
3. **Preview 路徑開始長真功能** — v5 若繼續加 mutation/編輯器，會變平行宇宙，遷移成本翻倍。

## 收斂後執行順序（單一佇列）

```
立即（本週）
 1. 合併 + deploy PR #6（堵漏財）、PR #7（無害，留作視覺參考）
 2. 刪 /v3 /v4；凍結 /v5（不再加功能）          ← 本 commit
 3. PR-D2/D3/D4 從待辦移除，歸併進 Phase 1.5D-bis / 1.5E

地基期（2-3 週）★ 新框架真正本體
 4. ✅ Phase 1.5A schema migration（PR #8 merged 2026-06-12）
 5. Phase 1.5C worker routing 重構 → R2V-first 4-mode（最高風險，legacy_path flag 並行）
    - ✅ slice 1：duration window module + 9 建立點 panelGenerationMode 蓋章（PR #9 merged）
    - ✅ slice 2（1.5B prompts）：發現 generic detail 已是 R2V-first（5-6 月重構成果），
         不造重複 prompt；只更新 router 註解+測試 pin 住。motion line generator 併入 slice 3。
    - ✅ slice 3a：consolidate Seedance-family dispatch params（seedanceFamilyParams 單一choke point，PR #12 merged）
    - 🔁 slice 3 **範圍收斂（2026-06-13 user 拍板）**：原「per-panel 4-mode worker routing +
         NP_AGENT_MOTION_LINE_GENERATOR + legacy_path 新舊並行」**取消**。改成「主流程 R2V-only」：
         * 主管線只走 R2V（分析→自動切組→帶每段分鏡 prompt→Seedance 生視頻），對齊北極星
           「核心管線 = Seedance R2V；附加 = Playground 文生圖/圖生視頻」。
         * **不做** per-panel generationMode 路由 / motion-line generator / t2i→i2v worker path /
           legacy_path flag → 最高風險的那塊整個移除（schema 的 keyframeUrl/motionLine/… 欄位留著當 nullable，無消費者，無害）。
         * t2i-storyboard 選擇器**保留**(預設 R2V)；它就是現存 prod 流程(文生圖→i2v)，留著零成本、不逼出 per-panel 路由。要極致關鍵幀控制的進階使用走 Playground。
         * ✅ **對白為主決定秒數**：Seedance + ARK composite path 接上 buildDialogueDrivenDurations
           （fal/atlascloud/Kling b-path 早已接），對白驅動 composite 總時長,靜默組才退回 panel-count baseline。
       ⏳ 待辦：Playground 圖生(FREEDOM)在有 API key 的環境實測一次(本沙箱無 key 跑不了)。
 6. Phase 9.1：Playground + 長尾任務收進 createRun/Task（多人+計費統一 spine）

框架期（2 週）
 7. Phase 1 拆 monolith + 套 tokens-v2（先重構後改皮，分兩 PR）
 8. Phase 1.5D-bis 雙視圖敘事編輯（= 原 D2/D3，蓋在新 schema 上）
 9. Phase 1.5E pre-flight 頁（= 原 D4）

商業化期（2-3 週）
10. Phase 2 公開 funnel + Stripe 接通（目前 0 程式碼，最大未啟動缺口）
11. Phase 3 管理頁 + RBAC 公開化
12. Phase 5 i18n parity + QA ≥9.5 + soft launch
```

## 給並行 session 的約定

- **不要再往 /v5 加功能**（凍結）；敘事編輯請等 Phase 1.5D-bis。
- 新工作一律對應到本文件的佇列編號，不再發明新的 PR-X 編號。
- 產品缺口備忘：Playground FREEDOM 生圖失敗待查（已靜態診斷，管線正常，待 errorMessage —— 見 QUESTIONS.md Q-005）。
  ~~props LLM 抽取（Stage 2b）零進度~~ → **已完成**：analyze-novel.ts 有獨立 `analyze_props` LLM 步驟，道具為 first-class asset（2026-06-13 核實）。
