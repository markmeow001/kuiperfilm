# 08 当前差距与后续动作

## 已解决

1. step 重试标识混乱（动态后缀）已解决。
2. runId 透传不全导致桥接缺失已解决。
3. run/step 终态不一致问题已做后端投影收敛。
4. story/script 前端主链路已切换为 run-event 单通道（不再依赖 task SSE 兜底）。
5. `GraphExecutor`、`PipelineGraph`、`QuickRunGraph` 已落地并接入两条核心 worker 主路径。
6. `src/lib/ai-runtime/` 已落地并接入 story/script 两条核心链路。

## 未完全收口

1. 长尾 AI handler 已完成第一批迁移，但仍有部分直接调用 `llm-client`（如 shot 系列、`text.worker`、`storyboard-phases`）待收口。
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
