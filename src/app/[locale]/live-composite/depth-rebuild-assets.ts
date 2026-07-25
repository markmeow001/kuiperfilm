import type { RefObject } from 'react'
import type {
  PlaygroundCostEstimate,
} from '@/lib/query/mutations/playground-mutations'
import type { Locale } from '@/i18n/routing'
import type { TrackBModelKey } from './lib/atlascloud-r2v-contract'
import type {
  DepthGuideProgress,
  DepthGuideRecordingResult,
} from './lib/depth-guide-recorder'
import type { VideoMetadata } from './live-composite-types'

/**
 * MaskStageHandle 的最小結構契約。MaskStage 可包含更多方法；深度流程只依賴
 * 本機深度影片輸出與取消，避免耦合遮罩編輯 API。
 */
export interface DepthGuideStageHandle {
  exportDepthGuideVideo: (options: {
    includeAudio: boolean
    onProgress: (progress: DepthGuideProgress) => void
  }) => Promise<DepthGuideRecordingResult>
  cancelDepthGuideVideo: () => void
}

export interface LocalDepthGuide {
  file: File
  previewUrl: string
  depthFrameCount: number
  effectiveDepthFps: number
  sufficient: boolean
}

export interface LocalDepthReferenceImage {
  file: File
  previewUrl: string
}

export interface DepthRebuildCharacterReference {
  id: string
  label: string
  sourceBinding: string
  brief: string
  description: string
  image: LocalDepthReferenceImage | null
}

export interface DepthRebuildSceneReference {
  id: string
  note: string
  image: LocalDepthReferenceImage
}

export interface DepthRebuildResult {
  runId: string
  url: string
}

export type DepthGuideStatus = 'idle' | 'generating' | 'ready' | 'failed'
export type DepthRebuildGenerationStatus =
  | 'idle'
  | 'uploading'
  | 'submitting'
  | 'generating'
  | 'succeeded'
  | 'failed'

export interface UseDepthRebuildOptions {
  userId: string
  stageRef: RefObject<DepthGuideStageHandle | null>
  metadata: VideoMetadata | null
  videoHasAudio: boolean | null
  locale?: Locale
  workspaceId?: string | null
}

export interface UseDepthRebuildResult {
  depthGuide: LocalDepthGuide | null
  depthGuideStatus: DepthGuideStatus
  depthGuideProgress: DepthGuideProgress | null
  characters: readonly DepthRebuildCharacterReference[]
  sceneReferences: readonly DepthRebuildSceneReference[]
  sceneBrief: string
  sceneDescription: string
  referenceImageCount: number
  maxReferenceImages: number
  descriptionAssistTarget: string | null
  modelKey: TrackBModelKey
  enabledModels: ReadonlyArray<{ value: TrackBModelKey; label: string }>
  enabledModelsLoading: boolean
  enabledModelsError: string | null
  resolution: string
  availableResolutions: readonly string[]
  prompt: string
  promptIsStale: boolean
  validationError: string | null
  canGenerate: boolean
  costEstimate: PlaygroundCostEstimate | null
  costEstimateLoading: boolean
  costEstimateError: string | null
  generationStatus: DepthRebuildGenerationStatus
  generationProgress: number | null
  submittedRunId: string | null
  canResume: boolean
  result: DepthRebuildResult | null
  error: string | null
  isBusy: boolean
  addCharacter: () => void
  removeCharacter: (characterId: string) => void
  setCharacterLabel: (characterId: string, value: string) => void
  setCharacterSourceBinding: (characterId: string, value: string) => void
  setCharacterBrief: (characterId: string, value: string) => void
  setCharacterDescription: (characterId: string, value: string) => void
  selectCharacterImage: (characterId: string, file: File) => void
  rejectCharacterImage: (characterId: string) => void
  clearCharacterImage: (characterId: string) => void
  addSceneImages: (files: readonly File[]) => void
  removeSceneImage: (sceneId: string) => void
  rejectSceneImage: (sceneId: string) => void
  setSceneReferenceNote: (sceneId: string, value: string) => void
  setSceneBrief: (value: string) => void
  setSceneDescription: (value: string) => void
  assistCharacterDescription: (characterId: string) => Promise<void>
  assistSceneDescription: () => Promise<void>
  setModelKey: (value: TrackBModelKey) => void
  setResolution: (value: string) => void
  setPrompt: (value: string) => void
  generateDepthGuide: () => Promise<void>
  cancelDepthGuide: () => void
  clearDepthGuide: () => void
  buildPrompt: () => void
  generate: () => Promise<DepthRebuildResult | null>
  resetSource: () => void
  resetResult: () => void
}

const DEPTH_REFERENCE_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])
const DEPTH_REFERENCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export function createDepthReferenceImage(file: File): LocalDepthReferenceImage {
  if (!DEPTH_REFERENCE_IMAGE_MIMES.has(file.type)) {
    throw new Error('參考圖片只支援 JPG、PNG 或 WebP')
  }
  if (file.size > DEPTH_REFERENCE_IMAGE_MAX_BYTES) {
    throw new Error('參考圖片不可超過 10 MB')
  }
  if (file.size === 0) {
    throw new Error('參考圖片是空檔案，請重新選擇')
  }
  return { file, previewUrl: URL.createObjectURL(file) }
}

export function revokeDepthReferenceImage(asset: LocalDepthReferenceImage | null): void {
  if (asset) URL.revokeObjectURL(asset.previewUrl)
}

export function revokeLocalDepthGuide(asset: LocalDepthGuide | null): void {
  if (asset) URL.revokeObjectURL(asset.previewUrl)
}
