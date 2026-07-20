/**
 * Pure planning helpers for the RVM (Robust Video Matting) sequential scan.
 *
 * RVM is a recurrent model: it must see EVERY frame in order (threading
 * r1..r4 states) even though the mask timeline only commits keyframes at the
 * user-selected sampling times. These helpers compute, ahead of time, which
 * frames to visit and which of those frames must commit a keyframe, so the
 * driver in rvm-engine.ts stays a thin loop and this logic stays testable.
 */

/** Scan frame rate used when the source frame rate is unknown to the browser. */
export const DEFAULT_RVM_SCAN_FPS = 30

export interface RvmScanStep {
  /** Video time (seconds) the driver must present before inference. */
  time: number
  /**
   * Sampling times (seconds) whose keyframe baseMask is committed from this
   * frame's matte. Empty for pure state-threading frames.
   */
  commitTimes: number[]
}

/**
 * Chooses the RVM `downsample_ratio` input for a source resolution, per the
 * model author's guidance (higher resolutions need lower ratios).
 * Classified on the short edge so portrait and landscape behave the same.
 */
export function chooseDownsampleRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('影片尺寸無效，無法選擇 RVM 縮放比例')
  }
  const shortEdge = Math.min(width, height)
  if (shortEdge >= 1080) return 0.25
  if (shortEdge >= 720) return 0.375
  return 0.5
}

/**
 * Builds the full sequential scan plan: one step per video frame from t=0 to
 * duration (inclusive), with each sampling time assigned to the nearest
 * frame (earlier frame wins a tie) exactly once.
 */
export function buildRvmScanPlan(duration: number, fps: number, commitTimes: number[]): RvmScanStep[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('影片長度無效')
  if (!Number.isFinite(fps) || fps <= 0) throw new Error('掃描影格率必須大於 0')
  if (commitTimes.length === 0) throw new Error('RVM 掃描至少需要一個取樣時間')

  const frameStep = 1 / fps
  const lastFrameIndex = Math.floor(duration * fps + 1e-6)
  const frameTimes: number[] = []
  for (let index = 0; index <= lastFrameIndex; index += 1) {
    frameTimes.push(Math.min(duration, index * frameStep))
  }
  if (frameTimes[frameTimes.length - 1] < duration - 1e-6) frameTimes.push(duration)

  const commits = new Map<number, number[]>()
  for (const commitTime of [...commitTimes].sort((a, b) => a - b)) {
    if (!Number.isFinite(commitTime) || commitTime < 0 || commitTime > duration + 1e-6) {
      throw new Error(`取樣時間 ${commitTime} 超出影片範圍`)
    }
    const nearestIndex = nearestFrameIndex(frameTimes, commitTime)
    const existing = commits.get(nearestIndex)
    if (existing) existing.push(commitTime)
    else commits.set(nearestIndex, [commitTime])
  }

  return frameTimes.map((time, index) => ({ time, commitTimes: commits.get(index) ?? [] }))
}

function nearestFrameIndex(frameTimes: number[], target: number): number {
  let low = 0
  let high = frameTimes.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (frameTimes[mid] < target) low = mid + 1
    else high = mid
  }
  // `low` is the first frame >= target; the previous frame may be closer.
  if (low > 0 && target - frameTimes[low - 1] <= frameTimes[low] - target) return low - 1
  return low
}

/** The four recurrent tensors threaded between consecutive RVM inferences. */
export interface RvmRecurrentFeeds<Tensor> {
  r1i: Tensor
  r2i: Tensor
  r3i: Tensor
  r4i: Tensor
}

/**
 * Maps one inference's recurrent outputs (r1o..r4o) to the next inference's
 * recurrent inputs (r1i..r4i). Missing outputs fail loudly: silently reusing
 * a stale state would corrupt every downstream matte.
 */
export function nextRecurrentFeeds<Tensor>(outputs: Record<string, Tensor>): RvmRecurrentFeeds<Tensor> {
  const pick = (name: string): Tensor => {
    const tensor = outputs[name]
    if (!tensor) throw new Error(`RVM 模型沒有回傳循環狀態 ${name}`)
    return tensor
  }
  return { r1i: pick('r1o'), r2i: pick('r2o'), r3i: pick('r3o'), r4i: pick('r4o') }
}
