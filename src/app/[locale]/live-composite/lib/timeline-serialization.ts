/**
 * Live Composite — timeline <-> persistence JSON mapping (pure, testable).
 *
 * The in-memory `MaskStroke` stores the brush as `size` (0-1 fraction of the
 * shorter source edge); the wire format stores `brushPercent` (= size * 100)
 * per the approved LiveCompositeProject.timeline schema. AI base masks are
 * NOT inlined — each keyframe's raster is uploaded as a PNG and referenced
 * by `baseMaskKey`; strokes stay vectors inside the JSON.
 */
import type {
  LiveCompositeSerializedKeyframe,
  LiveCompositeSerializedStroke,
  LiveCompositeSerializedTimeline,
} from '@/app/api/live-composite/lib/projects-contract'
import { LIVE_COMPOSITE_MAX_KEYFRAMES, LIVE_COMPOSITE_MAX_STROKES_PER_KEYFRAME } from '@/app/api/live-composite/lib/projects-contract'
import type { MaskKeyframe, MaskRaster, MaskStroke, VirtualCharacterLayer } from '../live-composite-types'

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

export function serializeMaskStroke(stroke: MaskStroke): LiveCompositeSerializedStroke {
  if (!Number.isFinite(stroke.size) || stroke.size <= 0 || stroke.size > 1) {
    throw new Error(`筆刷尺寸無效（stroke ${stroke.id}）`)
  }
  if (stroke.points.length === 0) {
    throw new Error(`筆劃沒有任何座標點（stroke ${stroke.id}）`)
  }
  return {
    id: stroke.id,
    tool: stroke.tool,
    brushPercent: round4(stroke.size * 100),
    points: stroke.points.map((point) => ({ x: round4(clamp01(point.x)), y: round4(clamp01(point.y)) })),
  }
}

export function deserializeMaskStroke(stroke: LiveCompositeSerializedStroke): MaskStroke {
  return {
    id: stroke.id,
    tool: stroke.tool,
    size: stroke.brushPercent / 100,
    points: stroke.points.map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) })),
  }
}

/**
 * Serialize the in-memory keyframes into the persistence JSON.
 * `resolveBaseMaskKey` maps a keyframe's AI raster to its uploaded PNG key;
 * a keyframe that HAS a raster but resolves to no key is a hard error —
 * silently dropping a mask would corrupt the saved project.
 */
export function serializeTimeline(
  keyframes: MaskKeyframe[],
  resolveBaseMaskKey: (keyframe: MaskKeyframe) => string | undefined,
  virtualCharacter?: VirtualCharacterLayer | null,
): LiveCompositeSerializedTimeline {
  if (keyframes.length === 0) throw new Error('遮罩時間軸是空的，無法儲存')
  if (keyframes.length > LIVE_COMPOSITE_MAX_KEYFRAMES) {
    throw new Error(`關鍵影格數量 ${keyframes.length} 超過上限 ${LIVE_COMPOSITE_MAX_KEYFRAMES}`)
  }
  if (virtualCharacter && !virtualCharacter.assetKey) {
    throw new Error('虛擬角色素材尚未上傳，無法儲存')
  }
  return {
    keyframes: keyframes.map((keyframe) => {
      if (keyframe.strokes.length > LIVE_COMPOSITE_MAX_STROKES_PER_KEYFRAME) {
        throw new Error(`關鍵影格 ${keyframe.time.toFixed(2)}s 的筆劃數超過上限 ${LIVE_COMPOSITE_MAX_STROKES_PER_KEYFRAME}`)
      }
      const baseMaskKey = keyframe.baseMask ? resolveBaseMaskKey(keyframe) : undefined
      if (keyframe.baseMask && !baseMaskKey) {
        throw new Error(`關鍵影格 ${keyframe.time.toFixed(2)}s 的 AI 遮罩尚未上傳，無法儲存`)
      }
      const serialized: LiveCompositeSerializedKeyframe = {
        id: keyframe.id,
        time: keyframe.time,
        strokes: keyframe.strokes.map(serializeMaskStroke),
      }
      return baseMaskKey ? { ...serialized, baseMaskKey } : serialized
    }),
    ...(virtualCharacter?.assetKey ? {
      virtualCharacter: {
        assetType: virtualCharacter.assetType,
        assetName: virtualCharacter.assetName,
        assetKey: virtualCharacter.assetKey,
        anchor: virtualCharacter.anchor,
        x: round4(virtualCharacter.x),
        y: round4(virtualCharacter.y),
        offsetX: round4(virtualCharacter.offsetX),
        offsetY: round4(virtualCharacter.offsetY),
        scale: round4(virtualCharacter.scale),
        rotation: round4(virtualCharacter.rotation),
        opacity: round4(virtualCharacter.opacity),
        startTime: round4(virtualCharacter.startTime),
        endTime: round4(virtualCharacter.endTime),
        loop: virtualCharacter.loop,
        depth: virtualCharacter.depth,
      },
    } : {}),
  }
}

/**
 * Rebuild in-memory keyframes from the persisted timeline. `rasterByKey`
 * must contain a decoded raster for EVERY baseMaskKey — a missing entry is
 * a hard error (mirror of serializeTimeline's rule).
 */
export function deserializeTimeline(
  timeline: LiveCompositeSerializedTimeline,
  rasterByKey: ReadonlyMap<string, MaskRaster>,
): MaskKeyframe[] {
  if (timeline.keyframes.length === 0) throw new Error('儲存的遮罩時間軸是空的，無法載入')
  return timeline.keyframes.map((keyframe) => {
    const restored: MaskKeyframe = {
      id: keyframe.id,
      time: keyframe.time,
      strokes: keyframe.strokes.map(deserializeMaskStroke),
    }
    if (!keyframe.baseMaskKey) return restored
    const raster = rasterByKey.get(keyframe.baseMaskKey)
    if (!raster) {
      throw new Error(`關鍵影格 ${keyframe.time.toFixed(2)}s 的 AI 遮罩下載失敗，無法載入`)
    }
    return { ...restored, baseMask: raster }
  })
}

/** All distinct baseMaskKeys referenced by a persisted timeline. */
export function collectBaseMaskKeys(timeline: LiveCompositeSerializedTimeline): string[] {
  const keys = new Set<string>()
  for (const keyframe of timeline.keyframes) {
    if (keyframe.baseMaskKey) keys.add(keyframe.baseMaskKey)
  }
  return [...keys]
}
