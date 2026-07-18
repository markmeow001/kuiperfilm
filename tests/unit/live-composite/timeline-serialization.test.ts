import { describe, expect, it } from 'vitest'
import {
  collectBaseMaskKeys,
  deserializeMaskStroke,
  deserializeTimeline,
  serializeMaskStroke,
  serializeTimeline,
} from '@/app/[locale]/live-composite/lib/timeline-serialization'
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
    }
    expect(collectBaseMaskKeys(timeline)).toEqual([
      'images/playground-ref/u/x.png',
      'images/playground-ref/u/y.png',
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

  it('refuses to save a local-only virtual character', () => {
    expect(() => serializeTimeline(
      [{ id: 'kf-0', time: 0, strokes: [] }],
      () => undefined,
      { ...character, assetKey: null },
    )).toThrow('虛擬角色素材尚未上傳')
  })
})
