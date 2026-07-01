# 自主開發 Loop 規格（2026-07-01）

> 把 `AUTONOMY_PROTOCOL.md` 的手動工作迴圈，升級成一個**有界、會自停、內建對抗式 review** 的
> 自主 loop。對應 Loop Engineering 三要素：**Loop（決定做什麼）/ Harness（怎麼做+怎麼驗）/
> Sandbox（邊界）**。目標是自動清掉「機械可驗證」那層工作，把人只留在「決策/品味/花錢」的點上。

## 為什麼這專案適合（已有的 harness）

- **可信完成訊號**：`test:guards`（現全綠）+ `tsc` baseline + 窄 vitest + `file-line-count`。
  = loop 的 verifier。多數 agent loop 死在「沒有可信 done 訊號」，這裡有。
- **持久化 backlog**：`docs/plans/2026-06-12-track-consolidation.md` 收斂佇列 + 各 plan doc。
- **Sandbox 規則**：`CLAUDE.md` 強約束 + `AUTONOMY_PROTOCOL.md` §4 硬停清單 + `QUESTIONS.md` gate。

## 為什麼「不能自己把整個專案做完」

1. **綠 ≠ 對**：guards 覆蓋 type/契約/架構不變量，**不覆蓋整合縫隙 / 真機行為 / 視覺品質**。
   實證：Phase 9.1 單元測試全綠卻藏 CRITICAL（queues.ts 漏路由，每個 playground job 會秒 fail），
   是 code review 抓到、不是 guards。→ **每個 iteration 必須內建對抗式 review**，不能只信 guards。
2. **有些決策是 user 的**：schema 變更、燒錢打 prod API、Stripe/商業化時程、10 條 open QUESTIONS、
   產品/UX 取捨。loop **必須停在門口**——這是設計，不是缺陷。

## Loop 規格（有界，非 while-true）

```
每個 iteration：
1. SELECT   讀收斂佇列/backlog，挑「下一個機械可驗證且不需 user 拍板」的項目。
            跳過標記 🛑(schema/錢/決策/品味) 的。
2. PLAN     列要改哪些檔 + 自查是否踩 CLAUDE.md 強約束 / AUTONOMY §4 硬規則。
3. TDD      先寫失敗測試(可行時) → 實作 → tsc + 窄 vitest + 相關 guard。
4. REVIEW★  對抗式 code-review 子 agent：專找整合縫、行為漂移、被 guards 漏掉的。
5. GATE     review 有 CRITICAL/HIGH → 修，回 3。乾淨 → commit（conventional）+ 更新 plan 狀態。
6. STOP?    撞硬規則 → 寫 QUESTIONS.md、停該項、跳下一個。
迴圈直到：可自主項清空 / 連續 N 項撞決策門 / token budget 到頂
→ 產總結報告，等 user 回這批決策。
```

### 硬停條件（承接 AUTONOMY §4，loop 內強制）
- 需改 `prisma/schema.prisma`、需打 prod Tencent/AI API、需刪測試檔、任何 secret/認證/加密改動。
- 連續 2 次 commit 需 revert → 停重 plan。
- code review 連兩輪仍 CRITICAL → 停。
- **禁止改測試斷言來讓測試過**（改 fixture/mock 可以）。

### 反 reward-hacking
- 完成訊號 = guards+tsc+**review 通過**，不是單看「測試綠」。
- 靜默縮 scope / top-N 截斷 → 必須 `log` 出來，不准當「全做完」。

### 驅動機制（手上就有）
- `/loop`（自我配速）跑迴圈；`Workflow` 可一次 fan-out 多面向 review；`ScheduleWakeup` 排下次。

## 可自主 vs 必停（套目前 backlog）

| 可自主（loop 吃）| 必停等 user |
|---|---|
| Phase 1 剩餘拆分 / C PanelLike 統一 / D Strip thumb / E smoke test / 長尾 llm-client 收口 | #10 Stripe（金流、時程）/ schema 變更 / 10 條 QUESTIONS / 真機·視覺品質驗收 |

## 第一次試跑：C — PanelLike 三方統一

- 目標：`storyboard-client-helpers.ts` / `V2GroupsLayout.tsx` / `GroupCard.tsx` 三份平行
  `PanelLike` 收斂成單一 exported 型別。
- **手法（記憶提醒）**：two-direction lift——先把各 local 版多出來的欄位（如 GroupCard 的
  voiceLines）併進 helpers 的 union，再讓三方 import helpers；**不可單向覆蓋 helpers**（會掉欄位）。
- 完成訊號：tsc 維持 baseline、storyboard 相關 vitest 綠、code-review 乾淨。
- 選它當試跑：明確 done 訊號、低風險、2-3hr、純技術債、不需 user 拍板。
