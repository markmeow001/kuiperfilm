import type { InteractiveSegmenter } from '@mediapipe/tasks-vision'
import { confidenceToMaskRaster } from './mask-analysis'
import type { MaskRaster, NormalizedPoint } from '../live-composite-types'

const WASM_PATH = '/mediapipe/vision'
const MODEL_PATH = '/models/live-composite/magic-touch.tflite'

let segmenterPromise: Promise<InteractiveSegmenter> | null = null

async function createInteractiveSegmenter(): Promise<InteractiveSegmenter> {
  const { FilesetResolver, InteractiveSegmenter } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
  return InteractiveSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH },
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  })
}

async function getInteractiveSegmenter(): Promise<InteractiveSegmenter> {
  segmenterPromise ??= createInteractiveSegmenter().catch((error: unknown) => {
    segmenterPromise = null
    throw error
  })
  return segmenterPromise
}

export async function segmentObjectAtPoint(
  source: HTMLCanvasElement | HTMLVideoElement,
  point: NormalizedPoint,
  threshold: number = 0.5,
  edgeSoftness: number = 0.08,
): Promise<MaskRaster> {
  const segmenter = await getInteractiveSegmenter()
  const result = segmenter.segment(source, { keypoint: point })
  const mask = result.confidenceMasks?.[0]
  if (!mask) throw new Error('物件分割模型沒有回傳遮罩')

  try {
    return confidenceToMaskRaster(
      mask.getAsFloat32Array(),
      mask.width,
      mask.height,
      threshold,
      edgeSoftness,
    )
  } finally {
    result.confidenceMasks?.forEach((confidenceMask) => confidenceMask.close())
    result.categoryMask?.close()
  }
}

export async function releaseInteractiveSegmenter(): Promise<void> {
  const pending = segmenterPromise
  segmenterPromise = null
  if (!pending) return
  try {
    const segmenter = await pending
    segmenter.close()
  } catch {
    // Initialization failure or browser teardown leaves no reusable resource.
  }
}
