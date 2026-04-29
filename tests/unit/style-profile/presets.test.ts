import { describe, expect, it } from 'vitest'

// 直接 import 真实模块（implementer 进行中时若文件未存在会 import error，
// 这是符合预期的"窄范围测试结构红 -> 实现完成后变绿"流程）。
import {
  STYLE_PROFILE_PRESETS,
  type PresetKey,
  type StylePresetEntry,
} from '@/lib/style-profile/presets'

const EXPECTED_KEYS: PresetKey[] = ['realistic', 'american-comic', 'anime', 'thick-paint']

describe('style-profile presets catalog', () => {
  it('catalog 包含全部 4 个预期 preset key', () => {
    const actualKeys = Object.keys(STYLE_PROFILE_PRESETS).sort()
    expect(actualKeys).toEqual([...EXPECTED_KEYS].sort())
  })

  describe.each(EXPECTED_KEYS)('preset[%s]', (key) => {
    it(`positivePrompt -> 非空 string 且 <= 1000 chars`, () => {
      const entry: StylePresetEntry = STYLE_PROFILE_PRESETS[key]
      expect(typeof entry.positivePrompt).toBe('string')
      expect(entry.positivePrompt.length).toBeGreaterThan(0)
      expect(entry.positivePrompt.length).toBeLessThanOrEqual(1000)
    })

    it(`negativePrompt -> 非空 string 且 <= 1000 chars`, () => {
      const entry: StylePresetEntry = STYLE_PROFILE_PRESETS[key]
      expect(typeof entry.negativePrompt).toBe('string')
      expect(entry.negativePrompt.length).toBeGreaterThan(0)
      expect(entry.negativePrompt.length).toBeLessThanOrEqual(1000)
    })

    it(`label -> 非空 string`, () => {
      const entry: StylePresetEntry = STYLE_PROFILE_PRESETS[key]
      expect(typeof entry.label).toBe('string')
      expect(entry.label.length).toBeGreaterThan(0)
    })
  })

  it('preset key -> 与 schema 中 NovelPromotionProject.artStyle 现行常用值一致（american-comic 必须存在，作为既有 default）', () => {
    // 既有 schema default 是 'american-comic'，preset 必须包含同名 key 以便 migration 平滑映射
    expect(STYLE_PROFILE_PRESETS['american-comic']).toBeDefined()
    expect(STYLE_PROFILE_PRESETS['american-comic'].positivePrompt.length).toBeGreaterThan(0)
  })

  it('每个 preset 的 positive 与 negative -> 不应该是同一字符串（避免 copy-paste 错误）', () => {
    for (const key of EXPECTED_KEYS) {
      const entry = STYLE_PROFILE_PRESETS[key]
      expect(entry.positivePrompt).not.toBe(entry.negativePrompt)
    }
  })
})
