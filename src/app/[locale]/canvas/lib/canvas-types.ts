/**
 * Shared types for the infinite-canvas region (M1).
 *
 * Canvas nodes wrap the existing Playground run spine (/api/playground/run):
 * an image/video node submits a PlaygroundRun and tracks its runId; results are
 * read back from the shared usePlaygroundRuns poll. No new task type in M1.
 */
import type { CanvasNodeType } from './canvas-tokens'
import type { CanvasDirectorOutputMetadata } from './director-output-metadata'

export type CanvasPortType =
  | 'text'
  | 'script'
  | 'identity-image'
  | 'frame-image'
  | 'video-clip'
  | 'audio-voice'
  | 'audio-music'
  | 'storyboard-group'
  | 'mask-image'

export interface CanvasEdgeData extends Record<string, unknown> {
  portType: CanvasPortType
  order?: number
  role?: 'first-frame' | 'last-frame' | 'reference' | 'clip' | 'voice' | 'music' | 'mask'
  invalid?: boolean
  invalidReason?: string
}

/**
 * Persisted per-node data (the `data` payload React Flow carries).
 * Extends Record<string, unknown> because React Flow v12 constrains a custom
 * node's data to an index-signature shape.
 */
/** One storyboard shot produced by the script node (mirrors the worker's
 *  CanvasStoryboardShot; kept here so the client doesn't import server code). */
export interface CanvasStoryboardShot {
  shotNumber: number
  description: string
  /** 景别：中景/特写/全景… */
  shotSize?: string
  /** 运镜：推近/拉远/环绕/固定… */
  cameraMove?: string
  /** 机位角度：平视/俯拍/仰拍/过肩/主观… */
  cameraAngle?: string
  /** 镜头焦段：24mm 广角/50mm 标准/85mm 人像… */
  lens?: string
  /** 人物表演与情绪。 */
  performance?: string
  /** 站位与调度（谁在哪、朝向、走位）。 */
  blocking?: string
  /** 光影氛围：这一镜的光线基调与情绪。 */
  lighting?: string
  /** 音效：这一镜的声音设计（环境音/拟音/配乐提示）。 */
  sfx?: string
  durationSec?: number
  dialogue?: string
  /** 步骤三合成的最终生成提示词（编辑镜头字段会清空，需重新合成）。 */
  finalPrompt?: string
  /** 合成时判定的出场资产名（决定该镜带哪些参考图）。 */
  entities?: string[]
}

/** 脚本生成器「准备资产」步骤里的一个资产（角色/场景/道具）。 */
export interface CanvasScriptAsset {
  id: string
  kind: 'character' | 'scene' | 'prop'
  name: string
  description: string
  /** 生成中的 playground run（完成后经 use-as-reference 换成 durable key）。 */
  runId?: string | null
  /** durable COS key（worker 生成时重新签名）。 */
  imageKey?: string | null
  /** 签名预览 URL。 */
  imageUrl?: string | null
}

export interface CanvasMaskPoint {
  /** Normalized 0–1 coordinates so the mask survives node resizing. */
  x: number
  y: number
}

export interface CanvasMaskPath {
  mode: 'add' | 'erase'
  brushSize: number
  points: CanvasMaskPoint[]
}

export interface CanvasImageVersion {
  rootNodeId: string
  parentNodeId: string
  version: number
  operation: 'crop' | 'outpaint'
  aspectRatio: string
}

export interface CanvasNodeData extends Record<string, unknown> {
  /** User-facing title shown in the node header (editable). */
  title: string
  /** Immutable blocking/previz provenance captured when 导演台 creates this output. */
  directorMetadata?: CanvasDirectorOutputMetadata | null
  /** Storyboard handoff: prefilled blocking brief for the Director AI draft panel. */
  blockingBrief?: string | null
  /** One-shot UI intent used when a storyboard creates a Director node. */
  openDirectorOnCreate?: boolean
  /** Non-destructive image edit lineage; edited outputs always live in sibling nodes. */
  imageVersion?: CanvasImageVersion | null
  /** Prevents accidental movement and deletion while preserving selection. */
  locked?: boolean
  /** Mask node: editable vector strokes over the connected/uploaded plate. */
  maskPaths?: CanvasMaskPath[]
  maskMode?: 'add' | 'erase'
  maskBrushSize?: number
  maskSourceUrl?: string | null
  maskSourceKey?: string | null
  /**
   * Natural pixel size of the plate the strokes were drawn over. The drawing
   * surface matches this aspect ratio, so normalized points map 1:1 onto the
   * full image — the rasterizer needs these dims to reproduce that mapping.
   */
  maskSourceWidth?: number | null
  maskSourceHeight?: number | null
  /**
   * Signature (query-stripped URL) of the plate at the time the first stroke
   * was committed. When the live source drifts from this (upstream image
   * regenerated / rewired), the node shows a stale warning instead of
   * silently rendering old strokes over a different picture.
   */
  maskDrawnOnSig?: string | null
  /**
   * Effective plate the strokes sit on, synced by MaskNode whichever way the
   * plate arrived (upstream image node OR own upload). Downstream consumers
   * (MediaNode 局部重绘) read these instead of re-walking the graph.
   * maskPlateKey is the durable COS key when known (uploads); URL otherwise.
   */
  maskPlateUrl?: string | null
  maskPlateKey?: string | null
  /**
   * Script node: 全局风格(全片统一,LLM 拆分镜时产出、可手改),合成提示词
   * 与资产生图都以它统一质感。
   */
  globalStyle?: string | null
  /** Script node: 准备资产步骤的资产清单（LLM 抽取 + 用户增删改）。 */
  scriptAssets?: CanvasScriptAsset[] | null
  /** Script node: 分镜来源入口（重新生成沿用同一模式）。 */
  storyboardMode?: 'script' | 'characters'
  /** Script node: 角色生成模式的故事方向。 */
  storyboardBrief?: string | null
  /** Script node: 合成提示词任务轮询句柄。 */
  promptsTaskId?: string | null
  /**
   * 合成提交时的镜头快照签名。任务完成时若当前镜头已漂移则丢弃结果并要求
   * 重新合成——绝不把旧输入的提示词写到新镜头上。
   */
  promptsSig?: string | null
  /** Script node: 批量生视频使用的视频模型。 */
  videoModelKey?: string
  /**
   * Script node: 上游参考节点 + 全部资产设定图 的 key/URL 快照,由 ScriptNode
   * 随上游/资产变化同步。铺出的镜头节点经 脚本→镜头 一条线读到它
   * (canvas-refs)。语义:批量提交带「该镜出场资产」的精准参考,单镜重生经
   * relay 拿全卡司(刻意折衷,见 canvas-refs 注释)。
   */
  refUrls?: string[] | null
  /** Prompt / text content. */
  prompt: string
  /** Selected model key (image or video catalog). Empty until chosen. */
  modelKey: string
  /** Output aspect ratio, e.g. '9:16'. */
  aspectRatio: string
  /** Video-only: duration seconds. */
  durationSec?: number
  /** Video-only: resolution token, e.g. '720p'. */
  resolution?: string
  /** Video-only: generation mode (how upstream refs are used). */
  genMode?: 'text' | 'image' | 'omni' | 'firstlast'
  /**
   * Video-only (首尾帧 mode): the LAST-frame image. First frame comes from the
   * upstream ref / anchor; this is the tail. lastFrameKey = durable COS key sent
   * to the run; lastFramePreview = signed URL for the node thumbnail.
   * Only fal / Minimax / BobAPI video models consume it; others ignore it.
   */
  lastFrameKey?: string | null
  lastFramePreview?: string | null
  /**
   * Video-only: 导演台预演导出的参考视频（R2V）。referenceVideoKey = 存储 key，
   * 提交时进 referenceVideos；referenceVideoUrl = 签名 URL 供节点预览。带此
   * 字段的节点默认走 omni（R2V）模式。
   */
  referenceVideoKey?: string | null
  referenceVideoUrl?: string | null
  /** Video-only: camera-movement preset key (运镜), appended to the prompt. */
  cameraMove?: string
  /**
   * Selected visual-style id (from the style library). When set, the style's
   * anchor is prepended and its visual modifiers appended to the prompt at
   * submit time — the playground spine has no style field, so injection is
   * client-side into the prompt text. Null = no style.
   */
  styleId?: string | null
  /**
   * Image-only: how many variants to generate on one "生成" (1/2/4). The canvas
   * fans out N playground runs (the spine hardcodes generationCount=1), and the
   * extra results land in sibling frame nodes. Defaults to 1.
   */
  batchCount?: number
  /**
   * Signature of the inputs (upstream text + reference list) captured at the
   * last generate. When the live inputs drift from this, the node shows the
   * LibTV「输入已更新」badge so the user knows the result is stale.
   */
  inputsSig?: string | null
  /** PlaygroundRun id once a generation has been submitted (null before). */
  runId?: string | null
  /** Last known result media URL (cached so reload shows something pre-poll). */
  resultUrl?: string | null
  /**
   * Durable COS key for ref-bearing nodes (character/director uploads). Preferred
   * over resultUrl when feeding downstream references: it's a bare key the worker
   * re-signs fresh, so the reference survives the signed-URL expiry that would
   * otherwise break i2v after a few hours. Undefined for run-result nodes whose
   * underlying key isn't exposed to the client.
   */
  referenceKey?: string | null
  /** Durable primary key for an asset-library node (including video assets). */
  assetStorageKey?: string | null
  /**
   * INPUT anchor for a generative node — a durable COS key fed as the node's own
   * reference/first-frame (distinct from referenceKey, which is a node's OUTPUT
   * for downstream). Set when a 导演台 camera spawns a frame: the blocking
   * screenshot anchors that frame's generation while the frame's generated
   * result (resultUrl) is what downstream nodes consume. anchorUrl = signed URL
   * for the node preview.
   */
  anchorKey?: string | null
  anchorUrl?: string | null
  /** Script node: the generated storyboard shots (persisted so reload keeps them). */
  shots?: CanvasStoryboardShot[] | null
  /** Script node: the in-flight CANVAS_STORYBOARD task id (poll /api/tasks/[id]). */
  storyboardTaskId?: string | null
  /** Audio node: uploaded reference voice clip (durable COS key + display name). */
  referenceAudioKey?: string | null
  referenceAudioName?: string | null
  /** Audio node: emotion prompt + clone strength (0–1). */
  emotionPrompt?: string | null
  emotionStrength?: number
  /** Audio node: generated speech url + in-flight CANVAS_TTS task id. */
  audioUrl?: string | null
  audioKey?: string | null
  audioTaskId?: string | null
  audioTrackRole?: 'voice' | 'music'
  ttsTaskId?: string | null
  /**
   * Canvas TTS submission identity retained only while the POST outcome is
   * unknown. Persisting both values lets a reload retry the exact logical
   * request without accidentally reusing its UUID for changed provider input.
   */
  ttsClientRequestId?: string | null
  ttsIdempotencyFingerprint?: string | null
  /** Text node: in-flight CANVAS_TEXT (writing assistant) task id. */
  textTaskId?: string | null
  groupKind?: 'storyboard'
  orderedChildIds?: string[]
  storyboardColumns?: 2 | 3 | 4
  showShotNumber?: boolean
  storyboardExportTaskId?: string | null
  storyboardExportKey?: string | null
  storyboardExportUrl?: string | null
  storyboardExportInputsSig?: string | null
  /** Composition node: bounded CPU-only canvas video assembly. */
  transition?: 'cut' | 'crossfade'
  crossfadeSec?: number
  voiceVolume?: number
  musicVolume?: number
  preserveOriginalAudio?: boolean
  composeTaskId?: string | null
  resultTaskId?: string | null
  resultKey?: string | null
}

/** Minimal serializable node (what we store in the Canvas DB row / localStorage). */
export interface SerializedNode {
  id: string
  type: CanvasNodeType
  x: number
  y: number
  data: CanvasNodeData
  /** Group membership (成组): child positions are relative to the parent. */
  parentId?: string
  /** Explicit node size: group container, or a card enlarged via the
   *  bottom-right resize grip. Absent = content-sized at the design width. */
  w?: number
  h?: number
  /** Explicit canvas stacking order. */
  zIndex?: number
}

export interface SerializedEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  data?: CanvasEdgeData
}

export interface SerializedViewport {
  x: number
  y: number
  zoom: number
}

export interface SerializedCanvas {
  nodes: SerializedNode[]
  edges: SerializedEdge[]
  viewport: SerializedViewport
}

// `satisfies` (not a type annotation) so the inferred type keeps its concrete
// keys. A plain `Omit<CanvasNodeData,'title'>` annotation collapses to the bare
// index signature because CanvasNodeData has `[key: string]: unknown`.
export const DEFAULT_NODE_DATA = {
  locked: false,
  maskPaths: [] as CanvasMaskPath[],
  maskMode: 'add' as 'add' | 'erase',
  maskBrushSize: 18,
  maskSourceUrl: null as string | null,
  maskSourceKey: null as string | null,
  maskSourceWidth: null as number | null,
  maskSourceHeight: null as number | null,
  maskDrawnOnSig: null as string | null,
  maskPlateUrl: null as string | null,
  maskPlateKey: null as string | null,
  prompt: '',
  modelKey: '',
  aspectRatio: '9:16',
  durationSec: 5,
  resolution: '720p',
  styleId: null as string | null,
  batchCount: 1,
  lastFrameKey: null as string | null,
  lastFramePreview: null as string | null,
  referenceVideoKey: null as string | null,
  referenceVideoUrl: null as string | null,
  shots: null as CanvasStoryboardShot[] | null,
  storyboardTaskId: null as string | null,
  globalStyle: null as string | null,
  scriptAssets: null as CanvasScriptAsset[] | null,
  storyboardBrief: null as string | null,
  promptsTaskId: null as string | null,
  promptsSig: null as string | null,
  refUrls: null as string[] | null,
  referenceAudioKey: null as string | null,
  referenceAudioName: null as string | null,
  emotionPrompt: null as string | null,
  emotionStrength: 0.4,
  audioUrl: null as string | null,
  audioKey: null as string | null,
  audioTaskId: null as string | null,
  audioTrackRole: 'voice' as 'voice' | 'music',
  ttsTaskId: null as string | null,
  ttsClientRequestId: null as string | null,
  ttsIdempotencyFingerprint: null as string | null,
  transition: 'cut' as 'cut' | 'crossfade',
  crossfadeSec: 0.5,
  voiceVolume: 1,
  musicVolume: 0.25,
  preserveOriginalAudio: true,
  composeTaskId: null as string | null,
  resultTaskId: null as string | null,
  resultKey: null as string | null,
  orderedChildIds: [] as string[],
  storyboardColumns: 4 as 2 | 3 | 4,
  showShotNumber: true,
  storyboardExportTaskId: null as string | null,
  storyboardExportKey: null as string | null,
  storyboardExportUrl: null as string | null,
  storyboardExportInputsSig: null as string | null,
  runId: null as string | null,
  resultUrl: null as string | null,
  // 视频生成结果的尾帧(worker ffmpeg 抽出、签名后的 URL)— 供下游节点
  // 做首尾帧续镜接力(video → 下游连线时由 canvas-refs 采集)。
  tailFrameUrl: null as string | null,
  referenceKey: null as string | null,
  anchorKey: null as string | null,
  anchorUrl: null as string | null,
} satisfies Record<string, unknown>

export const EMPTY_CANVAS: SerializedCanvas = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}
