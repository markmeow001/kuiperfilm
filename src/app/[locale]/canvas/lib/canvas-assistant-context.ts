import type { Edge, Node } from '@xyflow/react'
import type { CanvasNodeData } from './canvas-types'

const MAX_NODES = 60
const MAX_EDGES = 100

export function buildCanvasAssistantContext(
  instruction: string,
  nodes: Node<CanvasNodeData>[],
  edges: Edge[],
): string {
  const compactNodes = nodes.slice(0, MAX_NODES).map((node) => ({
    id: node.id,
    type: node.type,
    title: node.data.title,
    selected: Boolean(node.selected),
    locked: Boolean(node.data.locked),
    prompt: typeof node.data.prompt === 'string' ? node.data.prompt.slice(0, 400) : '',
    aspectRatio: node.data.aspectRatio,
  }))
  const compactEdges = edges.slice(0, MAX_EDGES).map((edge) => ({ source: edge.source, target: edge.target }))
  return JSON.stringify({
    instruction: instruction.trim().slice(0, 2000),
    canvas: {
      nodes: compactNodes,
      edges: compactEdges,
      truncated: nodes.length > MAX_NODES || edges.length > MAX_EDGES,
    },
  })
}
