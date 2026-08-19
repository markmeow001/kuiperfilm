# 08 当前差距与后续动作

## 已解决

1. step 重试标识混乱（动态后缀）已解决。
2. runId 透传不全导致桥接缺失已解决。
3. run/step 终态不一致问题已做后端投影收敛。
4. story/script 前端主链路已切换为 run-event 单通道（不再依赖 task SSE 兜底）。
5. `GraphExecutor`、`PipelineGraph`、`QuickRunGraph` 已落地并接入两条核心 worker 主路径。
6. `src/lib/ai-runtime/` 已落地并接入 story/script 两条核心链路。

## 未完全收口

1. ~~长尾 AI handler 仍有部分直接调用 `llm-client`（shot 系列 / `text.worker` / `storyboard-phases`）待收口。~~
   ✅ 已收口（2026-07-04 核实）：`src/` 内 `@/lib/llm-client` 生产端已无直接 import，`chatCompletion(` 直呼仅存在于
   `src/lib/llm/*` 基础层；最后一处 API route（`safe-rewrite`，见 Q-004）已改走 `executeAiTextStep`（ai-runtime）。
   `check:no-api-direct-llm-call` 绿。（`src/lib/llm-client.ts` 现为 `./llm/runtime` 的薄 re-export shim。）
2. 图片/视频/音频页面的运行态展示与控制仍存在 task-state 路径，未全部切到 run-store。
3. 旧 task-stream 基础设施仍用于非 run 页面，尚未最终下线。

## 下一个迭代优先级

1. P0：将其余 AI worker handler 全量切到 `src/lib/ai-runtime/`。
2. P0：图片/视频/音频运行 UI 与取消控制统一到 run-store。
3. P1：移除剩余 task-stream 作为主状态源的代码路径。
4. P1：补齐全链路回归并清理 dead code。

## 完成定义（DoD）

1. `story_to_script_run` 和 `script_to_storyboard_run` 均由 graph runtime 驱动。
2. 所有 AI route 通过同一运行时协议暴露状态。
3. `npm run test:regression` 全绿。
4. 主控文档阶段状态全部切为 `✅ 已完成`。

---

## Phase 11+ 留下的语义缺口

### Multi-shot 合成时长窗口仍是 provider 级硬编码（Phase 1.5C 后续）

`src/lib/workers/handlers/multi-shot-duration-window.ts` 的 `WINDOWS_BY_PROVIDER`
把 multi-shot 合成总时长窗口（Seedance 2.0 = 4–15s、tencent-vod = Kling Omni 15s）
**按 provider 硬编码**。这是把原本散在 4 个 path 文件的 4 份拷贝收敛成单一来源的
中间态，比之前好，但仍不是从 capability catalog 解析。

**为什么没直接走 catalog**：
- `taijiai`（BobAPI）完全不在 `standards/capabilities/image-video.catalog.json` 里。
- `VideoCapabilities`(`model-config-contract.ts`) 没有「合成总时长窗口」字段 —— catalog
  现有的 `durationOptions` 是**单次调用**的 per-shot 时长选项，跟 multi-shot composite
  的**总时长上限**是两个不同概念，不能直接复用。

**收口动作**（建议跟 Phase 1.5C slice 3 worker 重构一起，或之后独立做）：
1. `VideoCapabilities` 加 `multiShotCompositeMinSec?` / `multiShotCompositeMaxSec?`。
2. catalog 补 taijiai 条目。
3. `getMultiShotDurationWindow(provider, modelId)` 改从 catalog 按 (provider, modelId) 解析，删 `WINDOWS_BY_PROVIDER` 表。

目前硬编码不影响主链路（值正确、单一来源、未知 provider 显式 throw），不阻塞。

### panelGenerationMode 在 9 个建立点逐一盖章（Phase 1.5C 后续）

`panelGenerationMode: defaultPanelGenerationMode(...)` 目前在 9 个 `novelPromotionPanel.create`
调用点手动重复。专案没有共用的 panel-create helper（全是裸 `prisma.create`，pre-existing
风格），也没用 Prisma extension。**风险**：第 10 个建立点会 silently 漏盖 default。

**收口动作**：Phase 1.5C slice 3 重构 worker dispatch 时，顺势抽
`createNovelPromotionPanel({ data, projectGenerationMode?, sourcePanelMode? }, tx)` 单一
choke point，把 9 个调用点收敛进去（也能顺带统一 PATCH/PUT 的 create-if-missing 分支）。
未做前：新增 panel 建立点务必记得带 `panelGenerationMode`。

### MediaObject 跨用户 import 时的 ownership 语义（Phase 11.2 Q-005 后续）

Phase 11.5 Q-005 给 `MediaObject` 加了 `uploadedByUserId`,让 `assertReferenceImagesOwned` 能拒绝跨用户引用别人上传的图。但 Phase 11.2 import-from-global 流程把 `GlobalCharacter.appearances[*].imageMediaId` 直接拷到 `NovelPromotionCharacter.appearances[*].imageMediaId` 时,对应的 MediaObject 仍然挂在 **原 uploader**(global asset 创建者 user A)名下。

**后果**:
- User B 从 user A 的 GlobalCharacter import 一个角色到自己的 project;project 角色的 `appearance.imageMediaId` 还指向 user A 的 MediaObject;
- 下游若有 `assertReferenceImagesOwned` 类的所有权门(11.5 已对 styleProfile 装上,但还没卷到 character appearance image),可能把 user B 拒掉,因为他「引用了一张自己没上传的图」;
- 反方向:如果 user A 删掉 GlobalCharacter,他的 MediaObject 也可能 GC 掉,user B 的 project 会出现 broken image ref。

**三种可能的语义**(待拍板):
1. **转嫁 ownership**(import 时把 `MediaObject.uploadedByUserId` 改为 user B):清晰但破坏 user A 的「我上传的资产」视图。
2. **保持原 uploader**(现状):关系简单但暴露上述两种 corner case。需要 11.5 ownership-check 增加「team-shared global asset 例外」豁免。
3. **clone MediaObject**:import 时把图二次上传一份给 user B 名下,user A / user B 的 MediaObject 完全独立。最贵(双倍存储)但最干净。

**建议**:Phase 11+ 收尾时再决,目前 demo 阶段三种行为差异不影响主链路。当 11.5 把 `assertReferenceImagesOwned` 卷到所有 character / location image 之后,必须先选定语义,否则会随机 403。

---

### Phase 11.3 道具图像生成 worker 待接

11.3 Stage 1(schema + CRUD API + 14 regression tests)已完成(commit `40d8e4a`)。Stage 2-3 待接:
1. analyze-novel prompt 抽取 `props` 字段 alongside `new_characters` / `locations`
2. 新 `prop-image-task-handler.ts` worker 走 `IMAGE_PROP` 任务类型
3. V2SubjectsPage `道具` tab 接 useQuery + create/upload UI

Stage 2-3 等 Session A 在 v2 创作流程稳定后再接,避免与他们的 character 修复并行改 analyze-novel.ts。

---

### ~~Phase 11.4 角色三视图~~ — Session A 用不同路径完成(2026-05-01)

Session A 在 `9b68107` 把既有 `CHARACTER_REFERENCE_TO_SHEET` worker(已支援 3 视角输出)wire 进 V2CharacterEditModal「上传并转多视角」CTA,重用 `CharacterAppearance.imageUrls` JSON array(3 张图一笔 row),**0 schema 改动**完成需求。

跟我之前规划的 `viewType` column 路径不同 — 他们更轻量。Phase 11.4 视为完成,本条移除。

---

## E2E pipeline 验证 — 2026-05-01 跑通

完整 cascade pipeline 端到端跑通(admin 帐户、prod art.kuiperfilmailab.com):

```
project → episode → novelText →
analyze_novel (43s) → clips_build (129s) → script_to_storyboard_run (587s) →
image_character (~3min) → image_panel (30s) → video_multi_shot Kling-Omni B-path (105s)
```

3 角色 / 4 场景 / 3 storyboards / 21 panels / 1 character image / 1 panel image / 1 multi-shot mp4。

测试脚本落地在 `scripts/e2e/cascade-smoke.sh`,deploy 后跑一次能在 ~15 分钟验证主链路是否还通。

### 期间发现 + 修了 2 个 bug

**Bug #1 — locale heisenbug(`871d560`)**

`src/lib/workers/shared.ts` 的 `withFlowFields` 只 merge flow 字段(flowId / runId / 等),没把 `jobData.locale` 注 payload.meta。worker 进度更新走 `tryUpdateTaskProgress` 直接覆写 `task.payload` 整块,导致 `submitTask` 入库时写好的 `meta.locale` 被丢掉。

后果:任何 task 跑到一半被 reconcile / instrumentation re-enqueue 撿起来时,`resolveTaskLocaleFromPayload(task.payload)` 找不到 locale → 标 `TASK_LOCALE_REQUIRED FAILED`,**真正失败原因被这个 secondary error 蓋掉**。E2E 跑 storyboard 跑了 8 分钟最后看到的就是这个误导错误,实际可能是 LLM 超时 / OOM / 其他。

修法:`withFlowFields` 强制把 `jobData.locale` 注 outgoing payload.meta。jobData.locale 在 BullMQ job 上一定有(submitter 写进去),这是 canonical source。

**Bug #2 — 不寬容 video pricing(`eaadf9f`)**

`src/lib/billing/task-policy.ts:buildDefaultTaskBillingInfo` 只 catch `BILLING_UNKNOWN_MODEL`,对 `BILLING_UNKNOWN_VIDEO_RESOLUTION` / `BILLING_UNKNOWN_VIDEO_CAPABILITY_COMBINATION` / `BILLING_CAPABILITY_PRICE_NOT_FOUND` 直接 throw 出去,500 给 client。

Tencent VOD Kling-3.0-Omni 在 capability catalog 里 priceLabel='--'(没设 pricing),所以**所有** multi-shot video 触发都 500。`/generate-multi-shot-video` endpoint payload schema 又没传 resolution,task-policy 默认 '720p'(小写)跟 capability key '720P'(大写)mismatch,即使 pricing 在 catalog 里也会 fail。

修法:catch list 扩大到上述 3 个 code,跟 `BILLING_UNKNOWN_MODEL` 同样 fallback 语义 — task 跑、不算钱,等 pricing 入库再开账。

### 还没测的下游

- **voice-analyze + voice-line generation**: storyboard 跑完后会自动产 voice 任务,这次 e2e 没主动验证 voice 走完整流程
- **lip-sync (fal)**: admin 帐户 fal apiKey 是空的,这步直接 skip。等 fal 接上再测
- **stitch-mp4 (Phase 12.7)**: 全集 ffmpeg 拼接,需要前面所有 panel 都有 video

### 还没查清的 root cause

E2E 第一轮跑 storyboard 时跑到 `voice_analyze` 那个 phase,worker 进 LLM streaming 后(`stage=worker_llm_streaming` seq=1709)就不再有事件,task 最终被 reconcile 撿起来标 `TASK_LOCALE_REQUIRED`(由 Bug #1 的 secondary error)。修 Bug #1 后第二轮跑通了,但**那次中断的真正 root cause** — 是 LLM 超时、heartbeat 过期、worker container OOM、Redis 短断、还是别的 — 没查到。

判断:第二轮 (commit 871d560 deploy 后) 跑通有可能只是这次 timing 没踩到那个 corner case,不代表问题不存在。Prod 高负载 / 长尾 / 多用户并发场景仍可能再现,只是这次不会被错的 errorCode 误导。

下一轮 e2e 完整跑(包含 `3a57b6b` 的 root-cause cleanup deploy)如果再次踩到中断,因为 service.ts 的 meta merge 不再丢 locale,真正的 errorCode 会浮出来,届时再追。

### 下次 deploy 后 SOP

```bash
# 在 dev 机或 droplet 上
E2E_USERNAME=admin E2E_PASSWORD=... ./scripts/e2e/cascade-smoke.sh
# 完整 ~15 min(含 8min 视频),~$0.05–0.15 LLM/image 费用 + Tencent VOD 配额
```

详细使用见 `scripts/e2e/README.md`。

---

## AtlasCloud 配音 cutover 收尾（2026-08-19）

配音生成已收敛为 AtlasCloud Seed Audio 1.0 单一路径，FAL voice 全链移除。以下为本轮**未收口**的项目。

### G-1 production 仍可能存在未完成的 FAL voice 任务（需人工对帐）

FAL voice 已从代码中完全移除。残留的 `FAL:VOICE:*` external id 现在被
`classifyPaidVoiceProviderHandoff()` 归类为 `malformed`，而 `malformed` 仍被
`isProtectedVoiceLineProviderHandoff()` 视为**受保护**：

- `voice-line-job-recovery` 不再重建这类 job，一律 `quarantined`
- `tryMarkPaidVoiceProviderTerminalFailure` 拒绝为其打终态标记
- 因此**不会退款、不会重送、不会重复扣款**，但也**不会自动完成**

这些 task 会停在 QUEUED/PROCESSING 直到人工处理。cutover 当下无法连到 production
DB 确认数量（本机 `.env` 指向 dev 库）。**需要执行的只读盘点**：

```sql
SELECT id, type, status, externalId, createdAt
FROM Task
WHERE externalId LIKE 'FAL:VOICE:%'
  AND status IN ('QUEUED', 'PROCESSING');
```

若有结果，逐笔到 FAL 后台确认该 request 是否已产出音频，再决定补发或退款。若为 0，本项即可关闭。

### G-2 `qwen-voice-design.ts` 已无 import 端

AI 声音设计的两个入口（项目 / Asset Hub）都已在 HTTP 层与 worker 层关闭于
`VOICE_SOURCE_CONSENT_REQUIRED`，`handleVoiceDesignTask` 的 provider 主体因此不可达，
`src/lib/qwen-voice-design.ts` 不再被任何产品代码 import（`billing/task-policy.ts` 与
`billing/cost.ts` 只引用字符串 `'qwen-voice-design'` 作为 model id，非模块依赖）。

未删除，因为 `TASK_TYPE.VOICE_DESIGN` / `ASSET_HUB_VOICE_DESIGN` 仍需保留给既有 Task 行与
计费历史。待 VoiceSource + Consent + Revocation schema 落地时一并决定是重写还是移除。

### G-3 Asset Hub 声音 UI 仍呈现已被后端拒绝的能力

`src/app/[locale]/workspace/asset-hub/components/VoiceSettings.tsx` 仍保留
`type="file"` 上传与 `onVoiceDesign` 入口，且
`tests/unit/voice/project-custom-voice-ui-source-contract.test.ts` 明确断言其存在。
但对应的 `/api/asset-hub/voices/upload` 与 `/api/asset-hub/voice-design` 已一律回
400 `VOICE_SOURCE_CONSENT_REQUIRED`。使用者会看到可点击但必定失败的按钮。

项目侧已改为 fail-closed placeholder（`VoiceDesignDialog.tsx`），Asset Hub 侧尚未对齐。

### G-4 `useUploadProjectCharacterVoice` 仍是已关闭端点的活 client hook

`src/lib/query/mutations/character-voice-mutations.ts` 导出、且
`src/lib/query/hooks/index.ts` 再导出该 hook，但
`POST /api/novel-promotion/[projectId]/character-voice` 已回 400
`VOICE_SOURCE_CONSENT_REQUIRED`。与本轮已删除的 `useDesignProjectVoice` 属同一类残留，
本轮未一并处理（不在授权范围内）。

### G-5 `reference-to-character-api.test.ts` 在完整 api 套件内是 flaky（既有问题）

`tests/integration/api/specific/reference-to-character-api.test.ts` 的
`[safe wrapped reference]` 用例在完整 `test:integration:api` 套件中会**间歇性**失去
`@/lib/api-auth` mock，落到真实实作并抛
``` `headers` was called outside a request scope ``` → 500（期望 200）。

**已证实为 flaky，非确定性失败。** 同一份程式码连跑两次完整 `npm run test`：

| 执行 | 程式码 | 结果 |
|---|---|---|
| 基准 `9acd5e7` 完整链路 | 未改动 | 绿 |
| 基准 `9acd5e7` api 单跑（worktree） | 未改动 | 绿 |
| 本轮最终版 api 单跑 | 同下 | 绿（86 files / 859 tests） |
| 本轮最终版 完整链路 第 1 次 | 同上 | **1 失败**（本用例） |
| 本轮最终版 完整链路 第 2 次 | 同上 | 绿（505 files / 4312 tests） |

调查过程中另外观察到 `playground-run-seedance-normalization.test.ts`（mock 呼叫累积
成 2 笔而非 1 笔）与 `direct-submit-routes.test.ts` lip-sync 401 用例也曾一起失败，
显示这不是单一用例的问题，而是整个 api 套件的状态残留。

**成因**：该档以 runtime `installAuthMocks()`（`vi.doMock`）搭配 `beforeEach` 的
`vi.resetModules()` 建立 auth mock，而非专案其他档案惯用的顶层 hoisted `vi.mock`
（例：`voice-presets-catalog.test.ts`）。`vitest.config.ts` 又使用 `pool: 'forks'` 且
`minForks/maxForks = 1`，86 个档案在同一个 fork 内依序执行，放大状态残留。

**尝试过但退回的修法**：把该档改成顶层 hoisted `vi.mock('@/lib/api-auth', ...)`
搭配从 helper 汇出的 factory。失败 —— `beforeEach` 的 `vi.resetModules()` 会让
factory 内 `await import(helper)` 拿到全新的 helper 实例（`state` 重置），与静态
汇入的 `mockAuthenticated()` 操作的不是同一份 state，7 个用例全变 500。已完整还原，
未留下任何改动。正确修法需要一并处理 helper 的 state 生命周期，属测试基础设施重构，
超出本轮授权范围。

**对本轮的影响**：voice-design route 原本要从 `direct-submit-routes` 重新归类到 crud
群组。观察到该变更似乎会提高失败频率，因此退回原分组（已在 `route-catalog.ts` 加注），
关闭契约改由专用档 `tests/integration/api/voice-design-consent-boundary.test.ts`
断言（5 cases，涵盖专案与 Asset Hub 两个入口）。**但须诚实说明：这个归类决定是在
带噪声的证据下做的** —— 既然本用例已证实为 flaky，当初「移进 crud 群组会破坏套件」
的推论就不可靠。修掉 flake 之后应重新评估该 route 的正确分组。
