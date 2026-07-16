import type { MaskKeyframe, MaskRaster, MaskStroke } from '../live-composite-types'

export const MASK_KEYFRAME_TIME_EPSILON = 0.02

export function normalizeMaskTime(time: number, duration?: number): number {
  if (!Number.isFinite(time)) throw new Error('遮罩時間無效')
  const bounded = Math.max(0, duration === undefined ? time : Math.min(time, duration))
  return Math.round(bounded * 100) / 100
}

export function sortMaskKeyframes(keyframes: MaskKeyframe[]): MaskKeyframe[] {
  return [...keyframes].sort((a, b) => a.time - b.time)
}

export function findExactMaskKeyframe(keyframes: MaskKeyframe[], time: number): MaskKeyframe | null {
  return keyframes.find((keyframe) => Math.abs(keyframe.time - time) <= MASK_KEYFRAME_TIME_EPSILON) ?? null
}

export function resolveMaskKeyframe(keyframes: MaskKeyframe[], time: number): MaskKeyframe | null {
  const sorted = sortMaskKeyframes(keyframes)
  if (sorted.length === 0) return null
  if (sorted[0].time > time + MASK_KEYFRAME_TIME_EPSILON) return null
  let resolved = sorted[0]
  for (const keyframe of sorted) {
    if (keyframe.time > time + MASK_KEYFRAME_TIME_EPSILON) break
    resolved = keyframe
  }
  return resolved
}

export function upsertMaskKeyframe(
  keyframes: MaskKeyframe[],
  time: number,
  strokes: MaskStroke[],
  idFactory: () => string,
  baseMask?: MaskRaster | null,
): MaskKeyframe[] {
  const normalizedTime = normalizeMaskTime(time)
  const exact = findExactMaskKeyframe(keyframes, normalizedTime)
  if (exact) {
    return sortMaskKeyframes(
      keyframes.map((keyframe) => {
        if (keyframe.id !== exact.id) return keyframe
        if (baseMask === undefined) return { ...keyframe, strokes }
        if (baseMask === null) {
          const withoutBaseMask = { ...keyframe }
          delete withoutBaseMask.baseMask
          return { ...withoutBaseMask, strokes }
        }
        return { ...keyframe, strokes, baseMask }
      }),
    )
  }
  const next: MaskKeyframe = { id: idFactory(), time: normalizedTime, strokes }
  if (baseMask) next.baseMask = baseMask
  return sortMaskKeyframes([...keyframes, next])
}

export function upsertAiMaskKeyframe(
  keyframes: MaskKeyframe[],
  time: number,
  baseMask: MaskRaster,
  idFactory: () => string,
): MaskKeyframe[] {
  const exact = findExactMaskKeyframe(keyframes, normalizeMaskTime(time))
  return upsertMaskKeyframe(keyframes, time, exact?.strokes ?? [], idFactory, baseMask)
}

export function mergeAiMaskKeyframes(
  keyframes: MaskKeyframe[],
  frames: Array<{ time: number; mask: MaskRaster }>,
  idFactory: () => string,
): MaskKeyframe[] {
  return frames.reduce(
    (result, frame) => upsertAiMaskKeyframe(result, frame.time, frame.mask, idFactory),
    keyframes,
  )
}

export function createMaskKeyframeFromCurrent(
  keyframes: MaskKeyframe[],
  time: number,
  idFactory: () => string,
): MaskKeyframe[] {
  const normalizedTime = normalizeMaskTime(time)
  if (findExactMaskKeyframe(keyframes, normalizedTime)) return keyframes
  const inherited = resolveMaskKeyframe(keyframes, normalizedTime)
  return upsertMaskKeyframe(
    keyframes,
    normalizedTime,
    [...(inherited?.strokes ?? [])],
    idFactory,
    inherited?.baseMask,
  )
}

export function removeMaskKeyframe(keyframes: MaskKeyframe[], id: string): MaskKeyframe[] {
  if (keyframes.length <= 1) return keyframes
  return keyframes.filter((keyframe) => keyframe.id !== id)
}

export function applyMaskToStart(
  keyframes: MaskKeyframe[],
  time: number,
  strokes: MaskStroke[],
  idFactory: () => string,
  baseMask?: MaskRaster,
): MaskKeyframe[] {
  const normalizedTime = normalizeMaskTime(time)
  const fromCurrent = keyframes.filter((keyframe) => keyframe.time >= normalizedTime - MASK_KEYFRAME_TIME_EPSILON)
  return upsertMaskKeyframe(fromCurrent, 0, [...strokes], idFactory, baseMask ?? null)
}

export function applyMaskToEnd(
  keyframes: MaskKeyframe[],
  time: number,
  strokes: MaskStroke[],
  idFactory: () => string,
  baseMask?: MaskRaster,
): MaskKeyframe[] {
  const normalizedTime = normalizeMaskTime(time)
  const throughCurrent = keyframes.filter((keyframe) => keyframe.time <= normalizedTime + MASK_KEYFRAME_TIME_EPSILON)
  return upsertMaskKeyframe(throughCurrent, normalizedTime, [...strokes], idFactory, baseMask ?? null)
}
