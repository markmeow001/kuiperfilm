import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { parseCanvasAssistantPlan } from '@/lib/canvas/assistant-contract'
import { applyCanvasAssistantPlan } from '@/app/[locale]/canvas/lib/canvas-assistant-apply'
import { buildCanvasAssistantContext } from '@/app/[locale]/canvas/lib/canvas-assistant-context'
import { DEFAULT_NODE_DATA, type CanvasNodeData } from '@/app/[locale]/canvas/lib/canvas-types'

function node(id: string, type: 'text' | 'image' | 'video', selected = false): Node<CanvasNodeData> {
  return { id, type, position: { x: 0, y: 0 }, selected, data: { title: id, ...DEFAULT_NODE_DATA } }
}

describe('Canvas Assistant plan', () => {
  it('parses fenced JSON and rejects unsupported destructive operations', () => {
    const plan = parseCanvasAssistantPlan('```json\n{"summary":"建立流程","operations":[{"kind":"create_node","alias":"frame","nodeType":"image","title":"主画面"}]}\n```')
    expect(plan.operations[0]).toMatchObject({ kind: 'create_node', alias: 'frame', nodeType: 'image' })
    expect(() => parseCanvasAssistantPlan({ summary: '删掉', operations: [{ kind: 'delete_node', nodeIds: ['a'] }] })).toThrow(/unsupported operation/)
  })

  it('applies creation, alias connections and updates as one pure result', () => {
    const original = [node('brief', 'text', true)]
    let serial = 0
    const result = applyCanvasAssistantPlan(original, [], parseCanvasAssistantPlan({
      summary: '文字生成图片后转视频',
      operations: [
        { kind: 'create_node', alias: 'frame', nodeType: 'image', title: '关键帧', prompt: '电影感街景' },
        { kind: 'create_node', alias: 'clip', nodeType: 'video', title: '动态镜头' },
        { kind: 'connect', source: 'brief', target: 'frame' },
        { kind: 'connect', source: 'frame', target: 'clip' },
        { kind: 'update_nodes', nodeIds: ['clip'], patch: { aspectRatio: '16:9' } },
      ],
    }), { center: { x: 100, y: 80 }, createId: () => `new-${++serial}` })

    expect(original).toHaveLength(1)
    expect(result.nodes).toHaveLength(3)
    expect(result.nodes.find((item) => item.data.title === '动态镜头')?.data.aspectRatio).toBe('16:9')
    expect(result.edges).toHaveLength(2)
  })

  it('rejects invalid connections and locked-node updates before mutating the caller state', () => {
    const nodes = [node('video', 'video'), node('text', 'text')]
    const invalidPlan = parseCanvasAssistantPlan({ summary: '错误连线', operations: [{ kind: 'connect', source: 'video', target: 'text' }] })
    expect(() => applyCanvasAssistantPlan(nodes, [], invalidPlan, { center: { x: 0, y: 0 }, createId: () => 'x' })).toThrow(/不相容/)

    const locked = [{ ...node('locked', 'text'), data: { ...node('locked', 'text').data, locked: true } }]
    const update = parseCanvasAssistantPlan({ summary: '更新', operations: [{ kind: 'update_nodes', nodeIds: ['locked'], patch: { prompt: 'new' } }] })
    expect(() => applyCanvasAssistantPlan(locked, [], update, { center: { x: 0, y: 0 }, createId: () => 'x' })).toThrow(/已锁定/)
    expect(locked[0].data.prompt).toBe('')
  })

  it('bounds the context sent to AI and marks truncation', () => {
    const nodes = Array.from({ length: 61 }, (_, index) => node(`n-${index}`, 'text', index === 0))
    const edges: Edge[] = Array.from({ length: 101 }, (_, index) => ({ id: `e-${index}`, source: 'n-0', target: `n-${index % 60}` }))
    const context = JSON.parse(buildCanvasAssistantContext('请安排画布', nodes, edges)) as {
      canvas: { nodes: unknown[]; edges: unknown[]; truncated: boolean }
    }
    expect(context.canvas.nodes).toHaveLength(60)
    expect(context.canvas.edges).toHaveLength(100)
    expect(context.canvas.truncated).toBe(true)
  })
})
