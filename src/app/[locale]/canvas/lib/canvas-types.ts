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
  genMode?: 'text' | 'image' | 'omni'
  /** Video-only: camera-movement preset key (运镜), appended to the prompt. */
  cameraMove?: string
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
}

/** Minimal serializable node (what we store in the Canvas DB row / localStorage). */
export interface SerializedNode {
  id: string
  type: CanvasNodeType
  x: number
  y: number
  data: CanvasNodeData
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
