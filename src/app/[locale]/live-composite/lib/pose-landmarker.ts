import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { clamp } from './virtual-character'
import type { NormalizedPoint, VirtualCharacterMotionKeyframe } from '../live-composite-types'
import { seekVideoForAnalysis } from './mask-stage-utils'

const WASM_ROOT = '/mediapipe/vision'
const MODEL_PATH = '/models/live-composite/pose-landmarker-lite.task'
/**
 * Pose-ROI mask clipping must cover every subject in frame (e.g. two actors with
 * a building between them), so it runs a dedicated multi-pose instance. The
 * motion-tracking instance below stays at numPoses: 1 for existing callers.
 */
const ROI_POSE_COUNT = 2
let instancePromise: Promise<PoseLandmarker> | null = null
let timestamp = 0
let multiPoseInstancePromise: Promise<PoseLandmarker> | null = null
let multiPoseTimestamp = 0

function createPoseLandmarker(numPoses: number): Promise<PoseLandmarker> {
  return FilesetResolver.forVisionTasks(WASM_ROOT).then((vision) => PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numPoses,
    minPoseDetectionConfidence: 0.45,
    minTrackingConfidence: 0.45,
  }))
}

async function getPoseLandmarker(): Promise<PoseLandmarker> {
  instancePromise ??= createPoseLandmarker(1)
  return instancePromise
}

async function getMultiPoseLandmarker(): Promise<PoseLandmarker> {
  multiPoseInstancePromise ??= createPoseLandmarker(ROI_POSE_COUNT).catch((error: unknown) => {
    multiPoseInstancePromise = null
    throw error
  })
  return multiPoseInstancePromise
}

/**
 * Detects up to ROI_POSE_COUNT poses on the video's CURRENT frame (the caller
 * seeks first). Returns [] when no skeleton is found — callers must surface
 * "no pose = no clipping" to the UI instead of failing.
 */
export async function detectMultiPoseLandmarks(video: HTMLVideoElement): Promise<NormalizedPoint[][]> {
  const landmarker = await getMultiPoseLandmarker()
  multiPoseTimestamp = Math.max(multiPoseTimestamp + 1, Math.round(performance.now()))
  const result = landmarker.detectForVideo(video, multiPoseTimestamp)
  return result.landmarks.map((pose) => pose.map((landmark) => ({ x: landmark.x, y: landmark.y })))
}

export async function detectPoseMotion(video: HTMLVideoElement, time: number): Promise<VirtualCharacterMotionKeyframe> {
  const landmarker = await getPoseLandmarker()
  timestamp = Math.max(timestamp + 1, Math.round(performance.now()))
  const result = landmarker.detectForVideo(video, timestamp)
  const pose = result.landmarks[0]
  if (!pose) throw new Error(`${time.toFixed(2)}s 找不到可追蹤的人體骨架`)
  const leftShoulder = pose[11]
  const rightShoulder = pose[12]
  const leftHip = pose[23]
  const rightHip = pose[24]
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) throw new Error(`${time.toFixed(2)}s 人體骨架不完整`)
  const shoulderX = (leftShoulder.x + rightShoulder.x) / 2
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2
  const hipX = (leftHip.x + rightHip.x) / 2
  const hipY = (leftHip.y + rightHip.y) / 2
  const torsoLength = Math.hypot(hipX - shoulderX, hipY - shoulderY)
  const confidence = Math.min(leftShoulder.visibility ?? 1, rightShoulder.visibility ?? 1, leftHip.visibility ?? 1, rightHip.visibility ?? 1)
  return {
    id: crypto.randomUUID(),
    time,
    x: hipX,
    y: hipY,
    scale: clamp(torsoLength / 0.25, 0.35, 2.5),
    rotation: Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x) * 180 / Math.PI,
    confidence: clamp(confidence, 0, 1),
  }
}

export async function detectPoseAt(video: HTMLVideoElement | null, duration: number | undefined, time: number, signal: AbortSignal): Promise<VirtualCharacterMotionKeyframe> {
  if (!video || duration === undefined) throw new Error('請先載入可分析的影片')
  video.pause()
  const boundedTime = Math.min(duration, Math.max(0, time))
  await seekVideoForAnalysis(video, boundedTime, signal)
  return detectPoseMotion(video, boundedTime)
}

export function releasePoseLandmarker(): void {
  void instancePromise?.then((instance) => instance.close())
  instancePromise = null
  timestamp = 0
  void multiPoseInstancePromise?.then((instance) => instance.close()).catch(() => {
    // Creation already failed and was reported to the original caller; there is
    // no live instance to close here.
  })
  multiPoseInstancePromise = null
  multiPoseTimestamp = 0
}
