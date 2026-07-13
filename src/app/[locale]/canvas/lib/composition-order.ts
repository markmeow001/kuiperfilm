import type { Edge } from '@xyflow/react'
import type { CanvasNodeData } from './canvas-types'

export interface CompositionInput {
  id: string
  type?: string
  data: CanvasNodeData
}

export function orderCompositionInputs(available: CompositionInput[], edges: Edge[], targetId: string): CompositionInput[] {
  const byId = new Map(available.map((node) => [node.id, node]))
  return edges.map((edge, edgeIndex) => ({ edge, edgeIndex }))
    .filter(({ edge }) => edge.target === targetId && byId.has(edge.source))
    .sort((a, b) => {
      const aOrder = typeof a.edge.data?.order === 'number' ? a.edge.data.order : Number.MAX_SAFE_INTEGER
      const bOrder = typeof b.edge.data?.order === 'number' ? b.edge.data.order : Number.MAX_SAFE_INTEGER
      return aOrder - bOrder || a.edgeIndex - b.edgeIndex
    })
    .map(({ edge }) => byId.get(edge.source))
    .filter((node): node is CompositionInput => Boolean(node))
}

export function writeCompositionEdgeOrder(edges: Edge[], targetId: string, orderedSourceIds: string[]): Edge[] {
  const orderBySource = new Map(orderedSourceIds.map((sourceId, order) => [sourceId, order]))
  return edges.map((edge) => edge.target === targetId && orderBySource.has(edge.source)
    ? { ...edge, data: { ...edge.data, order: orderBySource.get(edge.source) } }
    : edge)
}
