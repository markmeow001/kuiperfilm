# 导演台 v3 — 镜头预演（previz）建置计画

> **进度 2026-07-13**：S1/S2/S3 已完成于分支 `feat/director-previz`（5 commit：
> 2c84848→56e9e8a）。95 previz 相关 tests 绿、tsc/eslint 干净、`npm run build` 过；
> unit:all 的 4 红与 integration:api 的 31 红均验证为基准 commit 既有（与本轮无关）。
> **待办**：① 浏览器人工冒烟（预演播放/录制导出/R2V 真生成一轮）② 拍板后并入
> feature/phase-11 部署 ③ S4（AI 导演路线）后置未做 ④ 走路循环（S2 后补项）未做。

> 2026-07-12。对标「一幕预演台」（AI 影像镜头预演工具，见 user 提供 4 张截图）。
> 把现有 3D 导演台从「静态截图机」升级为「会动的预演台」：时间轴多镜头、起幅落幅、
> 运镜线、调度线、预演播放、**导出预演视频直接喂给 R2V**。
>
> 前置：`docs/plans/2026-06-27-canvas-libtv-clone.md`（导演台 v2 的由来）。

## 为什么值得做（战略理由）

对标产品的杀手锏是「导出预演视频 → 喂给 AI 视频模型」，但它止步于导出文件。
我们的下游**已经全部现成**：

| 它导出的 | 我们对应的现成管线 |
|---|---|
| 预演视频（≤15s） | R2V 参考视频（Seedance 2.0 R2V 9-ref / Kling O3，AtlasCloud 上限恰好 15.2s） |
| 关键帧图 | `referenceImages`（起幅/落幅截图，capture() 现成） |
| 导演指令 | 视频 prompt（我们有 v3 字段化 prompt 工程） |
| 镜头数据 JSON | `data.stage` 序列化（现成） |
| 角色一致性 | 卡司节点 refs 自动接线（DirectorNode 现成） |

做完 = 「3D 排练 → 一键出成片」闭环，整合度超过对标品。

## 现状盘点（导演台 v2 已有 / 缺）

已有（`src/app/[locale]/canvas/director/`，~1900 行）：
- 关节级 rig 素体（8 体型、姿势预设、逐关节 slider）、多机位（位置/注视/FOV/荷兰角/追踪人物）、
  平面/全景球背景、画幅、场景树、隐藏/锁定、TransformControls、静态截图→发送 frame 节点。

缺（= 本计画范围）：
1. 镜头序列 + 时间轴（一幕 ≤15s 拆多镜头）
2. 起幅/落幅 + 运镜关键点 → 摄像机动画
3. 调度线（人物走位）+ 道具（对标品有车/几何块，我们一个道具都没有）
4. 预演播放（播放镜头/播放全片 + 进度条）
5. 导出：录制 → MP4（1080p，9:16/16:9）→ 上传 → 自动接进画布视频节点喂 R2V
6. AI 导演路线方案（文字 → LLM 出 2-3 套镜头方案自动摆台）

## 路线决定

| 项 | 决定 | 理由 |
|---|---|---|
| 数据模型 | `stage.shots?: StageShot[]`（v3 增量字段） | `normalizeStage` 已有版本迁移惯例（v1 camera→v2 cameras），旧存档零破坏 |
| 动画求值 | 纯函数 `evalShot(shot, t)`，与 three.js 渲染分离 | 可单测（项目铁则：行为断言）；渲染层只消费求值结果 |
| 运镜插值 | 起幅→[运镜点…]→落幅 走 CatmullRom；fov/roll lerp | 与截图交互一致（黄色箭头 waypoint 线） |
| 走位 | S2 先滑动（位置沿调度线 + 朝向=切线），走路循环(摆臂摆腿)后补 | rig 已支持逐关节，程序化 sine 摆动可后加不阻塞主线 |
| 录制 | `canvas.captureStream(30)` + MediaRecorder(vp9/webm)，**服务端 ffmpeg 转 MP4+裁切缩放** | ffmpeg 已在容器内（`src/lib/video-tail-frame.ts` 先例）；一次解决 webm 兼容 + 精确 1080×1920 输出 |
| 转码位置 | 新 API route `/api/canvas/previz-export`（execFile ffmpeg，60s timeout，≤50MB） | ≤15s 短片转码秒级，非分钟级长任务；沿用 tail-frame 的 execFile 模式。若实测超时再迁 worker |
| 导出去向 | 上传为 reference video key → DirectorNode 生成 video 节点（`referenceVideos=[key]`）+ 自动接卡司 | `PlaygroundRunSubmission.referenceVideos` 已存在；upload-reference 已收 video ≤50MB |
| 时长约束 | 全片 ≤15s（硬顶，UI 显示 00:xx/00:15.0），单镜 0.5–15s | 对齐 AtlasCloud R2V 参考视频 15.2s 上限（2026-07-09 bug 的教训：**导出路径也要在 route 校验**，别只靠前端） |
| AI 路线方案 | 新 route 沿用 `/api/canvas/text` 的接法（不旁路 worker/task spine 铁则） | LLM 输出结构化 JSON（Zod 校验）→ 客户端用 camera-presets `computePreset` 落成 StageShot[] |
| 道具 | 基础几何体（方块/球/圆柱/「车」低模组合体），复用 mannequin 的 transform/隐藏/锁定通道 | 对标品截图核心元素；不做外部模型导入（YAGNI） |

新依赖：**零**（three/fiber/drei/MediaRecorder/ffmpeg 全部已有）。

## 数据模型（v3 增量，落 `director/previz-types.ts`）

```ts
/** 一个镜头的某端（起幅或落幅）：机位 + 全体人偶/道具的摆位快照 */
export interface ShotKeyframe {
  camera: { position: Vec3; target: Vec3; fov: number; roll?: number }
  /** id → 摆位。缺席的 id = 该镜头内不动（沿用舞台常驻位）。 */
  actors: Record<string, { position: Vec3; rotation: Vec3 }>
}

export interface StageShot {
  id: string
  label: string                 // 「01 开场·远景」
  note?: string                 // 「远景 / 建立空间」（景别/机位/运镜描述，喂导演指令）
  durationSec: number           // 0.5–15，全片合计 ≤15
  start: ShotKeyframe           // 起幅
  end: ShotKeyframe             // 落幅
  cameraWaypoints?: Vec3[]      // 运镜关键点（起幅→…→落幅 CatmullRom）
  movePaths?: Record<string, Vec3[]>  // actorId → 调度线中间点
  easing?: 'linear' | 'easeInOut'     // 默认 easeInOut
}

export interface StageProp {    // 道具（与 StageMannequin 平行）
  id: string
  label: string
  kind: 'box' | 'sphere' | 'cylinder' | 'car'
  position: Vec3
  rotation: Vec3
  scale: Vec3                   // 道具允许非等比
  color: string
}

// DirectorStageState v3 追加：
//   props?: StageProp[]
//   shots?: StageShot[]
// normalizeStage() 同步扩展：坏数据降级（沿用 vec3()/isObj() 惯例），旧档 shots=[]。
```

求值器（`director/previz-eval.ts`，纯函数，不 import react/fiber）：

```ts
/** t∈[0,1] → 该时刻的机位姿态 + 每个 actor 的位置/朝向（朝向=路径切线，可被 rotation lerp 覆盖） */
export function evalShot(shot: StageShot, t: number): {
  camera: { position: Vec3; target: Vec3; fov: number; roll: number }
  actors: Record<string, { position: Vec3; rotation: Vec3 }>
}
/** 全片时间 → { shotIndex, tInShot }（按 durationSec 累计切） */
export function locateInSequence(shots: StageShot[], timeSec: number): { index: number; t: number }
```

## 切片计画

### S1 — 镜头动画核心（时间轴 + 起幅落幅 + 播放）

交付：能建镜头序列、设起幅/落幅、按「预演」看摄像机动起来、逐镜/全片播放、进度条 scrub。

| 动作 | 文件 |
|---|---|
| previz 类型 + normalize 扩展 | 新 `director/previz-types.ts`；改 `stage-types.ts`（state 加字段 + normalizeStage 委托） |
| 求值器（插值/序列定位） | 新 `director/previz-eval.ts` |
| 播放 hook（rAF 时钟、play/pause/seek/速率） | 新 `director/use-previz-playback.ts`（<400 行，line-count guard 对 `use*` 生效） |
| 时间轴条（镜头卡片列 + 00:08.5/00:15.0 + 上一镜/预演/下一镜/速率/截帧） | 新 `director/PrevizTimeline.tsx` |
| 镜头检查器（复制当前到起幅/落幅、「当前摄影机视角设为起幅/落幅」、时长、easing） | 新 `director/PrevizShotPanel.tsx` |
| 播放时驱动 viewCamera + actor group（消费 evalShot，绕过 React state，直接改 three object） | 改 `DirectorStage.tsx`（SceneContents 加 usePrevizPlayback 消费层） |
| 全片 ≤15s 约束（加镜头/改时长时钳制 + toast） | `PrevizShotPanel.tsx` / `previz-types.ts` 的 `clampShots()` |

测试（先写，行为断言）：`tests/unit/canvas/previz-eval.test.ts`
- t=0 精确回起幅、t=1 精确回落幅；waypoint 中点穿越；fov/roll lerp；
- `locateInSequence` 边界（0、镜头交界、超尾钳制）；
- `normalizeStage` 喂坏 shots（非数组/缺 Vec3/时长为负）不 throw、降级合理；
- `clampShots` 合计>15s 时的行为。

### S2 — 调度线 + 运镜线可视化 + 道具

交付：3D 里看得见、拖得动的调度线（人物）与运镜线（摄像机），播放时人偶沿线走、道具可摆。

| 动作 | 文件 |
|---|---|
| 调度线/运镜线渲染（线 + 方向箭头 + waypoint 小球可拖，样式对齐截图：人物橙黄、机位蓝） | 新 `director/PathVisuals.tsx` |
| waypoint 增删（选中镜头后「添加调度点」「清空调度点」，拖球 = TransformControls 复用） | 改 `DirectorStage.tsx` + `PrevizShotPanel.tsx` |
| 道具：StageProp 渲染（几何体 + car 低模组合）+ 场景树/添加菜单/transform 接入 | 新 `director/StageProps.tsx`；改 `stage-types.ts`、`DirectorStage.tsx` |
| 朝向=路径切线（evalShot 内），滑动位移 | 改 `previz-eval.ts` |
| （后补，不阻塞）程序化走路循环：按路径速度驱动肩/髋 sine 摆动 | 新 `director/walk-cycle.ts` |

测试：`previz-eval.test.ts` 增：沿调度线 t=0.5 落在路径中段、朝向≈切线方向；props normalize 坏数据降级。

### S3 — 导出闭环（预演 → MP4 → R2V）★价值兑现点

交付：「导出当前镜头视频 / 导出完整15秒视频」→ MP4（1080×1920 竖 / 1920×1080 横）
→ 自动生成画布视频节点（previz 参考视频 + 卡司 refs + 关键帧图 + 导演指令已填 prompt）。

| 动作 | 文件 |
|---|---|
| 录制器：锁定视角到镜头相机、隐藏 helpers/线/gizmo、captureStream+MediaRecorder，逐镜或全片；返回 webm Blob + 裁切参数（复用 capture() 的 max-fit crop 数学） | 新 `director/previz-record.ts` |
| 转码 route：multipart(webm+meta JSON) → zod 校验（时长 ≤15.2s、尺寸、大小 ≤50MB）→ ffmpeg `-vf crop,scale` → MP4 → 复用 upload-reference 的存储写入 → `{key, url}` | 新 `src/app/api/canvas/previz-export/route.ts` |
| 关键帧图：每镜起幅/落幅各 capture 一张 → 上传 image refs | `previz-record.ts` 内（复用 captureRef） |
| 导演指令生成（确定性模板，非 LLM）：从 shots 的景别/时长/运镜点/调度线生成中文指令文本 | 新 `src/lib/canvas/previz-director-text.ts`（纯函数） |
| DirectorNode 导出面板：导出按钮 ×2、画幅选择、进度 toast；完成后 addNodes(video 节点 `{referenceVideos:[key], prompt:导演指令, anchorKey:首帧}`) + 卡司 edges（沿用 handleSendShot 惯例） | 改 `nodes/DirectorNode.tsx` + `DirectorStage.tsx`（导出 UI 挂时间轴右侧，对齐截图「导出」卡） |

测试：
- `tests/unit/canvas/previz-director-text.test.ts` — 给定 shots 断言指令文本含景别/秒数/运镜描述；
- `tests/integration/api/canvas-previz-export.test.ts` — 校验分支（超时长 400 报 `REFERENCE_VIDEO_TOO_LONG`、超大 400）、ffmpeg mock 成功路径返回 key。
- 手测清单：竖/横两画幅、Kling O3 与 Seedance R2V 各跑一次真生成（prod 前）。

风险：MediaRecorder 帧率受 rAF 影响（后台 tab 掉帧）→ 录制时强制前台 + 提示；vp9 不可用时降 vp8（Safari 用 `video/mp4;codecs=avc1` 检测，`MediaRecorder.isTypeSupported` 逐级降）。

### S4 — AI 导演路线方案（可后置）

交付：左侧输入面板（文本 ≤500 字 + 片长模式 + 约束条件）→「生成导演路线」→ 2-3 套方案卡
（名称/风格/镜头数/时长分布）→ 点选一套 → 自动落 shots + 摆台。

| 动作 | 文件 |
|---|---|
| route：输入 zod 校验 → LLM（沿用 `/api/canvas/text` 的 spine 接法，**不旁路 worker 铁则**）→ 输出 Zod 强校验（总时长 ≤15、镜头 1-6、景别枚举=CAMERA_PRESETS keys） | 新 `src/app/api/canvas/director-routes/route.ts` + prompt 双语 `.zh.txt/.en.txt`（prompt-i18n guard） |
| 方案 → StageShot[] 物化：景别 key 走 `computePreset`（对现有卡司摆位取焦点），走位 hint 落调度线 | 新 `director/route-materialize.ts`（纯函数） |
| 方案列表 UI（截图左栏样式：方案卡 + 时间分布条 + 重新生成） | 新 `director/RoutePlansPanel.tsx` |

测试：materialize 纯函数单测（枚举越界降级、时长归一化）；route 校验分支。
注意：若引新 TASK_TYPE 要同步 6 个登记点（types/intent/task-policy/catalog/**queues.ts 路由**/categorizer）。

## 不做（YAGNI）

- 外部 3D 模型导入（glb 上传）、骨骼动画资产、物理碰撞
- 预演视频服务端渲染（headless three）——客户端录制够用，需求出现再议
- 多幕/多场景管理（一个导演台节点 = 一幕，画布本身就是多节点组织层）
- 口型/表情——素体无脸

## 约束与地雷（执行者必读）

- **改前先跑窄测**：`BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/canvas`；提交前 `npm run test:regression`（test:guards 的 tasktype-coverage 长期红是既有问题，见 memory，别被它骗）。
- `DirectorStage.tsx` 已 893 行：新功能一律新文件，接线以外不往里加块；若本轮把它推过千行，抽 `ScenePanel`/`RigPanel` 子组件（顺手不强制）。
- `use-previz-playback.ts` 受 line-count guard `use*` 400 行上限约束。
- 播放/录制期间**不写 React state 每帧**（直接操作 three object，只在停止时 commit）——v2 的 capture() 已示范 stateRef 模式。
- 导出 route 必须自己校验时长/大小——**别只靠前端守卫**（2026-07-09 DurationTooLong 教训）。
- 计费：S1/S2/S3 录制导出全免费（纯客户端+转码）；只有 S4 LLM 与下游生成扣点。
- prod 分支 = `feature/phase-11`；main 已过时。

## 拍板点（开工前 user 确认）

1. **切片顺序**：建议 S1→S2→S3 连做（S3 是价值兑现），S4 后置。同意？
2. **道具范围**：几何体 + car 低模够吗，还是首版连道具都砍（人物优先）？
3. **导出去向**：自动生成已接好线的视频节点（建议）之外，要不要也给「下载 MP4 到本地」按钮？（成本极低，顺手加）
