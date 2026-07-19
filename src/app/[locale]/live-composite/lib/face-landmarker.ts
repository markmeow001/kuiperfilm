/**
 * Live Composite — MediaPipe Face Landmarker wiring (browser-local only).
 *
 * Mirrors pose-landmarker.ts: one module-scope cached instance, wasm from
 * /public/mediapipe/vision, model from /public/models/live-composite/.
 * Nothing here touches AtlasCloud — face landmarks are analysis data for
 * stable face crops, expression comparison and problem-timecode detection
 * (spec §3.2); generation-side use stays frozen until B0.
 */
import { FilesetResolver, FaceLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { seekVideoForAnalysis } from './mask-stage-utils'

const WASM_ROOT = '/mediapipe/vision'
const MODEL_PATH = '/models/live-composite/face-landmarker.task'

/** Default crop padding: keeps forehead/chin inside the stabilized crop. */
export const FACE_CROP_DEFAULT_PADDING = 0.35
export type FaceCropAspect = 'square' | '3:4'

/** Normalized (0-1) top-left box in source-frame coordinates. */
export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
}

export interface FaceFrameAnalysis {
  landmarks: NormalizedLandmark[]
  /** MediaPipe blendshape categoryName -> score (0-1), unfiltered. */
  blendshapes: Record<string, number>
  faceBox: FaceBox
}

let instancePromise: Promise<FaceLandmarker> | null = null
let timestamp = 0

/**
 * Returns the shared Face Landmarker (VIDEO mode, blendshapes on, 1 face),
 * creating and caching it on first call. Also usable as a preload.
 */
export function createFaceLandmarker(): Promise<FaceLandmarker> {
  instancePromise ??= FilesetResolver.forVisionTasks(WASM_ROOT)
    .then((vision) => FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    }))
    .catch((error: unknown) => {
      instancePromise = null
      throw error
    })
  return instancePromise
}

export function releaseFaceLandmarker(): void {
  void instancePromise?.then((instance) => instance.close()).catch(() => {
    // Initialisation already failed (createFaceLandmarker cleared the cache
    // and surfaced the error to its caller) — nothing left to release.
  })
  instancePromise = null
  timestamp = 0
}

/**
 * Pure crop-box helper (unit-testable without MediaPipe).
 *
 * Uses the landmark bounding-box midpoint as a stabilized center (min/max
 * midpoint jitters far less than the landmark mean when the mouth opens),
 * expands each side by `padding` × the raw size, enforces the requested
 * aspect, and clamps into the 0-1 frame without shrinking unless the box
 * exceeds the frame itself.
 */
export function computeFaceCropBox(
  landmarks: readonly Pick<NormalizedLandmark, 'x' | 'y'>[],
  padding: number = FACE_CROP_DEFAULT_PADDING,
  aspect: FaceCropAspect = 'square',
): FaceBox {
  if (landmarks.length === 0) throw new Error('沒有臉部特徵點，無法計算臉部裁切框')
  if (!Number.isFinite(padding) || padding < 0 || padding > 1) {
    throw new Error('臉部裁切留白必須介於 0 到 1')
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const landmark of landmarks) {
    if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
      throw new Error('臉部特徵點座標無效，無法計算臉部裁切框')
    }
    if (landmark.x < minX) minX = landmark.x
    if (landmark.y < minY) minY = landmark.y
    if (landmark.x > maxX) maxX = landmark.x
    if (landmark.y > maxY) maxY = landmark.y
  }
  const rawWidth = maxX - minX
  const rawHeight = maxY - minY
  if (rawWidth <= 0 || rawHeight <= 0) throw new Error('臉部特徵點範圍無效，無法計算臉部裁切框')
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  let width = rawWidth * (1 + padding * 2)
  let height = rawHeight * (1 + padding * 2)
  if (aspect === 'square') {
    width = height = Math.max(width, height)
  } else {
    // 3:4 portrait crop (w:h = 3:4) that still contains the padded box.
    height = Math.max(height, width * (4 / 3))
    width = height * (3 / 4)
  }
  width = Math.min(1, width)
  height = Math.min(1, height)
  const x = Math.min(Math.max(centerX - width / 2, 0), 1 - width)
  const y = Math.min(Math.max(centerY - height / 2, 0), 1 - height)
  return { x, y, w: width, h: height }
}

/**
 * Analyze one already-seeked video frame. Returns `null` when no face is
 * present — a missed detection is track data (漏檢時間碼), not an error.
 * A model that stops returning blendshapes IS an error: the landmarker was
 * created with outputFaceBlendshapes and silently degrading would corrupt
 * every downstream expression comparison.
 */
export async function analyzeFaceFrame(video: HTMLVideoElement, time: number): Promise<FaceFrameAnalysis | null> {
  const landmarker = await createFaceLandmarker()
  timestamp = Math.max(timestamp + 1, Math.round(performance.now()))
  const result = landmarker.detectForVideo(video, timestamp)
  const landmarks = result.faceLandmarks[0]
  if (!landmarks || landmarks.length === 0) return null
  const categories = result.faceBlendshapes?.[0]?.categories
  if (!categories) throw new Error(`${time.toFixed(2)}s 臉部模型沒有回傳表情資料`)
  const blendshapes: Record<string, number> = {}
  for (const category of categories) {
    blendshapes[category.categoryName] = category.score
  }
  return { landmarks, blendshapes, faceBox: computeFaceCropBox(landmarks) }
}

/** Seek + analyze, mirroring detectPoseAt(). */
export async function detectFaceAt(
  video: HTMLVideoElement | null,
  duration: number | undefined,
  time: number,
  signal: AbortSignal,
): Promise<FaceFrameAnalysis | null> {
  if (!video || duration === undefined) throw new Error('請先載入可分析的影片')
  video.pause()
  const boundedTime = Math.min(duration, Math.max(0, time))
  await seekVideoForAnalysis(video, boundedTime, signal)
  return analyzeFaceFrame(video, boundedTime)
}
