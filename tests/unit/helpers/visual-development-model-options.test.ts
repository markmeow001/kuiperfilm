import { describe, expect, it } from 'vitest'
import {
  getVisualDevelopmentAspectRatios,
  pickVisualDevelopmentAspectRatio,
  reconcileVisualDevelopmentAspectRatio,
} from '@/lib/visual-development/model-options'

describe('visual-development model aspect ratios', () => {
  it('returns only the ratios registered for the selected image model', () => {
    const capabilities = { image: { aspectRatioOptions: ['3:4', '2:3'] } }

    expect(getVisualDevelopmentAspectRatios(capabilities, 'image')).toEqual(['3:4', '2:3'])
  })

  it('replaces a stale ratio after the model changes', () => {
    const capabilities = { image: { aspectRatioOptions: ['1:1', '3:4', '2:3'] } }

    expect(reconcileVisualDevelopmentAspectRatio('4:5', capabilities, 'image')).toBe('3:4')
  })

  it('fails closed when a model has no registered ratio capabilities', () => {
    expect(getVisualDevelopmentAspectRatios({ video: {} }, 'video')).toEqual([])
    expect(reconcileVisualDevelopmentAspectRatio('16:9', { video: {} }, 'video')).toBe('')
  })

  it('picks supported defaults without introducing another model ratio', () => {
    expect(pickVisualDevelopmentAspectRatio(['adaptive', '21:9', '3:4'], 'video')).toBe('3:4')
    expect(pickVisualDevelopmentAspectRatio(['9:16', '1:1'], 'video')).toBe('9:16')
  })
})
