import type { MaskKeyframe, MaskRaster, VirtualCharacterLayer } from '../live-composite-types'

export interface NormalizedBounds {
  left: number
  top: number
  right: number
  bottom: number
}

export interface CharacterRenderTransform {
  centerX: number
  centerY: number
  width: number
  height: number
  rotationRadians: number
  opacity: number
}

const MASK_VISIBLE_THRESHOLD = 24

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function findPersonBounds(mask: MaskRaster | undefined): NormalizedBounds | null {
  if (!mask || mask.width <= 0 || mask.height <= 0 || mask.alpha.length !== mask.width * mask.height) return null
  let left = mask.width
  let top = mask.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.alpha[y * mask.width + x] < MASK_VISIBLE_THRESHOLD) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) return null
  return {
    left: left / mask.width,
    top: top / mask.height,
    right: (right + 1) / mask.width,
    bottom: (bottom + 1) / mask.height,
  }
}

export function isCharacterVisible(layer: VirtualCharacterLayer, time: number): boolean {
  return time >= layer.startTime && time <= layer.endTime && layer.opacity > 0
}

export function resolveCharacterCenter(
  layer: VirtualCharacterLayer,
  mask: MaskRaster | undefined,
  trackedCenter?: { x: number; y: number } | null,
): { x: number; y: number } {
  if (layer.anchor === 'person') {
    if (trackedCenter) {
      return { x: trackedCenter.x + layer.offsetX, y: trackedCenter.y + layer.offsetY }
    }
    const bounds = findPersonBounds(mask)
    if (bounds) {
      return {
        x: (bounds.left + bounds.right) / 2 + layer.offsetX,
        y: (bounds.top + bounds.bottom) / 2 + layer.offsetY,
      }
    }
  }
  return { x: layer.x, y: layer.y }
}

function maskCenter(mask: MaskRaster | undefined): { x: number; y: number } | null {
  const bounds = findPersonBounds(mask)
  return bounds ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 } : null
}

interface PersonTrackingPoint {
  time: number
  center: { x: number; y: number }
}

const trackingPathCache = new WeakMap<MaskKeyframe[], PersonTrackingPoint[]>()

function buildTrackingPath(keyframes: MaskKeyframe[]): PersonTrackingPoint[] {
  const cached = trackingPathCache.get(keyframes)
  if (cached) return cached
  const path = keyframes
    .map((keyframe) => ({ time: keyframe.time, center: maskCenter(keyframe.baseMask) }))
    .filter((entry): entry is PersonTrackingPoint => entry.center !== null)
    .sort((a, b) => a.time - b.time)
  trackingPathCache.set(keyframes, path)
  return path
}

/** Smoothly interpolate the detected person's center between AI mask keyframes. */
export function resolveTrackedPersonCenter(keyframes: MaskKeyframe[], time: number): { x: number; y: number } | null {
  const tracked = buildTrackingPath(keyframes)
  if (tracked.length === 0) return null
  let before = tracked[0]
  for (const entry of tracked) {
    if (entry.time > time) break
    before = entry
  }
  const after = tracked.find((entry) => entry.time >= time) ?? tracked[tracked.length - 1]
  if (before.time === after.time) return before.center
  const progress = clamp((time - before.time) / (after.time - before.time), 0, 1)
  return {
    x: before.center.x + (after.center.x - before.center.x) * progress,
    y: before.center.y + (after.center.y - before.center.y) * progress,
  }
}

export function computeCharacterTransform(
  layer: VirtualCharacterLayer,
  mask: MaskRaster | undefined,
  stageWidth: number,
  stageHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  trackedCenter?: { x: number; y: number } | null,
): CharacterRenderTransform {
  const center = resolveCharacterCenter(layer, mask, trackedCenter)
  const height = stageHeight * clamp(layer.scale, 0.05, 2)
  const aspectRatio = sourceWidth > 0 && sourceHeight > 0 ? sourceWidth / sourceHeight : 1
  return {
    centerX: center.x * stageWidth,
    centerY: center.y * stageHeight,
    width: height * aspectRatio,
    height,
    rotationRadians: (layer.rotation * Math.PI) / 180,
    opacity: clamp(layer.opacity, 0, 1),
  }
}

export function characterMediaTime(layer: VirtualCharacterLayer, timelineTime: number, mediaDuration: number): number {
  const elapsed = Math.max(0, timelineTime - layer.startTime)
  if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return elapsed
  if (layer.loop) return elapsed % mediaDuration
  return Math.min(elapsed, Math.max(0, mediaDuration - 0.001))
}
