/**
 * Live Composite — face performance track (pure logic, browser-local data).
 *
 * Builds a per-sample face track (crop box + expression-relevant blendshape
 * summary) from a stage-like frame source, plus stability/problem analysis
 * used for 漏檢時間碼 and the stabilized crop path that will later feed the
 * 臉部近景參考影片. No video encoding here — that output feeds generation
 * (Track B), which is frozen until B0. Only spec §3.2 analysis data.
 */
import type { FaceBox, FaceFrameAnalysis } from './face-landmarker'

/** Default sampling interval for whole-clip face analysis (seconds). */
export const FACE_ANALYSIS_DEFAULT_INTERVAL = 0.5

/**
 * Expression-relevant blendshape categories kept in the persisted summary
 * (14 keys — well under the contract's 20-key cap). Everything else
 * (cheekPuff, noseSneer, …) is dropped to bound the JSON size.
 */
export const FACE_EXPRESSION_BLENDSHAPE_KEYS = [
  'jawOpen',
  'mouthSmileLeft',
  'mouthSmileRight',
  'mouthFrownLeft',
  'mouthFrownRight',
  'eyeBlinkLeft',
  'eyeBlinkRight',
  'browDownLeft',
  'browDownRight',
  'browInnerUp',
  'eyeLookInLeft',
  'eyeLookInRight',
  'eyeLookOutLeft',
  'eyeLookOutRight',
] as const

/**
 * Product-default thresholds pending B0 benchmark calibration:
 * a normalized face-center jump above this between consecutive detected
 * samples is flagged as a problem timecode.
 */
export const FACE_PROBLEM_JUMP_THRESHOLD = 0.18
/** Moving-average window (samples) for the stabilized crop path. Product default pending B0. */
export const FACE_STABILIZE_WINDOW = 5

export interface FacePerformanceSample {
  time: number
  /** null = no face detected at this sample (漏檢). */
  faceBox: FaceBox | null
  /** Filtered + 3-decimal-rounded expression summary; null when no face. */
  blendshapeSummary: Record<string, number> | null
}

export interface FacePerformanceTrack {
  samples: FacePerformanceSample[]
}

export interface FaceFrameSource {
  analyzeFaceAt: (time: number) => Promise<FaceFrameAnalysis | null>
}

export interface ExtractFacePerformanceOptions {
  onProgress?: (completed: number, total: number, time: number) => void
  /** Return false to abort; extraction throws FacePerformanceCancelledError. */
  shouldContinue?: () => boolean
}

export class FacePerformanceCancelledError extends Error {
  constructor() {
    super('臉部表演分析已取消')
    this.name = 'FacePerformanceCancelledError'
  }
}

function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

/** Keep only expression-relevant categories, rounded to 3 decimals. */
export function summarizeBlendshapes(blendshapes: Record<string, number>): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const key of FACE_EXPRESSION_BLENDSHAPE_KEYS) {
    const value = blendshapes[key]
    if (value === undefined) continue
    if (!Number.isFinite(value)) throw new Error(`表情數值無效（${key}）`)
    summary[key] = round3(value)
  }
  return summary
}

/**
 * Sample the clip at `times` and build the face performance track. A frame
 * without a face becomes a `faceBox: null` sample — missing faces are data,
 * not exceptions. Analysis errors (seek failure, model failure) propagate.
 */
export async function extractFacePerformance(
  source: FaceFrameSource,
  times: readonly number[],
  options: ExtractFacePerformanceOptions = {},
): Promise<FacePerformanceTrack> {
  if (times.length === 0) throw new Error('沒有可分析的時間點，無法建立臉部表演軌')
  for (const time of times) {
    if (!Number.isFinite(time) || time < 0) throw new Error(`分析時間點無效：${String(time)}`)
  }
  const samples: FacePerformanceSample[] = []
  for (let index = 0; index < times.length; index += 1) {
    if (options.shouldContinue && !options.shouldContinue()) throw new FacePerformanceCancelledError()
    const time = times[index]
    const analysis = await source.analyzeFaceAt(time)
    samples.push(analysis
      ? { time, faceBox: analysis.faceBox, blendshapeSummary: summarizeBlendshapes(analysis.blendshapes) }
      : { time, faceBox: null, blendshapeSummary: null })
    options.onProgress?.(index + 1, times.length, time)
  }
  return { samples }
}

export interface ExpressionPeak {
  time: number
  value: number
}

/**
 * Strongest moment for an expression: per detected sample, average the given
 * blendshape keys and return the max. Null when nothing is detected.
 */
export function computeExpressionPeak(track: FacePerformanceTrack, keys: readonly string[]): ExpressionPeak | null {
  if (keys.length === 0) throw new Error('沒有指定表情欄位，無法計算峰值')
  let peak: ExpressionPeak | null = null
  for (const sample of track.samples) {
    if (!sample.blendshapeSummary) continue
    let sum = 0
    for (const key of keys) sum += sample.blendshapeSummary[key] ?? 0
    const value = sum / keys.length
    if (!peak || value > peak.value) peak = { time: sample.time, value }
  }
  return peak
}

function boxCenter(box: FaceBox): { x: number; y: number } {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

export interface FaceTrackDrift {
  fromTime: number
  toTime: number
  /** Normalized distance between consecutive detected face centers. */
  drift: number
}

export interface FaceTrackStability {
  drifts: FaceTrackDrift[]
  /** Moving-average crop path over detected samples — the stabilized path a 臉部近景 crop would follow. */
  stabilizedPath: Array<{ time: number; box: FaceBox }>
}

/**
 * Per-gap center drift between consecutive detected samples, plus a
 * moving-average stabilized crop path (window centered per sample, detected
 * samples only). Undetected samples contribute nothing to either output.
 */
export function computeFaceTrackStability(
  track: FacePerformanceTrack,
  window: number = FACE_STABILIZE_WINDOW,
): FaceTrackStability {
  if (!Number.isInteger(window) || window < 1) throw new Error('穩定化視窗必須是至少 1 的整數')
  const detected = track.samples.filter(
    (sample): sample is FacePerformanceSample & { faceBox: FaceBox } => sample.faceBox !== null,
  )
  const drifts: FaceTrackDrift[] = []
  for (let index = 1; index < detected.length; index += 1) {
    const previous = boxCenter(detected[index - 1].faceBox)
    const current = boxCenter(detected[index].faceBox)
    drifts.push({
      fromTime: detected[index - 1].time,
      toTime: detected[index].time,
      drift: Math.hypot(current.x - previous.x, current.y - previous.y),
    })
  }
  const half = Math.floor(window / 2)
  const stabilizedPath = detected.map((sample, index) => {
    const start = Math.max(0, index - half)
    const end = Math.min(detected.length - 1, index + half)
    let x = 0
    let y = 0
    let w = 0
    let h = 0
    for (let cursor = start; cursor <= end; cursor += 1) {
      const box = detected[cursor].faceBox
      x += box.x + box.w / 2
      y += box.y + box.h / 2
      w += box.w
      h += box.h
    }
    const count = end - start + 1
    const width = w / count
    const height = h / count
    return {
      time: sample.time,
      box: {
        x: Math.min(Math.max(x / count - width / 2, 0), 1 - width),
        y: Math.min(Math.max(y / count - height / 2, 0), 1 - height),
        w: width,
        h: height,
      },
    }
  })
  return { drifts, stabilizedPath }
}

/**
 * Times needing attention: samples with no detected face, plus the later
 * sample of any consecutive detected pair whose center jump exceeds
 * `jumpThreshold`. Sorted ascending, unique.
 */
export function detectFaceProblemTimecodes(
  track: FacePerformanceTrack,
  jumpThreshold: number = FACE_PROBLEM_JUMP_THRESHOLD,
): number[] {
  if (!Number.isFinite(jumpThreshold) || jumpThreshold <= 0) throw new Error('臉部跳動門檻必須大於 0')
  const problems = new Set<number>()
  for (const sample of track.samples) {
    if (sample.faceBox === null) problems.add(sample.time)
  }
  for (const gap of computeFaceTrackStability(track, 1).drifts) {
    if (gap.drift > jumpThreshold) problems.add(gap.toTime)
  }
  return [...problems].sort((a, b) => a - b)
}
