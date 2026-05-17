/**
 * Catalog audit for the 22 active style-profile presets (plus 2 legacy
 * keys retained for DB backwards-compat).
 *
 * This file is the structural guard for the user's "每個風格 preset 有沒有用"
 * verification (see `project_kuiperfilm_style_preset_followups` memory).
 * It catches drift in the metadata / picker / prompt layer; the actual
 * visual QA (does Tencent VOD render xianxia when you pick `cn-xianxia`?)
 * is documented separately as a manual checklist produced by
 * `scripts/audit-style-presets.ts`.
 *
 * 22 active keys must be discoverable through PRESET_ORDER_BY_CATEGORY.
 * 2 legacy keys (`anime`, `thick-paint`) live in the catalog but are
 * intentionally hidden from the picker — DB rows from before the rename
 * still reference them and must resolve.
 */
import { describe, expect, it } from 'vitest'
import {
  STYLE_PROFILE_PRESETS,
  PRESET_ORDER_BY_CATEGORY,
  CATEGORY_LABEL_ZH,
  type PresetKey,
  type PresetCategory,
} from '@/lib/style-profile/presets'
import { resolvePresetKeyByPositivePrompt } from '@/lib/style-profile/style-reference-picker'

const ACTIVE_KEYS: PresetKey[] = [
  'realistic', 'cyberpunk', 'steampunk',
  'anime-classic', 'ghibli', 'anime-isekai', 'anime-modern', 'anime-urban', 'anime-school',
  'cn-xianxia', 'cn-cartoon', 'chinese-ink',
  'korean-webtoon-fine', 'korean-historical', 'korean-urban',
  'pixar-3d', 'q-plush', 'cg-epic', 'cg-urban', 'game-cg',
  'american-comic', 'fantasy-cute',
]
const LEGACY_KEYS: PresetKey[] = ['anime', 'thick-paint']
const ALL_CATEGORIES: PresetCategory[] = ['realistic', 'anime', 'chinese', 'korean', 'cg-3d', 'western']

const NEG_BASE_TAIL = 'low resolution, blurry, watermark, text overlay, deformed face, extra fingers, extra limbs'

describe('STYLE_PROFILE_PRESETS catalog', () => {
  it('contains exactly 22 active + 2 legacy keys', () => {
    const actualKeys = Object.keys(STYLE_PROFILE_PRESETS).sort()
    const expectedKeys = [...ACTIVE_KEYS, ...LEGACY_KEYS].sort()
    expect(actualKeys).toEqual(expectedKeys)
  })

  describe.each([...ACTIVE_KEYS, ...LEGACY_KEYS])('preset[%s]', (key) => {
    const entry = () => STYLE_PROFILE_PRESETS[key]

    it('has non-empty string label / zhLabel / zhDescription', () => {
      const e = entry()
      expect(typeof e.label).toBe('string')
      expect(e.label.length).toBeGreaterThan(0)
      expect(typeof e.zhLabel).toBe('string')
      expect(e.zhLabel.length).toBeGreaterThan(0)
      expect(typeof e.zhDescription).toBe('string')
      expect(e.zhDescription.length).toBeGreaterThan(0)
    })

    it('has a valid category', () => {
      const e = entry()
      expect(ALL_CATEGORIES).toContain(e.category)
    })

    it('positivePrompt is a non-empty string ≤ 2000 chars', () => {
      const p = entry().positivePrompt
      expect(typeof p).toBe('string')
      expect(p.length).toBeGreaterThan(0)
      // 2000 is generous — realistic is 700+ after the 2026-05-13 beef.
      // We're catching catastrophic bloat, not enforcing brevity.
      expect(p.length).toBeLessThanOrEqual(2000)
    })

    it('negativePrompt is a non-empty string ≤ 2000 chars', () => {
      const n = entry().negativePrompt
      expect(typeof n).toBe('string')
      expect(n.length).toBeGreaterThan(0)
      expect(n.length).toBeLessThanOrEqual(2000)
    })

    it('negativePrompt ends with the shared NEG_BASE tail (consistency invariant)', () => {
      // NEG_BASE is the universal failure-mode list. If a preset omits
      // it the model can produce watermark / deformed-face artifacts
      // that should always be excluded regardless of style.
      expect(entry().negativePrompt.endsWith(NEG_BASE_TAIL)).toBe(true)
    })

    it('positivePrompt and negativePrompt are not identical (copy-paste guard)', () => {
      const e = entry()
      expect(e.positivePrompt).not.toBe(e.negativePrompt)
    })

    it('roundtrips through resolvePresetKeyByPositivePrompt', () => {
      // The legacy `anime` preset's positivePrompt is intentionally
      // distinct from `anime-classic`, so reverse-resolve picks the
      // right key for legacy DB rows. If anyone tweaks one to match
      // the other this test will fail.
      const resolved = resolvePresetKeyByPositivePrompt(entry().positivePrompt)
      expect(resolved).toBe(key)
    })
  })

  it('every positivePrompt is unique across the catalog', () => {
    const prompts = Object.values(STYLE_PROFILE_PRESETS).map((e) => e.positivePrompt)
    const unique = new Set(prompts)
    expect(unique.size).toBe(prompts.length)
  })
})

describe('PRESET_ORDER_BY_CATEGORY', () => {
  it('covers every category', () => {
    const orderCategories = Object.keys(PRESET_ORDER_BY_CATEGORY).sort()
    expect(orderCategories).toEqual([...ALL_CATEGORIES].sort())
  })

  it('lists every active preset key exactly once', () => {
    const flat = Object.values(PRESET_ORDER_BY_CATEGORY).flat().sort()
    const active = [...ACTIVE_KEYS].sort()
    expect(flat).toEqual(active)
  })

  it('excludes all legacy keys from the picker', () => {
    const flat = new Set(Object.values(PRESET_ORDER_BY_CATEGORY).flat())
    for (const legacy of LEGACY_KEYS) {
      expect(flat.has(legacy)).toBe(false)
    }
  })

  it('every entry in a category matches its preset.category field', () => {
    for (const [category, keys] of Object.entries(PRESET_ORDER_BY_CATEGORY) as Array<[PresetCategory, PresetKey[]]>) {
      for (const key of keys) {
        expect(STYLE_PROFILE_PRESETS[key].category).toBe(category)
      }
    }
  })
})

describe('CATEGORY_LABEL_ZH', () => {
  it('provides a Chinese label for every category', () => {
    for (const cat of ALL_CATEGORIES) {
      expect(typeof CATEGORY_LABEL_ZH[cat]).toBe('string')
      expect(CATEGORY_LABEL_ZH[cat].length).toBeGreaterThan(0)
    }
  })

  it('labels are unique (no duplicate Chinese names)', () => {
    const labels = Object.values(CATEGORY_LABEL_ZH)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('styleReferences (only realistic preset ships them today)', () => {
  it('realistic has all three eraHint slots covered', () => {
    const refs = STYLE_PROFILE_PRESETS.realistic.styleReferences
    expect(refs).toBeDefined()
    const eras = new Set(refs!.map((r) => r.eraHint))
    expect(eras.has('period')).toBe(true)
    expect(eras.has('modern')).toBe(true)
    expect(eras.has('neutral')).toBe(true)
  })

  it('realistic references all use HTTPS URLs (Tencent VOD requirement)', () => {
    const refs = STYLE_PROFILE_PRESETS.realistic.styleReferences!
    for (const r of refs) {
      expect(r.url.startsWith('https://')).toBe(true)
      expect(r.label.length).toBeGreaterThan(0)
    }
  })

  it('no other preset ships styleReferences (only realistic uses the photo-anchor path)', () => {
    for (const key of [...ACTIVE_KEYS, ...LEGACY_KEYS]) {
      if (key === 'realistic') continue
      const refs = STYLE_PROFILE_PRESETS[key].styleReferences
      expect(refs === undefined || refs.length === 0).toBe(true)
    }
  })
})
