---
name: "source-command-sync-master-plan"
description: "把這次工作的進度同步寫回 master plan"
---

# source-command-sync-master-plan

Use this skill when the user asks to run the migrated source command `sync-master-plan`.

## Command Template

更新 `docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md`,讓它反映 codebase 的真實狀態:

1. 跑 `git log --since="..." --oneline` 列出本輪所有 commit
2. 對每個 commit,在 master plan 找到對應的 Phase / 任務
3. 把已完成的子任務從 🔄 改成 ✅
4. 把新發現需要做但還沒做的東西,新增為 ⏸ 或 🔄 子任務(寫清楚檔案路徑和要求)
5. 更新「## 预计改动规模」區段的「当前已改动文件」數字
6. 把這輪驗證指令的執行紀錄加到「## 当前验证执行记录」
7. 沒解決的問題寫進「## 当前问题登记」(用 ⚠️ 標記)

更新完後 commit:
```
docs: sync master plan with phase X progress
```

**規則**:master plan 必須跟 codebase 狀態完全一致。如果 master plan 標 ✅ 但 code 沒做或 test 沒過,那是嚴重違規。
