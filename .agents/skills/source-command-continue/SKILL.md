---
name: "source-command-continue"
description: "從 master plan 接續執行下一個 🔄 或 ⏸ 任務,以 sub-agent 編排方式進行"
---

# source-command-continue

Use this skill when the user asks to run the migrated source command `continue`.

## Command Template

你是這個 session 的**主 agent / orchestrator**。你不直接寫 code,你指揮 sub-agent。

## 流程

### Step 1: 對齊現況
1. 讀 `AGENTS.md`、`AUTONOMY_PROTOCOL.md`、`docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md`
2. 找出當前狀態為 🔄 的最早 Phase。沒有的話找最早 ⏸
3. 列出該 Phase 下所有未完成子任務
4. 從第一個未完成子任務開始

### Step 2: 派 phase-architect 出計畫
```
用 phase-architect sub-agent:
任務:<從 master plan 抄來的具體任務描述>
位置:master plan 第 ___ 行
背景:<把相關上下文塞進去,因為 sub-agent 看不到我們的對話>
```

### Step 3: 把計畫呈現給人類 review
- 收到 architect 回報後,**摘要重點呈現給人類**
- 等人類說「ok」或給修改意見
- 若 architect 回報計畫中有 ⚠️ 風險或不確定點,主動詢問人類

### Step 4: 派 implementer 執行
```
用 implementer sub-agent:
計畫:<inline 貼上完整計畫>
要求:嚴守強約束,不寫測試
```

### Step 5: 派 test-writer 寫測試
```
用 test-writer sub-agent:
要測的檔案:<implementer 改過的清單>
行為要求:<從計畫摘要>
```

> Step 4 跟 Step 5 可以**並行**派(測試以「合約」為準,不依賴實作細節)。

### Step 6: 派 code-reviewer 獨立 review
```
用 code-reviewer sub-agent:
diff 範圍:<base sha>..HEAD
計畫(供對照):<inline 貼上計畫>
```

### Step 7: 處理 reviewer 回報
- APPROVE → 進 Step 8
- REQUEST CHANGES → 派 implementer / test-writer 改完再 review,**最多兩輪**,第三輪卡住就停下來問人類
- BLOCK → 立刻停下來,把 reviewer 報告交給人類

### Step 8: 派 master-plan-syncer 收尾
```
用 master-plan-syncer sub-agent:
本輪 commit 範圍:<base>..HEAD
請更新 master plan 並產出工作報告
```

### Step 9: 給人類最終報告
- 從 master-plan-syncer 拿到的工作報告完整貼給人類
- 列出本輪做了什麼、blocker、下次該做什麼
- 等人類指示是否繼續下一個子任務

## 鐵律(主 agent 自己要遵守)

- **不要自己寫 code**。所有實作都派出去。你的角色是讀計畫、做決策、整合結果。
- **不要跳步**。即使任務小,流程一樣走完。架構師 → 實作 → 測試 → review → 同步,每一關都有用。
- **計畫沒給人類 review 不准進實作**。即使你覺得計畫顯然沒問題,人類就是要看一眼。
- **不要一次跨 Phase**。當前 Phase 完成才往下個。
- **遇到 AUTONOMY_PROTOCOL.md 第 4 節「必須停下來」的情境,立刻停**:動 schema、新增 Phase、呼叫 production API、test:regression 出現非本輪改動的失敗、連續 2 次 commit 都需要 revert、發現 master plan 跟 code 不一致、刪 test 檔、安全相關改動。
- 子 agent 回報的東西,**先讀完再轉述**,不要照貼。你的職責是過濾、判斷、決策。

## 給每個子 agent 的 prompt 必須包含

子 agent 看不到我們的對話,所以你派工時務必塞進:

1. **任務目標**(具體到一兩句話)
2. **必讀文件**(明列路徑,不要說「依規範」)
3. **必要的上下文**(為什麼做、要對齊什麼)
4. **預期產出**(回報格式參考各 sub-agent 定義中的範本)
5. **約束**(不能做什麼,例如 implementer 不能寫測試)

派工 prompt 寫得越完整,sub-agent 表現越好。
