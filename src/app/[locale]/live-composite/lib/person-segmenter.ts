import type { ImageSegmenter } from '@mediapipe/tasks-vision'
import { confidenceToMaskRaster, selectPersonSegmenterVariant, type PersonSegmenterVariant } from './mask-analysis'
import type { MaskRaster } from '../live-composite-types'

const WASM_PATH = '/mediapipe/vision'
const MODEL_PATHS: Record<PersonSegmenterVariant, string> = {
  landscape: '/models/live-composite/selfie-segmenter-landscape.tflite',
  square: '/models/live-composite/selfie-segmenter-square.tflite',
}
const PERSON_CONFIDENCE_INDEX = 1

const segmenterPromises: Partial<Record<PersonSegmenterVariant, Promise<ImageSegmenter>>> = {}

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

export async function segmentPersonFrame(
  source: HTMLCanvasElement | HTMLVideoElement,
  threshold: number,
  edgeSoftness: number,
): Promise<MaskRaster> {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height
  const segmenter = await getPersonSegmenter(selectPersonSegmenterVariant(width, height))
  const result = segmenter.segment(source)
  const confidenceMasks = result.confidenceMasks
  if (!confidenceMasks || confidenceMasks.length <= PERSON_CONFIDENCE_INDEX) {
    throw new Error('人物分割模型沒有回傳人物信心遮罩')
  }

  try {
    const personMask = confidenceMasks[PERSON_CONFIDENCE_INDEX]
    return confidenceToMaskRaster(
      personMask.getAsFloat32Array(),
      personMask.width,
      personMask.height,
      threshold,
      edgeSoftness,
    )
  } finally {
    confidenceMasks.forEach((mask) => mask.close())
    result.categoryMask?.close()
  }
}
