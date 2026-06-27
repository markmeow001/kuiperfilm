# 无限画布功能区 — clone LibTV（建置计画）

> 2026-06-27 单一事实来源。KuiperAI 新增「无限画布」独立创作区（像 /playground，与 v2 剧集流分开），
> 对标 LibTV(liblib.tv) 的画布 + 3D 导演台。
>
> 四份调研（在 ~/canvas_ref/）：
> - `libtv-features-report.md` — LibTV 全功能 + 优先矩阵（31 截图在 libtv-shots/）
> - `libtv-uiux-spec.md` — UI/UX 设计规格（配色 token / 版面 / 组件 / Tailwind）
> - `libtv-node-toolbars-deep.md` — **深层 per-node toolbar/dropdown 穷举**（~230 子选项，51 截图在 libtv-shots-deep/）← 每个节点点进去的功能
> - infinite-canvas 可移植性评估（见下方「路线决定」）

## 路线决定

| 项 | 决定 | 理由 |
|---|---|---|
| 画布引擎 | **React Flow（@xyflow/react，MIT）** | = LibTV 实测同款（rf__wrapper）；连线/handle/minimap 现成、合法 |
| 3D 导演台 | **three.js + @react-three/fiber + drei** | LibTV 导演台就是 three.js 场景编辑器 |
| infinite-canvas | **仅设计参考，零抄码** | AGPL-3.0：抄进闭源 SaaS = 被迫开源整个 KuiperAI（网路 copyleft §13） |
| 生成 | 全走 KuiperAI **Task spine + per-user 计费** | 多用户/商业化；之后可接 polyfilm 走他点数 |
| UI | 自建、不引 antd，套 `libtv-uiux-spec` token | 与 KuiperAI 设计系统一致 |
| 位置 | `src/app/[locale]/canvas/`（仿 /playground） | 独立、不污染 v2 |

新 deps（全 MIT）：`@xyflow/react`、`three`、`@react-three/fiber`、`@react-three/drei`。

## UI/UX 设计 token（来自 libtv-uiux-spec）

近黑、低彩度、单一青色 accent：
- 背景层级：canvas `#0A0A0B` · app `#0E0E10` · panel `#131316` · popover `#16161A` · card `#1B1B1F` · hover `#232328` · input `#202024`
- **accent = cyan `#4FD2E8`**（CTA / slider fill / 选中 ring / 主操作）
- gold `#F4C44E`（仅点数/会员）· scene-blue `#4F8EF7`（仅 3D 人偶/gizmo）
- 文字：primary `#F2F2F4` · secondary `#A8A8B0` · muted `#6E6E76`
- 边框 hairline `white/8`、选中 1.5px cyan ring；radius 6/10/14/20；阴影纯黑不带色；画布 = **dot grid**（24px）
- 两个核心可复用组件：**SliderRow**（细轨+青填充+白拇指+数字框）、**NumberScrubField**（XYZ 横拖 scrub）— 最高杠杆，先建

## 功能矩阵（LibTV × 优先 × 你已有 × 要接什么）

**P0 — 骨干**
- React Flow 节点图（typed node + L/R handle + edge）— 取代手写壳
- 视频节点（Seedance 文生/图生/首尾帧/全能参考 + 运镜 + 720P/5s + audio）— ✅ 已有 Seedance routing → 节点 onGenerate 接 Task spine
- 图片节点（t2i + 图编辑 + 参考）— ✅ image provider → 同上
- **导演台 3D**：素体 + 姿势预设 + 逐关节 rig + 相机 FOV/注视追角色 + **截图→发送到画布** — ❌ three.js 自建

**P1**：角色库(4-view，✅ CharacterAppearance)、脚本生成(✅ script→storyboard)、工具箱预设工作流、历史资产。
**P2/P3**：AI识图导入3D + 360全景、几何道具、风格库市集、视频合成、音频生视频、公开 graph replay、双层点数。

## 深层 per-node 功能（来自 libtv-node-toolbars-deep，~230 子选项）

> ⚠️ 这是上一份报告漏掉、user 截图点名的层：**每个节点 toolbar 点进去的功能 + 二级下拉**。这些「配方」(预设) 才是 LibTV 真正的差异化，不只是节点图。下表只列要 clone 的高价值面，全量见报告。

### 图片节点 — 「预设 / 九宫格」配方目录 ★最高 clone 价值（P0）
一个统一的「生图配方」库，empty 态在 **预设 ▾**、有图态在 **九宫格 ▾** 暴露。**这就是把我们已有的 storyboard prompt 工程包装成一键配方的地方**：
- **分镜叙事**(6)：调度故事板(带运动轨迹草图) / 故事板(完整剧情片段) / 25宫格连贯分镜 / 剧情推演四宫格 / 画面推演-3秒后 / 画面推演-5秒前
- **质感调节**(2)：人像质感调节(降 AI 感) / 电影级光影校正
- **空间与机位**(2)：720全景 / 多机位九宫格
- **设定图**(5)：角色脸部三视图 / 角色设定图 / 角色三视图 / 场景设定图 / 产品设定图
- 有图态额外直接动作：全景 / 多角度 / 打光；人像质感调节 ▾(人像调节/情绪调节)；高清(→ 高清放大子节点 Topazlabs 2/4/6×)；宫格切分(拆格成多节点)；标注/旋转/下载/预览。

→ **接法**：每个配方 = 一组预设的 prompt 模板 + model + 参数，落到我们的 storyboard prompt 库（已有大量 v3 字段化 prompt 可复用）。

### 图片节点 — 摄像机 builder（P1）
9 机身(Sony Venice/Arri Alexa 35·65/Red V-Raptor/Panavision DXL2/Arricam LT/ArriFlex 435/IMAX×2) × 10 镜头 × 7 焦距(8–125mm) × 3 光圈(ƒ1.4/4/11) → 拼成「电影级摄影」prompt 片段。

### 视频节点（P0）
- **5 生成模式 tab**：文生 / 图生 / 首尾帧(首帧·首尾帧) / 全能参考 / 图片参考。
- **运镜广场**(P0)：camera-movement 预设画廊(推/拉/环绕/升降/手持…) — 接我们的运镜 prompt。
- **特效广场**(P1)：video-effect 预设画廊。
- 模型选择：LibTV 列 31 个；**我们只接已有/已授权**(Seedance 2.0 全变体 t2v/i2v/r2v · 1.5 · 1.0 + 既有 provider)，不引入未授权外部模型。
- spec：比例(Auto+6) · 清晰度 480P/720P/1080P/4K · 时长 5–15s · 生成音频开关。

### 音频节点（P0）
音色库(我方接 TTS provider) + 克隆 + 4 轴筛选(语言/口音/性别/年龄) + 语速/情感。LibTV 用 Minimax-speech；我方走既有 TTS 路径。

### 脚本节点（P0）
3 模式(剧本→分镜脚本 / 角色→分镜脚本 / 自写) + LLM picker → **直接复用我们的 script→storyboard 链 + 描述词工程**。

### 工具箱（P1）
24 个一键预设工作流(周星驰名场面 + 旅拍转场系列 + 商品展示系列 + 大师分镜九宫格…)，每个 = 预接好的 model+prompt+params 投到画布。= 我们的「配方市集」。

### 导演台 3D（P0，见下方 M2 详列）
11 素体 + 群众阵列 + 7 几何道具；20 姿势预设 + 逐关节 rig；相机 FOV/注视/截图→发送到画布。

## 分期（UI/UX 已并入）

```
M1 地基 + 出图（~中型）
  · React Flow 壳 + libtv 配色 token + dot-grid + 顶栏 + 底部胶囊 dock + 右下缩放（照 uiux-spec §2）
  · 节点卡：header(icon+可编辑名) + body(preview) + 底部生成 config bar + L/R handle（照 §3）
  · 图片+视频节点 onGenerate → 新 task type CANVAS_GENERATE（或复用 playground spine）→ worker → 轮询 → 结果落地 + 计费
  · config bar：model picker(只列我方已接/已授权) + 画质/清晰度/比例 popover + 批量 + 翻译
  · 图片 +handle / 视频 5 生成模式 tab（文生/图生/首尾帧/全能参考/图片参考）
  · 画布存 DB（新表 Canvas: projectId, nodes JSON, edges JSON, viewport）
  · @引用其他节点当参考（参考节点 = React Flow edge）

M1.5 配方目录 ★（~中，最高杠杆，复用现有 prompt 工程）
  · 图片「预设/九宫格」配方库：分镜叙事6 + 质感调节2 + 空间机位2 + 设定图5（= 预设 prompt 模板 + model + 参数，落我们 storyboard prompt 库）
  · 有图态 top toolbar：人像质感调节▾ / 全景 / 多角度 / 打光 / 九宫格▾ / 高清(→高清放大子节点) / 宫格切分
  · 摄像机 builder（机身/镜头/焦距/光圈 → 摄影 prompt 片段）
  · 视频 运镜广场 + 特效广场 预设画廊（接我方运镜 prompt）
  · 工具箱：一键预设工作流（投到画布）

M2 导演台 P0（~大，1-2 周）★ 核心差异化
  · three.js(R3F) 全屏：11 素体(男/女/健壮/纤细/少年/儿童/二头身…) + 群众阵列(行×列×间距) + 7 几何道具
  · 20 姿势预设 + 逐关节 rig（SliderRow：身体/躯干/头部/手臂-肩/肘…）
  · 相机：位置/FOV/注视目标(手动 or 追角色) + 导演视角↔机位视角 toggle
  · 三栏版面 + 场景树(隐藏/锁定) + gizmo + axis cube（照 uiux-spec §6）
  · 摄像机截图 → 发送到画布 → 注入 image 节点 → 喂 Seedance i2v
  · 画幅比例、全景背景(连图片节点驱动)

M3 串接 + 角色/脚本/音频（~中）
  · i2v 串分镜序列（串短剧）+ 视频合成(拼接)节点 · 角色库接 CharacterAppearance(4-view) · 脚本节点接 script→storyboard 链 · 音频节点接 TTS(音色筛选) · 历史资产

M4 进阶（~大，可选）
  · AI 识图导入 3D + 360 全景生成 · 风格库市集 · polyfilm provider · 公开 replay
```

## 架构 / 资料

- `src/app/[locale]/canvas/` → `CanvasClient`(React Flow) + `nodes/`(各节点) + `director/`(three.js 全屏) + `lib/`(canvas store/serialize)。
- 生成：节点「生成」→ `submitTask(CANVAS_GENERATE 或复用 playground)` → BullMQ worker → 轮询 job → 结果写回节点 + 媒体落地（COS/R2）。**计费照现有 per-user。**
- DB：新表 `Canvas`（id, projectId/userId, nodes JSON, edges JSON, viewport, updatedAt）。

## 风险

1. **导演台 three.js 3D 最重**（M2：骨架 rig + TransformControls gizmo + 相机 render），但最大差异化。
2. **生成接线**（节点 ↔ Task spine + 计费 + 轮询）是 M1 主工。
3. React Flow 自订节点 + 不引 antd 自建 UI。
4. **AGPL 红线**：全程零 infinite-canvas 程式码，只照截图/spec 重写。

## 进度

**M1 ✅ 完成（2026-06-27）** — `npm run build` 绿、tsc 绿、eslint 绿、7 unit test 绿：
- 装 `@xyflow/react@12.11.1`（MIT）；`CanvasClient.tsx` 从手写壳迁到 React Flow（dot-grid Background / Controls / MiniMap / 顶栏 / 底部 dock / 缩放）。
- 套 `lib/canvas-tokens.ts`（LibTV 配色：近黑 bg 层级 + cyan #4FD2E8 accent）。
- 4 节点 `nodes/`：MediaNode(image+video 一份参数化) / TextNode / CharacterNode + `node-shell.tsx`（统一卡片 + L/R handle）。
- **图片/视频节点接现有 Playground run spine**（`lib/canvas-generation.tsx` → useSubmitPlaygroundRun + usePlaygroundRuns 3s 轮询 + useUserModels）→ **文生图/文生视频真生成，计费/worker/轮询全继承，零新 task type**。
- 连线：handle→handle（onConnect）+ 拖到空白弹菜单生「连好的下一个节点」（onConnectEnd）。
- 持久化：**localStorage**（serialize/deserialize 已写成纯函数 + 单测，DB 表只要换 load/save 两处）。
- 测试 `tests/unit/canvas/canvas-serialize.test.ts`（7 绿）。
- 部署/验证：**未 commit、未 deploy**（等 user 授权）；线上仍是旧手写壳 a966115。

**M1.5a ✅ DB 持久化 + i2v 首帧串接（2026-06-27）** — build 绿、tsc 绿(我方)、eslint 绿、16 unit test 绿：
- **DB**：新表 `Canvas`（schema + User.canvases 关系，prisma generate 过）；`@db.Text` JSON 字段（nodes/edges/viewport）；workspaceId 纯 scalar 无 FK（同 Task.projectId）。
  - `src/lib/canvas/canvas-validation.ts`（zod，cap 500 节点/1000 边/1MB blob）+ `canvas-repository.ts`（repository pattern；**id 不属于该 user → 抛 CANVAS_NOT_FOUND，绝不静默 create**）。
  - `src/app/api/canvas/route.ts`（GET 最新 / POST upsert，auth-scoped）+ 注册进 route-catalog。
  - 前端 `lib/query/mutations/canvas-mutations.ts`（useCanvas/useSaveCanvas）；CanvasClient 改成**从 DB hydrate + 800ms debounce autosave + viewport 还原**（弃 localStorage）。
  - **表自动建**：prod entrypoint `prisma db push --accept-data-loss=false`（docker-compose.prod.yml:178）→ 下次 deploy 自动加表，无需手动 DB 手术。
- **i2v 首帧串接**（关键发现：**零后端改动**）：worker `playground-video.ts` 早就把 `signedImageUrls[0]` 当首帧（leadImageUrl），且 `toSignedUrlIfCos` 只签 `images/`·`voice/`·`video/` 开头的 COS key、**http URL 原样穿透**。所以视频节点把上游图片节点的 signed resultUrl 当 referenceImages[0] 传 → 自动变首帧。
  - `lib/canvas-refs.ts`（纯函数 pickUpstreamReferenceUrls，只取 image/character 上游的 resultUrl）+ 单测。
  - MediaNode 用 `useNodeConnections` + `useNodesData` 反应式抓上游 → 视频=首帧串接、图片=编辑/一致性参考；卡片显示「首帧 ← 上游 (n)」badge。
- 测试：`tests/unit/canvas/`（serialize 7 + refs 4 + repository 5 = 16 绿）。
- **未 commit、未 deploy**（等授权）。线上仍旧手写壳 a966115。

## 待 user 拍板（下一步）
- M1+M1.5a 要不要 commit + deploy 上线试（deploy 会跑 db push 建 canvas 表，需 prod 授权）。
- 接着做 **M1.5b 配方目录**（最高杠杆，复用 storyboard prompt）还是 **M2 导演台 3D**。
