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

### Phase 11.4 角色三视图(front/side/back)schema 待加

User 2026-04-30 拍板:角色升级到三视图(`front` / `side` / `back`),提升 multi-shot 跨镜一致性。

Schema 决策:
- `CharacterAppearance.viewType String?` (`'front' | 'side' | 'back' | null`),null 代表 legacy 单图
- `@@unique([characterId, appearanceIndex])` 改成 `@@unique([characterId, appearanceIndex, viewType])`
- `GlobalCharacterAppearance` 同步加 `viewType`(对称)

Worker 改:
- `panel-image-task-handler` 按 `panel.shotType` 挑对应视图(正面镜头取 front,侧面镜头取 side)
- `multi-shot-video-handler` 的 `SubjectInfos.N` 也按视图选

UI:
- V2SubjectsPage 角色卡展开 = 三视图 grid + 「补生 side / back」按钮(不自动全补,避免 3x credit cost)

**当前阻塞**:Session A 正在 iterate `analyze-novel.ts` + character image generation 的 contract bug(commits `b492fb4` / `6462ee6` / `69df394`)。Phase 11.4 schema 改 `CharacterAppearance` unique key,跟他们正在改的字段直接冲突。等他们收尾后再开。
