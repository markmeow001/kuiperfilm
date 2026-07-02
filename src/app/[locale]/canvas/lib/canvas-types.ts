/**
 * Shared types for the infinite-canvas region (M1).
 *
 * Canvas nodes wrap the existing Playground run spine (/api/playground/run):
 * an image/video node submits a PlaygroundRun and tracks its runId; results are
 * read back from the shared usePlaygroundRuns poll. No new task type in M1.
 */
import type { CanvasNodeType } from './canvas-tokens'

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
  shotSize?: string
  cameraMove?: string
  durationSec?: number
  dialogue?: string
}

export interface CanvasNodeData extends Record<string, unknown> {
  /** User-facing title shown in the node header (editable). */
  title: string
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
  ttsTaskId?: string | null
  /** Text node: in-flight CANVAS_TEXT (writing assistant) task id. */
  textTaskId?: string | null
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
  /** Group container size (type 'group' only). */
  w?: number
  h?: number
}

export interface SerializedEdge {
  id: string
  source: string
  target: string
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
  prompt: '',
  modelKey: '',
  aspectRatio: '9:16',
  durationSec: 5,
  resolution: '720p',
  styleId: null as string | null,
  batchCount: 1,
  lastFrameKey: null as string | null,
  lastFramePreview: null as string | null,
  shots: null as CanvasStoryboardShot[] | null,
  storyboardTaskId: null as string | null,
  referenceAudioKey: null as string | null,
  referenceAudioName: null as string | null,
  emotionPrompt: null as string | null,
  emotionStrength: 0.4,
  audioUrl: null as string | null,
  ttsTaskId: null as string | null,
  runId: null as string | null,
  resultUrl: null as string | null,
  referenceKey: null as string | null,
  anchorKey: null as string | null,
  anchorUrl: null as string | null,
} satisfies Record<string, unknown>

export const EMPTY_CANVAS: SerializedCanvas = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}
