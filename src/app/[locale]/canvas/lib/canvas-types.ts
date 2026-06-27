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
  /** PlaygroundRun id once a generation has been submitted (null before). */
  runId?: string | null
  /** Last known result media URL (cached so reload shows something pre-poll). */
  resultUrl?: string | null
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
} satisfies Record<string, unknown>

export const EMPTY_CANVAS: SerializedCanvas = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}
