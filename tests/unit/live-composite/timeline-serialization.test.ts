import { describe, expect, it } from 'vitest'
import {
  collectBaseMaskKeys,
  deserializeFaceTrack,
  deserializeFaceTrackFromTimeline,
  deserializeOcclusionTimeline,
  deserializeMaskStroke,
  deserializeTimeline,
  FACE_TRACK_VERSION,
  serializeFaceTrack,
  serializeMaskStroke,
  serializeTimeline,
} from '@/app/[locale]/live-composite/lib/timeline-serialization'
import type { FacePerformanceTrack } from '@/app/[locale]/live-composite/lib/face-performance'
import type { MaskKeyframe, MaskRaster, MaskStroke, VirtualCharacterLayer } from '@/app/[locale]/live-composite/live-composite-types'

function makeRaster(seed: number): MaskRaster {
  return { width: 2, height: 2, alpha: new Uint8ClampedArray([seed, 0, 255, 128]) }
}

function makeStroke(overrides: Partial<MaskStroke> = {}): MaskStroke {
  return {
    id: 's-1',
    tool: 'keep',
    size: 0.06,
    points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
    ...overrides,
  }
}

describe('live-composite timeline serialization', () => {
  const character: VirtualCharacterLayer = {
    assetType: 'video', assetName: 'robot.webm', assetUrl: 'blob:robot',
    assetKey: 'video/playground-ref/user-1/robot.webm', anchor: 'person',
    x: 0.7, y: 0.5, offsetX: 0.25, offsetY: 0, scale: 0.4,
    rotation: 0, opacity: 1, startTime: 0, endTime: 3, loop: true,
    depth: 'behind-person',
  }

  it('stroke round trip maps size <-> brushPercent and keeps tool/points', () => {
    const serialized = serializeMaskStroke(makeStroke({ tool: 'erase', size: 0.125 }))
    expect(serialized).toEqual({
      id: 's-1',
      tool: 'erase',
      brushPercent: 12.5,
      points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }],
    })
    expect(deserializeMaskStroke(serialized)).toEqual(makeStroke({ tool: 'erase', size: 0.125 }))
  })

  it('serialize clamps drifted points into 0-1', () => {
    const serialized = serializeMaskStroke(makeStroke({ points: [{ x: -0.2, y: 1.7 }] }))
    expect(serialized.points).toEqual([{ x: 0, y: 1 }])
  })

  it('serialize rejects invalid brush size and empty strokes', () => {
    expect(() => serializeMaskStroke(makeStroke({ size: 0 }))).toThrow('筆刷尺寸無效')
    expect(() => serializeMaskStroke(makeStroke({ size: 1.5 }))).toThrow('筆刷尺寸無效')
    expect(() => serializeMaskStroke(makeStroke({ points: [] }))).toThrow('沒有任何座標點')
  })

  it('timeline round trip restores keyframes, strokes and AI rasters', () => {
    const raster = makeRaster(7)
    const keyframes: MaskKeyframe[] = [
      { id: 'kf-0', time: 0, strokes: [makeStroke()], baseMask: raster },
      { id: 'kf-1', time: 2.5, strokes: [] },
    ]
    const maskKey = 'images/playground-ref/user-1/ref-mask.png'

    const timeline = serializeTimeline(keyframes, (keyframe) => (keyframe.baseMask ? maskKey : undefined))
    expect(timeline.keyframes[0].baseMaskKey).toBe(maskKey)
    expect(timeline.keyframes[1]).not.toHaveProperty('baseMaskKey')

    const restored = deserializeTimeline(timeline, new Map([[maskKey, raster]]))
    expect(restored).toEqual(keyframes)
    // Raster is carried by reference — no lossy copy on load.
    expect(restored[0].baseMask).toBe(raster)
  })

  it('round trips an independent foreground occlusion timeline', () => {
    const personRaster = makeRaster(10)
    const occlusionRaster = makeRaster(20)
    const personKeyframes: MaskKeyframe[] = [{ id: 'person-0', time: 0, strokes: [], baseMask: personRaster }]
    const occlusionKeyframes: MaskKeyframe[] = [{ id: 'depth-0', time: 0, strokes: [makeStroke()], baseMask: occlusionRaster }]
    const keys = new Map<MaskRaster, string>([
      [personRaster, 'images/playground-ref/user-1/person.png'],
      [occlusionRaster, 'images/playground-ref/user-1/depth.png'],
    ])

    const timeline = serializeTimeline(personKeyframes, (keyframe) => keyframe.baseMask ? keys.get(keyframe.baseMask) : undefined, null, occlusionKeyframes)
    expect(timeline.occlusionKeyframes?.[0].baseMaskKey).toBe('images/playground-ref/user-1/depth.png')
    expect(deserializeOcclusionTimeline(timeline, new Map([
      ['images/playground-ref/user-1/person.png', personRaster],
      ['images/playground-ref/user-1/depth.png', occlusionRaster],
    ]))).toEqual(occlusionKeyframes)
  })

  it('opens legacy timelines with an empty foreground occlusion keyframe', () => {
    const legacy = { keyframes: [{ id: 'person-0', time: 0, strokes: [] }] }
    expect(deserializeOcclusionTimeline(legacy, new Map())).toEqual([
      { id: 'occlusion-keyframe-0', time: 0, strokes: [] },
    ])
  })

  it('serialize fails loudly when a keyframe raster has no uploaded key', () => {
    const keyframes: MaskKeyframe[] = [{ id: 'kf-0', time: 1.25, strokes: [], baseMask: makeRaster(1) }]
    expect(() => serializeTimeline(keyframes, () => undefined)).toThrow('AI 遮罩尚未上傳')
  })

  it('deserialize fails loudly when a raster is missing for a stored key', () => {
    const timeline = {
      keyframes: [{ id: 'kf-0', time: 0.5, baseMaskKey: 'images/playground-ref/user-1/gone.png', strokes: [] }],
    }
    expect(() => deserializeTimeline(timeline, new Map())).toThrow('下載失敗')
  })

  it('enforces keyframe and stroke caps at serialize time', () => {
    const tooManyKeyframes: MaskKeyframe[] = Array.from({ length: 601 }, (_, index) => ({
      id: `kf-${index}`,
      time: index,
      strokes: [],
    }))
    expect(() => serializeTimeline(tooManyKeyframes, () => undefined)).toThrow('超過上限 600')

    const tooManyStrokes: MaskKeyframe[] = [{
      id: 'kf-0',
      time: 0,
      strokes: Array.from({ length: 501 }, (_, index) => makeStroke({ id: `s-${index}` })),
    }]
    expect(() => serializeTimeline(tooManyStrokes, () => undefined)).toThrow('筆劃數超過上限 500')

    expect(() => serializeTimeline([], () => undefined)).toThrow('遮罩時間軸是空的')
  })

  it('collectBaseMaskKeys dedupes shared keys', () => {
    const timeline = {
      keyframes: [
        { id: 'a', time: 0, baseMaskKey: 'images/playground-ref/u/x.png', strokes: [] },
        { id: 'b', time: 1, baseMaskKey: 'images/playground-ref/u/x.png', strokes: [] },
        { id: 'c', time: 2, baseMaskKey: 'images/playground-ref/u/y.png', strokes: [] },
        { id: 'd', time: 3, strokes: [] },
      ],
      occlusionKeyframes: [
        { id: 'depth-a', time: 0, baseMaskKey: 'images/playground-ref/u/y.png', strokes: [] },
        { id: 'depth-b', time: 1, baseMaskKey: 'images/playground-ref/u/z.png', strokes: [] },
      ],
    }
    expect(collectBaseMaskKeys(timeline)).toEqual([
      'images/playground-ref/u/x.png',
      'images/playground-ref/u/y.png',
      'images/playground-ref/u/z.png',
    ])
  })

  it('serializes virtual character settings without transient assetUrl', () => {
    const result = serializeTimeline([{ id: 'kf-0', time: 0, strokes: [] }], () => undefined, character)
    expect(result.virtualCharacter).toEqual({
      assetType: 'video', assetName: 'robot.webm', assetKey: character.assetKey,
      anchor: 'person', x: 0.7, y: 0.5, offsetX: 0.25, offsetY: 0,
      scale: 0.4, rotation: 0, opacity: 1, startTime: 0, endTime: 3,
      loop: true, depth: 'behind-person',
    })
    expect(result.virtualCharacter).not.toHaveProperty('assetUrl')
  })

  it('persists tracking corrections, appearance, and pose motion keyframes', () => {
    const result = serializeTimeline([{ id: 'kf-0', time: 0, strokes: [] }], () => undefined, {
      ...character,
      trackingKeyframes: [{ id: 'track-1', time: 1.23456, offsetX: 0.12345, offsetY: -0.2 }],
      appearance: { exposure: 0.1, contrast: -0.2, saturation: 0.3, temperature: 0.4, blur: 1.5, lightWrap: 0.2, shadowOpacity: 0.4, shadowBlur: 20, shadowOffsetX: 2, shadowOffsetY: 8 },
      motionEnabled: true,
      motionKeyframes: [{ id: 'pose-1', time: 1, x: 0.5, y: 0.6, scale: 1.1, rotation: 4, confidence: 0.8 }],
    })
    expect(result.virtualCharacter?.trackingKeyframes?.[0]).toEqual({ id: 'track-1', time: 1.2346, offsetX: 0.1235, offsetY: -0.2 })
    expect(result.virtualCharacter?.appearance?.shadowBlur).toBe(20)
    expect(result.virtualCharacter?.motionEnabled).toBe(true)
    expect(result.virtualCharacter?.motionKeyframes?.[0].confidence).toBe(0.8)
  })

  it('refuses to save a local-only virtual character', () => {
    expect(() => serializeTimeline(
      [{ id: 'kf-0', time: 0, strokes: [] }],
      () => undefined,
      { ...character, assetKey: null },
    )).toThrow('虛擬角色素材尚未上傳')
  })
})

describe('live-composite face track serialization', () => {
  const faceTrack: FacePerformanceTrack = {
    samples: [
      { time: 0, faceBox: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 }, blendshapeSummary: { jawOpen: 0.812, mouthSmileLeft: 0.4 } },
      { time: 0.5, faceBox: null, blendshapeSummary: null },
      { time: 1, faceBox: { x: 0.22, y: 0.21, w: 0.3, h: 0.3 }, blendshapeSummary: { jawOpen: 0.1 } },
    ],
  }

  it('round trips: sampledAt 保留所有取樣、entries 只留偵測到的、漏檢還原為 null 樣本', () => {
    const serialized = serializeFaceTrack(faceTrack)
    expect(serialized.version).toBe(FACE_TRACK_VERSION)
    expect(serialized.sampledAt).toEqual([0, 0.5, 1])
    expect(serialized.entries.map((entry) => entry.time)).toEqual([0, 1])
    expect(serialized.entries[0]).toEqual({
      time: 0,
      faceBox: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
      blendshapes: { jawOpen: 0.812, mouthSmileLeft: 0.4 },
    })
    // 漏檢時間 0.5 進 problems（detectFaceProblemTimecodes 重新計算）。
    expect(serialized.problems).toContain(0.5)

    expect(deserializeFaceTrack(serialized)).toEqual(faceTrack)
  })

  it('serializeTimeline 帶 faceTrack -> 寫進 timeline；未帶 -> 完全省略', () => {
    const keyframes: MaskKeyframe[] = [{ id: 'kf-0', time: 0, strokes: [] }]
    const withTrack = serializeTimeline(keyframes, () => undefined, null, undefined, faceTrack)
    expect(withTrack.faceTrack?.sampledAt).toEqual([0, 0.5, 1])
    expect(deserializeFaceTrackFromTimeline(withTrack)).toEqual(faceTrack)

    const withoutTrack = serializeTimeline(keyframes, () => undefined)
    expect(withoutTrack).not.toHaveProperty('faceTrack')
    expect(deserializeFaceTrackFromTimeline(withoutTrack)).toBeNull()
  })

  it('數值截整：時間/裁切框 4 位、表情 3 位', () => {
    const serialized = serializeFaceTrack({
      samples: [{
        time: 1.234567,
        faceBox: { x: 0.123456, y: -0.01, w: 0.999999, h: 1.2 },
        blendshapeSummary: { jawOpen: 0.55555 },
      }],
    })
    expect(serialized.entries[0]).toEqual({
      time: 1.2346,
      faceBox: { x: 0.1235, y: 0, w: 1, h: 1 },
      blendshapes: { jawOpen: 0.556 },
    })
    expect(serialized.sampledAt).toEqual([1.2346])
  })

  it('超過上限或空軌 -> 明確錯誤', () => {
    expect(() => serializeFaceTrack({ samples: [] })).toThrow('臉部表演軌是空的')

    const tooMany: FacePerformanceTrack = {
      samples: Array.from({ length: 601 }, (_, index) => ({
        time: index * 0.5,
        faceBox: null,
        blendshapeSummary: null,
      })),
    }
    expect(() => serializeFaceTrack(tooMany)).toThrow('超過上限 600')

    const tooManyKeys: FacePerformanceTrack = {
      samples: [{
        time: 0,
        faceBox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        blendshapeSummary: Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`shape${index}`, 0.5])),
      }],
    }
    expect(() => serializeFaceTrack(tooManyKeys)).toThrow('超過上限 20')
  })
})
