/**
 * Server-side validation for the infinite-canvas save payload (2026-06-27).
 *
 * The canvas is user-authored free-form data, so we validate at the API
 * boundary (rules/common: never trust external data) but stay permissive about
 * per-node `data` shape — node schemas evolve and the client owns them. We cap
 * counts + sizes to stop a malicious/runaway payload, and pin node types to the
 * known set.
 */
import { z } from 'zod'

const NODE_TYPES = ['character', 'image', 'video', 'text', 'director', 'script'] as const

export const MAX_NODES = 500
export const MAX_EDGES = 1000
/** Hard cap on the serialized blob (chars) — defends the @db.Text column. */
export const MAX_CANVAS_BYTES = 1_000_000

const serializedNodeSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.enum(NODE_TYPES),
  x: z.number().finite(),
  y: z.number().finite(),
  // Per-node data is client-owned; accept any JSON object, bound elsewhere by
  // the overall byte cap.
  data: z.record(z.string(), z.unknown()).default({}),
})

const serializedEdgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string().min(1).max(128),
  target: z.string().min(1).max(128),
})

const serializedViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().min(0.01).max(100),
})

export const canvasSaveSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  title: z.string().max(200).optional(),
  nodes: z.array(serializedNodeSchema).max(MAX_NODES),
  edges: z.array(serializedEdgeSchema).max(MAX_EDGES),
  viewport: serializedViewportSchema,
})

export type CanvasSaveInput = z.infer<typeof canvasSaveSchema>
