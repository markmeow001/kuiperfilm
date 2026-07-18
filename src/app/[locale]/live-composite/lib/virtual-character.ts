import type { MaskKeyframe, MaskRaster, VirtualCharacterLayer, VirtualCharacterMotionKeyframe, VirtualCharacterTrackingKeyframe } from '../live-composite-types'

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
  confidence: number
}

export interface TrackingDiagnostic {
  time: number
  confidence: number
  status: 'good' | 'warning' | 'lost'
}

export interface TrackingFailureRange {
  startTime: number
  endTime: number
  status: 'warning' | 'lost'
}

const trackingPathCache = new WeakMap<MaskKeyframe[], PersonTrackingPoint[]>()

function buildTrackingPath(keyframes: MaskKeyframe[]): PersonTrackingPoint[] {
  const cached = trackingPathCache.get(keyframes)
  if (cached) return cached
  const path = keyframes
    .map((keyframe) => ({
      time: keyframe.time,
      center: maskCenter(keyframe.baseMask),
      confidence: maskTrackingConfidence(keyframe.baseMask),
    }))
    .filter((entry): entry is PersonTrackingPoint => entry.center !== null)
    .sort((a, b) => a.time - b.time)
  trackingPathCache.set(keyframes, path)
  return path
}

/** A deterministic quality estimate for the local person mask; it is not provider confidence. */
export function maskTrackingConfidence(mask: MaskRaster | undefined): number {
  const bounds = findPersonBounds(mask)
  if (!mask || !bounds) return 0
  const width = Math.max(0, bounds.right - bounds.left)
  const height = Math.max(0, bounds.bottom - bounds.top)
  const boundsArea = width * height
  if (boundsArea <= 0) return 0
  let visiblePixels = 0
  for (const alpha of mask.alpha) if (alpha >= MASK_VISIBLE_THRESHOLD) visiblePixels += 1
  const coverage = visiblePixels / (mask.width * mask.height)
  const fillRatio = clamp(coverage / boundsArea, 0, 1)
  const usefulCoverage = clamp(coverage / 0.08, 0, 1) * clamp((0.92 - coverage) / 0.22, 0, 1)
  const edgeCount = [bounds.left, bounds.top, 1 - bounds.right, 1 - bounds.bottom].filter((gap) => gap < 0.006).length
  const edgeScore = 1 - edgeCount * 0.12
  return clamp(fillRatio * 0.45 + usefulCoverage * 0.35 + edgeScore * 0.2, 0, 1)
}

function diagnosticStatus(confidence: number): TrackingDiagnostic['status'] {
  if (confidence < 0.28) return 'lost'
  if (confidence < 0.58) return 'warning'
  return 'good'
}

export function trackingDiagnostics(keyframes: MaskKeyframe[]): TrackingDiagnostic[] {
  return keyframes
    .map((keyframe) => {
      const confidence = maskTrackingConfidence(keyframe.baseMask)
      return { time: keyframe.time, confidence, status: diagnosticStatus(confidence) }
    })
    .sort((a, b) => a.time - b.time)
}

export function trackingFailureRanges(keyframes: MaskKeyframe[]): TrackingFailureRange[] {
  const diagnostics = trackingDiagnostics(keyframes)
  const ranges: TrackingFailureRange[] = []
  for (const diagnostic of diagnostics) {
    if (diagnostic.status === 'good') continue
    const previous = ranges[ranges.length - 1]
    if (previous && previous.status === diagnostic.status && diagnostic.time - previous.endTime <= 1.1) {
      previous.endTime = diagnostic.time
    } else {
      ranges.push({ startTime: diagnostic.time, endTime: diagnostic.time, status: diagnostic.status })
    }
  }
  return ranges
}

function resolveTrackingCorrection(
  corrections: VirtualCharacterTrackingKeyframe[],
  time: number,
): { x: number; y: number } {
  if (corrections.length === 0) return { x: 0, y: 0 }
  const sorted = [...corrections].sort((a, b) => a.time - b.time)
  let before = sorted[0]
  for (const correction of sorted) {
    if (correction.time > time) break
    before = correction
  }
  const after = sorted.find((correction) => correction.time >= time) ?? sorted[sorted.length - 1]
  if (before.time === after.time) return { x: before.offsetX, y: before.offsetY }
  const progress = clamp((time - before.time) / (after.time - before.time), 0, 1)
  return {
    x: before.offsetX + (after.offsetX - before.offsetX) * progress,
    y: before.offsetY + (after.offsetY - before.offsetY) * progress,
  }
}

/** Smoothly interpolate the detected person's center between AI mask keyframes. */
export function resolveTrackedPersonCenter(
  keyframes: MaskKeyframe[],
  time: number,
  corrections: VirtualCharacterTrackingKeyframe[] = [],
): { x: number; y: number } | null {
  const tracked = buildTrackingPath(keyframes)
  if (tracked.length === 0) return null
  let before = tracked[0]
  for (const entry of tracked) {
    if (entry.time > time) break
    before = entry
  }
  const after = tracked.find((entry) => entry.time >= time) ?? tracked[tracked.length - 1]
  const correction = resolveTrackingCorrection(corrections, time)
  if (before.time === after.time) return { x: before.center.x + correction.x, y: before.center.y + correction.y }
  const progress = clamp((time - before.time) / (after.time - before.time), 0, 1)
  return {
    x: before.center.x + (after.center.x - before.center.x) * progress + correction.x,
    y: before.center.y + (after.center.y - before.center.y) * progress + correction.y,
  }
}

export function resolveCharacterMotion(
  keyframes: VirtualCharacterMotionKeyframe[],
  time: number,
): Omit<VirtualCharacterMotionKeyframe, 'id' | 'time'> | null {
  if (keyframes.length === 0) return null
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
  let before = sorted[0]
  for (const keyframe of sorted) {
    if (keyframe.time > time) break
    before = keyframe
  }
  const after = sorted.find((keyframe) => keyframe.time >= time) ?? sorted[sorted.length - 1]
  const progress = before.time === after.time ? 0 : clamp((time - before.time) / (after.time - before.time), 0, 1)
  const interpolate = (start: number, end: number) => start + (end - start) * progress
  return {
    x: interpolate(before.x, after.x),
    y: interpolate(before.y, after.y),
    scale: interpolate(before.scale, after.scale),
    rotation: interpolate(before.rotation, after.rotation),
    confidence: interpolate(before.confidence, after.confidence),
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
