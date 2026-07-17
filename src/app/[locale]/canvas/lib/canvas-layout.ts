import type { Node } from '@xyflow/react'
import type { CanvasNodeData } from './canvas-types'

export type CanvasArrangeMode = 'left' | 'top' | 'horizontal' | 'vertical'
export type CanvasLayerMode = 'front' | 'back'

const FALLBACK_WIDTH = 280
const FALLBACK_HEIGHT = 180
const DISTRIBUTION_GAP = 24

function nodeSize(node: Node<CanvasNodeData>) {
  const styleWidth = Number(node.style?.width)
  const styleHeight = Number(node.style?.height)
  return {
    width: node.measured?.width ?? node.width ?? (styleWidth || FALLBACK_WIDTH),
    height: node.measured?.height ?? node.height ?? (styleHeight || FALLBACK_HEIGHT),
  }
}

function selectedTopLevel(nodes: Node<CanvasNodeData>[]) {
  return nodes.filter((node) => node.selected && !node.parentId)
}

/**
 * Aligns or distributes selected top-level nodes. Group children use
 * parent-relative coordinates, so mixing them into a canvas-space operation
 * would move them unpredictably; they are intentionally left untouched.
 */
export function arrangeSelectedNodes(
  nodes: Node<CanvasNodeData>[],
  mode: CanvasArrangeMode,
): Node<CanvasNodeData>[] {
  const selected = selectedTopLevel(nodes)
  if (selected.length < 2) return nodes
  const selectedIds = new Set(selected.map((node) => node.id))

  if (mode === 'left' || mode === 'top') {
    const target = Math.min(...selected.map((node) => mode === 'left' ? node.position.x : node.position.y))
    return nodes.map((node) => {
      if (!selectedIds.has(node.id) || node.data.locked) return node
      return {
        ...node,
        position: mode === 'left'
          ? { ...node.position, x: target }
          : { ...node.position, y: target },
      }
    })
  }

  const horizontal = mode === 'horizontal'
  const ordered = [...selected].sort((a, b) =>
    horizontal ? a.position.x - b.position.x : a.position.y - b.position.y,
  )
  const start = horizontal ? ordered[0].position.x : ordered[0].position.y
  const endNode = ordered[ordered.length - 1]
  const endSize = nodeSize(endNode)
  const naturalEnd = horizontal
    ? endNode.position.x + endSize.width
    : endNode.position.y + endSize.height
  const totalSize = ordered.reduce((sum, node) => {
    const size = nodeSize(node)
    return sum + (horizontal ? size.width : size.height)
  }, 0)
  const availableGap = (naturalEnd - start - totalSize) / (ordered.length - 1)
  const gap = Math.max(DISTRIBUTION_GAP, availableGap)
  const positions = new Map<string, number>()
  let cursor = start
  for (const node of ordered) {
    positions.set(node.id, cursor)
    const size = nodeSize(node)
    cursor += (horizontal ? size.width : size.height) + gap
  }

  return nodes.map((node) => {
    const value = positions.get(node.id)
    if (value === undefined || node.data.locked) return node
    return {
      ...node,
      position: horizontal
        ? { ...node.position, x: value }
        : { ...node.position, y: value },
    }
  })
}

export function setSelectedLayer(
  nodes: Node<CanvasNodeData>[],
  mode: CanvasLayerMode,
): Node<CanvasNodeData>[] {
  const selected = selectedTopLevel(nodes)
  if (selected.length === 0) return nodes
  const selectedIds = new Set(selected.map((node) => node.id))
  const zValues = nodes.map((node) => node.zIndex ?? 0)
  const target = mode === 'front' ? Math.max(...zValues, 0) + 1 : Math.min(...zValues, 0) - 1
  return nodes.map((node) => selectedIds.has(node.id) ? { ...node, zIndex: target } : node)
}

export function setSelectedLocked(
  nodes: Node<CanvasNodeData>[],
  locked: boolean,
): Node<CanvasNodeData>[] {
  return nodes.map((node) => {
    if (!node.selected) return node
    return {
      ...node,
      draggable: !locked,
      data: { ...node.data, locked },
    }
  })
}
