/**
 * AtlasCloud Seedance 2.0 R2V 供應商契約（純函數，不發送任何請求）。
 *
 * 依據 docs/plans/2026-07-19-ai-live-action-reconstruction-v2.1.md：
 * - §2.1 唯一允許模型（Fast／Standard R2V）
 * - §2.2 輸入能力上限（images ≤9、videos ≤3、audios ≤3）
 * - §2.3 參考素材固定順序契約
 * - §2.4 reference_videos 15 秒合計配額
 * - §8.3 顯式失敗原則（禁止靜默刪除不支援欄位）
 *
 * Track B 生成側在 B0 benchmark 放行前凍結；本檔只提供契約驗證與
 * 順序映射，不包含任何任務提交邏輯。
 */

// ---------------------------------------------------------------------------
// 模型白名單（§2.1）
// ---------------------------------------------------------------------------

export const ALLOWED_TRACK_B_MODELS = [
  'atlascloud::seedance-2.0-fast-r2v',
  'atlascloud::seedance-2.0-r2v',
] as const

export type TrackBModelKey = (typeof ALLOWED_TRACK_B_MODELS)[number]

export const TRACK_B_FAST_MODEL: TrackBModelKey = 'atlascloud::seedance-2.0-fast-r2v'
export const TRACK_B_STANDARD_MODEL: TrackBModelKey = 'atlascloud::seedance-2.0-r2v'

export function isAllowedTrackBModel(key: string): key is TrackBModelKey {
  return (ALLOWED_TRACK_B_MODELS as readonly string[]).includes(key)
}

/** 各模型允許的輸出解析度（§2.1）。Fast 不支援 1080p。 */
export const TRACK_B_MODEL_RESOLUTIONS: Record<TrackBModelKey, readonly string[]> = {
  'atlascloud::seedance-2.0-fast-r2v': ['480p', '720p'],
  'atlascloud::seedance-2.0-r2v': ['480p', '720p', '1080p'],
}

// ---------------------------------------------------------------------------
// 能力上限（§2.2）
// ---------------------------------------------------------------------------

export const MAX_REFERENCE_IMAGES = 9
export const MAX_REFERENCE_VIDEOS = 3
export const MAX_REFERENCE_AUDIOS = 3
export const MAX_TOTAL_REFERENCE_VIDEO_SECONDS = 15
export const MIN_DURATION_SECONDS = 4
export const MAX_DURATION_SECONDS = 15

/**
 * 產品預設值（不是 AtlasCloud 供應商限制）：
 * 目標鏡頭長度超過 11 秒時，第一版預設停用 video 2（臉部近景參考），
 * 因為剩餘配額（15 - video1）不足以構成有效的臉部參考。
 *
 * 「有效臉部參考」的最低秒數不是已知的 AtlasCloud 契約——B0 benchmark
 * 必須驗證此門檻後才可調整，且在驗證前不得把此值宣稱為模型限制（§2.4）。
 */
export const DEFAULT_VIDEO2_DISABLE_SHOT_SECONDS = 11

/**
 * AtlasCloud Seedance 2.0 R2V 不支援的欄位（§2.2）。
 * 出現在 payload 時必須顯式失敗，不得靜默刪除（§8.3）。
 * 權重類欄位（*_weight／weight）另以樣式比對攔截。
 */
export const FORBIDDEN_R2V_PAYLOAD_FIELDS = ['seed', 'camera_fixed', 'negative_prompt'] as const

const FORBIDDEN_WEIGHT_FIELD_PATTERN = /(^|_)weight(s)?($|_)/i

// ---------------------------------------------------------------------------
// 參考素材順序映射（§2.3）
// ---------------------------------------------------------------------------

export interface ReferenceAsset {
  assetId: string
  /** 影片／音訊素材的長度（秒）。圖片可省略。 */
  durationSeconds?: number
}

export interface ReferenceSlots {
  /** video 1：真人完整表演影片——唯一動作、表情、口型與攝影機參考。 */
  performanceVideo: ReferenceAsset | null
  /** video 2：可選的穩定臉部近景表演參考影片。 */
  faceCloseupVideo?: ReferenceAsset | null
  /** audio 1：原始台詞／同期聲。 */
  originalAudio?: ReferenceAsset | null
  /** image 1–3：AI 角色正面、側面、背面或 3/4 角度。 */
  characterImages?: readonly ReferenceAsset[]
  /** image 4–5：服裝、妝容、武器與細節。 */
  detailImages?: readonly ReferenceAsset[]
  /** image 6：背景概念圖（構圖／世界觀參考，不是最終影片背景）。 */
  backgroundConceptImage?: ReferenceAsset | null
  /** 其餘圖片：光影、材質或場景補充。 */
  extraImages?: readonly ReferenceAsset[]
}

export interface ReferenceMappingRow {
  /** prompt 引用 token，例如 'video 1'、'image 6'。 */
  token: string
  /** 給 UI 顯示的角色說明，例如 '主表演影片'。 */
  role: string
  assetId: string
}

export interface ReferenceOrderMapping {
  videos: readonly ReferenceAsset[]
  audios: readonly ReferenceAsset[]
  images: readonly ReferenceAsset[]
  /** 人類可讀映射列，例如 'video 1 → 主表演影片'。 */
  rows: readonly ReferenceMappingRow[]
}

const SLOT_ROLES = {
  performanceVideo: '主表演影片',
  faceCloseupVideo: '臉部近景參考影片',
  originalAudio: '原始台詞／同期聲',
  characterImage: '角色多角度參考',
  detailImage: '服裝／妝容／武器細節',
  backgroundConceptImage: '背景概念圖（概念參考，非最終背景）',
  extraImage: '光影／材質／場景補充',
} as const

/**
 * 依 §2.3 的固定順序組合參考素材，並產生 prompt token 與
 * 人類可讀映射列。任一素材增減都必須重新呼叫本函數重建映射，
 * 不得沿用舊 prompt。
 */
export function buildReferenceOrderMapping(slots: ReferenceSlots): ReferenceOrderMapping {
  const videos: ReferenceAsset[] = []
  const audios: ReferenceAsset[] = []
  const images: ReferenceAsset[] = []
  const rows: ReferenceMappingRow[] = []

  const pushVideo = (asset: ReferenceAsset, role: string) => {
    videos.push(asset)
    rows.push({ token: `video ${videos.length}`, role, assetId: asset.assetId })
  }
  const pushAudio = (asset: ReferenceAsset, role: string) => {
    audios.push(asset)
    rows.push({ token: `audio ${audios.length}`, role, assetId: asset.assetId })
  }
  const pushImage = (asset: ReferenceAsset, role: string) => {
    images.push(asset)
    rows.push({ token: `image ${images.length}`, role, assetId: asset.assetId })
  }

  if (slots.performanceVideo) pushVideo(slots.performanceVideo, SLOT_ROLES.performanceVideo)
  if (slots.faceCloseupVideo) pushVideo(slots.faceCloseupVideo, SLOT_ROLES.faceCloseupVideo)
  if (slots.originalAudio) pushAudio(slots.originalAudio, SLOT_ROLES.originalAudio)
  for (const asset of slots.characterImages ?? []) pushImage(asset, SLOT_ROLES.characterImage)
  for (const asset of slots.detailImages ?? []) pushImage(asset, SLOT_ROLES.detailImage)
  if (slots.backgroundConceptImage) pushImage(slots.backgroundConceptImage, SLOT_ROLES.backgroundConceptImage)
  for (const asset of slots.extraImages ?? []) pushImage(asset, SLOT_ROLES.extraImage)

  return { videos, audios, images, rows }
}

// ---------------------------------------------------------------------------
// video 2 的 15 秒配額（§2.4）
// ---------------------------------------------------------------------------

export interface Video2QuotaResult {
  video1Seconds: number
  /** video 2 可用秒數上限 = 15 - video1，最小 0。 */
  video2BudgetSeconds: number
  video2Enabled: boolean
  /** 停用時的人類可讀原因（含剩餘秒數），啟用時為 null。 */
  disabledReason: string | null
}

/**
 * 計算 video 2（臉部近景參考）的可用配額。
 * video 1 永遠等於目標鏡頭長度，不得為了塞入 video 2 而裁短主表演。
 */
export function computeVideo2Quota(
  video1Seconds: number,
  options?: { disableShotThresholdSeconds?: number },
): Video2QuotaResult {
  const threshold = options?.disableShotThresholdSeconds ?? DEFAULT_VIDEO2_DISABLE_SHOT_SECONDS
  const budget = Math.max(0, MAX_TOTAL_REFERENCE_VIDEO_SECONDS - video1Seconds)

  if (video1Seconds > threshold) {
    return {
      video1Seconds,
      video2BudgetSeconds: budget,
      video2Enabled: false,
      disabledReason:
        `主表演影片 ${video1Seconds} 秒已超過產品預設門檻 ${threshold} 秒，臉部近景參考（video 2）已停用；` +
        `15 秒配額剩餘 ${budget} 秒。此門檻為產品預設值，非 AtlasCloud 模型限制，待 B0 benchmark 驗證後調整。`,
    }
  }

  return {
    video1Seconds,
    video2BudgetSeconds: budget,
    video2Enabled: true,
    disabledReason: null,
  }
}

// ---------------------------------------------------------------------------
// 提交前顯式驗證（§8.3）
// ---------------------------------------------------------------------------

export interface R2VValidationIssue {
  field: string
  message: string
}

export interface R2VRequestDraft {
  modelKey: string
  durationSeconds: number
  resolution: string
  referenceImageCount: number
  /** 每支參考影片的長度（秒），依 video 1、video 2… 順序。 */
  referenceVideoDurationsSeconds: readonly number[]
  referenceAudioCount?: number
  /** 額外 payload 欄位；含禁用欄位時必須顯式失敗，不得靜默刪除。 */
  payload?: Readonly<Record<string, unknown>>
}

export interface R2VValidationResult {
  ok: boolean
  issues: readonly R2VValidationIssue[]
}

export function validateR2VRequest(draft: R2VRequestDraft): R2VValidationResult {
  const issues: R2VValidationIssue[] = []

  if (!isAllowedTrackBModel(draft.modelKey)) {
    issues.push({
      field: 'modelKey',
      message: `模型「${draft.modelKey}」不在 Track B 白名單內；只允許 ${ALLOWED_TRACK_B_MODELS.join('、')}，不得切換其他供應商。`,
    })
  }

  if (draft.durationSeconds < MIN_DURATION_SECONDS || draft.durationSeconds > MAX_DURATION_SECONDS) {
    issues.push({
      field: 'durationSeconds',
      message: `時長 ${draft.durationSeconds} 秒超出允許範圍（${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} 秒）。`,
    })
  }

  if (isAllowedTrackBModel(draft.modelKey)) {
    const allowedResolutions = TRACK_B_MODEL_RESOLUTIONS[draft.modelKey]
    if (!allowedResolutions.includes(draft.resolution)) {
      issues.push({
        field: 'resolution',
        message: `模型「${draft.modelKey}」不支援 ${draft.resolution}；允許：${allowedResolutions.join('、')}。`,
      })
    }
  }

  if (draft.referenceImageCount > MAX_REFERENCE_IMAGES) {
    issues.push({
      field: 'referenceImageCount',
      message: `參考圖片 ${draft.referenceImageCount} 張超過上限 ${MAX_REFERENCE_IMAGES} 張。`,
    })
  }

  const videoCount = draft.referenceVideoDurationsSeconds.length
  if (videoCount > MAX_REFERENCE_VIDEOS) {
    issues.push({
      field: 'referenceVideoDurationsSeconds',
      message: `參考影片 ${videoCount} 支超過上限 ${MAX_REFERENCE_VIDEOS} 支。`,
    })
  }
  const totalVideoSeconds = draft.referenceVideoDurationsSeconds.reduce((sum, seconds) => sum + seconds, 0)
  if (totalVideoSeconds > MAX_TOTAL_REFERENCE_VIDEO_SECONDS) {
    issues.push({
      field: 'referenceVideoDurationsSeconds',
      message: `參考影片總長 ${totalVideoSeconds} 秒超過合計上限 ${MAX_TOTAL_REFERENCE_VIDEO_SECONDS} 秒。`,
    })
  }

  const audioCount = draft.referenceAudioCount ?? 0
  if (audioCount > MAX_REFERENCE_AUDIOS) {
    issues.push({
      field: 'referenceAudioCount',
      message: `參考音訊 ${audioCount} 支超過上限 ${MAX_REFERENCE_AUDIOS} 支。`,
    })
  }
  if (audioCount > 0 && draft.referenceImageCount === 0 && videoCount === 0) {
    issues.push({
      field: 'referenceAudioCount',
      message: '參考音訊必須同時存在圖片或影片參考。',
    })
  }

  for (const key of Object.keys(draft.payload ?? {})) {
    const forbidden =
      (FORBIDDEN_R2V_PAYLOAD_FIELDS as readonly string[]).includes(key) ||
      FORBIDDEN_WEIGHT_FIELD_PATTERN.test(key)
    if (forbidden) {
      issues.push({
        field: key,
        message: `欄位「${key}」不受 AtlasCloud Seedance 2.0 R2V 支援；依 §8.3 必須顯式失敗，不得靜默刪除。`,
      })
    }
  }

  return { ok: issues.length === 0, issues }
}
