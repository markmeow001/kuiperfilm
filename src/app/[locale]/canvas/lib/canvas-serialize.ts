/**
 * Pure (un)serialization between React Flow's runtime node/edge shape and the
 * persisted SerializedCanvas. Kept side-effect-free so it's unit-testable and
 * reusable by both the localStorage cache (M1) and the Canvas DB row (M1 step 2).
 */
import type { Edge, Node, Viewport } from '@xyflow/react'
import type { CanvasNodeType } from './canvas-tokens'
import {
  type CanvasNodeData,
  type SerializedCanvas,
  type SerializedEdge,
  type SerializedNode,
  DEFAULT_NODE_DATA,
  EMPTY_CANVAS,
} from './canvas-types'

const VALID_TYPES: readonly CanvasNodeType[] = ['character', 'image', 'video', 'text', 'director', 'script']

function isValidType(t: unknown): t is CanvasNodeType {
  return typeof t === 'string' && (VALID_TYPES as readonly string[]).includes(t)
}

/** React Flow nodes/edges/viewport → persisted JSON. */
export function serializeCanvas(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  viewport: Viewport,
): SerializedCanvas {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (isValidType(n.type) ? n.type : 'text') as CanvasNodeType,
      x: n.position.x,
      y: n.position.y,
      data: n.data,
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
  }
}

/**
 * Persisted JSON → React Flow nodes/edges. Defensive: tolerates partial/legacy
 * rows by filling DEFAULT_NODE_DATA and dropping nodes with invalid types.
 * Never throws — bad input degrades to EMPTY_CANVAS pieces (fail-soft for a
 * non-critical creative surface; the user just gets a blank canvas).
 */
export function deserializeCanvas(raw: unknown): {
  nodes: Node<CanvasNodeData>[]
  edges: Edge[]
  viewport: Viewport
} {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as Partial<SerializedCanvas>
  const srcNodes = Array.isArray(parsed.nodes) ? parsed.nodes : []
  const srcEdges = Array.isArray(parsed.edges) ? parsed.edges : []

  const nodes: Node<CanvasNodeData>[] = srcNodes
    .filter((n): n is SerializedNode => Boolean(n) && isValidType((n as SerializedNode).type))
    .map((n) => ({
      id: String(n.id),
      type: n.type,
      position: { x: Number(n.x) || 0, y: Number(n.y) || 0 },
      data: { title: '', ...DEFAULT_NODE_DATA, ...((n.data ?? {}) as Partial<CanvasNodeData>) } as CanvasNodeData,
    }))

  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges: Edge[] = srcEdges
    .filter((e): e is SerializedEdge => Boolean(e) && Boolean((e as SerializedEdge).source) && Boolean((e as SerializedEdge).target))
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({ id: String(e.id), source: String(e.source), target: String(e.target) }))

  const vp = parsed.viewport
  const viewport: Viewport =
    vp && typeof vp === 'object'
      ? { x: Number(vp.x) || 0, y: Number(vp.y) || 0, zoom: Number(vp.zoom) || 1 }
      : EMPTY_CANVAS.viewport

  return { nodes, edges, viewport }
}
