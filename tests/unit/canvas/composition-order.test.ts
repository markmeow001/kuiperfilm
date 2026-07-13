import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import type { CanvasNodeData } from '@/app/[locale]/canvas/lib/canvas-types'
import { orderCompositionInputs, writeCompositionEdgeOrder } from '@/app/[locale]/canvas/lib/composition-order'

function node(id: string): Node<CanvasNodeData> {
  return { id, type: 'video', position: { x: 0, y: 0 }, data: { title: id, prompt: '', modelKey: '', aspectRatio: '9:16', runId: `run-${id}` } }
}

describe('composition canonical edge order', () => {
  it('edge data order -> controls display and submit order regardless of node array order', () => {
    const available = [node('a'), node('b'), node('c')]
    const edges: Edge[] = [
      { id: 'ea', source: 'a', target: 'composition', data: { order: 2 } },
      { id: 'eb', source: 'b', target: 'composition', data: { order: 0 } },
      { id: 'ec', source: 'c', target: 'composition', data: { order: 1 } },
    ]
    expect(orderCompositionInputs(available, edges, 'composition').map((item) => item.id)).toEqual(['b', 'c', 'a'])
  })

  it('UI reorder -> writes contiguous order to matching edges and leaves audio edge untouched', () => {
    const edges: Edge[] = [
      { id: 'ea', source: 'a', target: 'composition', data: { role: 'clip', order: 0 } },
      { id: 'eb', source: 'b', target: 'composition', data: { role: 'clip', order: 1 } },
      { id: 'voice', source: 'voice', target: 'composition', data: { role: 'voice' } },
    ]
    expect(writeCompositionEdgeOrder(edges, 'composition', ['b', 'a'])).toEqual([
      { id: 'ea', source: 'a', target: 'composition', data: { role: 'clip', order: 1 } },
      { id: 'eb', source: 'b', target: 'composition', data: { role: 'clip', order: 0 } },
      { id: 'voice', source: 'voice', target: 'composition', data: { role: 'voice' } },
    ])
  })
})
