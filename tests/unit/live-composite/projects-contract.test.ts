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

    expect(findForeignStorageKey({
      ...ok,
      timeline: {
        keyframes: ok.timeline.keyframes,
        occlusionKeyframes: [{ id: 'depth-1', time: 0, baseMaskKey: 'images/playground-ref/user-2/depth.png', strokes: [] }],
      },
    }, USER)).toEqual({
      field: 'timeline.occlusionKeyframes[depth-1].baseMaskKey',
      key: 'images/playground-ref/user-2/depth.png',
    })

    expect(findForeignStorageKey({
      timeline: liveCompositeTimelineSchema.parse(timeline({
        virtualCharacter: {
          assetType: 'video', assetName: 'robot.webm', assetKey: 'video/playground-ref/user-2/robot.webm',
          anchor: 'person', x: 0.7, y: 0.5, offsetX: 0.2, offsetY: 0, scale: 0.4,
          rotation: 0, opacity: 1, startTime: 0, endTime: 2, loop: true, depth: 'behind-person',
        },
      })),
    }, USER)).toEqual({ field: 'timeline.virtualCharacter.assetKey', key: 'video/playground-ref/user-2/robot.webm' })
  })

  it('timeline schema accepts the real editor shape and rejects malformed strokes', () => {
    expect(liveCompositeTimelineSchema.safeParse(timeline()).success).toBe(true)
    expect(liveCompositeTimelineSchema.safeParse(timeline({
      occlusionKeyframes: [{ id: 'depth-0', time: 0, strokes: [] }],
    })).success).toBe(true)

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

  it('validates virtual character timing, transform and storage metadata', () => {
    const character = {
      assetType: 'image', assetName: 'robot.png', assetKey: `images/playground-ref/${USER}/robot.png`,
      anchor: 'person', x: 0.7, y: 0.5, offsetX: 0.2, offsetY: 0, scale: 0.4,
      rotation: 0, opacity: 1, startTime: 0, endTime: 2, loop: false, depth: 'in-front',
    }
    expect(liveCompositeTimelineSchema.safeParse(timeline({ virtualCharacter: character })).success).toBe(true)
    expect(liveCompositeTimelineSchema.safeParse(timeline({ virtualCharacter: { ...character, endTime: -1 } })).success).toBe(false)
    expect(liveCompositeTimelineSchema.safeParse(timeline({ virtualCharacter: { ...character, startTime: 3 } })).success).toBe(false)
    expect(liveCompositeTimelineSchema.safeParse(timeline({ virtualCharacter: { ...character, opacity: 2 } })).success).toBe(false)
    expect(liveCompositeTimelineSchema.safeParse(timeline({ virtualCharacter: {
      ...character,
      trackingKeyframes: [{ id: 'track-1', time: 1, offsetX: 0.1, offsetY: -0.1 }],
      appearance: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, blur: 0, lightWrap: 0.1, shadowOpacity: 0.2, shadowBlur: 10, shadowOffsetX: 0, shadowOffsetY: 4 },
      motionEnabled: true,
      motionKeyframes: [{ id: 'pose-1', time: 1, x: 0.5, y: 0.6, scale: 1, rotation: 0, confidence: 0.9 }],
    } })).success).toBe(true)
    expect(liveCompositeTimelineSchema.safeParse(timeline({ virtualCharacter: { ...character, motionKeyframes: [{ id: 'pose-1', time: 1, x: 0.5, y: 0.6, scale: 1, rotation: 0, confidence: 2 }] } })).success).toBe(false)
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
