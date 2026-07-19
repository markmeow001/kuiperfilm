import type { MaskRaster } from '../live-composite-types'

const VISIBLE_ALPHA_THRESHOLD = 8

interface MaskBounds {
  left: number
  top: number
  right: number
  bottom: number
}

function findMaskBounds(mask: MaskRaster): MaskBounds | null {
  let left = mask.width
  let top = mask.height
  let right = -1
  let bottom = -1

  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.alpha[y * mask.width + x] < VISIBLE_ALPHA_THRESHOLD) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }

  if (right < left || bottom < top) return null
  return { left, top, right: right + 1, bottom: bottom + 1 }
}

function interpolate(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function interpolateBounds(before: MaskBounds, after: MaskBounds, progress: number): MaskBounds {
  return {
    left: interpolate(before.left, after.left, progress),
    top: interpolate(before.top, after.top, progress),
    right: interpolate(before.right, after.right, progress),
    bottom: interpolate(before.bottom, after.bottom, progress),
  }
}

function sampleAlpha(mask: MaskRaster, x: number, y: number): number {
  const boundedX = Math.min(mask.width - 1, Math.max(0, x))
  const boundedY = Math.min(mask.height - 1, Math.max(0, y))
  const x0 = Math.floor(boundedX)
  const y0 = Math.floor(boundedY)
  const x1 = Math.min(mask.width - 1, x0 + 1)
  const y1 = Math.min(mask.height - 1, y0 + 1)
  const xAmount = boundedX - x0
  const yAmount = boundedY - y0
  const top = interpolate(mask.alpha[y0 * mask.width + x0], mask.alpha[y0 * mask.width + x1], xAmount)
  const bottom = interpolate(mask.alpha[y1 * mask.width + x0], mask.alpha[y1 * mask.width + x1], xAmount)
  return interpolate(top, bottom, yAmount)
}

function dissolveMaskRasters(before: MaskRaster, after: MaskRaster, progress: number): MaskRaster {
  const alpha = new Uint8ClampedArray(before.alpha.length)
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = Math.round(interpolate(before.alpha[index], after.alpha[index], progress))
  }
  return { width: before.width, height: before.height, alpha }
}

function sourceCoordinate(position: number, targetStart: number, targetSize: number, sourceStart: number, sourceSize: number): number {
  const normalized = (position + 0.5 - targetStart) / targetSize
  return sourceStart + normalized * sourceSize - 0.5
}

/**
 * Morph two compatible mask rasters by matching their visible bounding boxes.
 * This compensates for coarse position and scale changes without pretending to
 * be dense optical flow: fine limb/detail correspondence still depends on the
 * frequency and quality of the analyzed masks.
 */
export function morphMaskRasters(before: MaskRaster, after: MaskRaster, progress: number): MaskRaster {
  if (before.width !== after.width || before.height !== after.height || before.alpha.length !== after.alpha.length) {
    return before
  }

  const amount = Math.min(1, Math.max(0, progress))
  if (amount <= 0) return before
  if (amount >= 1) return after

  const beforeBounds = findMaskBounds(before)
  const afterBounds = findMaskBounds(after)
  if (!beforeBounds || !afterBounds) return dissolveMaskRasters(before, after, amount)

  const targetBounds = interpolateBounds(beforeBounds, afterBounds, amount)
  const targetWidth = targetBounds.right - targetBounds.left
  const targetHeight = targetBounds.bottom - targetBounds.top
  if (targetWidth <= 0 || targetHeight <= 0) return dissolveMaskRasters(before, after, amount)

  const beforeWidth = beforeBounds.right - beforeBounds.left
  const beforeHeight = beforeBounds.bottom - beforeBounds.top
  const afterWidth = afterBounds.right - afterBounds.left
  const afterHeight = afterBounds.bottom - afterBounds.top
  const alpha = new Uint8ClampedArray(before.alpha.length)
  const startX = Math.max(0, Math.floor(targetBounds.left))
  const endX = Math.min(before.width, Math.ceil(targetBounds.right))
  const startY = Math.max(0, Math.floor(targetBounds.top))
  const endY = Math.min(before.height, Math.ceil(targetBounds.bottom))

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const centerX = x + 0.5
      const centerY = y + 0.5
      if (centerX < targetBounds.left || centerX >= targetBounds.right || centerY < targetBounds.top || centerY >= targetBounds.bottom) {
        continue
      }
      const beforeX = sourceCoordinate(x, targetBounds.left, targetWidth, beforeBounds.left, beforeWidth)
      const beforeY = sourceCoordinate(y, targetBounds.top, targetHeight, beforeBounds.top, beforeHeight)
      const afterX = sourceCoordinate(x, targetBounds.left, targetWidth, afterBounds.left, afterWidth)
      const afterY = sourceCoordinate(y, targetBounds.top, targetHeight, afterBounds.top, afterHeight)
      alpha[y * before.width + x] = Math.round(interpolate(
        sampleAlpha(before, beforeX, beforeY),
        sampleAlpha(after, afterX, afterY),
        amount,
      ))
    }
  }

  return { width: before.width, height: before.height, alpha }
}
