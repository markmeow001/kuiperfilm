import { describe, expect, it } from 'vitest'
import {
  EMPTY_WORLD_BIBLE,
  parseWorldBible,
  worldBibleRequiredFieldsComplete,
} from '@/lib/visual-development/world-bible'
import { buildWorldBibleAssetPrompt } from '@/lib/visual-development/world-bible-prompt'

const completeWorld = {
  ...EMPTY_WORLD_BIBLE,
  projectPremise: 'An underground city survives by consuming biological energy.',
  visualThesis: 'Sacred white order conceals industrial predation.',
  eraAndGeography: 'A sealed subterranean metropolis after ecological collapse.',
  societyAndFactions: 'Religious rulers above workers and hidden dissidents.',
  technologyRules: 'Steam infrastructure is fused with controlled gene technology.',
  colorScript: 'Ivory and gold belong to authority; soot and brass belong to workers.',
  materialRules: 'Metals oxidize, lace yellows, and biological membranes remain damp.',
  architectureLanguage: 'Vertical gothic authority over circular industrial infrastructure.',
  cameraFormat: '2.39:1, restrained lenses, deep blacks, motivated practical light.',
  forbiddenElements: 'No clean fantasy magic, modern plastics, or decorative steampunk clutter.',
}

describe('visual development world bible', () => {
  it('完整世界規則 -> 通過必填欄位檢查並保留可追溯資料', () => {
    const parsed = parseWorldBible({
      ...completeWorld,
      references: [{ id: 'ref-1', key: 'images/ref.png', name: 'stone', category: 'material', note: 'surface only', createdAt: '2026-07-29' }],
    })

    expect(worldBibleRequiredFieldsComplete(parsed)).toBe(true)
    expect(parsed.references).toEqual([expect.objectContaining({ id: 'ref-1', key: 'images/ref.png', category: 'material' })])
  })

  it('缺少建築規則 -> 不得通過 World Canon 必填檢查', () => {
    expect(worldBibleRequiredFieldsComplete({ ...completeWorld, architectureLanguage: '' })).toBe(false)
  })

  it('材質資產 Prompt -> 生成單張無字實拍畫面並保留世界規則與參考圖邊界', () => {
    const prompt = buildWorldBibleAssetPrompt(completeWorld, 'MATERIAL-AGING')

    expect(prompt.prompt).toContain(completeWorld.materialRules)
    expect(prompt.prompt).toContain('Reference images, when supplied, are evidence')
    expect(prompt.prompt).toContain('one uninterrupted, edge-to-edge photorealistic set-detail or still-life photograph')
    expect(prompt.prompt).toContain('live-action photorealism')
    expect(prompt.prompt).toContain('single full-bleed photograph')
    expect(prompt.prompt).toContain('must contain zero written characters')
    expect(prompt.negativePrompt).toContain('movie poster')
    expect(prompt.negativePrompt).toContain('digital painting')
    expect(prompt.negativePrompt).toContain('gibberish text')
    expect(prompt.negativePrompt).toContain('multi-panel layout')
  })

  it('世界核心公式 Prompt -> 要求單一真人電影畫面而不是手繪概念圖', () => {
    const prompt = buildWorldBibleAssetPrompt(completeWorld, 'WORLD-FORMULA')

    expect(prompt.prompt).toContain('one uninterrupted, edge-to-edge photorealistic live-action establishing shot')
    expect(prompt.prompt).toContain('physical feature-film set or location')
    expect(prompt.negativePrompt).toContain('concept art rendering')
  })

  it('Research Canon 的排除證據 -> 只編入文字限制與 Negative Prompt', () => {
    const avoidConstraint = 'Avoid glossy untouched brass and pristine ceremonial textiles.'
    const prompt = buildWorldBibleAssetPrompt({
      ...completeWorld,
      research: {
        ...completeWorld.research,
        status: 'locked',
        references: [{
          id: 'avoid-1',
          key: 'images/internal-avoid.png',
          name: 'Internal exclusion',
          category: 'costume-material',
          usage: 'avoid',
          note: avoidConstraint,
          sourceUrl: 'https://example.com/internal',
          creator: 'Archive',
          license: 'Internal research',
          rightsStatus: 'editorial-reference',
          externalProcessingAllowed: false,
          downstreamEnabled: false,
          reviewStatus: 'approved',
          rejectionNote: null,
          createdAt: '2026-07-31T00:00:00.000Z',
        }],
      },
    }, 'MATERIAL-AGING')

    expect(prompt.prompt).toContain(avoidConstraint)
    expect(prompt.negativePrompt).toContain(avoidConstraint)
    expect(prompt.prompt).not.toContain('images/internal-avoid.png')
  })

  it.each(['WORLD-FORMULA', 'FACTION-COLOR', 'MATERIAL-AGING', 'ARCH-SYMBOL'] as const)(
    '%s Prompt -> 禁止模型自行排版、拼貼與產生文字',
    (code) => {
      const prompt = buildWorldBibleAssetPrompt(completeWorld, code)

      expect(prompt.prompt).toContain('one continuous image from one camera viewpoint')
      expect(prompt.prompt).toContain('no white margin, border, grid, split screen, inset image, collage or multi-panel layout')
      expect(prompt.prompt).toContain('no title, heading, caption, label, annotation, callout, legend, letter, number, logo, watermark, readable signage or invented writing')
      expect(prompt.prompt).toContain('Do not reserve or design any area for text')
      expect(prompt.negativePrompt).toContain('mood board')
      expect(prompt.negativePrompt).toContain('typography')
    },
  )
})
