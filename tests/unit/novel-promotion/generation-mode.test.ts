import { describe, expect, it } from 'vitest'
import {
  resolveGenerationModeBehavior,
  GENERATION_MODES,
  OPENING_PACINGS,
} from '@/lib/novel-promotion/generation-mode'

describe('resolveGenerationModeBehavior', () => {
  it('r2v-narrative: 跳過生圖、自動鏈、隱藏鎖幀、預設敘事視圖、只 Seedance', () => {
    const b = resolveGenerationModeBehavior('r2v-narrative')
    expect(b.cascadeImageGen).toBe(false)
    expect(b.autoChainAfterAnalyze).toBe(true)
    expect(b.showFrameLock).toBe(false)
    expect(b.defaultStoryboardView).toBe('multishot')
    expect(b.videoModelFilter).toBe('seedance-only')
  })

  it('t2i-storyboard: 生圖、手動、顯示鎖幀、預設分鏡卡、全模型', () => {
    const b = resolveGenerationModeBehavior('t2i-storyboard')
    expect(b.cascadeImageGen).toBe(true)
    expect(b.autoChainAfterAnalyze).toBe(false)
    expect(b.showFrameLock).toBe(true)
    expect(b.defaultStoryboardView).toBe('gallery')
    expect(b.videoModelFilter).toBe('all')
  })

  it('null / undefined / 未知值 → 安全預設 r2v-narrative', () => {
    expect(resolveGenerationModeBehavior(null).cascadeImageGen).toBe(false)
    expect(resolveGenerationModeBehavior(undefined).autoChainAfterAnalyze).toBe(true)
    expect(resolveGenerationModeBehavior('garbage').defaultStoryboardView).toBe('multishot')
  })

  it('暴露合法值常數', () => {
    expect(GENERATION_MODES).toEqual(['r2v-narrative', 't2i-storyboard'])
    expect(OPENING_PACINGS).toEqual(['hook', 'cinematic'])
  })
})
