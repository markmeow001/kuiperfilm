---
name: "source-command-phase-status"
description: "報告當前 Phase 狀態與下一步"
---

# source-command-phase-status

Use this skill when the user asks to run the migrated source command `phase-status`.

## Command Template

不要動 code,只做報告:

1. 讀 `docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md`,列出所有 Phase 狀態(✅ / 🔄 / ⏸ / ⚠️)
2. 對每個 🔄 Phase,列出已完成 vs 未完成的子任務
3. 列出「## 当前问题登记」中所有未解決的 ⚠️
4. 跑 `git status` 看是否有未 commit 的東西
5. 跑 `git log --oneline -10` 看最近 10 個 commit
6. 讀 `QUESTIONS.md`(若存在)列未答覆的問題

最後給出建議:**接下來最合理的下一步是什麼,為什麼**。

不要動任何檔案。
