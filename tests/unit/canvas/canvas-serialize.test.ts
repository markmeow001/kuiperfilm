/**
 * Unit tests for the canvas (un)serialization core (M1).
 * Pure functions — no React Flow runtime needed.
 */
import { describe, it, expect } from 'vitest'
import type { Edge, Node, Viewport } from '@xyflow/react'
import { serializeCanvas, deserializeCanvas } from '@/app/[locale]/canvas/lib/canvas-serialize'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from '@/app/[locale]/canvas/lib/canvas-types'

function node(id: string, type: string, x: number, y: number, data: Partial<CanvasNodeData> = {}): Node<CanvasNodeData> {
  return { id, type, position: { x, y }, data: { title: type, ...DEFAULT_NODE_DATA, ...data } }
}

describe('serializeCanvas', () => {
  it('captures node id/type/position/data, edges, and viewport', () => {
    const nodes = [node('a', 'image', 10, 20, { prompt: 'cat', modelKey: 'm1' })]
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b' }]
    const vp: Viewport = { x: 5, y: 6, zoom: 1.5 }

    const out = serializeCanvas(nodes, edges, vp)

    expect(out.nodes[0]).toMatchObject({ id: 'a', type: 'image', x: 10, y: 20 })
    expect(out.nodes[0].data.prompt).toBe('cat')
    expect(out.edges[0]).toEqual({ id: 'e1', source: 'a', target: 'b' })
    expect(out.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 })
  })

  it('coerces an unknown node type to text', () => {
    const out = serializeCanvas([node('a', 'bogus', 0, 0)], [], { x: 0, y: 0, zoom: 1 })
    expect(out.nodes[0].type).toBe('text')
  })
})

describe('deserializeCanvas', () => {
  it('round-trips a serialized canvas', () => {
    const nodes = [node('a', 'image', 10, 20, { prompt: 'cat' }), node('b', 'video', 30, 40)]
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b' }]
    const serialized = serializeCanvas(nodes, edges, { x: 1, y: 2, zoom: 1.2 })

    const back = deserializeCanvas(serialized)

    expect(back.nodes).toHaveLength(2)
    expect(back.nodes[0]).toMatchObject({ id: 'a', type: 'image', position: { x: 10, y: 20 } })
    expect(back.nodes[0].data.prompt).toBe('cat')
    expect(back.edges[0]).toMatchObject({ source: 'a', target: 'b' })
    expect(back.viewport).toEqual({ x: 1, y: 2, zoom: 1.2 })
  })

  it('fills DEFAULT_NODE_DATA for partial node data', () => {
    const back = deserializeCanvas({ nodes: [{ id: 'a', type: 'image', x: 0, y: 0, data: { title: 'x' } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
    expect(back.nodes[0].data.aspectRatio).toBe(DEFAULT_NODE_DATA.aspectRatio)
    expect(back.nodes[0].data.prompt).toBe('')
  })

  it('drops nodes with invalid types', () => {
    const back = deserializeCanvas({ nodes: [{ id: 'a', type: 'bogus', x: 0, y: 0, data: {} }, { id: 'b', type: 'image', x: 0, y: 0, data: {} }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
    expect(back.nodes.map((n) => n.id)).toEqual(['b'])
  })

  it('drops edges that reference missing nodes', () => {
    const back = deserializeCanvas({
      nodes: [{ id: 'a', type: 'image', x: 0, y: 0, data: {} }],
      edges: [{ id: 'e1', source: 'a', target: 'ghost' }, { id: 'e2', source: 'a', target: 'a' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    })
    expect(back.edges.map((e) => e.id)).toEqual(['e2'])
  })

  it('fails soft to empty pieces on garbage input', () => {
    expect(deserializeCanvas(null).nodes).toEqual([])
    expect(deserializeCanvas(undefined).edges).toEqual([])
    expect(deserializeCanvas('nonsense').viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(deserializeCanvas(42).nodes).toEqual([])
  })
})
