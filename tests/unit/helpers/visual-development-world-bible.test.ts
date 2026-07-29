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

  it('材質資產 Prompt -> 同時包含世界規則、資產責任與參考圖邊界', () => {
    const prompt = buildWorldBibleAssetPrompt(completeWorld, 'MATERIAL-AGING')

    expect(prompt.prompt).toContain('Material & Aging Rules')
    expect(prompt.prompt).toContain(completeWorld.materialRules)
    expect(prompt.prompt).toContain('Reference images, when supplied, are evidence')
    expect(prompt.prompt).toContain('photorealistic macro photography')
    expect(prompt.prompt).toContain('live-action photorealism')
    expect(prompt.negativePrompt).toContain('movie poster')
    expect(prompt.negativePrompt).toContain('digital painting')
  })

  it('世界核心公式 Prompt -> 要求單一真人電影畫面而不是手繪概念圖', () => {
    const prompt = buildWorldBibleAssetPrompt(completeWorld, 'WORLD-FORMULA')

    expect(prompt.prompt).toContain('one uninterrupted photorealistic live-action establishing frame')
    expect(prompt.prompt).toContain('physical feature-film set or location')
    expect(prompt.negativePrompt).toContain('concept art rendering')
  })
})
