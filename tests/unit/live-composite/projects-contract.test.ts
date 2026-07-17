import { describe, expect, it } from 'vitest'
import {
  findForeignStorageKey,
  isOwnPlaygroundRefKey,
  liveCompositeProjectCreateSchema,
  liveCompositeTimelineSchema,
} from '@/app/api/live-composite/lib/projects-contract'

const USER = 'user-1'

function timeline(overrides: Record<string, unknown> = {}) {
  return {
    keyframes: [{
      id: 'kf-0',
      time: 0,
      strokes: [{ id: 's-1', tool: 'keep', brushPercent: 6, points: [{ x: 0.5, y: 0.5 }] }],
    }],
    ...overrides,
  }
}

describe('live-composite projects contract', () => {
  it('isOwnPlaygroundRefKey accepts only the caller namespace with the right media prefix', () => {
    expect(isOwnPlaygroundRefKey(`images/playground-ref/${USER}/ref-a.png`, USER, 'image')).toBe(true)
    expect(isOwnPlaygroundRefKey(`video/playground-ref/${USER}/ref-a.mp4`, USER, 'video')).toBe(true)
    // wrong media namespace for the declared kind
    expect(isOwnPlaygroundRefKey(`video/playground-ref/${USER}/ref-a.mp4`, USER, 'image')).toBe(false)
    expect(isOwnPlaygroundRefKey(`images/playground-ref/${USER}/ref-a.png`, USER, 'video')).toBe(false)
    // foreign user / traversal / prefix-only / empty
    expect(isOwnPlaygroundRefKey('images/playground-ref/user-2/ref-a.png', USER, 'image')).toBe(false)
    expect(isOwnPlaygroundRefKey(`images/playground-ref/${USER}/../user-2/x.png`, USER, 'image')).toBe(false)
    expect(isOwnPlaygroundRefKey(`images/playground-ref/${USER}/`, USER, 'image')).toBe(false)
    expect(isOwnPlaygroundRefKey('', USER, 'image')).toBe(false)
    expect(isOwnPlaygroundRefKey(`images/playground-ref/${USER}/x.png`, '', 'image')).toBe(false)
    expect(isOwnPlaygroundRefKey('https://evil.example/x.png', USER, 'image')).toBe(false)
  })

  it('findForeignStorageKey reports the offending field, keyframes included', () => {
    const ok = {
      videoKey: `video/playground-ref/${USER}/v.mp4`,
      backgroundKey: `images/playground-ref/${USER}/bg.png`,
      timeline: {
        keyframes: [{ id: 'kf-0', time: 0, baseMaskKey: `images/playground-ref/${USER}/m.png`, strokes: [] }],
      },
    }
    expect(findForeignStorageKey(ok, USER)).toBeNull()

    expect(findForeignStorageKey({ ...ok, videoKey: 'video/playground-ref/user-2/v.mp4' }, USER))
      .toEqual({ field: 'videoKey', key: 'video/playground-ref/user-2/v.mp4' })
    expect(findForeignStorageKey({ ...ok, backgroundKey: 'images/other/bg.png' }, USER))
      .toEqual({ field: 'backgroundKey', key: 'images/other/bg.png' })
    expect(findForeignStorageKey({
      ...ok,
      timeline: { keyframes: [{ id: 'kf-9', time: 1, baseMaskKey: 'images/playground-ref/user-2/m.png', strokes: [] }] },
    }, USER)).toEqual({ field: 'timeline.keyframes[kf-9].baseMaskKey', key: 'images/playground-ref/user-2/m.png' })
  })

  it('timeline schema accepts the real editor shape and rejects malformed strokes', () => {
    expect(liveCompositeTimelineSchema.safeParse(timeline()).success).toBe(true)

    const badTool = timeline({
      keyframes: [{ id: 'kf-0', time: 0, strokes: [{ id: 's-1', tool: 'remove', brushPercent: 6, points: [{ x: 0.5, y: 0.5 }] }] }],
    })
    expect(liveCompositeTimelineSchema.safeParse(badTool).success).toBe(false)

    const outOfRange = timeline({
      keyframes: [{ id: 'kf-0', time: 0, strokes: [{ id: 's-1', tool: 'keep', brushPercent: 6, points: [{ x: 2, y: 0.5 }] }] }],
    })
    expect(liveCompositeTimelineSchema.safeParse(outOfRange).success).toBe(false)

    const negativeTime = timeline({ keyframes: [{ id: 'kf-0', time: -1, strokes: [] }] })
    expect(liveCompositeTimelineSchema.safeParse(negativeTime).success).toBe(false)

    const emptyKeyframes = timeline({ keyframes: [] })
    expect(liveCompositeTimelineSchema.safeParse(emptyKeyframes).success).toBe(false)

    const extraProp = timeline({
      keyframes: [{ id: 'kf-0', time: 0, strokes: [], surprise: true }],
    })
    expect(liveCompositeTimelineSchema.safeParse(extraProp).success).toBe(false)
  })

  it('create schema requires timeline and validates the color format', () => {
    expect(liveCompositeProjectCreateSchema.safeParse({ timeline: timeline() }).success).toBe(true)
    expect(liveCompositeProjectCreateSchema.safeParse({}).success).toBe(false)
    expect(liveCompositeProjectCreateSchema.safeParse({
      timeline: timeline(),
      backgroundColor: 'blue',
    }).success).toBe(false)
    expect(liveCompositeProjectCreateSchema.safeParse({
      timeline: timeline(),
      backgroundColor: '#172033',
    }).success).toBe(true)
  })
})
