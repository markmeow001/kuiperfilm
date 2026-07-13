import type { Node } from '@xyflow/react'
import type { CanvasNodeData } from './canvas-types'

export function orderStoryboardChildren(children: Node<CanvasNodeData>[], orderedChildIds: string[]): Node<CanvasNodeData>[] {
  const byId = new Map(children.map((node) => [node.id, node]))
  const preferred = orderedChildIds.map((id) => byId.get(id)).filter((node): node is Node<CanvasNodeData> => Boolean(node))
  const seen = new Set(preferred.map((node) => node.id))
  return [...preferred, ...children.filter((node) => !seen.has(node.id))]
}

export function moveStoryboardChild(nodes: Node<CanvasNodeData>[], index: number, direction: -1 | 1): string[] | null {
  const target = index + direction
  if (target < 0 || target >= nodes.length) return null
  const next = nodes.map((node) => node.id)
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export function completedStoryboardImages(nodes: Node<CanvasNodeData>[]): Node<CanvasNodeData>[] {
  return nodes.filter((node) => node.type === 'image' && typeof node.data.runId === 'string' && node.data.runId.length > 0)
}

export function storyboardInputsSignature(nodes: Node<CanvasNodeData>[]): string {
  return JSON.stringify(completedStoryboardImages(nodes).map((node) => ({ id: node.id, runId: node.data.runId })))
}

export function isStoryboardExportStale(exportSignature: string | null | undefined, currentSignature: string): boolean {
  return typeof exportSignature === 'string' && exportSignature !== currentSignature
}
