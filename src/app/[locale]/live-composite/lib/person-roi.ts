import type { NormalizedPoint } from '../live-composite-types'

/**
 * Product default padding applied to EACH side of the pose union box (normalized 0-1).
 * Generous on purpose so hands, props, and hair extending past the skeleton stay inside;
 * the goal is only to kill far-outside false positives (e.g. a light-colored building
 * between two subjects), not to tighten the mask near body edges.
 */
export const POSE_ROI_PADDING = 0.15

/** Normalized (0-1) rectangle in video space. */
export interface PoseRoi {
  x: number
  y: number
  w: number
  h: number
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * Union bounding box over ALL detected poses' landmarks, padded per side and
 * clamped to the 0-1 frame.
 *
 * Returns null when there is no usable landmark (no pose detected, empty poses,
 * or a degenerate off-frame box). Callers MUST treat null as "no clipping" and
 * surface that to the UI — never clip silently to an empty region.
 */
export function computePoseUnionRoi(
  posesLandmarks: readonly (readonly NormalizedPoint[])[],
  padding: number = POSE_ROI_PADDING,
): PoseRoi | null {
  if (!Number.isFinite(padding) || padding < 0) throw new Error('骨架範圍外擴值必須是非負數')

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const pose of posesLandmarks) {
    for (const landmark of pose) {
      if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) continue
      minX = Math.min(minX, landmark.x)
      minY = Math.min(minY, landmark.y)
      maxX = Math.max(maxX, landmark.x)
      maxY = Math.max(maxY, landmark.y)
    }
  }
  if (minX === Number.POSITIVE_INFINITY) return null

  const left = clamp01(minX - padding)
  const top = clamp01(minY - padding)
  const right = clamp01(maxX + padding)
  const bottom = clamp01(maxY + padding)
  const width = right - left
  const height = bottom - top
  // Skeleton entirely outside the frame collapses to a zero-area box after
  // clamping; treat it the same as "no pose" instead of wiping the whole mask.
  if (width <= 0 || height <= 0) return null
  return { x: left, y: top, w: width, h: height }
}

/**
 * Returns a COPY of the mask with every value outside the ROI rectangle zeroed
 * (copy per repo immutability rule; per-frame mask buffers are transient, so the
 * one extra allocation per analyzed frame is acceptable).
 *
 * roi = null returns the ORIGINAL mask reference untouched: no pose means no
 * clipping. That outcome must be reported to the UI by the caller
 * (poseRoiApplied = false) — it is an explicit product behavior, not a silent
 * fallback.
 */
export function clipMaskToRoi<T extends Float32Array | Uint8Array | Uint8ClampedArray>(
  mask: T,
  width: number,
  height: number,
  roi: PoseRoi | null,
): T {
  if (roi === null) return mask
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('遮罩尺寸無效，無法套用骨架範圍裁切')
  }
  if (mask.length !== width * height) {
    throw new Error(`遮罩資料長度不符：預期 ${width * height}，收到 ${mask.length}`)
  }

  // floor/ceil keeps pixels that are even partially inside the normalized ROI.
  const left = Math.max(0, Math.floor(roi.x * width))
  const right = Math.min(width, Math.ceil((roi.x + roi.w) * width))
  const top = Math.max(0, Math.floor(roi.y * height))
  const bottom = Math.min(height, Math.ceil((roi.y + roi.h) * height))

  const clipped = mask.slice() as T
  for (let row = 0; row < height; row += 1) {
    const rowStart = row * width
    if (row < top || row >= bottom) {
      clipped.fill(0, rowStart, rowStart + width)
      continue
    }
    if (left > 0) clipped.fill(0, rowStart, rowStart + left)
    if (right < width) clipped.fill(0, rowStart + right, rowStart + width)
  }
  return clipped
}

/**
 * UI copy for the analysis result line: how many analyzed frames actually got
 * pose-ROI clipping. Empty string when the setting is off.
 */
export function describePoseRoiOutcome(enabled: boolean, appliedFlags: readonly boolean[]): string {
  if (!enabled || appliedFlags.length === 0) return ''
  if (appliedFlags.length === 1) {
    return appliedFlags[0] ? '已套用骨架範圍裁切。' : '未偵測到骨架，此影格未裁切。'
  }
  const applied = appliedFlags.filter(Boolean).length
  const missing = appliedFlags.length - applied
  return `${applied} / ${appliedFlags.length} 影格已套用骨架範圍裁切${missing > 0 ? `，其餘 ${missing} 格未偵測到骨架、未裁切` : ''}。`
}
