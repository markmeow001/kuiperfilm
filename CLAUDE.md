# KuiperAI — Claude Code 專案導讀

> 這份文件是 Claude Code 每次啟動時會自動載入的「專案憲法」。每次進來都先讀完,再動手。

## 1. 這個專案是什麼

KuiperAI 是一個**短劇生成工具**:使用者透過網頁輸入劇本(或小說) → AI 產生分鏡 → 渲染成影片。整合騰訊雲 (COS / VOD)、多家 AI 模型供應商 (OpenAI / Google / OpenRouter / Fal),以 Remotion 輸出影片。

技術棧:
- Next.js 15 + React 19 + TypeScript (App Router)
- Prisma + MySQL (主資料庫)
- BullMQ + ioredis (任務佇列)
- LangGraph + AI SDK + MySQL Checkpointer (統一 AI runtime,**進行中重構**)
- Remotion (影片渲染)
- next-intl (i18n,prompt 有 `.en.txt` / `.zh.txt` 雙版本)
- Vitest (測試)

## 2. 必讀文件(順序很重要)

每次工作開始前,**依序讀完這幾份**:

1. **`docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md`** ← 這是 single source of truth。專案目前的所有重構工作都依這份文件推進。每次改完 code 必須回頭更新這份文件的 Phase 狀態。
2. **`docs/ai-runtime/README.md`** + 其下 `01-08` 八份文件 → 架構/資料模型/事件協議/API 契約/遷移手冊/運維/測試/差距
3. **`agent/testing.md`** → 測試規範(行為斷言、mock 規則、防假綠燈)
4. **`AUTONOMY_PROTOCOL.md`** → 你自主開發時的 SOP(卡住怎麼辦、怎麼登記問題、什麼時候必須停下來)

## 3. 強約束(不可違反)

這些是 master plan 已寫死的鐵則,違反等於整輪工作作廢:

- **不打補丁**。需要的是乾淨架構,不是縫縫補補。
- **不做兼容層**。新舊雙跑會永遠回不去單一架構。
- **不隱式回退**。錯誤要顯式失敗,絕不靜默吞掉。
- **不靜默吞錯**。所有 catch 必須 log + 顯式處理。
- **State 只存引用**。大文本正文走 DB refs,不直接塞進 state。
- **事件必須有 seq**。`graph_events.seq` 單調遞增,前端發現跳號要補拉 `afterSeq`。
- **AI route 不准旁路 worker**。所有 AI 任務必須走 `createRun` → worker handler → run-runtime。
- **不准呼叫 llm-client 直連**。AI 必須走 `src/lib/ai-runtime/`(Phase 6 中)。
- **不准 hardcode model capabilities**。透過 capability catalog。
- **不准做 provider 猜測**。明確指定。
- **檔案行數有上限**(`scripts/guards/file-line-count-guard.mjs` 會擋)。

## 4. Guard 系統(自動防線)

專案有 30+ 個 guard script 在 `scripts/guards/` 自動檢查不變量。完成任何工作前**必須**:

```bash
npm run test:regression
```

這個指令會跑:
- `test:guards` — API handler / direct LLM call / coverage guards
- `test:unit:all` — 全部單元測試
- `test:billing:integration` — 計費整合測試
- `test:integration:api` — API 路由
- `test:integration:chain` — queue → worker → 結果完整鏈路

如果你只改了某個切片,可以先跑窄一點的:

| 改了什麼 | 跑哪個 |
|---|---|
| worker handler | `BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/worker` |
| API route | `npx vitest run tests/integration/api` |
| AI runtime | `npx vitest run tests/unit/run-runtime` |
| helpers / hooks | `npx vitest run tests/unit/helpers` |
| 提交前 | `npm run test:regression` ← 必跑 |

關鍵 config-center guards(模型設定相關改動必跑):
```bash
npm run check:config-center-guards
```

## 5. 關鍵指令速查

```bash
# 開發(會同時跑 next + worker + watchdog + bull-board)
npm run dev

# 只跑 next
npm run dev:next

# Build
npm run build  # 會先 prisma generate

# Bull-Board 任務面板
# http://localhost:3010/admin/queues
```

## 6. 目錄地圖

| 路徑 | 用途 |
|---|---|
| `src/app/` | Next.js App Router(頁面 + API routes) |
| `src/app/api/runs/` | **新版** Run API(統一入口,進行中) |
| `src/lib/run-runtime/` | LangGraph Runtime 核心(types/service/publisher/task-bridge/graph-executor/quick-run-graph/pipeline-graph) |
| `src/lib/ai-runtime/` | AI SDK 統一調用層(Phase 6) |
| `src/lib/workers/handlers/` | BullMQ worker 各任務 handler |
| `src/lib/query/hooks/run-stream/` | 前端 run-event 消費 |
| `lib/prompts/novel-promotion/` | AI prompt 模板(`.zh.txt` / `.en.txt` 雙版本必須同步) |
| `prisma/schema.prisma` | DB schema |
| `scripts/guards/` | 架構不變量守衛 |
| `tests/` | unit / integration / contracts / behavior |
| `docs/ai-runtime/` | 重構文件集 |

## 7. 環境變數注意事項

- **不要把 secret 寫進 code**。一律從 `.env` 讀,範例在 `.env.example`。
- 本機開發 `STORAGE_TYPE=local`,生產才切 `cos` 或 `r2`。
- `BILLING_MODE=OFF` 是本機開發的預設。改計費邏輯時要分別測 ON/OFF。
- Tencent COS 鑰匙、AI provider key 都絕不可 commit。

## 8. Prompt 規則

`lib/prompts/novel-promotion/*.{zh,en}.txt` 必須**雙語同步**。`scripts/guards/prompt-i18n-guard.mjs` 會擋。改了中文要改英文,反之亦然。

## 9. 影片 / 大檔規則

- 影片生成是長任務(分鐘級),**絕對不能** sync 阻塞 HTTP request。一律走 BullMQ。
- `*.mp4`、`*.mov`、`uploads/`、`/data/` 已在 `.gitignore` 內。不要把這些東西 commit。

## 10. 工作流程(重要)

### 起始
1. 讀 master plan 看當前 Phase 狀態與 🔄 / ⏸ 任務
2. 讀 `AUTONOMY_PROTOCOL.md` 確認 SOP
3. 視需要 plan mode 提案,確認方向再動手

### 進行中
- 每完成一個邏輯單元 → 跑相關 vitest → commit
- commit message 用 conventional commits(`feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:`)
- 同步更新 master plan 對應 Phase 的狀態與檔案清單

### 收尾
- `npm run test:regression` 全綠才算完成
- 把這次的學到/留下的問題寫進 master plan 的「⚠️ 当前问题登记」區段
- 沒解決的 TODO 寫進 `docs/ai-runtime/08-open-gaps.md`

## 11. 卡住怎麼辦

不要硬猜。順序如下:
1. 先用 context7 MCP 查最新 SDK 文件(Tencent / AI SDK / Prisma)
2. 在 codebase grep 類似的既有實作參考
3. 寫 `QUESTIONS.md`(若不存在就建立),登記問題給人類 review
4. **如果卡在架構決策**(例如要不要新增一個 Phase、要不要改 schema),停下來等人類拍板,不要自行決定

## 12. 絕對不要做的事

- 不要動 `src/generated/prisma/`(自動產生)
- 不要刪 `docs/ai-runtime/` 任何文件
- 不要為了讓 test pass 而修改 test 本身的斷言(改 fixture / mock 沒問題)
- 不要 commit `.env`、`uploads/`、`*.mp4` 等
- 不要呼叫 production Tencent / AI API 跑測試(用 mock 或 fixture)
- 不要在 master plan 標記 ✅ 但實際上 `npm run test:regression` 沒過

---

**最後一條:寧可慢、寧可問、寧可登記到 QUESTIONS.md,也不要為了「往前推進」而違反上面任何一條。**
