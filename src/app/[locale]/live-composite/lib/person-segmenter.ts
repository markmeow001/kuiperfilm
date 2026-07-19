import type { ImageSegmenter, MPMask } from '@mediapipe/tasks-vision'
import { confidenceToMaskRaster, selectPersonSegmenterVariant, type PersonSegmenterVariant } from './mask-analysis'
import { clipMaskToRoi, type PoseRoi } from './person-roi'
import type { MaskRaster } from '../live-composite-types'

const WASM_PATH = '/mediapipe/vision'
const MODEL_PATHS: Record<PersonSegmenterVariant, string> = {
  landscape: '/models/live-composite/selfie-segmenter-landscape.tflite',
  square: '/models/live-composite/selfie-segmenter-square.tflite',
}
const segmenterPromises: Partial<Record<PersonSegmenterVariant, Promise<ImageSegmenter>>> = {}

/** Selfie Segmenter emits one foreground probability mask, not a background/person pair. */
export function selectPersonConfidenceMask(confidenceMasks: MPMask[] | undefined): MPMask {
  const personMask = confidenceMasks?.[0]
  if (!personMask) throw new Error('人物分割模型沒有回傳人物信心遮罩')
  return personMask
}

async function createPersonSegmenter(variant: PersonSegmenterVariant): Promise<ImageSegmenter> {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH)
  return ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATHS[variant] },
    runningMode: 'IMAGE',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  })
}

async function getPersonSegmenter(variant: PersonSegmenterVariant): Promise<ImageSegmenter> {
  segmenterPromises[variant] ??= createPersonSegmenter(variant).catch((error: unknown) => {
    delete segmenterPromises[variant]
    throw error
  })
  return segmenterPromises[variant]
}

/** Warms up (and caches) the segmenter for a variant without running a frame. */
export function preloadPersonSegmenter(variant: PersonSegmenterVariant): Promise<ImageSegmenter> {
  return getPersonSegmenter(variant)
}

/**
 * Closes every cached MediaPipe segmenter and clears the module-scope cache so
 * the WASM/GPU resources are released when the feature unmounts. The next
 * segmentation request will lazily create fresh instances.
 */
export async function releasePersonSegmenters(): Promise<void> {
  const pending = Object.values(segmenterPromises)
  for (const variant of Object.keys(segmenterPromises) as PersonSegmenterVariant[]) {
    delete segmenterPromises[variant]
  }
  await Promise.all(pending.map(async (promise) => {
    try {
      const segmenter = await promise
      segmenter.close()
    } catch {
      // Either the segmenter failed to initialise (nothing to release) or
      // close() threw during browser teardown; both leave nothing to clean up.
    }
  }))
}

/**
 * `poseRoi` (normalized, from computePoseUnionRoi) zeroes segmenter confidence
 * OUTSIDE the pose union box before threshold/softness post-processing, killing
 * far-away false positives (buildings the model mistakes for people). null =
 * no clipping (setting off or no pose detected; callers surface that to the UI).
 */
export async function segmentPersonFrame(
  source: HTMLCanvasElement | HTMLVideoElement,
  threshold: number,
  edgeSoftness: number,
  poseRoi: PoseRoi | null = null,
): Promise<MaskRaster> {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height
  const segmenter = await getPersonSegmenter(selectPersonSegmenterVariant(width, height))
  const result = segmenter.segment(source)
  const confidenceMasks = result.confidenceMasks

  try {
    const personMask = selectPersonConfidenceMask(confidenceMasks)
    return confidenceToMaskRaster(
      clipMaskToRoi(personMask.getAsFloat32Array(), personMask.width, personMask.height, poseRoi),
      personMask.width,
      personMask.height,
      threshold,
      edgeSoftness,
    )
  } finally {
    confidenceMasks?.forEach((mask) => mask.close())
    result.categoryMask?.close()
  }
}
