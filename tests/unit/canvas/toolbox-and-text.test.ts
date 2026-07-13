import { describe, it, expect } from 'vitest'
import { TOOLBOX_PRESETS } from '@/app/[locale]/canvas/lib/canvas-toolbox'
import { pickUpstreamText } from '@/app/[locale]/canvas/lib/canvas-refs'

describe('toolbox presets', () => {
  it('every preset builds a valid, internally-consistent graph', () => {
    let n = 0
    const mk = () => `id-${n++}`
    for (const p of TOOLBOX_PRESETS) {
      n = 0
      const { nodes, edges } = p.build(mk, 100, 100)
      expect(nodes.length, p.key).toBeGreaterThan(0)
      const ids = new Set(nodes.map((x) => x.id))
      // all unique node ids
      expect(ids.size).toBe(nodes.length)
      // every edge connects existing nodes
      for (const e of edges) {
        expect(ids.has(e.source), `${p.key} edge.source`).toBe(true)
        expect(ids.has(e.target), `${p.key} edge.target`).toBe(true)
      }
      // every node has a title + valid type
      for (const node of nodes) {
        expect(['text', 'image', 'video', 'character']).toContain(node.type)
        expect(typeof node.data.title).toBe('string')
      }
    }
  })

  it('preset keys are unique', () => {
    expect(new Set(TOOLBOX_PRESETS.map((p) => p.key)).size).toBe(TOOLBOX_PRESETS.length)
  })
})

describe('pickUpstreamText', () => {
  it('joins text-node prompts, ignores non-text', () => {
    const text = pickUpstreamText([
      { type: 'text', data: { prompt: '第一幕：雪夜' } },
      { type: 'image', data: { prompt: 'should be ignored' } },
      { type: 'text', data: { prompt: '人物登场' } },
    ])
    expect(text).toBe('第一幕：雪夜\n人物登场')
  })
  it('returns empty for no text / blank / null', () => {
    expect(pickUpstreamText([])).toBe('')
    expect(pickUpstreamText([{ type: 'text', data: { prompt: '   ' } }, null, undefined])).toBe('')
    expect(pickUpstreamText([{ type: 'character', data: {} }])).toBe('')
  })

  it('script node with storyboard shots -> feeds concrete shot text downstream', () => {
    expect(pickUpstreamText([{
      type: 'script',
      data: { prompt: '旧剧本', shots: [{ description: '远景建立城市', dialogue: '开始吧' }, { description: '角色推门' }] },
    }])).toBe('远景建立城市；开始吧\n角色推门')
  })

  it('script node without shots -> feeds its source prompt downstream', () => {
    expect(pickUpstreamText([{ type: 'script', data: { prompt: '第一场：雨夜' } }])).toBe('第一场：雨夜')
  })
})
