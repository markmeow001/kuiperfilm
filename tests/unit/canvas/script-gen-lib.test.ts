import { describe, expect, it } from 'vitest'
import {
  assetImagePrompt,
  upstreamCharacterCast,
  scriptGenProgress,
  shotEditInvalidatesPrompt,
  shotReferenceKeys,
  splitByEntityNames,
} from '@/app/[locale]/canvas/script-gen/script-gen-lib'
import type { CanvasScriptAsset, CanvasStoryboardShot } from '@/app/[locale]/canvas/lib/canvas-types'

const asset = (over: Partial<CanvasScriptAsset>): CanvasScriptAsset => ({
  id: 'a1', kind: 'character', name: '现代沈昭昭', description: 'desc', ...over,
})
const shot = (over: Partial<CanvasStoryboardShot>): CanvasStoryboardShot => ({
  shotNumber: 1, description: '画面', ...over,
})

describe('scriptGenProgress — 三步骤门禁', () => {
  it('[全部就绪] -> [3/3 且 batchReady]', () => {
    const p = scriptGenProgress(
      [shot({ finalPrompt: 'p1' }), shot({ shotNumber: 2, finalPrompt: 'p2' })],
      [asset({ imageKey: 'images/a.png' })],
    )
    expect(p).toMatchObject({ shotsReady: 2, assetsDone: 1, promptsDone: 2, completeSteps: 3, batchReady: true })
  })

  it('[一个资产没图] -> [步骤二未完成，batchReady=false]', () => {
    const p = scriptGenProgress(
      [shot({ finalPrompt: 'p1' })],
      [asset({ imageKey: 'images/a.png' }), asset({ id: 'a2', name: '皇帝', imageKey: null })],
    )
    expect(p.completeSteps).toBe(2)
    expect(p.batchReady).toBe(false)
  })

  it('[一个镜头没合成提示词] -> [步骤三未完成]', () => {
    const p = scriptGenProgress([shot({ finalPrompt: 'p1' }), shot({ shotNumber: 2 })], [])
    expect(p.promptsDone).toBe(1)
    expect(p.batchReady).toBe(false)
  })

  it('[没有镜头] -> [0/3，空资产清单不虚报完成]', () => {
    expect(scriptGenProgress([], [])).toMatchObject({ completeSteps: 0, batchReady: false })
  })

  it('[镜头缺描述] -> [步骤一未完成]', () => {
    const p = scriptGenProgress([shot({}), shot({ shotNumber: 2, description: '  ' })], [])
    expect(p.shotsReady).toBe(1)
    expect(p.completeSteps).toBe(0)
  })
})

describe('splitByEntityNames — 实体高亮切分', () => {
  it('[最长名称优先] -> [「现代沈昭昭」不被「沈昭昭」拆走]', () => {
    expect(splitByEntityNames('在办公室里，现代沈昭昭伏案', ['沈昭昭', '现代沈昭昭'])).toEqual([
      { text: '在办公室里，', entity: false },
      { text: '现代沈昭昭', entity: true },
      { text: '伏案', entity: false },
    ])
  })

  it('[多次命中] -> [每次都高亮，顺序保持]', () => {
    expect(splitByEntityNames('皇帝看着皇帝的龙椅', ['皇帝'])).toEqual([
      { text: '皇帝', entity: true },
      { text: '看着', entity: false },
      { text: '皇帝', entity: true },
      { text: '的龙椅', entity: false },
    ])
  })

  it('[无命中/空输入] -> [原样或空]', () => {
    expect(splitByEntityNames('没有实体', ['皇帝'])).toEqual([{ text: '没有实体', entity: false }])
    expect(splitByEntityNames('', ['皇帝'])).toEqual([])
    expect(splitByEntityNames('文字', [])).toEqual([{ text: '文字', entity: false }])
  })
})

describe('shotReferenceKeys — 出场资产 → 参考图', () => {
  const assets = [
    asset({ name: '现代沈昭昭', imageKey: 'images/a.png' }),
    asset({ id: 'a2', name: '金銮殿', kind: 'scene', imageKey: 'images/b.png' }),
    asset({ id: 'a3', name: '手铐', kind: 'prop', imageKey: null }),
  ]

  it('[entities 命中] -> [按序取 durable key，没图的资产跳过]', () => {
    expect(shotReferenceKeys(shot({ entities: ['金銮殿', '现代沈昭昭', '手铐'] }), assets))
      .toEqual(['images/b.png', 'images/a.png'])
  })

  it('[无 entities] -> [空参考（不发明）]', () => {
    expect(shotReferenceKeys(shot({}), assets)).toEqual([])
  })
})

describe('assetImagePrompt', () => {
  it('[角色 + 全局风格] -> [设定图指令 + 风格收尾]', () => {
    const prompt = assetImagePrompt({ kind: 'character', name: '皇帝', description: '唐代君主' }, '厚涂插画')
    expect(prompt).toContain('角色设定图：皇帝')
    expect(prompt).toContain('唐代君主')
    expect(prompt).toContain('单人全身设定图')
    expect(prompt).toContain('整体风格：厚涂插画')
  })

  it('[无全局风格] -> [不出现风格行]', () => {
    expect(assetImagePrompt({ kind: 'prop', name: '手铐', description: '金属' }, null)).not.toContain('整体风格')
  })
})

describe('shotEditInvalidatesPrompt', () => {
  it('[改提示词输入字段] -> [true]；[只改时长] -> [false]', () => {
    expect(shotEditInvalidatesPrompt({ description: 'x' })).toBe(true)
    expect(shotEditInvalidatesPrompt({ sfx: 'x' })).toBe(true)
    expect(shotEditInvalidatesPrompt({ durationSec: 8 })).toBe(false)
    expect(shotEditInvalidatesPrompt({ finalPrompt: 'x' })).toBe(false)
  })
})

describe('upstreamCharacterCast — 入口二卡司', () => {
  it('[已命名角色节点] -> [取标题为角色名，去重保序；未命名与非角色跳过]', () => {
    expect(upstreamCharacterCast([
      { type: 'character', data: { title: ' Hayes ' } },
      { type: 'character', data: { title: 'Maeve' } },
      { type: 'character', data: { title: 'Hayes' } },
      { type: 'character', data: { title: '' } },
      { type: 'scene', data: { title: '牧场客厅' } },
      null,
    ])).toEqual([{ name: 'Hayes' }, { name: 'Maeve' }])
  })
})
