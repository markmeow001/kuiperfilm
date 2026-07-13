# 无限画布闭环计划 — Typed Graph → 合成 → 资产沉淀

> 2026-07-12。对标 LibTV 团队版实际创作链路，目标不是增加更多能拉线的卡片，
> 而是确保每一条允许存在的连线都有明确输入、明确输出、可验证的业务行为。
>
> 前置：`docs/plans/2026-06-27-canvas-libtv-clone.md`、
> `docs/plans/2026-07-12-director-previz.md`。

## 目标

把现有画布从「生成节点集合」补成完整制作闭环：

```text
文本／脚本／角色／场景
  → 分镜图
  → 首尾帧／参考视频生成镜头
  → 视频片段 + 配音／音乐
  → 分镜组／时间顺序
  → 合成成片
  → 保存角色、场景、素材与工作流
```

完成后必须满足：

1. UI 允许建立的每条边，目标节点都会真实消费上游数据。
2. 不兼容的节点组合在连线时明确拒绝，不产生装饰性边。
3. 长时视频处理全部走 task spine + worker，HTTP route 不同步跑 ffmpeg。
4. 生成结果和素材使用 durable key，不依赖会过期的 signed URL。
5. 所有新 route、task type、worker 与纯函数都有行为测试。

## 当前事实

### 已完成基础（本分支 working tree）

- `canvas-connections.ts`：集中定义节点类型的合法连线矩阵。
- Canvas `onConnect` + React Flow `isValidConnection`：双层拒绝无语义连线。
- `Script → Image / Video / Audio`：下游会读取脚本 prompt 或已生成 shots。
- 两张图片连入首尾帧视频：第一张映射首帧、第二张映射尾帧。
- 角色 reference 不再被误当作 blocking frame。
- 40 项新增窄测通过；完整 canvas 133 tests 通过；build 通过。

### 仍缺的闭环

- Audio 不能进入最终影片。
- 多个 Video 不能在画布中合成。
- Group 只是视觉容器，不能成为有顺序的「分镜组」。
- 分镜组不能导出编号故事板或送入合成。
- 图片／视频／角色节点不能保存回资产库。
- 连接端口仍是单一左右 handle，尚未向用户展示输入语义。

## 第一性原则与架构决定

| 问题 | 决定 | 原因 |
|---|---|---|
| 合成放哪里 | 新 `composition` 节点 + `CANVAS_COMPOSE_VIDEO` worker task | 合成可能分钟级，不能阻塞 HTTP；必须可观察、重试、计费/审计 |
| 视频顺序 | 以进入 composition 的 edge `data.order` 为准；UI 可重排 | React Flow 边数组顺序不应成为隐式业务契约 |
| 音频语义 | Audio 接 composition，支持 voice/music 两轨；首版各最多一条 | 最小必要复杂度；避免首版直接做完整 NLE |
| 音频混合 | ffmpeg `amix` + 明确音量；无音轨时保留原片音频 | 行为确定、可单测命令参数；禁止静默丢音 |
| 分镜组 | 扩展 group data 为 `groupKind: storyboard` + `orderedChildIds` | 视觉父子关系与业务顺序分开，拖动布局不会改变镜头顺序 |
| 故事板导出 | worker 或受控服务端 renderer 输出编号 JPEG/PDF | 浏览器 canvas 会受跨域素材污染，不能作为可靠生产路径 |
| 资产入库 | 新 `/api/canvas/assets` facade，内部调用统一 media/asset service | 不让前端拼接多个 asset-hub 私有契约；所有权与 durable media 统一校验 |
| typed ports UI | 保留单卡多 handle，但 handle 带稳定 id 与数据类型 | 用户能看懂为什么能连；为首帧/尾帧/音轨建立确定映射 |

## 数据契约

### 端口类型

```ts
type CanvasPortType =
  | 'text'
  | 'script'
  | 'identity-image'
  | 'frame-image'
  | 'video-clip'
  | 'audio-voice'
  | 'audio-music'
  | 'storyboard-group'

interface CanvasEdgeData {
  portType: CanvasPortType
  order?: number
  role?: 'first-frame' | 'last-frame' | 'reference' | 'clip' | 'voice' | 'music'
}
```

序列化、validation 与 deserialize 必须保留 edge data；旧边没有 data 时根据
source/target 类型做一次确定性推导，无法推导的旧边明确标记 invalid，不能静默猜测。

### Composition node data

```ts
interface CanvasCompositionData {
  clipOrder: string[]
  transition: 'cut' | 'crossfade'
  crossfadeSec: number
  voiceVolume: number
  musicVolume: number
  outputResolution: '720p' | '1080p'
  composeTaskId?: string | null
  resultKey?: string | null
  resultUrl?: string | null
  durationSec?: number | null
}
```

限制：首版 1–60 个片段、总时长 ≤20 分钟、单文件与输出尺寸使用服务器硬限制。

### Storyboard group data

```ts
interface CanvasStoryboardGroupData {
  groupKind: 'storyboard'
  orderedChildIds: string[]
  columns: 2 | 3 | 4
  showShotNumber: boolean
  exportTaskId?: string | null
  exportKey?: string | null
  exportUrl?: string | null
}
```

## 切片计划

### S1 — Typed graph 收口（已完成主体）

交付：画布上不再出现无作用连线，脚本和首尾帧语义真实传递。

- [x] 合法 source/target 类型矩阵。
- [x] `onConnect` 与 `isValidConnection` 双层验证。
- [x] Script 下游文本解析。
- [x] 双图片首尾帧映射。
- [x] edge data 序列化与 stable handle id。
- [x] 连接错误显示具体原因，而不是统一「不能连接」。
- [x] 已存在旧画布 invalid edge 审计与 UI 标记：合法旧边静默推导，只有真无语义边显示红色虚线。

测试：所有允许组合逐项断言；所有拒绝组合逐项断言；serialize round-trip 保留
`portType/order/role`。

### S2 — Composition 节点与视频合成

交付：多个视频节点按明确顺序合成一条可下载、可继续连接的成片。

> **完成 2026-07-13**：`composition` 节点、免费 task、video queue 显式路由、
> 全域并发锁、可替换 executor、cut/xfade、720p 资源硬顶、结果签名查询与行为测试已落地。

#### S2 技术选型：ffmpeg vs Remotion（开工前结论）

| 维度 | ffmpeg concat/xfade | 现有 Remotion `video-editor-render` |
|---|---|---|
| 执行模型 | 单进程原生转码；可用 `threads/preset/t` 硬限制 | 每任务先 webpack bundle，再启动 Chromium 按帧渲染 |
| 纯片段拼接 | 直接 concat；格式不同时一次 normalize | 每帧经 React/Chromium 合成，纯拼接成本明显更高 |
| crossfade／混音 | `xfade` / `acrossfade` / `amix` 原生支持 | React 时间线表达较直观，但仍由 Chromium 逐帧输出 |
| 字幕／复杂图层 | filter graph 可做基础字幕，复杂排版维护成本高 | 复杂字幕、图层、动画更适合 Remotion 组件 |
| 本仓库现况 | previz 已验证 `execFile`、`veryfast`、时长硬顶 | 管线可用，但当前每次任务重复 bundle，默认 1080p，资源较重 |
| droplet 风险 | 可收紧到 720p、≤10 clips、≤3min、threads=2、并发=1 | Chromium + bundle + 编码同时占 CPU/内存，更容易重现 OOM／worker 饥饿 |

**结论：S2/S3 首版采用 ffmpeg executor。** 这不是恢复旧的无上限整集 concat：首版只做
≤10 clips、≤3 分钟、720p、并发 1，并强制 `-preset veryfast -threads 2` 与输出时长硬顶。
选择理由是当前交付仅需 clip normalize、cut/xfade 与音轨混合，ffmpeg 在这个范围内比
Remotion 的 bundle＋Chromium 逐帧渲染更轻、更容易施加资源上限。

执行层必须收敛为 `CanvasComposeExecutor` 接口；task、API、UI 只依赖接口返回。未来迁外部
合成服务只替换 executor。若后续字幕／复杂图层成为主需求，可新增 Remotion executor，
而不是改动 task 契约。S4 的 4K 静态故事板仍优先 spike `renderStill`，不受本结论影响。

1. 注册 `composition` node type：tokens、types、validation、serialize、nodeTypes。
2. 新增 `CompositionNode.tsx`：
   - 展示已连接 clips；
   - 拖拽重排；
   - cut/crossfade；
   - 720p/1080p；
   - 生成、进度、失败、重试、结果预览。
3. 新 API `/api/canvas/compose`：只验证输入并创建任务。
4. 新 TASK_TYPE `CANVAS_COMPOSE_VIDEO`，同步全部登记点：
   - task types；
   - intent；
   - billing policy；
   - observe policy；
   - categorizer；
   - route/task catalogs；
   - queue/worker handler routing。
5. Worker：
   - 所有输入 key 必须属于当前用户或是允许的 run result；
   - 下载到隔离 tmp dir；
   - ffprobe 获取真实时长／尺寸／音轨；
   - 统一 fps、像素格式、分辨率；
   - concat 或 xfade；
   - 输出 MP4 上传 COS/R2；
   - 清理 tmp；失败记录明确错误码。

验收：3 个不同尺寸片段可按 UI 顺序合成；切换顺序后输出顺序改变；任何输入失败时整
个任务显式失败，不跳过坏片段。

实现资源预算（S2 完成态）：输入逐文件 stream 到 tmp，不把 clips 整包放内存；输入总量
硬顶 2GB、输出文件硬顶 512MB，故 tmp 峰值硬顶约 2.5GB。上传接口当前需要读取最终输出
Buffer，应用层额外内存峰值硬顶 512MB；ffmpeg stderr buffer 2MB、threads=2、720p、
`veryfast`、输出 `-t 180`。迁外部 executor 后可消除本机最终输出 Buffer 峰值。

### S3 — Audio → Composition 混音

交付：TTS 语音或音乐节点可接入成片，而不是停在孤立播放器。

- Audio 节点增加轨道角色：`voice` / `music`。
- Composition 接收最多一条 voice + 一条 music。
- voice 长度不足：尾部静音；超过成片：明确裁切并在 UI 显示。
- music 默认循环到成片长度，尾部 fade-out。
- 如果输入视频有原音：首版提供「保留原音」开关，默认开启。
- ffmpeg filter graph 必须由结构化参数生成，禁止拼接用户字符串。

验收：原音＋配音＋BGM 三轨均可听见；音量滑杆变化能在输出中验证；无音频输入时不改
变视频原音。

### S4 — 业务化分镜组与故事板输出

交付：Group 从视觉容器升级为可重排、可导出、可送合成的分镜组。

- 多选图片／视频 →「建立分镜组」。
- 组内独立顺序条，不以 x/y 坐标推断顺序。
- 图片组：导出带镜号、标题的 4K 故事板 JPEG；可选 PDF。
- 视频组：一键连接到 composition，并把组内顺序写入 edge order。
- 删除 group 默认释放 children，不删除素材；删除素材须另行明确确认。
- 组内素材结果更新时显示「故事板已过期」。

验收：移动节点位置不改变镜头顺序；重排顺序会改变故事板编号和 composition 顺序。

### S5 — 画布资产入库

交付：生成结果不再只存在画布节点，可沉淀并跨画布复用。

- Character/Image 节点：保存为角色主体。
- Image 节点：保存为场景图或普通参考素材。
- Video/Composition 节点：保存为视频素材。
- Director 预演：保存为参考视频素材和首尾帧。
- 保存弹窗字段：名称、类型、分类文件夹、说明。
- `/api/canvas/assets`：
  - auth/editor 权限；
  - durable key 所有权校验；
  - 创建 MediaObject 与对应 asset-hub 记录；
  - 重复 key 明确提示已存在，不静默复制。
- 资产库面板从「角色库」扩展为角色／场景／图片／视频四类，拖入时保留 durable key。

验收：画布生成图片保存入库后，新画布能从资产库拖回，并作为下游 reference 正常生成。

### S6 — 字幕闭环（后置）

字幕擦除属于独立 AI/视频编辑能力，不与合成首版混做：

1. `subtitle-overlay`：已有字幕文本／SRT 烧录到 composition。
2. `subtitle-remove`：矩形区域遮罩／inpaint，需单独验证模型或 ffmpeg 路线。
3. 两者均产出新 Video 节点，绝不覆盖原素材。

## 测试计划

### Unit

- connection matrix、port inference、edge migration。
- clip order、audio track selection、duration policy。
- ffmpeg 参数 builder：具体参数与顺序断言。
- storyboard layout：列数、编号、尺寸与顺序。
- asset payload 与 duplicate detection。

### Worker

- 正常 concat／crossfade／混音。
- 坏 key、越权 key、下载失败、无 video stream、总时长超限。
- 中间 clip 失败必须整任务失败，禁止跳过。
- DB/run result 写入具体 key、URL、duration。

### API

- 401、400、404、成功创建 task。
- route catalog 与 task type catalog。
- ownership/IDOR 回归测试。

### Browser smoke

1. Text → Script → 3 张分镜图。
2. 两图 → 首尾帧视频。
3. 三段 Video + Audio → Composition。
4. 重排 → 重新合成并核对顺序。
5. 图片组 → 4K 故事板。
6. 成片／角色保存资产 → 新画布重新拖入。

## 风险与禁止事项

- 禁止在 API route 同步合成 20 分钟视频。
- 禁止把 signed URL 当永久资产引用。
- 禁止遇到坏片段自动跳过或换用默认素材。
- 禁止用节点画布位置隐式决定业务顺序。
- 禁止让 Audio 直接接普通 Video 生成节点却不被消费；Audio 只接 Composition。
- 禁止为了「像 LibTV」复制其代码；只实现已验证的产品行为。
- 生产部署前必须跑 `npm run test:regression`，并在真实对象存储上完成一次三片段合成。

## Claude 审查批注（2026-07-13，开工前必读）

计画方向批准。但有一段**本仓库的历史必须正视**，以及 5 点修正：

### ⚠️ 历史地雷：server 端 ffmpeg 合成曾被退役

`src/lib/workers/handlers/episode-package-zip.ts` 头注：旧的整集 ffmpeg concat
「17×1080P 拼一条 mp4 会把两颗 vCPU 占满 ~6 分钟、拖死 BullMQ」——因此被退役，
改 zip 打包让用户去剪映剪。`EPISODE_STITCH_MP4` 现在 dispatch 到 zip 打包器。
S2 本质上是在同一台 droplet 上重新引入这条路径，而本计画的上限（60 clips /
20 分钟）比当年退役的规模大数倍。**不带资源约束就实施 = 重蹈覆辙。**

S2 修正（必须）：
1. 首版上限收紧：**clips ≤10、总时长 ≤3 分钟、默认 720p**（1080p 后置）；
   上限常量集中一处，放宽走配置不走改码。
2. **合成任务并发 = 1**：与其他 video 任务隔离（独立 concurrency guard 或
   BullMQ limiter），绝不允许两个合成同跑；video worker 并发本来只有 2
   （Tencent 配额瓶颈），被合成占满会饿死生成任务。
3. ffmpeg 加 `-preset veryfast -threads 2` 上限 + 输出时长硬顶（previz-transcode
   的 `-t` 前例）；droplet 有 OOM 历史（2026-05-01），tmp 磁盘用量与峰值内存
   写进 S2 验收。
4. 技术选型对比一次再动手：仓库已有 **Remotion 渲染管线**
   （`video-editor-render.ts`，renderMedia→upload 完整可用）——若 crossfade/
   字幕最终都要 Remotion，S2 直接用它可能省一条 ffmpeg 路径；若坚持 ffmpeg
   concat/xfade（更轻），在 plan 里写明为什么。

### 其他修正

5. **队列路由写死**：`CANVAS_COMPOSE_VIDEO` 必须显式加入 `src/lib/task/queues.ts`
   的 `VIDEO_TYPES`——默认 fallback 是 **text queue**，合成会把文本 worker 卡死
   （新 TASK_TYPE 六+1 登记点见 previz S4 的 commit a41ab11 为模板）。
6. **计费已拍板（user 2026-07-13）**：合成首版**免点数**（自家 CPU），之后会
   迁到外部服务再定价。实作要求：billing policy 登记为零成本任务；worker 里
   ffmpeg 调用收敛在一个可替换的执行层后面（如 compose-executor 接口），迁外部
   时只换实现不动 task/UI 契约。
7. **S4 故事板 renderer 选型**：优先评估已在依赖里的 **Remotion renderStill**；
   禁止为此新引入 Puppeteer（重依赖）。开工前 spike 一张 4K 网格出图验证内存。
8. **S5 资产归属**：明确资产挂 user 还是 workspace（多租户 Org→Workspace→Member
   已上线，见 workspaces 相关实现）；facade 里写清，别默认 user-only。
9. S1 收尾的「旧边 invalid 标记」注意别把用户旧画布弄成满屏红——可推导的
   （image→video 等）静默迁移，只有真推导不出的才标。

## 建议实施顺序

```text
S1 typed ports 收尾
  → S2 composition
  → S3 audio mix
  → S4 storyboard group
  → S5 asset persistence
  → S6 subtitles
```

S2+S3 是最先兑现「一条成片」价值的切片；S4+S5 解决团队整理与长期资产沉淀。字幕擦除
技术风险独立，后置不会阻塞主闭环。
