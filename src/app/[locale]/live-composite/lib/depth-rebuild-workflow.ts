import {
  MAX_DURATION_SECONDS,
  MAX_REFERENCE_IMAGES,
  MIN_DURATION_SECONDS,
  TRACK_B_MODEL_RESOLUTIONS,
  isAllowedTrackBModel,
  validateR2VRequest,
  type TrackBModelKey,
} from './atlascloud-r2v-contract'
import type { SourceAudioMode } from '@/lib/playground/source-audio-contract'
import type { DepthRebuildMotionSettings } from './depth-rebuild-motion-contract'
import { buildDepthRebuildGuidePlan } from './depth-rebuild-guide-plan'

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
  sourceAudioMode: SourceAudioMode
  motionSettings: DepthRebuildMotionSettings
  criticalCenterSeconds?: number
}

export interface DepthRebuildValidationInput {
  sourceDurationSeconds: number | null
  sourceVideoAvailable?: boolean
  depthGuideExists: boolean
  depthGuideSufficient: boolean
  characters: ReadonlyArray<{
    label: string
    sourceBinding: string
    description: string
    imageExists: boolean
  }>
  sceneReferenceCount: number
  reservedReferenceImageCount?: number
  sceneDescription: string
  modelKey: string
  resolution: string
  enabledModelKeys: readonly string[]
  sourceAudioMode: SourceAudioMode
  sourceAudioDetected: boolean | null
  prompt: string
  segmentPromptCount?: number
  promptIsFresh: boolean
  criticalCenterSeconds?: number
}

export interface DepthRebuildPromptValidationInput {
  sourceDurationSeconds: number | null
  characters: DepthRebuildValidationInput['characters']
  sceneReferenceCount: number
  reservedReferenceImageCount?: number
  sceneDescription: string
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
    sourceAudioMode: input.sourceAudioMode,
    motionSettings: input.motionSettings,
    criticalCenterSeconds: input.criticalCenterSeconds ?? null,
  })
}

export function depthRebuildDurationSeconds(sourceDurationSeconds: number): number {
  return buildDepthRebuildGuidePlan(sourceDurationSeconds).outputDurationSeconds
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
export const DEPTH_GUIDE_REQUIRED_MESSAGE = '請先產生深度引導影片'

function getSourceDurationValidationError(sourceDurationSeconds: number | null): string | null {
  if (sourceDurationSeconds === null) return '請先上傳原始表演影片'
  if (
    !Number.isFinite(sourceDurationSeconds) ||
    sourceDurationSeconds < MIN_DURATION_SECONDS ||
    sourceDurationSeconds > MAX_DURATION_SECONDS
  ) {
    return `原片需介於 ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} 秒`
  }
  return null
}

function getReferenceSetupValidationError(
  input: Pick<
    DepthRebuildPromptValidationInput,
    'characters' | 'sceneReferenceCount' | 'sceneDescription' | 'reservedReferenceImageCount'
  >,
): string | null {
  // 零角色 = 自由重繪模式：保留原片表演者，只依主題／場景重繪。
  // 用來排除身份替換變數、單獨驗證深度引導遵循度。
  const reservedReferenceImageCount = input.reservedReferenceImageCount ?? 0
  const userReferenceImageLimit = MAX_REFERENCE_IMAGES - reservedReferenceImageCount
  if (input.characters.length + input.sceneReferenceCount > userReferenceImageLimit) {
    return reservedReferenceImageCount > 0
      ? `長片分段需保留 1 張銜接末幀，人物與場景參考圖片合計最多 ${userReferenceImageLimit} 張`
      : `人物與場景參考圖片合計最多 ${MAX_REFERENCE_IMAGES} 張`
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
    // 單一角色時允許留空綁定：prompt 端自動綁定「原片唯一表演者」。
    if (!binding && input.characters.length > 1) {
      return `請描述「${label}」要替換原片中的哪一位人物`
    }
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
  if (referenceImageCount > userReferenceImageLimit) {
    return reservedReferenceImageCount > 0
      ? `長片分段需保留 1 張銜接末幀，人物與場景參考圖片合計最多 ${userReferenceImageLimit} 張`
      : `人物與場景參考圖片合計最多 ${MAX_REFERENCE_IMAGES} 張`
  }
  return null
}

/**
 * 免費建立 Prompt 只檢查會影響文字與 image 對應的資料。
 * 深度影片、模型與費用留到最後付費生成前才驗證。
 */
export function getDepthRebuildPromptValidationError(
  input: DepthRebuildPromptValidationInput,
): string | null {
  return getSourceDurationValidationError(input.sourceDurationSeconds)
    ?? getReferenceSetupValidationError(input)
}

export function getDepthRebuildValidationError(input: DepthRebuildValidationInput): string | null {
  const sourceDurationSeconds = input.sourceDurationSeconds
  if (sourceDurationSeconds === null) return '請先上傳原始表演影片'
  const sourceError = getSourceDurationValidationError(sourceDurationSeconds)
  if (sourceError) return sourceError
  if (input.sourceVideoAvailable === false) {
    return '目前只找到預覽網址，缺少可安全送出的 RGB 原片；請重新上傳原始表演影片'
  }
  if (
    input.sourceAudioMode !== 'generate'
    && input.sourceAudioDetected !== true
  ) {
    return input.sourceAudioDetected === null
      ? '正在確認原片音軌；若不需要原音，可改選「AI 重新生成聲音」'
      : '原片未偵測到音軌；請改選「AI 重新生成聲音」'
  }
  if (!input.depthGuideExists) return DEPTH_GUIDE_REQUIRED_MESSAGE
  if (!input.depthGuideSufficient) return '深度引導影片有效幀率不足，請重新產生後再生成'
  const referenceError = getReferenceSetupValidationError(input)
  if (referenceError) return referenceError

  const referenceImageCount = input.characters.filter((character) => character.imageExists).length
    + input.sceneReferenceCount
  if (!isAllowedTrackBModel(input.modelKey)) {
    return '只支援 AtlasCloud Seedance 2.0 Fast／Standard R2V'
  }
  if (!input.enabledModelKeys.includes(input.modelKey)) {
    return `目前帳號尚未啟用模型「${input.modelKey}」，請先到設定中心啟用`
  }

  let guidePlan: ReturnType<typeof buildDepthRebuildGuidePlan>
  try {
    guidePlan = buildDepthRebuildGuidePlan(sourceDurationSeconds, {
      ...(input.criticalCenterSeconds === undefined
        ? {}
        : { criticalCenterSeconds: input.criticalCenterSeconds }),
    })
  } catch (caught) {
    return caught instanceof Error ? caught.message : '無法建立自適應 Depth 引導計畫'
  }
  const requestValidation = validateR2VRequest({
    modelKey: input.modelKey,
    durationSeconds: guidePlan.outputDurationSeconds,
    resolution: input.resolution,
    referenceImageCount,
    referenceVideoDurationsSeconds: [
      guidePlan.fullDepth.durationSeconds,
      ...(guidePlan.secondary ? [guidePlan.secondary.durationSeconds] : []),
    ],
  })
  if (!requestValidation.ok) {
    return requestValidation.issues[0]?.message ?? '深度重建設定無效'
  }
  if (
    input.segmentPromptCount !== undefined
    && input.segmentPromptCount !== 1
  ) {
    return '自適應引導計畫或 Prompt 已變更，請重新建立 Prompt'
  }
  if (!input.prompt.trim()) return '請先建立並檢查 Prompt'
  if (!input.promptIsFresh) return '設定或參考素材已變更，請重新建立 Prompt'
  return null
}
