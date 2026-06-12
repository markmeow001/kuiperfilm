import { describe, expect, it } from 'vitest'
import {
  PANEL_GENERATION_MODES,
  defaultPanelGenerationMode,
  isPanelGenerationMode,
} from '@/lib/novel-promotion/generation-mode'

describe('defaultPanelGenerationMode (Phase 1.5C creation-site default)', () => {
  it('maps r2v-narrative projects to r2v_with_subjects', () => {
    expect(defaultPanelGenerationMode({ projectGenerationMode: 'r2v-narrative' }))
      .toBe('r2v_with_subjects')
  })

  it('maps t2i-storyboard projects to t2i_then_i2v', () => {
    expect(defaultPanelGenerationMode({ projectGenerationMode: 't2i-storyboard' }))
      .toBe('t2i_then_i2v')
  })

  it('null / undefined / unknown project mode falls back to r2v_with_subjects (R2V-first)', () => {
    expect(defaultPanelGenerationMode({ projectGenerationMode: null })).toBe('r2v_with_subjects')
    expect(defaultPanelGenerationMode({})).toBe('r2v_with_subjects')
    expect(defaultPanelGenerationMode({ projectGenerationMode: 'bogus' })).toBe('r2v_with_subjects')
  })

  it('source panel mode wins over project mode (duplicate / variant / insert inherit)', () => {
    expect(defaultPanelGenerationMode({
      projectGenerationMode: 'r2v-narrative',
      sourcePanelMode: 'direct_t2v',
    })).toBe('direct_t2v')
    expect(defaultPanelGenerationMode({
      projectGenerationMode: 't2i-storyboard',
      sourcePanelMode: 'r2v_with_motion_ref',
    })).toBe('r2v_with_motion_ref')
  })

  it('invalid source panel mode falls through to the project mapping', () => {
    expect(defaultPanelGenerationMode({
      projectGenerationMode: 't2i-storyboard',
      sourcePanelMode: 'not-a-mode',
    })).toBe('t2i_then_i2v')
  })

  it('isPanelGenerationMode narrows exactly the 4 modes', () => {
    for (const mode of PANEL_GENERATION_MODES) {
      expect(isPanelGenerationMode(mode)).toBe(true)
    }
    expect(isPanelGenerationMode('r2v-narrative')).toBe(false) // project-level value, not a panel mode
    expect(isPanelGenerationMode(null)).toBe(false)
    expect(isPanelGenerationMode(undefined)).toBe(false)
    expect(isPanelGenerationMode(3)).toBe(false)
  })
})
