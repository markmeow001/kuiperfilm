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
- 当前已改动文件：26（本轮累计，含 runtime/service/bridge/worker/前端运行钩子/回归测试/文档集）

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
- ⏸ Phase 11: 竞品对标功能补完（基于 docs/competitor-features/ 分析；Top 5 优先）
  - ⏸ Phase 11.1: 「剧 → 集」UI 第一公民化（P0，纯前端，最契合用户核心需求）
  - ⏸ Phase 11.2: 角色 / 场景跨集共用 UX 强化（P0，含 junction table migration）
  - ⏸ Phase 11.3: 道具（Props）first-class asset（P1，新 model）
  - ⏸ Phase 11.4: 角色三视图（全身 → 三视图 → 头像）结构化（P0，跨集一致性核心）
  - ⏸ Phase 11.5: 风格 lock（正向 + 负向 prompt）（P0，最小可行验证）
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

- ⏸ 任务：Project 详情页加「集列表」主视图
  - 文件：`src/app/[locale]/workspace/[projectId]/page.tsx`
  - 文件：`src/app/[locale]/workspace/[projectId]/components/EpisodeList.tsx`（新）
  - 要求：
    - 进到 project 第一眼看到所有 episodes 的 grid
    - 每集显示：episodeNumber、name、缩略图（首镜或封面）、进度（剧本/分镜/视频完成度）
    - 顶部「+ 新建集」按钮
    - 点集进入既有的 stage workflow（带 episodeId param）

- ⏸ 任务：Episode 切换器在 workspace header 永久存在
  - 文件：`src/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/WorkspaceHeaderShell.tsx`
  - 要求：
    - 类似 PolyFilm 故事板的水平 tab（第1集 / 第2集 / ...）
    - 所有阶段（config / assets / storyboard / videos / voice）都能切集
    - 当前 episode 高亮
    - 「+ 新建集」end-of-tabs

- ⏸ 任务：Project 层级设定独立区块
  - 文件：`src/app/[locale]/workspace/[projectId]/components/ProjectSettings.tsx`（新或重构）
  - 显示：videoRatio（9:16 / 16:9）、targetDuration、artStyle、各种 model 配置
  - 集会继承这些设定（已是现状）

- ⏸ 任务：API 层补 episode CRUD 完整性检查
  - 文件：`src/app/api/projects/[projectId]/episodes/route.ts`（确认 / 补足）
  - 验收：POST 新增、PATCH 重排序、DELETE 删除都顺畅

**驗收**：
- 进到 project 看到 dashboard：剧名 + N 集 + 角色 N 个 + 场景 N 个
- header 任何阶段都能轻易切其他集
- 「新增集」一键搞定
- `npm run test:regression` 全绿

**风险**：
- ⚠️ Episode 切换涉及 client state（既有 useNovelPromotionWorkspaceController）改动，需确认 stage state 不会因切集错乱

### Phase 11.2 角色 / 场景跨集共用 UX 强化（P0，含 schema migration）

**目标**：「同一个剧当中共用角色跟场景」实质上 schema 已支持，本 Phase 强化 UX 让用户看得见、用得到，并加 junction table 让查询更准。

- ⏸ 任务：Project 层级的「角色 / 场景」分页
  - 文件：`src/app/[locale]/workspace/[projectId]/components/ProjectAssets.tsx`（新）
  - 要求：
    - 不论在哪集，都能在 workspace 看到该 project 所有角色 / 场景
    - 操作：新增、编辑、删除、从全局库导入
    - 显示该角色 / 场景在哪几集出现过（依赖下方 junction table）

- ⏸ 任务：新增 EpisodeCharacter / EpisodeLocation junction table
  - 文件：`prisma/schema.prisma`
    - 新增 model `EpisodeCharacter`：`{ id, episodeId, characterId, role?, createdAt }`，索引 `[episodeId, characterId]`
    - 新增 model `EpisodeLocation`：`{ id, episodeId, locationId, createdAt }`，索引 `[episodeId, locationId]`
  - 文件：`prisma/migrations/...`（新 migration）
    - 既有 `panels.characters` / `panels.location` text 字段保留（不破坏既有数据）
    - 但新增写入路径：当 panel 引用 character 时，同步写入 EpisodeCharacter
  - 文件：`src/lib/workers/handlers/script-to-storyboard.ts` 或对应 storyboard 生成路径
    - 在 panel / shot 落库时同步 upsert 到 junction table

- ⏸ 任务：从全局资产中心一键导入到 project
  - 文件：`src/app/api/projects/[projectId]/import-character/route.ts`（确认 / 补足）
  - 文件：`src/app/api/projects/[projectId]/import-location/route.ts`（确认 / 补足）
  - 逻辑：
    - 选 GlobalCharacter → 复制成 NovelPromotionCharacter
    - 设置 `sourceGlobalCharacterId` 标记来源
    - 复制 appearances / images（可选）
  - UI：在 ProjectAssets.tsx 加「从资产中心导入」按钮 + selector

- ⏸ 任务：同步既有 panels.characters / panels.location 数据到 junction table
  - 文件：`scripts/migrations/sync-episode-character-junction.ts`（新）
  - 一次性脚本：扫所有 panels，反查 character/location 名 → id，回填 junction table

**驗收**：
- Project 详情页有独立「角色 / 场景」分页
- Episode 1 加角色，Episode 2 自动看得到、可选用
- Junction table query 能跑：`SELECT episodes WHERE character_id = X`
- 既有数据迁移不丢失
- `npm run test:regression` + `npm run check:no-multiple-sources-of-truth` 全绿

**风险**：
- ⚠️ Schema migration 高风险，必须分两步发布（add table → backfill → enforce）
- ⚠️ panels.characters text 字段与 junction table 双写期间数据一致性问题，要明确 source of truth（建议 junction 为主，text 为兼容遗留）
- ⚠️ 既有 sourceGlobalCharacterId 关系不能断

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

- ⏸ 任务：Project 加 styleProfile
  - 文件：`prisma/schema.prisma`
    - NovelPromotionProject 新增字段：`stylePositivePrompt String? @db.Text`、`styleNegativePrompt String? @db.Text`、`styleReferenceImages String? @db.Text`（JSON array of URLs）
    - 既有 `artStyle` enum 字段保留（向下兼容，可视为 styleProfile 的 preset 来源）

- ⏸ 任务：所有 image / video generate 自动 inject style
  - 文件：`src/lib/ai-runtime/`（image / video adapter 添加 styleProfile 参数）
  - 文件：相关 storyboard / character / location image generate handler
  - 注入规则：
    - positive prompt prepend `styleProfile.positivePrompt`
    - negative prompt prepend `styleProfile.negativePrompt`
    - 若 model 支持 reference image，inject `styleReferenceImages`

- ⏸ 任务：UI 风格设定面板
  - 文件：`src/app/[locale]/workspace/[projectId]/components/StyleProfilePanel.tsx`（新）
  - 内建 preset：写实 / 美漫 / 动漫 / 厚涂（每个 preset 包含 positive + negative pair）
  - 可自定义 positive + negative
  - 可上传 reference image 当风格锚点（走 MediaObject）

- ⏸ 任务：迁移既有 artStyle 到 styleProfile
  - 文件：`scripts/migrations/migrate-artstyle-to-style-profile.ts`（新）
  - 一次性脚本：扫所有 NovelPromotionProject，根据 artStyle enum 填入对应的 positive + negative prompt

**驗收**：
- 同 project 内多集生成的画风一致
- 既有 artStyle 数据迁移到 styleProfile
- 改 negative prompt 后下次生成排除特定风格
- `npm run test:regression` + `npm run check:no-hardcoded-model-capabilities` 全绿

**风险**：
- ⚠️ 改 prompt 注入逻辑会影响所有 image / video 生成的 token 数与成本，要监控
- ⚠️ 不同 model 对 negative prompt 的支持度不同（capability catalog 需更新）

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

## 当前问题登记（必须先记录再推进）
- ⚠️ 回归门禁未全绿：存在 3 个历史/并行改动引入的失败用例，导致 `test:regression` 无法通过。
- ⚠️ 本地构建环境 Redis 未监听 `127.0.0.1:16379`，`next build` 期间出现大量连接拒绝日志，但构建产物仍成功输出。

# 5:备注
- 本文档是唯一执行来源，必须与代码库保持同步。
- 禁止隐式回退、禁止兼容层、禁止静默吞错。
- 若遇阻塞，必须先登记到 `⚠️ 问题` 再继续可执行项。
