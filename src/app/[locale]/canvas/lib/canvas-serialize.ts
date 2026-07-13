/**
 * Pure (un)serialization between React Flow's runtime node/edge shape and the
 * persisted SerializedCanvas. Kept side-effect-free so it's unit-testable and
 * reusable by both the localStorage cache (M1) and the Canvas DB row (M1 step 2).
 */
import type { Edge, Node, Viewport } from '@xyflow/react'
import type { CanvasNodeType } from './canvas-tokens'
import {
  type CanvasEdgeData,
  type CanvasNodeData,
  type SerializedCanvas,
  type SerializedEdge,
  type SerializedNode,
  DEFAULT_NODE_DATA,
  EMPTY_CANVAS,
} from './canvas-types'
import { CANVAS_SOURCE_HANDLE, CANVAS_TARGET_HANDLE, inferCanvasEdgeData } from './canvas-connections'

const VALID_TYPES: readonly CanvasNodeType[] = ['character', 'image', 'video', 'text', 'director', 'script', 'audio', 'composition', 'group']

function isValidType(t: unknown): t is CanvasNodeType {
  return typeof t === 'string' && (VALID_TYPES as readonly string[]).includes(t)
}

/** React Flow nodes/edges/viewport → persisted JSON. */
export function serializeCanvas(
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
  viewport: Viewport,
): SerializedCanvas {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const frameCounts = new Map<string, number>()
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (isValidType(n.type) ? n.type : 'text') as CanvasNodeType,
      x: n.position.x,
      y: n.position.y,
      data: n.data,
      // 成组: children carry parentId (position is parent-relative); the group
      // container persists its explicit size.
      ...(n.parentId ? { parentId: n.parentId } : {}),
      ...(n.type === 'group'
        ? {
            w: Number(n.style?.width ?? n.measured?.width) || 400,
            h: Number(n.style?.height ?? n.measured?.height) || 300,
          }
        : {}),
    })),
    edges: edges.map((e) => {
      const sourceType = nodeById.get(e.source)?.type as CanvasNodeType
      const targetNode = nodeById.get(e.target)
      const targetType = targetNode?.type as CanvasNodeType
      let frameIndex: number | undefined
      if (!e.data && targetType === 'video' && (sourceType === 'image' || sourceType === 'video')) {
        frameIndex = frameCounts.get(e.target) ?? 0
        frameCounts.set(e.target, frameIndex + 1)
      }
      const data = e.data as CanvasEdgeData | undefined ?? (
        sourceType && targetType
          ? inferCanvasEdgeData(sourceType, targetType, {
              frameIndex,
              targetMode: typeof targetNode?.data?.genMode === 'string' ? targetNode.data.genMode : undefined,
            })
          : { portType: 'frame-image', invalid: true, invalidReason: '连线端点不存在' }
      )
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? CANVAS_SOURCE_HANDLE,
        targetHandle: e.targetHandle ?? CANVAS_TARGET_HANDLE,
        data,
      }
    }),
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

  const valid = srcNodes.filter(
    (n): n is SerializedNode => Boolean(n) && isValidType((n as SerializedNode).type),
  )
  // A parent must be a TOP-LEVEL group node (the UI only builds one nesting
  // level; hand-crafted API payloads could smuggle group→group chains or
  // parentId pointing at a regular node, which break React Flow's ordering
  // rules on every subsequent load — strip those here, fail-soft).
  const topLevelGroupIds = new Set(
    srcNodes
      .filter((n) => Boolean(n) && (n as SerializedNode).type === 'group' && !(n as SerializedNode).parentId)
      .map((n) => String((n as SerializedNode).id)),
  )
  const nodes: Node<CanvasNodeData>[] = valid
    // React Flow requires parents to appear before their children — order
    // groups first (stable within each bucket).
    .sort((a, b) => Number(b.type === 'group') - Number(a.type === 'group'))
    .map((n) => {
      const parentId =
        n.type !== 'group' && n.parentId && topLevelGroupIds.has(String(n.parentId))
          ? String(n.parentId)
          : undefined
      return {
        id: String(n.id),
        type: n.type,
        position: { x: Number(n.x) || 0, y: Number(n.y) || 0 },
        data: { title: '', ...DEFAULT_NODE_DATA, ...((n.data ?? {}) as Partial<CanvasNodeData>) } as CanvasNodeData,
        ...(parentId ? { parentId, extent: 'parent' as const } : {}),
        ...(n.type === 'group'
          ? { style: { width: Number(n.w) || 400, height: Number(n.h) || 300 } }
          : {}),
      }
    })

  const nodeIds = new Set(nodes.map((n) => n.id))
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const frameCounts = new Map<string, number>()
  const edges: Edge[] = srcEdges
    .filter((e): e is SerializedEdge => Boolean(e) && Boolean((e as SerializedEdge).source) && Boolean((e as SerializedEdge).target))
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => {
      const source = String(e.source)
      const target = String(e.target)
      const sourceType = nodeById.get(source)?.type as CanvasNodeType
      const targetNode = nodeById.get(target)
      const targetType = targetNode?.type as CanvasNodeType
      const existingData = e.data && typeof e.data === 'object' ? e.data as CanvasEdgeData : null
      let frameIndex: number | undefined
      if (!existingData && targetType === 'video' && (sourceType === 'image' || sourceType === 'video')) {
        frameIndex = frameCounts.get(target) ?? 0
        frameCounts.set(target, frameIndex + 1)
      }
      const data = existingData ?? inferCanvasEdgeData(sourceType, targetType, {
        frameIndex,
        targetMode: typeof targetNode?.data?.genMode === 'string' ? targetNode.data.genMode : undefined,
      })
      return {
        id: String(e.id),
        source,
        target,
        sourceHandle: e.sourceHandle ?? CANVAS_SOURCE_HANDLE,
        targetHandle: e.targetHandle ?? CANVAS_TARGET_HANDLE,
        data,
        ...(data.invalid ? { style: { stroke: '#D85C5C', strokeDasharray: '5 4' }, label: '无效连线' } : {}),
      }
    })

  const vp = parsed.viewport
  const viewport: Viewport =
    vp && typeof vp === 'object'
      ? { x: Number(vp.x) || 0, y: Number(vp.y) || 0, zoom: Number(vp.zoom) || 1 }
      : EMPTY_CANVAS.viewport

  return { nodes, edges, viewport }
}
