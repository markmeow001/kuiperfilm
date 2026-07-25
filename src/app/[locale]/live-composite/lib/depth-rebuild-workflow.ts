import {
  MAX_DURATION_SECONDS,
  MAX_REFERENCE_IMAGES,
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
  characters: ReadonlyArray<{
    id: string
    label: string
    sourceBinding: string
    description: string
    image: DepthRebuildAssetFingerprint | null
  }>
  sceneReferences: ReadonlyArray<{
    id: string
    note: string
    image: DepthRebuildAssetFingerprint
  }>
  sceneDescription: string
  modelKey: string
  resolution: string
  preserveSourceAudio: boolean
}

export interface DepthRebuildValidationInput {
  sourceDurationSeconds: number | null
  depthGuideExists: boolean
  depthGuideSufficient: boolean
  characters: ReadonlyArray<{
    label: string
    sourceBinding: string
    description: string
    imageExists: boolean
  }>
  sceneReferenceCount: number
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
    characters: input.characters.map((character) => ({
      id: character.id,
      label: character.label.trim(),
      sourceBinding: character.sourceBinding.trim(),
      description: character.description.trim(),
      image: character.image,
    })),
    sceneReferences: input.sceneReferences.map((scene) => ({
      id: scene.id,
      note: scene.note.trim(),
      image: scene.image,
    })),
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

export const DEPTH_CHARACTER_LABEL_MAX_CHARS = 40
export const DEPTH_CHARACTER_BINDING_MAX_CHARS = 120
export const DEPTH_CHARACTER_DESCRIPTION_MAX_CHARS = 600
export const DEPTH_SCENE_DESCRIPTION_MAX_CHARS = 1_000
export const DEPTH_REFERENCE_NOTE_MAX_CHARS = 120

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
  if (input.characters.length === 0) return '請至少新增一位新角色'
  if (input.characters.length + input.sceneReferenceCount > MAX_REFERENCE_IMAGES) {
    return `人物與場景參考圖片合計最多 ${MAX_REFERENCE_IMAGES} 張`
  }
  const normalizedLabels = new Set<string>()
  const normalizedBindings = new Set<string>()
  for (const [index, character] of input.characters.entries()) {
    const ordinal = index + 1
    const label = character.label.trim()
    const binding = character.sourceBinding.trim()
    const description = character.description.trim()
    if (!character.imageExists) return `請上傳角色 ${ordinal} 的參考圖片`
    if (!label) return `請填寫角色 ${ordinal} 的名稱`
    if (label.length > DEPTH_CHARACTER_LABEL_MAX_CHARS) {
      return `角色 ${ordinal} 名稱不可超過 ${DEPTH_CHARACTER_LABEL_MAX_CHARS} 字`
    }
    const normalizedLabel = label.toLocaleLowerCase()
    if (normalizedLabels.has(normalizedLabel)) return `角色名稱「${label}」重複，請使用不同名稱`
    normalizedLabels.add(normalizedLabel)
    if (!binding) return `請描述「${label}」要替換原片中的哪一位人物`
    if (binding.length > DEPTH_CHARACTER_BINDING_MAX_CHARS) {
      return `「${label}」的人物對應不可超過 ${DEPTH_CHARACTER_BINDING_MAX_CHARS} 字`
    }
    const normalizedBinding = binding.replace(/\s+/g, ' ').toLocaleLowerCase()
    if (normalizedBindings.has(normalizedBinding)) {
      return `兩位角色都綁定「${binding}」，請分別指定不同的原片人物`
    }
    normalizedBindings.add(normalizedBinding)
    if (!description) return `請填寫「${label}」的角色補充描述`
    if (description.length > DEPTH_CHARACTER_DESCRIPTION_MAX_CHARS) {
      return `「${label}」的角色描述不可超過 ${DEPTH_CHARACTER_DESCRIPTION_MAX_CHARS} 字`
    }
  }
  if (!input.sceneDescription.trim()) return '請填寫新場景描述'
  if (input.sceneDescription.trim().length > DEPTH_SCENE_DESCRIPTION_MAX_CHARS) {
    return `場景描述不可超過 ${DEPTH_SCENE_DESCRIPTION_MAX_CHARS} 字`
  }
  const referenceImageCount = input.characters.filter((character) => character.imageExists).length
    + input.sceneReferenceCount
  if (referenceImageCount > MAX_REFERENCE_IMAGES) {
    return `人物與場景參考圖片合計最多 ${MAX_REFERENCE_IMAGES} 張`
  }
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
    referenceImageCount,
    referenceVideoDurationsSeconds: [input.sourceDurationSeconds],
  })
  if (!requestValidation.ok) return requestValidation.issues[0]?.message ?? '深度重建設定無效'
  if (!input.prompt.trim()) return '請先建立並檢查 Prompt'
  if (!input.promptIsFresh) return '設定或參考素材已變更，請重新建立 Prompt'
  return null
}
