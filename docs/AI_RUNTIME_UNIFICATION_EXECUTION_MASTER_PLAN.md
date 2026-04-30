你必须按照目前的md文件详细执行我们的代码修改计划，且必须时刻关注，维护本次md文档，确保该文档能始终保持最新，和我们代码库保持完全一致，除非用户要求，否则默认禁止打补丁，禁止兼容层，我们需要的是简洁干净可扩展的系统，我们这个系统目前没有人用，可以一次性全量，彻底，不留遗留的修改，并且需要一次性完成所有，禁止停下，禁止自己停止任务，一次性完成所有内容。

# 1:项目目标

## 核心目标
- 统一所有 AI 任务到单一运行时：`LangGraph + AI SDK + MySQL Checkpointer`。
- 保留非 AI 接口现状，避免无效改造。
- 统一状态、重试、取消、回放、日志、错误语义，消除多套执行模型冲突。

## 为什么做
- 目前系统存在多套执行与状态模型并行，导致：
  - 步骤状态覆盖/错位/重复。
  - 重试层级打架（队列重试、步骤重试、解析重试）。
  - 前端需要补丁式归并逻辑（如 stepId 重试后缀解析）。
  - 故障定位成本高。

## 强约束（必须满足）
- A. State 瘦身：State 只存 metadata 和 DB refs，不存大文本正文。
- B. 逻辑时钟：`graph_events.seq` 单调递增；前端发现跳号即补拉 `afterSeq`。

## 修改前后预期
- 修改前：任务执行、流式事件、回放与状态聚合分散在多层。
- 修改后：统一 Run Runtime，单一事实源，统一事件协议与恢复机制。

## 预计改动规模（动态更新）
- 预计文件：75-105
- 预计代码行：8000-13000
- 当前已改动文件：146（125 既有累计 + 本轮 Phase 11.2 working tree 21 个：prisma schema / messages i18n x2 / project page / route-catalog / script-to-storyboard handler + helpers + 新增 episode-asset-bridge / characters list route / locations list route / import-character route / import-location route / ProjectAssets parent + Characters tab + Locations tab + ImportFromGlobalDialog / sync-episode-character-junction migration script + 8 个新 test files：episode-asset-bridge unit + import-character / import-location / characters-list / locations-list integration + sync-episode-character-junction integration + ProjectAssets jsdom + storyboard-junction worker test）

# 2:阶段+具体代码修改地方以及需要修改的内容

## 阶段总览状态
- ✅ Phase 1: 架构决策已锁定（LangGraph + AI SDK + MySQL Checkpointer；AI 全量统一，非 AI 不改）
- ✅ Phase 2: 主控文档建立并进入持续维护
- ✅ Phase 3: Runtime 骨架 + Prisma graph_* 模型
- ✅ Phase 4: Run API（/api/runs）
- ✅ Phase 5: 事件 seq 逻辑 + 前端跳号补拉
- 🔄 Phase 6: AI SDK 统一层（核心链路已切，长尾任务待收口）
- 🔄 Phase 7: GraphExecutor + QuickRunGraph/PipelineGraph（已落地并接入核心链路）
- 🔄 Phase 8: 复杂链路迁移（story_to_script_run / script_to_storyboard_run）
- ⏸ Phase 9: 其余 AI 任务全量迁移
- 🔄 Phase 10: 清理旧执行路径与旧事件协议（代码清理持续进行）
- 🔄 Phase 11: 竞品对标功能补完（基于 docs/competitor-features/ 分析；Top 5 优先）— 11.5 + 11.1 + 11.2 主要子任務 ✅ 完成；11.3 / 11.4 仍 ⏸；11.1.5 / 11.2.5 reviewer follow-up ⏸
  - ✅ Phase 11.1: 「剧 → 集」UI 第一公民化（P0，纯前端，最契合用户核心需求）— 主要 4 個子任務全部 ✅ 完成；reorder API 拆 Phase 11.1.5
  - ⏸ Phase 11.1.5: reviewer round 1 + round 2 follow-up（reorder API + lean GET 拆分 + EpisodeCard 抽取 + dead Sidebar 删除 + vitest dom config 默认旗 + locale prefix 验证 + OverviewView unit test）
  - ✅ Phase 11.2: 角色 / 场景跨集共用 UX 强化（P0，含 junction table migration）— 主要 4 個子任務全部 ✅ 完成；本輪只實作 `auto-from-panel` role producer，`manual` / `imported-from-global` 寫入路徑拆 Phase 11.2.5
  - ⏸ Phase 11.2.5: 11.2 follow-up debt（manual character/location editing UI / dead non-junction lookup 清查 / MediaObject 跨用戶限制寫進 08-open-gaps.md）
  - ⏸ Phase 11.3: 道具（Props）first-class asset（P1，新 model）
  - ⏸ Phase 11.4: 角色三视图（全身 → 三视图 → 头像）结构化（P0，跨集一致性核心）
  - 🔄 Phase 11.5: 风格 lock（正向 + 负向 prompt）（P0，最小可行验证）— 主要 4 個子任務全部 ✅ 完成；末尾留 5 個 P2 ⏸ 子任務（dead i18n key / comment / DB cleanup / asset-hub forward / handler 測試覆蓋）
- ⚠️ Phase Risk: 一次性切换风险高，必须严格按阶段门禁推进
- ⚠️ Phase 11 Risk: 11.2 / 11.3 / 11.4 涉及 schema migration，需详细 playbook；11.4 改 character generation pipeline 影响范围大

## Phase 2（当前执行中）主控文档
- 🔄 任务：创建并维护唯一执行文档
  - 路径：`docs/AI_RUNTIME_UNIFICATION_EXECUTION_MASTER_PLAN.md`
  - 要求：每次代码变更后先更新本文件状态，再继续下一步。

## Phase 3 运行时骨架与数据模型
- ✅ 任务：新增 Prisma 模型与索引
  - 文件：`prisma/schema.prisma`
  - 新增：`graph_runs`, `graph_steps`, `graph_step_attempts`, `graph_events`, `graph_checkpoints`, `graph_artifacts`
  - 要求：
    - `graph_events` 包含 `seq`，并约束 `(run_id, seq)` 唯一。
    - `graph_runs` 包含 `last_seq` 以支持 run 内递增序列。
    - `graph_runs.taskId` 建立唯一映射（run <-> task），用于取消与追踪。
- ✅ 任务：新增 Run 类型与服务
  - 文件：`src/lib/run-runtime/types.ts`
  - 文件：`src/lib/run-runtime/service.ts`
  - 文件：`src/lib/run-runtime/publisher.ts`
  - 文件：`src/lib/run-runtime/task-bridge.ts`
  - 文件：`src/lib/run-runtime/workflow.ts`
  - 能力：
    - createRun/getRun/requestCancel/listEventsAfterSeq/appendEventWithSeq
    - run event publish + task event bridge
    - State 大小守卫（64KB）
- ⚠️ 风险：DDL 与现有高并发表并存，需控制迁移窗口与索引创建顺序。

## Phase 4 Run API
- ✅ 任务：新增运行接口
  - `src/app/api/runs/route.ts` -> `POST /api/runs`, `GET /api/runs`
  - `src/app/api/runs/[runId]/route.ts` -> `GET /api/runs/:runId`
  - `src/app/api/runs/[runId]/events/route.ts` -> `GET /api/runs/:runId/events?afterSeq=`
  - `src/app/api/runs/[runId]/cancel/route.ts` -> `POST /api/runs/:runId/cancel`

## Phase 5 逻辑时钟与跳号补拉
- ✅ 任务：运行时事件序列
  - 文件：`src/lib/run-runtime/service.ts`
  - 要求：事务内分配 seq、写事件、更新 run.last_seq。
- ✅ 任务：worker 事件 runId 透传
  - 文件：`src/lib/workers/shared.ts`
  - 说明：`withFlowFields` 已统一注入 `runId`（来自 payload/meta），确保 processing/progress/stream/completed/failed 全链路可桥接到 run 事件。
- ✅ 任务：task->run 事件桥接增强（progress 感知）
  - 文件：`src/lib/run-runtime/task-bridge.ts`
  - 说明：`task.progress` 事件已支持基于 `stage/done/error` 推导 `step.complete/step.error`，并统一 `stepKey`、`attempt`、lane 解析规则；stream 场景增加默认 `step:${taskType}` 键防止丢片段。
- ✅ 任务：run/step 终态投影收敛
  - 文件：`src/lib/run-runtime/service.ts`
  - 说明：`run.complete/run.error/run.canceled` 会批量收敛未终态 step；并完善错误消息解析（含嵌套 error.message）与运行中状态推进，减少“run 终态但 step 仍 running”矛盾。
- ✅ 任务：桥接规则回归测试
  - 文件：`tests/unit/run-runtime/task-bridge.test.ts`
  - 覆盖：stream lane 归一、stream 缺失 stepId 的 fallback stepKey、processing done/error 推导、completed 映射、缺失 runId 拦截。
- 🔄 任务：前端消费路径切入 run seq 拉取
  - 文件：`src/lib/query/hooks/run-stream/run-request-executor.ts`
  - 说明：当接口返回 `runId` 时，前端优先走 `/api/runs/:runId/events?afterSeq=` 递增拉取，按 seq 单调推进；task SSE 保留为无 runId 场景兜底。
- ✅ 任务：run events 拉流路径单测
  - 文件：`tests/unit/helpers/run-request-executor.run-events.test.ts`
  - 覆盖：`async + runId` 返回后改走 `/api/runs/:runId/events` 并产出终态。
- ✅ 任务：state-machine 保留 run.start payload
  - 文件：`src/lib/query/hooks/run-stream/state-machine.ts`
  - 说明：`run.start` 事件会落盘 payload，后续恢复和调试可读取 `taskId/runId` 元信息。
- 🔄 任务：前端消费顺序保障
  - 文件：`src/lib/query/hooks/run-stream/*`（将迁移到 RunStoreV2）
  - 要求：发现 seq 跳号即补拉并去重。
- ✅ 任务：story/script 前端运行流改为 run-event 单通道
  - 文件：
    - `src/lib/query/hooks/run-stream/run-request-executor.ts`
    - `src/lib/query/hooks/run-stream/recovered-run-subscription.ts`
    - `src/lib/query/hooks/run-stream/run-stream-state-runtime.ts`
    - `src/lib/query/hooks/useStoryToScriptRunStream.ts`
    - `src/lib/query/hooks/useScriptToStoryboardRunStream.ts`
    - `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useWorkspaceExecution.ts`
    - `src/app/[locale]/workspace/[projectId]/modes/novel-promotion/hooks/useNovelPromotionWorkspaceController.ts`
  - 说明：移除 story/script 的 task SSE 兜底，恢复与执行统一为 `/api/runs/:runId/events` 轮询与 seq 补拉；停止动作改为 `/api/runs/:runId/cancel`。
- ⚠️ 风险：实时流与补拉流重复事件导致状态回退，必须基于 seq 去重。

## Phase 6 AI SDK 统一调用层
- ✅ 任务：新增 AI Runtime 基础层
  - 目录：`src/lib/ai-runtime/`
  - 文件：
    - `src/lib/ai-runtime/types.ts`
    - `src/lib/ai-runtime/errors.ts`
    - `src/lib/ai-runtime/client.ts`
    - `src/lib/ai-runtime/index.ts`
  - 能力：统一 step 调用、错误归一、usage 输出结构。
- 🔄 任务：核心链路 handler 切换到 AI Runtime
  - 文件：
    - `src/lib/workers/handlers/story-to-script.ts`
    - `src/lib/workers/handlers/script-to-storyboard.ts`
- ✅ 任务：长尾文本 handler 批量切换到 AI Runtime（第一批）
  - 文件：
    - `src/lib/workers/handlers/analyze-global.ts`
    - `src/lib/workers/handlers/analyze-novel.ts`
    - `src/lib/workers/handlers/voice-analyze.ts`
    - `src/lib/workers/handlers/screenplay-convert.ts`
    - `src/lib/workers/handlers/clips-build.ts`
    - `src/lib/workers/handlers/episode-split.ts`
    - `src/lib/workers/handlers/asset-hub-ai-modify.ts`
    - `src/lib/workers/handlers/character-profile.ts`
- ⚠️ 风险：仍有少量旧 `llm-client` 直连点（如 shot 系列/text.worker/storyboard-phases），需继续收口。

## Phase 7 Graph 执行器与模板
- ✅ 任务：实现 GraphExecutor（checkpoint/retry/cancel/timeout）
  - 文件：`src/lib/run-runtime/graph-executor.ts`
- ✅ 任务：实现 QuickRunGraph（单节点简单任务）
  - 文件：`src/lib/run-runtime/quick-run-graph.ts`
- ✅ 任务：实现 PipelineGraph（复杂链路模板）
  - 文件：`src/lib/run-runtime/pipeline-graph.ts`
- ✅ 任务：GraphExecutor 单测
  - 文件：`tests/unit/run-runtime/graph-executor.test.ts`
- ⚠️ 风险：旧 `_r2` 等语义必须彻底移除，禁止新旧混用。

## Step Identity 统一（阶段内子任务）
- ✅ 任务：消除动态 `stepId_retry_x` 语义，统一为 `stepId` 固定 + `stepAttempt` 递增
  - 已完成文件：
    - `src/lib/workers/handlers/clips-build.ts`
    - `src/lib/workers/handlers/screenplay-convert.ts`
    - `src/lib/workers/handlers/voice-analyze.ts`
    - `src/lib/workers/handlers/episode-split.ts`
    - `src/lib/novel-promotion/story-to-script/orchestrator.ts`

## Phase 8 复杂链路迁移（核心）
- ✅ 任务：`story_to_script_run` worker 主路径接入 PipelineGraph 执行器
  - 文件：`src/lib/workers/handlers/story-to-script.ts`
- ✅ 任务：`script_to_storyboard_run` worker 主路径接入 PipelineGraph 执行器
  - 文件：`src/lib/workers/handlers/script-to-storyboard.ts`
- ⏸ 任务：把“台词分析”固定建模为分镜链路步骤
- ⚠️ 风险：产物写入幂等与回放一致性

## Phase 9 其余 AI 任务迁移
- ⏸ 任务：图像/视频/音频/资产中心 AI 任务统一纳管
- ⚠️ 风险：任何 AI route 不允许旁路旧执行路径

## Phase 10 清理与收口
- ⏸ 任务：切换所有 AI 提交入口到 createRun
- ⏸ 任务：下线旧 AI worker 执行路径与旧 task-stream 事件写入
- ⏸ 任务：清理死代码和旧类型
- ✅ 任务：补全运行时重构文档集与 README 入口
  - 新增目录：`docs/ai-runtime/`
  - 新增文件：
    - `README.md`
    - `01-architecture.md`
    - `02-data-model.md`
    - `03-event-protocol.md`
    - `04-api-contract.md`
    - `05-migration-playbook.md`
    - `06-operations-runbook.md`
    - `07-testing-acceptance.md`
    - `08-open-gaps.md`
  - 更新：`README.md` 添加文档入口
- ⚠️ 风险：漏删；需关键字全仓扫描验收

## Phase 11 竞品对标功能补完（基于 docs/competitor-features/ 分析）

### 背景
对标 PolyFilm AI、Alibaba LumenX、LocalMiniDrama 三家产品后产出的整合计划。详细对标资料见：
- `docs/competitor-features/_summary.md`（总体战略）
- `docs/competitor-features/integration-plan.md`（具体实施建议）
- `docs/competitor-features/polyfilm.md` / `lumenx.md` / `localminidrama.md`（个别对手深度）

**用户核心需求**：「像 PolyFilm 一样建置一个剧，每个剧里面去增加集数，同一个剧当中共用角色跟场景」

**关键发现**：现有 `prisma/schema.prisma` 已支持 Project（剧）→ Episode（集）→ project-scoped Character / Location 的结构。Phase 11 主要补 UI / 体验 + 几个关键 schema 增强。

### 强约束（Phase 11 内独有）
- 不打补丁、不兼容层、不隐式回退（继承全局强约束）
- 任何 schema migration 必须有完整 playbook，包含 rollback 步骤
- 既有 NovelPromotionCharacter / NovelPromotionLocation 的 sourceGlobalCharacterId 链接关系不能断
- prompt 改动必须 zh + en 同步（prompt-i18n-guard.mjs 会挡）
- 所有 image / video generate 改动必须走 ai-runtime（no-api-direct-llm-call.mjs 会挡）

### Phase 11.1 「剧 → 集」UI 第一公民化（P0）

**目标**：让 Project = 剧、Episode = 集 在介面上明确，体验对齐 PolyFilm。**只改 UI，不改 schema**。

- ✅ 任务：Project 详情页加「集列表」主视图
  - 文件：`src/app/[locale]/workspace/[projectId]/page.tsx`
  - 文件：`src/app/[locale]/workspace/[projectId]/components/EpisodeList.tsx`（新）
  - 文件：`src/app/[locale]/workspace/[projectId]/components/episode-progress.ts`（新）
  - 文件：`src/app/[locale]/workspace/[projectId]/components/episode-thumbnail.ts`（新）
  - 文件：`src/app/[locale]/workspace/[projectId]/components/OverviewView.tsx`（新；project dashboard wrapper，组合 EpisodeList + ProjectSettings）
  - 文件：`src/app/api/novel-promotion/[projectId]/episodes/route.ts`（GET 回填 progress / thumbnail 计算所需欄位）
  - 完成：进到 project 第一眼看到所有 episodes grid + 剧名 + 角色/场景计数；每集显示 episodeNumber、name、缩略图（首镜或封面）、进度（剧本/分镜/视频完成度）；顶部「+ 新建集」按钮；点集进入既有的 stage workflow（带 episodeId param）。Q-4 A 拍板「**完全停止「自动跳第一集」effect**」，user 进 project 永远先看 dashboard
  - 测试：`tests/unit/episode-progress.test.ts` 8/8 ✅、`tests/unit/episode-thumbnail.test.ts` 7/7 ✅、`tests/unit/components/EpisodeList.test.tsx` 9/9 ✅、`tests/unit/components/OverviewView.test.tsx` ⏸（拆 Phase 11.1.5 follow-up）、`tests/integration/api/episodes-list.test.ts` 7/7 ✅、`tests/integration/workspace-page.test.tsx` 6/6 ✅（含 Q-4 A regression）

- ✅ 任务：Episode 切换器在 workspace header 永久存在
  - 文件：`src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/WorkspaceHeaderShell.tsx`（接入 EpisodeTabBar）
  - 文件：`src/components/ui/EpisodeTabBar.tsx`（新；水平 tab + 「+ 新建集」end-of-tabs）
  - 文件：`src/components/ui/CapsuleNav.tsx`（旧 dropdown 切换器移除 / 改导）
  - 文件：`src/lib/query/mutations/useEpisodeMutations.ts`（新增 / 重排序 mutation 缓存对齐）
  - 完成：所有阶段（config / assets / storyboard / videos / voice）都能切集；当前 episode 高亮；切集时 Q-2 B 拍板「**保留 URL stage param（不重置）**」让用户停在同 stage 跨集对比。reorder 行为本轮无 UI（拆 Phase 11.1.5 ⏸）
  - 测试：`tests/unit/components/EpisodeTabBar.test.tsx` 6/6 ✅、`tests/integration/workspace-page.test.tsx` 6/6 ✅（含 Q-2 B regression）

- ✅ 任务：Project 层级设定独立区块
  - 文件：`src/app/[locale]/workspace/[projectId]/components/ProjectSettings.tsx`（新）
  - 显示：videoRatio（9:16 / 16:9）、targetDuration、各种 model 配置 / capabilityOverrides，**styleProfile 唯讀 badge（自訂 / 未設定 + 參考圖數）**
  - 註：master plan 此處原文写「artStyle」**已過時**（Phase 11.5 / Q-006 拍板 A 完全停用 artStyle / artStylePrompt）。Q-1 C user 拍板 ProjectSettings 显示 styleProfile 唯讀 badge：解 `referenceImageObjectIds` JSON 出参考图数；`isCustom` 透过判断 styleProfile 是否有 positivePrompt / referenceImage 决定显「自訂」或「未設定」。**不反推 preset 名**（避免 hardcode 对照表）
  - 测试：`tests/unit/components/ProjectSettings.test.tsx` 8/8 ✅（涵盖 parseReferenceImageCount / capabilityOverrides 正規化 / styleProfileSummary isCustom 判断三条核心 path）

- ✅ 任务：API 层补 episode CRUD 完整性检查
  - 文件：`src/app/api/novel-promotion/[projectId]/episodes/route.ts`（GET / POST 完整性检查 + 回填 progress / thumbnail 所需欄位）
  - 文件：`tests/integration/api/episodes-list.test.ts`（新；7/7 ✅）
  - 完成：POST 新增、DELETE 删除都顺畅，GET 回 progress / thumbnail 计算所需欄位
  - **PATCH 重排序未做** — Q-3 B user 拍板「拆 Phase 11.1.5 子任务」（reorder API + drag-and-drop UI 一併下个 phase 做）。本子任务边界：仅完成 GET / POST / DELETE 完整性

**驗收**：
- ✅ 进到 project 看到 dashboard：剧名 + N 集 + 角色 N 个 + 场景 N 个（OverviewView）
- ✅ header 任何阶段都能轻易切其他集（EpisodeTabBar，含 stage param 保留）
- ✅ 「新增集」一键搞定
- ⚠️ `npm run test:regression` 完整链路本轮未跑（Q-002 ripgrep 缺失 / Q-003 worker mock 缺欄位 pre-existing 仍挡），但 Phase 11.1 范围内 7 类测试 51 cases 全 pass：tsc / config-center-guards / test-route-coverage / test-coverage-guards / 5 类 unit / 2 类 integration（详见末尾「当前验证执行记录」段）

**风险**：
- ✅ Episode 切换涉及 client state（既有 useNovelPromotionWorkspaceController）已确认 stage state 不会因切集错乱（Q-2 B 保留 stage param 设计）
- ⚠️ N=50 集场景：dashboard 拉 episodes list 会拉出 N 个 `novelText` `@db.Text` blob 上 wire（Phase 11.1.5 #2 拆 lean / wizard-rehydrate 两条路径）

### Phase 11.1.5 reviewer follow-up（11.1 收尾后子任务，未开工）

来源：reviewer round 1 + round 2 提的 follow-up + Q-3 B 拍板拆出来的 reorder API。每一项独立可推进，不互相阻塞。

- ⏸ 任务：Episode reorder API + drag-and-drop UI（Q-3 B 拆过来）
  - 文件：`src/app/api/novel-promotion/[projectId]/episodes/reorder/route.ts`（新）
  - 文件：`src/components/ui/EpisodeTabBar.tsx`（加 reorder UI）
  - 逻辑：transaction 处理 episodeNumber `@@unique` 约束（先升再写：把目标号段先 +1000 暂存避撞 unique，再写最终值）
  - 验收：drag-and-drop 顺序、unique 冲突 graceful 处理（不暴露 db error）、optimistic update 失败回滚

- ⏸ 任务：GET `/episodes` 拆 lean / wizard-rehydrate 两条路径
  - 问题：dashboard 用 `useQuery` 拉 episodes 拉到 N 集 `novelText` `@db.Text`，N=50 集就 50 个 large blob 上 wire
  - 文件：`src/app/api/novel-promotion/[projectId]/episodes/route.ts`（加 `?slim=1`）或新 endpoint `episodes/wizard-rehydrate`
  - 逻辑：dashboard 用 lean GET（不含 novelText），wizard 用 full GET 或专属 endpoint
  - 验收：N=50 集 dashboard 载入时间下降可量测（before/after benchmark）、wizard 重编能拿到 novelText

- ⏸ 任务：`OverviewView.tsx` 补 unit test
  - 文件：`tests/unit/components/OverviewView.test.tsx`（新）
  - 涵盖：`parseReferenceImageCount` 解 JSON、`capabilityOverrides` 正規化、`styleProfileSummary` isCustom 判断
  - 验收：4-6 case + 假绿灯检查（assertion 真的会 fail when 实作错）

- ⏸ 任务：拆 `EpisodeList.tsx` 304 行 → 提取 `EpisodeCard.tsx`
  - 文件：`src/app/[locale]/workspace/[projectId]/components/EpisodeCard.tsx`（新）
  - 含 editingName / confirmingDelete 两组局部 state（从 EpisodeList 抽出）
  - EpisodeList 缩到 ~150 行
  - 验收：tests 不变、guard 绿、`scripts/guards/file-line-count-guard.mjs` 不挡

- ⏸ 任务：删除 dead `src/app/[locale]/workspace/[projectId]/components/Sidebar.tsx`
  - reviewer 确认无 import / caller
  - 验收：grep 确认无遗留 import + tests 不变

- ⏸ 任务：`vitest.dom.config.ts` 预设关 BILLING_TEST_BOOTSTRAP
  - 避免后人忘记带 `BILLING_TEST_BOOTSTRAP=0` 跑 dom test
  - 验收：跑 dom test 不需手动带旗

- ⏸ 任务：EpisodeTabBar projectHref 确认带 [locale] prefix
  - reviewer round 1 提的小问题
  - 看 next-intl middleware 行为（直连 `/workspace/...` vs `/zh/workspace/...`）
  - 验收：locale-prefixed route 跳转正确

### Phase 11.2 角色 / 场景跨集共用 UX 强化（P0，含 schema migration）

**目标**：「同一个剧当中共用角色跟场景」实质上 schema 已支持，本 Phase 强化 UX 让用户看得见、用得到，并加 junction table 让查询更准。

**Q-1 / Q-2 / Q-3 / Q-5 拍板**（user 拍板紀錄已存 QUESTIONS.md「Phase 11.2 設計決策（已落實）」）：
- **Q-1 A**：junction = SoT，`panels.characters` 视为 panel 属性（角色出场记录），不是 episode 索引；列 episodes for character 一律走 junction，不再 scan panels.characters
- **Q-2 B**：junction 写入用三层 fallback 解 character/location 名 — name 精确 → name case-insensitive → aliases JSON
- **Q-3 C**：`role` 用 enum/string 区分 `'auto-from-panel'` | `'manual'` | `'imported-from-global'`，让 UI 能区分来源
- **Q-5 B**：import endpoint 签名 `POST /api/projects/[projectId]/import-character` body `{globalCharacterId, includeAppearances?}`；返回**完整 character object**（不是只有 characterId），UI 可立即渲染

- ✅ 任务：Project 层级的「角色 / 场景」分页
  - 文件：`src/app/[locale]/workspace/[projectId]/components/ProjectAssets.tsx`（新；parent，组合 Characters / Locations 两个 tab）
  - 文件：`src/app/[locale]/workspace/[projectId]/components/ProjectAssetsCharactersTab.tsx`（新）
  - 文件：`src/app/[locale]/workspace/[projectId]/components/ProjectAssetsLocationsTab.tsx`（新）
  - 文件：`src/app/[locale]/workspace/[projectId]/components/ImportFromGlobalDialog.tsx`（新；从全局库选择 selector + 「import」按钮）
  - 文件：`src/app/[locale]/workspace/[projectId]/page.tsx`（加 `view='assets'` 分支挂载 ProjectAssets）
  - 文件：`messages/{en,zh}/workspaceDetail.json`（i18n 字串）
  - 完成：进 project 任意时刻都能在 dashboard 看到该 project 所有角色 / 场景；列出每个 asset 出现在哪几集（资料源：junction）；显示「import from global」按钮触发 dialog；逐项编辑 / 删除 UI **本轮未做**（拆 Phase 11.2.5 ⏸；本轮 read-only + import-only）
  - 测试：`tests/unit/components/ProjectAssets.test.tsx` 6 cases（jsdom）

- ✅ 任务：新增 EpisodeCharacter / EpisodeLocation junction table + bridge layer
  - 文件：`prisma/schema.prisma`
    - 新增 model `EpisodeCharacter`：`{ id, episodeId, characterId, role String?, createdAt }`，`@@unique([episodeId, characterId])`
    - 新增 model `EpisodeLocation`：`{ id, episodeId, locationId, role String?, createdAt }`，`@@unique([episodeId, locationId])`
    - NovelPromotionEpisode / Character / Location 加上反向 relation
    - `role` field 用 String 而非 enum：取值 `'auto-from-panel'` | `'manual'` | `'imported-from-global'`（Q-3 C 拍板）；用 String 是为了向后扩展不需 ALTER TABLE
  - 文件：`src/lib/episode-asset-bridge.ts`（新；bridge layer）
    - `linkEpisodeCharactersFromPanel(tx, episodeId, panelCharactersJson, projectId)`：从 panel 落库时 upsert junction，**三层 fallback** 解名（Q-2 B 拍板）：name 精确 → name case-insensitive → aliases JSON contains
    - `linkEpisodeLocationFromPanel(tx, episodeId, panelLocationName, projectId)`：同上
    - `getEpisodesForCharacter(characterId)` / `getEpisodesForLocation(locationId)`：list-episodes-by-asset 反查
    - `createMany skipDuplicates: true` 避免 `@@unique` 冲突；role 一律标 `'auto-from-panel'`
  - 文件：`src/lib/workers/handlers/script-to-storyboard-helpers.ts`
    - `persistSingleClipStoryboard` / `persistStoryboardsAndPanels` 加 `projectId` 参数
    - 在 panel 落库的 transaction 内呼叫 `linkEpisodeCharactersFromPanel` + `linkEpisodeLocationFromPanel`，role=`'auto-from-panel'`
    - **transaction timeout 从 15s→30s, 30s→60s**（因为 transaction 多了 junction sync 的 db ops；保守扩容避免 timeout）
  - 文件：`src/lib/workers/handlers/script-to-storyboard.ts` 把 `projectId` 传进 helpers
  - **本轮只实作 `auto-from-panel` role producer**（由 storyboard handler 自动写入）。`manual` 跟 `imported-from-global` **是欄位 / 概念已就緒，但沒有實際的寫入路徑**：
    - `manual`：缺 manual character / location editing UI（CRUD endpoint + form）— 拆 Phase 11.2.5 ⏸
    - `imported-from-global`：import endpoint **目前没有写 EpisodeCharacter / EpisodeLocation junction**，因为「跨集共用」是 global asset library 的概念，没绑特定 episode；junction 是「这集用到这个 asset」的关系，而 import 只是「把 global asset 拷进 project asset library」。两件事正交。**真正写 junction 的时机仍然是 storyboard handler 偵測到 panel 引用该 asset 时**，role 还是 `auto-from-panel`。后续若要支援「user 在 episode 详情手动添 asset 不出现在任何 panel 也算这集用到」才会动到 `manual` 写入路径
  - 测试：`tests/unit/lib/episode-asset-bridge.test.ts` 22 cases（三层 fallback 各路径 + skipDuplicates 不抛 + projectId scope 过滤）；`tests/unit/worker/storyboard-junction.test.ts` 5 cases（worker handler 端 e2e；`vi.fn` 用 generic 解 8 个 TS 错）

- ✅ 任务：从全局资产中心一键导入到 project
  - 文件：`src/app/api/projects/[projectId]/import-character/route.ts`（新；POST）
    - body：`{globalCharacterId: string, includeAppearances?: boolean}`（Q-5 B 拍板）
    - 复制 GlobalCharacter → NovelPromotionCharacter，设 `sourceGlobalCharacterId`；若 `includeAppearances=true` 同步复制 appearances + images
    - **返回完整 character object**（含 appearances）让 UI 立即渲染，不需再 GET 一次（Q-5 B 拍板）
  - 文件：`src/app/api/projects/[projectId]/import-location/route.ts`（新；POST）
    - body：`{globalLocationId: string, includeImages?: boolean}`，对称结构
  - 文件：`src/app/api/projects/[projectId]/characters/route.ts`（新；GET 列出该 project 所有 characters + 每人 episodes from junction）
  - 文件：`src/app/api/projects/[projectId]/locations/route.ts`（新；GET 列出该 project 所有 locations + 每个 episodes from junction）
  - UI：`ImportFromGlobalDialog.tsx` 接 import endpoint，invalidate characters/locations query
  - 测试：
    - `tests/integration/api/projects/import-character.test.ts` 8 cases
    - `tests/integration/api/projects/import-location.test.ts` 8 cases
    - `tests/integration/api/projects/characters-list.test.ts` 6 cases
    - `tests/integration/api/projects/locations-list.test.ts` 6 cases
  - **route-catalog 同步**：`tests/contracts/route-catalog.ts` 131→135 routes，加 4 个 entry（characters / import-character / import-location / locations，按字母順序排在 projects/[projectId] 區塊）

- ✅ 任务：同步既有 panels.characters / panels.location 数据到 junction table
  - 文件：`scripts/migrations/sync-episode-character-junction.ts`（新；一次性 backfill）
  - 设计：
    - flag `--commit`（不带 = dry-run）：默认 dry-run 不写 db，只输出会写多少 row；带 `--commit` 才真写
    - flag `--projectId=<id>`：可选，只跑指定 project 范围（用于 staged rollout 或修单个 project）
    - 扫 panels.characters / panels.location，套用 bridge layer 的三层 fallback 解名 → upsert junction，role=`'auto-from-panel'`
    - 找不到对应 character / location 的 panel 不当错误，log warning（避免噪音 row 阻断 backfill）
  - 测试：`tests/integration/scripts/sync-episode-character-junction.test.ts` 8 cases（含 dry-run / commit / projectId scope / 三层 fallback / skipDuplicates / 找不到 asset 的 warning path）

**驗收**：
- ✅ Project 详情页有独立「角色 / 场景」分页（read-only + import；manual edit UI 拆 11.2.5）
- ✅ Episode 1 加角色（透过 panel 引用），Episode 2 自动在 ProjectAssets 看得到（因为 junction 是 project-wide）、可选用
- ✅ Junction table query 能跑：`getEpisodesForCharacter(characterId)` / `getEpisodesForLocation(locationId)` 反查
- ✅ 既有数据迁移有 backfill 脚本（dry-run + commit 两路）
- ✅ TypeScript clean、test:guards 全绿、相关 vitest 全绿（详见末尾「当前验证执行记录」段）

**风险（剩余 / 已收尾）**：
- ✅ Schema migration 风险已收：本 phase 用「add table → bridge layer 双写自 storyboard handler → backfill script」三步策略，没强制 enforce，旧 panels.characters text 字段保留作为 read-side 信号源（搜索哪些 panel 用了哪角色仍然走 panels.characters）
- ✅ panels.characters text 字段与 junction table source of truth 已明确：**junction = episodes-for-character 的 SoT**（Q-1 A 拍板）；**panels.characters = 该 panel 使用了哪些角色的属性**（不是 episode 索引）。两者 not redundant
- ✅ 既有 sourceGlobalCharacterId 关系不动；import endpoint 持续设这个 id

### Phase 11.2.5 reviewer round 2 follow-up + 11.2 debt（11.2 收尾后，未开工）

来源：reviewer round 2 APPROVE 但留的 follow-up + 本轮拆出去的 manual write path。

- ⏸ 任务：Manual character / location editing UI
  - 文件：`src/app/[locale]/workspace/[projectId]/components/ProjectAssetsCharactersTab.tsx`（加 edit / create / delete UI）
  - 文件：`src/app/[locale]/workspace/[projectId]/components/ProjectAssetsLocationsTab.tsx`（同）
  - 文件：`src/app/api/projects/[projectId]/characters/[characterId]/route.ts`（新；PATCH / DELETE）
  - 文件：`src/app/api/projects/[projectId]/locations/[locationId]/route.ts`（新；PATCH / DELETE）
  - 文件：`src/app/api/projects/[projectId]/characters/route.ts`（已有 GET，加 POST manual create）
  - 文件：`src/app/api/projects/[projectId]/locations/route.ts`（已有 GET，加 POST manual create）
  - 逻辑：manual create / link 时 junction `role='manual'`（区分 storyboard auto-write）
  - 验收：UI 能 CRUD；manual junction row 跟 auto-from-panel row 在 list 端能区分

- ⏸ 任务：dead code lookup（确认没有舊的 non-junction 讀取殘留）
  - grep `panels.characters` / `panels.location` 所有读取点
  - 期望：只有「panel 详情页 / 编辑 panel UI」用 panels.characters 显示「这个 panel 出场角色」（合理；这是 panel 属性）
  - 不期望：用 panels.characters 列「该 character 出现在哪几集」（应改走 junction）
  - 验收：grep + manual review 把所有「list episodes by asset」路径都迁到 `getEpisodesForCharacter` / `getEpisodesForLocation`

- ⏸ 任务：把 MediaObject 跨用戶限制写进 `docs/ai-runtime/08-open-gaps.md`
  - 来源：Phase 11.5 Q-005 拍板 A 加了 `MediaObject.uploadedByUserId`，但本轮 11.2 import-character 把 GlobalCharacter 的 appearance image 拷进 NovelPromotionCharacter 时，对应 MediaObject 仍维持原 uploader（global asset 的 uploader）
  - 后果：A 用户 import B 用户的 GlobalCharacter，B 的 MediaObject id 出现在 A 的 NovelPromotionCharacterAppearance.imageMediaId，下游 styleProfile 之类的 ownership check 可能误拒（11.5 的 `assertReferenceImagesOwned` 还没卷到 character appearance image）
  - 验收：08-open-gaps.md 加一条 entry 说明 MediaObject ownership 跨 user import 的语义（要决定：转嫁 ownership？保持原 uploader？clone MediaObject？）

### Phase 11.3 道具（Props）first-class asset（P1）

**目标**：补齐三家对手都有但 KuiperAI 没有的道具概念。

- ⏸ 任务：新增 NovelPromotionProp + GlobalProp 模型
  - 文件：`prisma/schema.prisma`
    - 新增 `NovelPromotionProp`：`{ id, novelPromotionProjectId, name, summary?, sourceGlobalPropId?, createdAt, updatedAt }`
    - 新增 `NovelPromotionPropImage`：参考既有 LocationImage 结构
    - 新增 `GlobalProp`：参考 GlobalLocation 结构
    - 新增 `GlobalPropImage`：参考 GlobalLocationImage 结构
    - NovelPromotionProject 加 relation：`props NovelPromotionProp[]`
    - User 加 relation：`globalProps GlobalProp[]`
  - 索引规则参考既有 character / location 模式

- ⏸ 任务：劇本實體提取 prompt 加上道具
  - 文件：`lib/prompts/novel-promotion/agent_storyboard_*.{zh,en}.txt`
  - 文件：`lib/prompts/novel-promotion/agent_character_profile.{zh,en}.txt` 邻近的实体提取 prompt
  - 改 prompt：输出 characters + locations + **props** 三类
  - 文件：`src/lib/workers/handlers/analyze-novel.ts`、`analyze-global.ts`
    - 解析 props，写入 NovelPromotionProp

- ⏸ 任务：UI「道具」分页（与角色 / 场景并列）
  - 文件：延伸 ProjectAssets.tsx
  - Categories：武器 / 物品 / 載具 / 特殊（可选）

- ⏸ 任务：Panel 可绑定道具 reference
  - 文件：`prisma/schema.prisma`（NovelPromotionPanel 加 propIds 字段，JSON array of UUID）
  - 文件：图片生成 prompt 自动拉对应道具 reference image

**驗收**：
- 从剧本能自动提取道具并生成图片
- Panel 编辑 UI 可手动绑定道具
- 道具的图片可作为 reference 注入分镜图生成
- `npm run check:prompt-i18n` 全绿（zh + en 同步）

**风险**：
- ⚠️ 新增 model 影响范围大（schema + prompt + UI + worker），按子任务分开 commit

### Phase 11.4 角色三视图结构化（P0，跨集一致性核心）

**目标**：对标 LumenX 的「全身像 → 三视图 + 头像」reference 结构，提升跨集 / 跨镜头角色一致性。

- ⏸ 任务：CharacterAppearance 结构化扩展
  - 文件：`prisma/schema.prisma`
    - CharacterAppearance 加字段：`fullBodyUrl?`、`fullBodyMediaId?`、`threeViewUrl?`、`threeViewMediaId?`、`portraitUrl?`、`portraitMediaId?`
    - GlobalCharacterAppearance 同步加这些字段
    - 既有 `imageUrl` 字段保留（向下兼容，标 deprecated 注释）
  - 或方案 B：新表 `CharacterReferenceSet { id, appearanceId, type: 'fullBody'|'threeView'|'portrait', url, mediaId }`

- ⏸ 任务：角色生成流程改两步
  - 文件：`src/lib/workers/handlers/character-profile.ts`
  - Step A: 生「无背景全身图」（已有？确认现状）
  - Step B: 用全身图当 reference，并行生三视图 + 头像特写
  - 文件：`lib/prompts/novel-promotion/character_image_to_description.{zh,en}.txt` 与相关 prompt
    - 三视图：要求 front / side / back 三个角度
    - 头像：要求 close-up portrait

- ⏸ 任务：storyboard / panel 自动选 reference
  - 文件：分镜图生成相关 worker
  - 逻辑：当 panel 涉及 Character A
    - 若 panel 是近景 / 对白特写 → 用 portrait
    - 若 panel 是全身动作 → 用 fullBody
    - 若 panel 涉及多角度 → 用 threeView
  - 实现：在分镜图生成 prompt assembly 阶段，根据 panel.scale / panel.shotType 选 reference

- ⏸ 任务：UI 显示三视图 + 头像
  - 文件：character 编辑面板
  - 显示：全身像 + 三视图 + 头像，可分别重生

**驗收**：
- 同角色在 N 集视觉一致（人类 review 通过）
- 既有 imageUrl 字段不被破坏
- character generation 走 ai-runtime（不绕过）
- `npm run test:regression` + `npm run check:config-center-guards` 全绿

**风险**：
- ⚠️ 改 character generation pipeline，影响既有所有 project 的下游分镜图
- ⚠️ Schema 加字段是 additive，但 backfill 既有 character 是大工程（建议新创角色才生三视图，旧角色按需触发）

### Phase 11.5 风格 lock（P0，最小可行验证 + LumenX 借鑑）

**目标**：建立全局视觉锚点，让全片画风统一。**Phase 11 内最小投入、最先做的子任务**。

- ✅ 任务：Project 加 styleProfile（含 Q-005 連帶 MediaObject ownership）
  - 文件：`prisma/schema.prisma`
    - NovelPromotionProject 新增字段：`stylePositivePrompt String? @db.Text`、`styleNegativePrompt String? @db.Text`、`styleReferenceImages String? @db.Text`（JSON array of MediaObject ids）— 已落盤 line 257-259
    - 既有 `artStyle` enum 字段保留（schema-only deprecated；生產 code 完全停用，見下個子任務）— 註解 line 252 已標 deprecated
    - **Q-005 拍板 A：MediaObject 加 `uploadedByUserId String? @db.VarChar(36)` + `uploader User? @relation("MediaObjectUploader")` + `@@index([uploadedByUserId])`** — line 965-989，使 `assertReferenceImagesOwned` 與 `loadStyleProfile` 可做真實 owner 過濾

- ✅ 任务：所有 image / video generate 自动 inject style（含 Q-006 artStyle 完全停用 + Q-009 範圍擴大）
  - 文件：`src/lib/ai-runtime/index.ts`（chokepoint 接 `injectStyleProfile`，line 11 export injector）
  - 文件：`src/lib/ai-runtime/style-profile-injector.ts`（新；純函式：positive prepend、negative prepend、reference image inject when model supports）
  - 文件：worker handlers 全部接 chokepoint 並砍掉 `getArtStylePrompt` 直連：
    - `character-image-task-handler.ts`、`location-image-task-handler.ts`、`panel-image-task-handler.ts`、`panel-variant-task-handler.ts`、`asset-hub-image-task-handler.ts`、`asset-hub-modify-task-handler.ts`、`reference-to-character.ts`、`image-task-handlers-core.ts`、`image-task-handler-shared.ts`、`video.worker.ts`
    - **Q-006 拍板 A：完全停用 artStyle**：`getArtStylePrompt` 在 worker 端零呼叫；asset-hub 與 reference-to-character 等 handler 標明「artStyle deactivated」
    - **Q-009 拍板 A：範圍擴大**：variant / modify / asset-hub-modify 也接 styleProfile
  - 文件：`src/app/api/asset-hub/{characters,picker,voices}/route.ts`、`src/app/api/novel-promotion/[projectId]/{route.ts,location/route.ts,episodes/[episodeId]/route.ts,voice-lines/route.ts,generate-character-image/route.ts}` 等：把 artStyle 從 PATCH validator / 寫入路徑 / response 欄位拿掉
  - 文件：UI 4 處 `ART_STYLES` selector 全砍：`CharacterCreationForm.tsx`、`LocationCreationModal.tsx`、`ConfigEditModal.tsx`、`AddLocationModal.tsx` x2（novel-promotion + asset-hub）
  - 文件：`src/lib/workers/utils.ts`：`resolveImageSourceFromGeneration` / `resolveVideoSourceFromGeneration` 接 styleProfile 參數實際傳入 chokepoint（修 Bug-4）

- ✅ 任务：UI 风格设定面板
  - 文件：`src/app/[locale]/workspace/[projectId]/components/StyleProfilePanel.tsx`（新）
  - 文件：`src/app/[locale]/workspace/[projectId]/components/StyleProfilePresetPicker.tsx`（新）
  - 文件：`src/lib/style-profile/presets.ts`（4 preset：realistic / american-comic / anime / thick-paint）
  - 文件：`src/app/api/projects/[projectId]/style-profile/route.ts`（GET + PATCH，含 Q-005 真實 ownership check）
  - 文件：`src/lib/query/hooks/useStyleProfile.ts` + `src/lib/query/mutations/updateStyleProfile.ts` + `src/lib/query/keys.ts`
  - 文件：`ConfigStage.tsx` 接 `useStyleProfile` 把既有資料 prefill 進 panel（修 Q-008 / Bug-3 reviewer 抓的「Save 會清空既有資料」資料損失）

- ✅ 任务：迁移既有 artStyle 到 styleProfile（含 Q-007 fallback + Q-005 backfill）
  - 文件：`scripts/migrations/migrate-artstyle-to-style-profile.ts`（新）
  - **Q-007 拍板 B fallback**：unmapped artStyle（11 個非 4-preset enum 值）改用 `getArtStylePrompt(artStyle)` 字串當 positive prompt fallback，避免 silent skip 造成資料遺失
  - 文件：`scripts/migrations/backfill-media-object-uploader.ts`（新；Q-005 連帶；MediaObject → Generation/Project → User 反查回填 `uploadedByUserId`，孤立 row 標 NULL+log）

**驗收**：
- 同 project 内多集生成的画风一致
- 既有 artStyle 数据迁移到 styleProfile
- 改 negative prompt 后下次生成排除特定风格
- `npm run test:regression` + `npm run check:no-hardcoded-model-capabilities` 全绿

**风险**：
- ⚠️ 改 prompt 注入逻辑会影响所有 image / video 生成的 token 数与成本，要监控
- ⚠️ 不同 model 对 negative prompt 的支持度不同（capability catalog 需更新）

### Phase 11.5 P2 后续清理待办（user 拍板延后，非阻塞 11.5 验收）

- ⏸ 任务：移除 dead i18n key `visualStyle`
  - 文件：`messages/zh/novel-promotion.json:101`、`messages/en/novel-promotion.json:101`、`messages/zh/configModal.json:5`、`messages/en/configModal.json:5`
  - 变动：刪除 `storyInput.visualStyle` / `configModal.visualStyle` 4 條鍵（ART_STYLES selector 已砍，i18n key 變 dead code）
  - 驗收：`npm run check:prompt-i18n` 全綠（zh + en 同步刪）；UI grep `visualStyle` 0 命中

- ⏸ 任务：`asset-hub-modify-task-handler.ts:87` comment 改寫
  - 文件：`src/lib/workers/handlers/asset-hub-modify-task-handler.ts`（line 87 附近）
  - 變動：目前註解仍提 Q-009 sentinel，待 asset-hub 全量改成 per-user / per-project 二分後改寫，避免 Q-009 標記混淆後續 reader
  - 驗收：comment 不再引用 Q-009 sentinel；grep `Q-009` 命中數 0

- ⏸ 任务：N+2 release 移除 DB column `NovelPromotionProject.artStyle` / `artStylePrompt`
  - 文件：`prisma/schema.prisma`（line 250-256 附近 deprecated 區）+ 對應 Prisma migration
  - 變動：生產 code 已零讀寫；schema cleanup 在 N+2 release 執行 `ALTER TABLE NovelPromotionProject DROP COLUMN artStyle, DROP COLUMN artStylePrompt`
  - 驗收：grep `artStyle` 在 `src/` 0 命中（除 deprecation history 註解）；migration script 跑過 DEV / staging 通過

- ⏸ 任务：清掉 POST `/api/asset-hub/locations` backend forward `artStyle`
  - 文件：`src/app/api/asset-hub/locations/route.ts:52, 102`
  - 變動：worker 已 deactivated artStyle，但 route 仍 destructure `artStyle` 並 forward `artStyle: artStyle || 'american-comic'` 給 worker（屬 implementer round 2 偏離點，留下的 dead forward）
  - 驗收：route 不再 destructure artStyle；payload 不再含 artStyle 欄位；對應 integration test fixture 同步移除

- ⏸ 任务：reviewer round 3 指出順手砍 `getArtStylePrompt` 的 handler 是否需要正式測試覆蓋
  - 文件：`tests/unit/worker/asset-hub-image-task-handler.test.ts`（新或補）、`tests/unit/worker/reference-to-character-style-profile.test.ts`（已建，可能要補測 case）
  - 變動：`asset-hub-image-task-handler` / `reference-to-character` 等順手砍 `getArtStylePrompt` 的 handler 雖功能正確，但 reviewer 提醒目前測試覆蓋只到 happy path，缺「styleProfile null 時 fallback 不再 inject artStyle string」的 negative case
  - 驗收：每個改過的 handler 都至少有一個「styleProfile null + 確保 prompt 不含 artStyle 字串」的 unit test；coverage 達 80%

### Phase 12 New UI Pivot ✅(2026-04-30 一晚 dogfood pass 完成)

**Status**:12.0 → 12.8 全部完成,/v2/workspace/[projectId] 上線並設為 default。
6 個 step page 都接 real data,multi-shot batch CTA 接通,sidebar 顯示登入帳號(NextAuth session),legacy /workspace fallback 保留。完整 commit list:`d34f9c1`(skeleton)→ `a703019`(script)→ `2abb854`(subjects)→ `6754fc0`(storyboard 12.5.1)→ `074c434`(voice+final)→ `6a9ff7d`(sidebar user info + regen wiring)→ `5668625`(multi-shot 12.5.2)→ `cb9dabd`(default route 12.8)→ `1827f38`(home overview)→ `4d48d06`(live project name)。

**已 deploy build 13/14/15/16/17(rebuild 12.x 系列)**,droplet `art.kuiperfilmailab.com` 訪問 dashboard 點 project 預設進新 UI。

**已知遺漏 / Phase 12.x.x 跟進**(均不阻塞 Phase 12 收工):
- 12.5.3 LLM 自動依語意切 multi-shot group(目前是 client 側機械每 5 個一組)+ schema 加 panel.multiShotGroupId
- 12.6.x voice tuning slider 接 panel-level config + 套用至全部分鏡
- 12.7.x FFmpeg 全集合成 + 匯出 mp4
- 12.5.x video panel 「首尾幀生視頻」 CTA enable
- 12.5.x prompt builder chips 接 capabilityOverrides PATCH
- 12.x.x SubjectsPage 「鎖定」chip 接 character_profile_confirm

(Phase 12 原始規劃保留下方供查閱 — 以下為當初 scope)

### Phase 12 New UI Pivot 原規劃(基于 docs/ui-redesign/,**user 2026-04-30 拍板**)

#### 背景

11.x 系列(11.5/11.1/11.2 已完成,11.3/11.4 ⏸)已经把 backend 能力堆得够用 — multi-shot handler、22 styleProfile preset、character junction、tencent-vod audio fix 都已就位。但现有 frontend 是线性 stage navigation,user demo 时发现:
- 跟 Kino 视界 2.0 比起来「丑」「找不到东西」(整体 UX 不专业)
- multi-shot / 角色一致性等 advance feature 没 UI 入口
- styleProfile picker / 角色 regenerate 等关键 entry point 隐蔽

User 自己用 Claude 写了完整 UI 重设计规格,放在 `docs/ui-redesign/`(8 screens + design system + 4 phase plan),目标对标 Kino 4-Agent 架构 + drama-workshop 多 character schema + KuiperAI 既有 BCP 批量能力。User 也提供了具体 mockup `~/Downloads/kino_mockup.jsx`(已 ported 到 `/zh/preview` 路由)。

**Why pivot now:** user 明确说「目标不是 demo,要真实可用」。继续在现有线性 UI 加大 feature 等于「以后新 UI 起来再做一遍」,浪费 30-40% 工。直接重做 frontend layout(backend 不改,api/schema/worker 全部沿用)更快到 production。

**How to apply:** Phase 12 在 `feature/phase-11` 之后另起一个 branch,或直接在同 branch 增加 v2 路由。**不砍现有 `/workspace/[id]`**(留作 fallback,避免破坏正在跑的 demo 用户)。所有新功能都做在 `/v2/workspace/[id]` 下。

#### Phase 12.0 master plan 增补 + task tree

(本节)— 把 pivot 决定记录,对齐 docs/ui-redesign/ 跟现有 Phase 11.x 工作。

#### Phase 12.1 抽 Sidebar + TopBar 为 reusable component

`/preview/page.tsx` 内的 Sidebar(264px,Logo + 6 step + user block)跟 TopBar(STEP 编号 + 标题 + 进度条)抽成 `src/components/v2/Sidebar.tsx` + `src/components/v2/TopBar.tsx`。参数化 STEPS、active step、project name、进度。先用假资料,12.3+ 接真 project。

**验收:** 两个 component 可被 mockup `/preview` 直接用,且 TS clean。

#### Phase 12.2 建 /v2/workspace/[projectId] 路由 + 6 page skeleton

Next.js app router:
```
src/app/[locale]/v2/workspace/[projectId]/
├── layout.tsx                  Sidebar + TopBar shell
├── page.tsx                    redirect to /script(or home)
├── home/page.tsx              首页 OPC vs BCP
├── script/page.tsx            剧本(替代 NovelInputStage)
├── subjects/page.tsx          主体(替代 AssetsStage)
├── storyboard/page.tsx        分镜(替代 StoryboardStage)
├── voice/page.tsx             配音
└── final/page.tsx             成片
```

每个 page 先 import Sidebar/TopBar + 假内容,接资料留 12.3+。

**验收:** 6 个 page 都可访问,sidebar step 切换正确 highlight。

#### Phase 12.3 ScriptPage 接资料(剧本 / 故事 stage)

把 mockup 的 ScriptPage 接 `useNovelPromotionProject` + 上传小说 + 4 种起始方式 + 「生成剧本」mutation。画面比例 / 风格 chip 改用 22 个 styleProfile preset(下拉或 popover)。

**验收:** 进 /v2/.../script 可输入小说 → 触发既有 LLM pipeline → 看到 AI Draft 分镜结果。

#### Phase 12.4 SubjectsPage 接资料(角色 / 场景 / 道具)

Tabs 切换 character / location / prop。Grid 显示卡片(复用现有 character-list / location-list API)。每张卡有「重新生成」「锁定」(== confirm character_profile_confirm)。「进入分镜」按钮接 router.push storyboard。

**验收:** 角色/场景资产看得到、可重生、可锁定。

#### Phase 12.5 StoryboardPage 接资料 + multi-shot 整合 ⭐

**这是 Phase 12 最核心的 feature**:

3 栏 layout(左 prompt builder / 中 multi-model output / 右 inspector + cast + audio + notes)。接现有 storyboard panel API。**重点是 multi-shot 自动整合**:

1. LLM 分镜阶段(已有 `multi_shot_group` placeholder tag)依语意自动 group 2-3 panel(同场景 / 连续动作)
2. 每组送一个 multi-shot=intelligence task 给 Kling 3.0 / Omni
3. SubjectInfos 自动从 `EpisodeCharacter` junction 填(character.name + character.imageUrl)
4. 20-25 panel 短剧预期切成 ~10 个 multi-shot tasks,角色一致性靠 SubjectInfos 维持

`/api/.../generate-multi-shot-video` 已存在(平行 session 写),只需 UI 接通 + LLM prompt 加 group 标记逻辑。

**验收:** 一段 90 秒短剧(20-25 panel)→ 点「批量生成」→ 自动分组 → 出 ~10 个连贯 multi-shot 视频,角色跨镜不飘。

#### Phase 12.6 VoicePage 接资料(配音)

Filter rail(性别 / 情绪)+ voice grid(复用现有 voice 管理 API)。Tuning slider(情绪强度 / 语速 / 语调)接 panel-level voice config。

**验收:** 选 voice → 试听 → 套用至「全部」生成 audio + 关联到对应 panel。

#### Phase 12.7 FinalPage 接资料(成片)

Player + timeline + 导出 mp4。复用现有 video editor 逻辑(srt / FFmpeg pipeline)。Stats panel 显示总分镜 / 总时长 / 解析度 / 风格。

**验收:** 看到完整短剧播放 + 可下载 1080P mp4。

#### Phase 12.8 切换 default route → /v2/workspace

Header 点 project 从 `/workspace/[id]` redirect `/v2/workspace/[id]`。旧 `/workspace/[id]` 保留作 fallback。所有新建 project flow 走 /v2。

**验收:** 新用户 / 已有用户进 dashboard 点 project,默认进新 UI。

#### Phase 12 推进顺序

12.0 → 12.1 → 12.2 → 12.3 → 12.4 → 12.5 ⭐ → 12.6 → 12.7 → 12.8

预估 2-3 周(单 dev + Claude Code,一次只做一个子任务,每子任务都通 type-check + 部分 e2e + commit + push)。

#### Phase 12 跟 Phase 11.3 / 11.4 的关系

- **11.3 道具 first-class** ⏸ — 12.4 SubjectsPage 的「道具」tab 等于 11.3 的 UI;backend 11.3 schema 改动可在 12.4 同时做
- **11.4 角色三视图** ⏸ — 12.5 multi-shot 的角色一致性靠 SubjectInfos 已够,11.4 的「frontView/sideView/backView」是更深的 character.imageUrl 多视角扩展,可推迟到 Phase 13
- **11.1.5 / 11.2.5 follow-up debt** ⏸ — 12 系列做完会替换掉这些子任务的 UI,debt 可一次清

### Phase 11 推进顺序建议

按风险与价值排序：

1. **Phase 11.5**（最小验证，1 周）→ 跑通 Claude Code sub-agent orchestrator，建立信心
2. **Phase 11.1**（纯 UI，1-2 周）→ 用户核心需求，立即体感
3. **Phase 11.2**（schema migration，1-2 周）→ 把 11.1 的 UX 体验做扎实
4. **Phase 11.4**（核心一致性，2-3 周）→ 真正的产品差异化
5. **Phase 11.3**（道具，1-2 周）→ 补齐对手共有功能

每个子任务完成必须：
- 跑 `/verify`（含 `npm run test:regression`）
- `/sync-master-plan` 同步状态
- commit message 标注 Phase 编号（例如：`feat(phase-11.5): add style profile to NovelPromotionProject`）

# 4:验证策略

## 可量化目标
- 状态一致性：
  - 0 次出现“左侧已完成但主面板仍在流式输出”的矛盾状态。
  - 0 次出现步骤重复膨胀/覆盖错位。
- 恢复能力：
  - 刷新恢复完整率 100%（同一 run）。
  - 人工制造 seq 跳号后，1 次补拉内恢复完整。
- 稳定性：
  - 可重试错误均按策略重试；不可重试错误显式失败。
- 观测：
  - 每条关键日志含 `runId/stepKey/attempt`。

## 验证方式
- 单测：runtime、event seq、state guard、error mapping。
- 集成：story_to_script_run、script_to_storyboard_run 的成功/失败/重试路径。
- 回归：`npm run test:regression` 全绿。

## 当前验证执行记录（持续追加）
- ✅ `npx vitest run tests/unit/run-runtime/task-bridge.test.ts`
- ✅ `npx vitest run tests/unit/run-runtime/task-bridge.test.ts tests/unit/helpers/run-stream-state-machine.test.ts`
- ✅ `npx vitest run tests/unit/helpers/run-request-executor.run-events.test.ts tests/unit/run-runtime/task-bridge.test.ts tests/unit/helpers/run-stream-state-machine.test.ts`
- ✅ `npx vitest run tests/unit/helpers/run-request-executor.run-events.test.ts tests/unit/helpers/recovered-run-subscription.test.ts tests/unit/run-runtime/graph-executor.test.ts`
- ✅ `npm run build`
- ✅ `npm run test:regression` guard 阶段已通过（含新增 run routes catalog）
- ⚠️ `npm run test:regression` 二次执行阻塞于仓库现有单测失败（与本轮 runtime 改造文件无直接耦合）：
  - `tests/unit/optimistic/task-target-overlay.test.ts`（2 failures）
  - `tests/unit/billing/cost-error-branches.test.ts`（1 failure）
- ✅ `npm run build`（含 run-request-executor 改造后再次通过）

### Phase 11.5 本轮新增验证（working tree，feature/phase-11，未 commit）
- ✅ `npx tsc --noEmit -p tsconfig.json`：0 errors
- ✅ `npm run check:config-center-guards`：全綠
- ✅ `npm run check:no-multiple-sources-of-truth`：全綠
- ✅ `npm run check:no-hardcoded-model-capabilities`：全綠
- ✅ `npx vitest run tests/unit/style-profile/`：4 files / 44 tests pass（presets / injector / loader / migration / backfill-media-object-uploader）
- ✅ `npx vitest run tests/integration/api/style-profile.test.ts`：13 tests pass（含 Q-005 ownership BLOCK 修補後 fixture 改用合法 UUID 的 Bug-3 修補）
- ✅ `npx vitest run tests/unit/worker/chokepoint-style-injection.test.ts`：5 tests pass
- ✅ 其他 worker test 全綠（character-image / location-image / panel-image / panel-variant / modify-image-reference-description / image-task-handlers-core / video-worker / analyze-novel / reference-to-character + reference-to-character-style-profile），唯 pre-existing Q-003 panel-image-task-handler.test:188 與 script-to-storyboard.test x2 prisma mock 缺欄位 fail（非本 phase 引入）
- ✅ `npx vitest run tests/unit/media/service.test.ts`：5 tests pass（MediaObject.uploadedByUserId 寫入路徑）

### Phase 11.2 本轮新增验证（working tree，feature/phase-11，未 commit）
- ✅ `npx tsc --noEmit -p tsconfig.json`：0 errors（含 worker test `vi.fn` 用 generic 解 8 個 TS error）
- ✅ `npm run check:config-center-guards`：全綠
- ✅ `npm run check:test-route-coverage`：131→135 routes（本轮 catalog 加 4 個 entry：projects/[projectId]/characters / locations / import-character / import-location）
- ✅ `npm run check:test-coverage-guards`：全綠
- ✅ `npm run check:no-multiple-sources-of-truth`：全綠（junction = episodes-for-character SoT；panels.characters = panel 属性，两者 not redundant）
- ✅ `tests/unit/lib/episode-asset-bridge.test.ts`：22/22 pass（三层 name fallback 各路径 + skipDuplicates + projectId scope）
- ✅ `tests/integration/api/projects/import-character.test.ts`：8/8 pass
- ✅ `tests/integration/api/projects/import-location.test.ts`：8/8 pass
- ✅ `tests/integration/api/projects/characters-list.test.ts`：6/6 pass
- ✅ `tests/integration/api/projects/locations-list.test.ts`：6/6 pass
- ✅ `tests/integration/scripts/sync-episode-character-junction.test.ts`：8/8 pass（dry-run / commit / projectId scope / 三层 fallback / skipDuplicates / warning path）
- ✅ `tests/unit/components/ProjectAssets.test.tsx`：6/6 pass（jsdom）
- ✅ `tests/unit/worker/storyboard-junction.test.ts`：5/5 pass（worker handler 端 storyboard 落库后 junction 写入正确）
- ⚠️ 本轮无新 BLOCK 问题；pre-existing Q-002 / Q-003 / Q-004（Phase 11.5 / 11.1 同步阶段已登记）仍挡 `npm run test:regression` 完整链路，不在 Phase 11.2 范围内

### Phase 11.1 本轮新增验证（working tree，feature/phase-11，未 commit）
- ✅ `npx tsc --noEmit -p tsconfig.json`：0 errors
- ✅ `npm run check:config-center-guards`：5/5
- ✅ `npm run check:test-route-coverage`：131 routes（含本轮 episodes endpoint progress / thumbnail 欄位回填）
- ✅ `npm run check:test-coverage-guards`：全綠
- ✅ `tests/unit/episode-progress.test.ts`：8/8 pass
- ✅ `tests/unit/episode-thumbnail.test.ts`：7/7 pass
- ✅ `tests/unit/components/EpisodeList.test.tsx`：9/9 pass
- ✅ `tests/unit/components/EpisodeTabBar.test.tsx`：6/6 pass
- ✅ `tests/unit/components/ProjectSettings.test.tsx`：8/8 pass（涵盖 parseReferenceImageCount / capabilityOverrides 正規化 / styleProfileSummary isCustom 判断）
- ✅ `tests/integration/api/episodes-list.test.ts`：7/7 pass
- ✅ `tests/integration/workspace-page.test.tsx`：6/6 pass（**Q-2 B regression：切集保留 stage param** + **Q-4 A regression：不自动跳第一集** 双路径守住）
- ⚠️ 本轮无新 BLOCK 问题；pre-existing Q-002 / Q-003 / Q-004（Phase 11.5 同步阶段已登记）仍挡 `npm run test:regression` 完整链路，不在 Phase 11.1 范围内

## 当前问题登记（必须先记录再推进）
- ⚠️ 回归门禁未全绿：存在 3 个历史/并行改动引入的失败用例，导致 `test:regression` 无法通过。
- ⚠️ 本地构建环境 Redis 未监听 `127.0.0.1:16379`，`next build` 期间出现大量连接拒绝日志，但构建产物仍成功输出。
- ⚠️ Q-002（pre-existing，非本 phase 引入）：ripgrep 未裝 → `scripts/check-api-handler.ts` 用 `rg --files` 報 `command not found` → `npm run test:guards` 連帶失敗 → `npm run test:regression` 同樣中斷在第一步。建議解法：`brew install ripgrep` 或讓 guard fallback 到 `grep`。
- ⚠️ Q-003（pre-existing，非本 phase 引入）：worker handler test prisma mock 缺欄位導致 3 個用例 fail：`tests/unit/worker/panel-image-task-handler.test.ts:188`（`prismaMock.novelPromotionPanel.update` 期望被呼叫一次，實際參數對不上）+ `tests/unit/worker/script-to-storyboard.test.ts` 兩個 case（`Cannot read properties of undefined (reading 'deleteMany')` on `prisma.novelPromotionStoryboard.deleteMany`，看起來 mock factory 漏 model）。屬 Phase 8（複雜鏈路遷移）範疇。
- ⚠️ Q-004（pre-existing，非本 phase 引入，但屬 Phase 6 強約束違反）：`src/app/api/novel-promotion/[projectId]/safe-rewrite/route.ts:56, 74` 直連 `chatCompletion*` → 違反強約束「AI route 不准旁路 worker」「AI 必須走 ai-runtime」。`npm run check:no-api-direct-llm-call` 會抓出。需 Phase 6 / Phase 8 owner 處理改走 `createRun` → worker handler。

# 5:备注
- 本文档是唯一执行来源，必须与代码库保持同步。
- 禁止隐式回退、禁止兼容层、禁止静默吞错。
- 若遇阻塞，必须先登记到 `⚠️ 问题` 再继续可执行项。
