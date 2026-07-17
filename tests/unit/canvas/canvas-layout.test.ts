import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { arrangeSelectedNodes, setSelectedLayer, setSelectedLocked } from '@/app/[locale]/canvas/lib/canvas-layout'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from '@/app/[locale]/canvas/lib/canvas-types'

function node(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<Node<CanvasNodeData>> = {},
): Node<CanvasNodeData> {
  return {
    id,
    type: 'image',
    position: { x, y },
    measured: { width, height },
    selected: true,
    data: { title: id, ...DEFAULT_NODE_DATA },
    ...extra,
  }
}

describe('canvas layout operations', () => {
  it('異尺寸節點橫向均分 -> 依節點邊界保留一致間距', () => {
    const result = arrangeSelectedNodes([
      node('a', 0, 0, 100, 100),
      node('b', 200, 0, 200, 100),
      node('c', 600, 0, 300, 100),
    ], 'horizontal')

    const a = result.find((item) => item.id === 'a')!
    const b = result.find((item) => item.id === 'b')!
    const c = result.find((item) => item.id === 'c')!
    const firstGap = b.position.x - (a.position.x + 100)
    const secondGap = c.position.x - (b.position.x + 200)
    expect(firstGap).toBe(secondGap)
    expect(firstGap).toBeGreaterThanOrEqual(24)
  })

  it('混選群組子節點 -> 只排列頂層節點且不移動子節點', () => {
    const child = node('child', 20, 30, 100, 100, { parentId: 'group' })
    const result = arrangeSelectedNodes([
      node('a', 100, 90, 100, 100),
      node('b', 300, 200, 100, 100),
      child,
    ], 'left')

    expect(result.find((item) => item.id === 'a')?.position.x).toBe(100)
    expect(result.find((item) => item.id === 'b')?.position.x).toBe(100)
    expect(result.find((item) => item.id === 'child')?.position).toEqual({ x: 20, y: 30 })
  })

  it('已鎖定節點參與基準計算但不會被排列移動', () => {
    const locked = node('locked', 300, 100, 100, 100, {
      data: { title: 'locked', ...DEFAULT_NODE_DATA, locked: true },
      draggable: false,
    })
    const result = arrangeSelectedNodes([node('a', 100, 0, 100, 100), locked], 'top')
    expect(result.find((item) => item.id === 'locked')?.position.y).toBe(100)
    expect(result.find((item) => item.id === 'a')?.position.y).toBe(0)
  })

  it('鎖定與圖層操作 -> 寫入可持久化節點狀態', () => {
    const nodes = [node('a', 0, 0, 100, 100), { ...node('b', 0, 0, 100, 100), selected: false, zIndex: 4 }]
    const locked = setSelectedLocked(nodes, true)
    expect(locked[0].data.locked).toBe(true)
    expect(locked[0].draggable).toBe(false)

    const layered = setSelectedLayer(locked, 'front')
    expect(layered[0].zIndex).toBe(5)
    expect(layered[1].zIndex).toBe(4)
  })
})
