---
name: "source-command-verify"
description: "跑完整回歸驗證"
---

# source-command-verify

Use this skill when the user asks to run the migrated source command `verify`.

## Command Template

執行下列驗證流程,任一步失敗就停下來分析,不要跳過:

```bash
# 1. Lint
npm run lint

# 2. TypeScript / build
npm run build

# 3. Guards(架構不變量)
npm run test:guards
npm run check:config-center-guards

# 4. 完整回歸
npm run test:regression
```

如果某個 test 過不了:
1. 先確認失敗是不是這次改動造成的
2. 如果是 → 修(但**不准**改 test 斷言來繞過,改 mock / fixture 可以)
3. 如果不是(歷史失敗)→ 寫進 master plan 的「⚠️ 当前问题登记」區段,不要假裝沒看見

全部 ✅ 才能宣稱完成。
