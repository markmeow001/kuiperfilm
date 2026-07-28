import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISUAL_DEVELOPMENT_STAGE,
  getVisualDevelopmentStage,
  VISUAL_DEVELOPMENT_STAGES,
} from '@/app/[locale]/visual-development/visual-development-config'

describe('visual development stage configuration', () => {
  it('defines the complete Phase -1 through Phase 13 pipeline in order', () => {
    expect(VISUAL_DEVELOPMENT_STAGES).toHaveLength(15)
    expect(VISUAL_DEVELOPMENT_STAGES.map((stage) => stage.code)).toEqual([
      '-1',
      '00',
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '10',
      '11',
      '12',
      '13',
    ])
  })

  it('uses unique ids and opens the UI prototype on casting', () => {
    const ids = VISUAL_DEVELOPMENT_STAGES.map((stage) => stage.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(DEFAULT_VISUAL_DEVELOPMENT_STAGE).toBe('casting')
    expect(getVisualDevelopmentStage(DEFAULT_VISUAL_DEVELOPMENT_STAGE).code).toBe('01')
  })
})
