import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  EMPTY_CANVAS_HISTORY,
  recordCanvasSnapshot,
  redoCanvasSnapshot,
  undoCanvasSnapshot,
} from '@/app/[locale]/canvas/lib/canvas-history'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from '@/app/[locale]/canvas/lib/canvas-types'

function node(id: string, x: number): Node<CanvasNodeData> {
  return {
    id,
    type: 'image',
    position: { x, y: 0 },
    data: { title: id, ...DEFAULT_NODE_DATA },
  }
}

describe('canvas transaction history', () => {
  it('記錄兩次變更 -> undo/redo 還原精確節點位置', () => {
    const first = { nodes: [node('a', 0)], edges: [] }
    const second = { nodes: [node('a', 120)], edges: [] }
    const current = { nodes: [node('a', 320)], edges: [] }
    let history = recordCanvasSnapshot(EMPTY_CANVAS_HISTORY, first)
    history = recordCanvasSnapshot(history, second)

    const undone = undoCanvasSnapshot(history, current)
    expect(undone.snapshot?.nodes[0].position.x).toBe(120)

    const redone = redoCanvasSnapshot(undone.history, undone.snapshot!)
    expect(redone.snapshot?.nodes[0].position.x).toBe(320)
  })

  it('undo 後建立新交易 -> 清空 redo 分支', () => {
    const first = { nodes: [node('a', 0)], edges: [] }
    const current = { nodes: [node('a', 120)], edges: [] }
    const history = recordCanvasSnapshot(EMPTY_CANVAS_HISTORY, first)
    const undone = undoCanvasSnapshot(history, current)
    expect(undone.history.future).toHaveLength(1)

    const branched = recordCanvasSnapshot(undone.history, undone.snapshot!)
    expect(branched.future).toEqual([])
  })

  it('歷史快照使用深拷貝 -> 後續節點資料修改不污染舊版本', () => {
    const current = { nodes: [node('a', 0)], edges: [] }
    const history = recordCanvasSnapshot(EMPTY_CANVAS_HISTORY, current)
    current.nodes[0].data.prompt = 'changed later'
    expect(history.past[0].nodes[0].data.prompt).toBe('')
  })
})
