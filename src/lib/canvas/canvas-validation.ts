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

const NODE_TYPES = ['character', 'image', 'video', 'text', 'director', 'script', 'audio', 'composition', 'group'] as const

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
  // 成组 (grouping): children reference their group container; the container
  // persists an explicit size.
  parentId: z.string().min(1).max(128).optional(),
  w: z.number().finite().positive().max(10_000).optional(),
  h: z.number().finite().positive().max(10_000).optional(),
})

const serializedEdgeSchema = z.object({
  id: z.string().min(1).max(128),
  source: z.string().min(1).max(128),
  target: z.string().min(1).max(128),
  sourceHandle: z.string().max(128).nullable().optional(),
  targetHandle: z.string().max(128).nullable().optional(),
  data: z.object({
    portType: z.enum(['text', 'script', 'identity-image', 'frame-image', 'video-clip', 'audio-voice', 'audio-music', 'storyboard-group']),
    order: z.number().int().nonnegative().optional(),
    role: z.enum(['first-frame', 'last-frame', 'reference', 'clip', 'voice', 'music']).optional(),
    invalid: z.boolean().optional(),
    invalidReason: z.string().max(300).optional(),
  }).passthrough().optional(),
})

const serializedViewportSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  zoom: z.number().finite().min(0.01).max(100),
})

export const canvasSaveSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  title: z.string().max(200).optional(),
  kind: z.enum(['canvas', 'workflow']).default('canvas'),
  nodes: z.array(serializedNodeSchema).max(MAX_NODES),
  edges: z.array(serializedEdgeSchema).max(MAX_EDGES),
  viewport: serializedViewportSchema,
})

export const canvasDeleteSchema = z.object({
  id: z.string().min(1).max(64),
})

export type CanvasSaveInput = z.infer<typeof canvasSaveSchema>
