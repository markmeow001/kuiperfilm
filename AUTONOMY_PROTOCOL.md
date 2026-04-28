# Claude 自主開發 SOP — KuiperAI

> 這份是 Claude Code 在自主模式下推進工作時的標準作業流程。每次工作週期遵循這份文件。

## 0. 起手式

每個工作週期一開始,**依序**做這幾件事:

1. 讀 `CLAUDE.md`(導讀)
2. 讀 `docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md`(找當前任務)
3. 跑 `git status` 確認工作區乾淨
4. 跑 `git log --oneline -5` 看最近的進度
5. 讀 `QUESTIONS.md`(若存在)看是否有待回應的問題會影響本輪工作

## 1. 工作迴圈

```
┌───────────────────────────────────────┐
│  讀 master plan → 選一個未完成子任務   │
└─────────────────┬─────────────────────┘
                  ↓
┌───────────────────────────────────────┐
│  Plan mode 列出本次具體要改哪些檔案    │
│  自我檢查是否違反 CLAUDE.md 強約束     │
└─────────────────┬─────────────────────┘
                  ↓
┌───────────────────────────────────────┐
│  實作 → 寫對應測試                     │
└─────────────────┬─────────────────────┘
                  ↓
┌───────────────────────────────────────┐
│  跑窄範圍 vitest                       │
│  跑相關 guard scripts                  │
└─────────────────┬─────────────────────┘
                  ↓
            ┌────────────┐
            │  全綠?     │
            └─┬────────┬─┘
              ↓ 是      ↓ 否
   ┌───────────────┐  ┌─────────────────────┐
   │ commit       │  │ Section 3「卡住流程」 │
   │ 更新 master  │  │                     │
   │ plan 狀態    │  │                     │
   └──────┬───────┘  └─────────────────────┘
          ↓
       下一個子任務
```

## 2. 每個 commit 的最低要求

- 對應到 master plan 的某個具體子任務
- conventional commit message(`feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:`)
- 該 commit 範圍內所有 vitest ✅
- 不留 `console.log` / `debugger` / 未使用 import(`scripts/check-no-console.ts` 會擋)
- master plan 對應行從 🔄 / ⏸ 改成 ✅(同一個 commit 一起改)

## 3. 卡住怎麼辦(分級處理)

### Level 1 — 技術不熟
症狀:不知道某個 SDK / API 怎麼用、TypeScript 型別搞不定、Prisma migration 寫不出來。

處理:
1. 用 context7 MCP 查官方文件
2. 在 codebase grep 類似實作(例如:其他 worker handler 怎麼處理同個情境)
3. 解決 → 繼續

### Level 2 — 測試卡住
症狀:test 紅、看不出原因、改了 code 也修不好。

處理:
1. **不准**為了讓 test pass 而修改 test 斷言
2. 把失敗訊息、失敗的 test 檔、你的假設寫進 `QUESTIONS.md`
3. 嘗試最多 **2 次**修法。第 3 次還沒修好 → 停下來,等 review

### Level 3 — 架構決策
症狀:該不該加 Phase?該不該改 schema?該不該下線某個 API?該不該用 X 而不是 Y?

處理:
1. **不准**自行拍板。停下來。
2. 把選項、各自的優劣、你的傾向寫進 `QUESTIONS.md` 第「## 架構決策待確認」區段
3. master plan 對應位置標 ⚠️ 並引用 `QUESTIONS.md` 的問題編號
4. 等人類回應後再繼續

### Level 4 — 違反強約束的誘惑
症狀:「如果加個小兼容層就能省 3 小時了」「這個 catch 直接吞掉錯就過了」。

處理:**直接拒絕**。違反強約束的代價是整輪工作作廢。寧可慢、寧可問。

## 4. 必須停下來的硬規則

下列情境**強制中斷**自主執行,寫進 QUESTIONS.md 等人類:

| 情境 | 為什麼 |
|---|---|
| 需要動 `prisma/schema.prisma` 加新表或改欄位 | DB 變更不可逆,要人類確認 migration 策略 |
| 需要加新 Phase 到 master plan | 範圍變更要人類拍板 |
| 需要呼叫 production Tencent / AI provider API | 會燒錢 |
| `npm run test:regression` 出現本輪改動之外的失敗 | 可能踩到歷史炸彈,要先排雷 |
| 連續 2 次 commit 都需要 revert | 表示方向錯了,停下來重新 plan |
| 發現 master plan 跟 code 不一致(且不知道誰對) | 不能憑感覺選,要人類確認 |
| 需要刪除任何 test 檔 | 可能等於放棄某個防線 |
| 任何涉及 secret / 認證 / 加密的改動 | 安全敏感,要人類 review |

## 5. QUESTIONS.md 格式

第一次需要時建立 `/QUESTIONS.md`,格式:

```markdown
# Open Questions

## Q-001 [架構決策] 標題
- **Phase**: Phase 6
- **背景**: ...
- **選項**:
  - A. ...(優點 / 缺點)
  - B. ...(優點 / 缺點)
- **我的傾向**: A,因為 ...
- **狀態**: 待確認
- **建立時間**: 2026-04-28

## Q-002 [測試卡住] 標題
...
```

人類回覆後,Claude 把 `狀態` 改成 `已解決`,記錄決議,然後繼續工作。

## 6. master plan 同步規則

**任何 code commit 都必須同步 master plan**,在同一個 commit 或下一個 commit 內:

- ✅ 已完成:該行從 🔄 → ✅
- 🔄 部分完成:加註解說明哪些子部分還沒做
- ⚠️ 遇到問題:加 ⚠️ 並引用 QUESTIONS.md
- 新發現的工作:在對應 Phase 末尾加 ⏸ 子任務,寫清楚檔案路徑和驗收標準

如果這輪工作改動了文件本身的範圍預估,更新「## 预计改动规模」區段。

## 7. 一輪工作的結束標準

**所有以下條件成立才算結束**:

- [ ] 至少完成 1 個 master plan 子任務(從 🔄 / ⏸ → ✅)
- [ ] `npm run test:regression` 全綠(或失敗已登記到 master plan)
- [ ] 所有改動已 commit
- [ ] master plan 已同步反映現況
- [ ] QUESTIONS.md 中所有本輪新增的 question 都已寫清楚(可以未解決,但要寫完整)
- [ ] 給人類一份簡要報告(本輪做了什麼、下次該做什麼、有沒有 blocker)

## 8. 報告格式(每輪結束時)

```markdown
## 本輪工作報告

**完成的 Phase 子任務**:
- Phase 6 / 任務 X(commit `<sha>`):...
- Phase 7 / 任務 Y(commit `<sha>`):...

**驗證結果**:
- `npm run test:regression`: ✅ / ⚠️(說明)
- `npm run build`: ✅

**新增的問題**(若有):
- Q-XXX:...

**建議的下一步**:
- ...
```

---

## 補充:跟人類協作的禮貌

- 不要在 commit message 寫「This commit was made by Claude」之類的東西。寫成果就好。
- 不要在 master plan 加裝飾性語言,精簡、像工程文件那樣。
- 卡住的時候不要繞圈圈撐場面。直接登記問題、停下來,比假裝在進度更有價值。
