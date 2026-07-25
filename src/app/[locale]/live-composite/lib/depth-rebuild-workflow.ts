import {
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  TRACK_B_MODEL_RESOLUTIONS,
  isAllowedTrackBModel,
  validateR2VRequest,
  type TrackBModelKey,
} from './atlascloud-r2v-contract'

export interface DepthRebuildAssetFingerprint {
  name: string
  size: number
  type: string
  lastModified: number
}

export interface DepthRebuildFingerprintInput {
  sourceDurationSeconds: number | null
  sourceWidth: number | null
  sourceHeight: number | null
  depthGuide: DepthRebuildAssetFingerprint | null
  characterImage: DepthRebuildAssetFingerprint | null
  sceneImage: DepthRebuildAssetFingerprint | null
  characterDescription: string
  sceneDescription: string
  modelKey: string
  resolution: string
  preserveSourceAudio: boolean
}

export interface DepthRebuildValidationInput {
  sourceDurationSeconds: number | null
  depthGuideExists: boolean
  depthGuideSufficient: boolean
  characterImageExists: boolean
  sceneImageExists: boolean
  characterDescription: string
  sceneDescription: string
  modelKey: string
  resolution: string
  enabledModelKeys: readonly string[]
  prompt: string
  promptIsFresh: boolean
}

export function fileToDepthRebuildFingerprint(file: File): DepthRebuildAssetFingerprint {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
  }
}

export function buildDepthRebuildFingerprint(input: DepthRebuildFingerprintInput): string {
  return JSON.stringify({
    sourceDurationSeconds: input.sourceDurationSeconds,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    depthGuide: input.depthGuide,
    characterImage: input.characterImage,
    sceneImage: input.sceneImage,
    characterDescription: input.characterDescription.trim(),
    sceneDescription: input.sceneDescription.trim(),
    modelKey: input.modelKey,
    resolution: input.resolution,
    preserveSourceAudio: input.preserveSourceAudio,
  })
}

export function depthRebuildDurationSeconds(sourceDurationSeconds: number): number {
  if (!Number.isFinite(sourceDurationSeconds)) {
    throw new Error('無法讀取原片秒數')
  }
  if (sourceDurationSeconds < MIN_DURATION_SECONDS || sourceDurationSeconds > MAX_DURATION_SECONDS) {
    throw new Error(`深度重建只支援 ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} 秒影片`)
  }
  return Math.round(sourceDurationSeconds)
}

const DEPTH_REBUILD_RATIOS = [
  { value: '21:9', ratio: 21 / 9 },
  { value: '16:9', ratio: 16 / 9 },
  { value: '4:3', ratio: 4 / 3 },
  { value: '1:1', ratio: 1 },
  { value: '3:4', ratio: 3 / 4 },
  { value: '9:16', ratio: 9 / 16 },
] as const

export function depthRebuildAspectRatio(
  width: number,
  height: number,
): (typeof DEPTH_REBUILD_RATIOS)[number]['value'] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('原片尺寸無效，無法判斷輸出比例')
  }
  const ratio = width / height
  return DEPTH_REBUILD_RATIOS.reduce((closest, candidate) => (
    Math.abs(Math.log(ratio / candidate.ratio)) <
      Math.abs(Math.log(ratio / closest.ratio))
      ? candidate
      : closest
  )).value
}

export function depthRebuildResolutions(modelKey: TrackBModelKey): readonly string[] {
  return TRACK_B_MODEL_RESOLUTIONS[modelKey]
}

export function getDepthRebuildValidationError(input: DepthRebuildValidationInput): string | null {
  if (input.sourceDurationSeconds === null) return '請先上傳原始表演影片'
  if (
    !Number.isFinite(input.sourceDurationSeconds) ||
    input.sourceDurationSeconds < MIN_DURATION_SECONDS ||
    input.sourceDurationSeconds > MAX_DURATION_SECONDS
  ) {
    return `原片需介於 ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} 秒`
  }
  if (!input.depthGuideExists) return '請先產生深度引導影片'
  if (!input.depthGuideSufficient) return '深度引導影片有效幀率不足，請重新產生後再生成'
  if (!input.characterImageExists) return '請上傳新角色圖片'
  if (!input.characterDescription.trim()) return '請填寫新角色描述'
  if (!input.sceneDescription.trim()) return '請填寫新場景描述'
  if (!isAllowedTrackBModel(input.modelKey)) {
    return '只支援 AtlasCloud Seedance 2.0 Fast／Standard R2V'
  }
  if (!input.enabledModelKeys.includes(input.modelKey)) {
    return `目前帳號尚未啟用模型「${input.modelKey}」，請先到設定中心啟用`
  }

  const requestValidation = validateR2VRequest({
    modelKey: input.modelKey,
    durationSeconds: input.sourceDurationSeconds,
    resolution: input.resolution,
    referenceImageCount: input.sceneImageExists ? 2 : 1,
    referenceVideoDurationsSeconds: [input.sourceDurationSeconds],
  })
  if (!requestValidation.ok) return requestValidation.issues[0]?.message ?? '深度重建設定無效'
  if (!input.prompt.trim()) return '請先建立並檢查 Prompt'
  if (!input.promptIsFresh) return '設定或參考素材已變更，請重新建立 Prompt'
  return null
}
