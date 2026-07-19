/**
 * 表演素材體檢報告（Track B / B0 規格前置檢查）。
 *
 * 純函數、可在 node 測試；所有計算皆在本機完成，不發送任何請求，
 * 不含生成側邏輯（Track B 生成側在 B0 benchmark 放行前凍結）。
 *
 * 供應商限制一律取自 atlascloud-r2v-contract（§2.1／§2.4），
 * 本檔不得重新硬編碼；其餘門檻皆為「產品預設值」並逐一標註。
 */
import {
  MAX_DURATION_SECONDS,
  MAX_TOTAL_REFERENCE_VIDEO_SECONDS,
  MIN_DURATION_SECONDS,
  buildReferenceOrderMapping,
  computeVideo2Quota,
} from './atlascloud-r2v-contract'

// ---------------------------------------------------------------------------
// 產品預設門檻（非 AtlasCloud 供應商限制）
// ---------------------------------------------------------------------------

/**
 * 產品預設值（非 AtlasCloud 供應商限制）：
 * 素材短邊 ≥1080px 視為細節傳遞充足；720–1079px 預覽可用但細節傳遞較弱；
 * <720px 判定表演細節可能不足。待 B0 benchmark 實測後可調整。
 */
export const RESOLUTION_PASS_MIN_SHORT_SIDE = 1080
export const RESOLUTION_WARN_MIN_SHORT_SIDE = 720

/**
 * 產品預設值（非 AtlasCloud 供應商限制）：
 * 臉部覆蓋率（有偵測到臉的取樣點 ÷ 全部取樣點）門檻。
 * ≥0.9 視為穩定；0.6–0.9 需注意；<0.6 判定臉部參考不可靠。
 * 待 B0 benchmark 實測後可調整。
 */
export const FACE_COVERAGE_PASS_RATIO = 0.9
export const FACE_COVERAGE_WARN_RATIO = 0.6

/** 漏檢時間段在 detail 內最多列出的段數，其餘以總數表示。 */
const MISSING_SEGMENT_DISPLAY_CAP = 4

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export type MaterialReadinessStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export type MaterialReadinessRowKey =
  | 'duration'
  | 'resolution'
  | 'audio'
  | 'faceCoverage'
  | 'video2Quota'

export interface MaterialReadinessRow {
  key: MaterialReadinessRowKey
  label: string
  status: MaterialReadinessStatus
  detail: string
}

export type MaterialReadinessVerdict = 'ready' | 'warn' | 'fail'

export interface MaterialReadinessReport {
  rows: readonly MaterialReadinessRow[]
  verdict: MaterialReadinessVerdict
  /** 一行繁中總結，供卡片標題下方顯示。 */
  summary: string
}

/** 與 FacePerformanceTrack 結構相容的最小輸入（只關心 faceBox 是否為 null）。 */
export interface MaterialReadinessFaceTrack {
  samples: ReadonlyArray<{ time: number; faceBox: object | null }>
}

export interface MaterialReadinessInput {
  durationSec: number
  width: number
  height: number
  /** null＝瀏覽器無法偵測音訊軌（不是「沒有音訊」）。 */
  hasAudio: boolean | null
  /** null／undefined＝尚未執行臉部分析。 */
  faceTrack?: MaterialReadinessFaceTrack | null
}

// ---------------------------------------------------------------------------
// 格式化工具
// ---------------------------------------------------------------------------

function formatSeconds(seconds: number): string {
  return Number(seconds.toFixed(1)).toString()
}

interface TimeSegment {
  start: number
  end: number
}

function formatSegment(segment: TimeSegment): string {
  if (segment.start === segment.end) return `${segment.start.toFixed(2)}s`
  return `${segment.start.toFixed(2)}–${segment.end.toFixed(2)}s`
}

function formatSegments(segments: readonly TimeSegment[]): string {
  const shown = segments.slice(0, MISSING_SEGMENT_DISPLAY_CAP).map(formatSegment).join('、')
  return segments.length > MISSING_SEGMENT_DISPLAY_CAP
    ? `${shown}⋯（共 ${segments.length} 段）`
    : shown
}

/** 把連續的漏檢取樣點（faceBox === null）合併成時間段。 */
function collectMissingSegments(track: MaterialReadinessFaceTrack): TimeSegment[] {
  const segments: TimeSegment[] = []
  let current: TimeSegment | null = null
  for (const sample of track.samples) {
    if (sample.faceBox === null) {
      current = current
        ? { start: current.start, end: sample.time }
        : { start: sample.time, end: sample.time }
    } else if (current) {
      segments.push(current)
      current = null
    }
  }
  if (current) segments.push(current)
  return segments
}

// ---------------------------------------------------------------------------
// 各檢查列
// ---------------------------------------------------------------------------

function assessDuration(durationSec: number): MaterialReadinessRow {
  const label = '時長'
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { key: 'duration', label, status: 'unknown', detail: '無法讀取影片時長，請重新載入素材。' }
  }
  const formatted = formatSeconds(durationSec)
  if (durationSec < MIN_DURATION_SECONDS) {
    return {
      key: 'duration',
      label,
      status: 'fail',
      detail: `影片 ${formatted} 秒，不足 ${MIN_DURATION_SECONDS} 秒，無法生成。`,
    }
  }
  if (durationSec > MAX_DURATION_SECONDS) {
    return {
      key: 'duration',
      label,
      status: 'fail',
      detail: `影片 ${formatted} 秒，超過 ${MAX_TOTAL_REFERENCE_VIDEO_SECONDS} 秒——參考影片合計上限；需剪短或分段。`,
    }
  }
  return {
    key: 'duration',
    label,
    status: 'pass',
    detail: `影片 ${formatted} 秒，符合 ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} 秒規格。`,
  }
}

function assessResolution(width: number, height: number): MaterialReadinessRow {
  const label = '解析度'
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { key: 'resolution', label, status: 'unknown', detail: '無法讀取影片解析度，請重新載入素材。' }
  }
  const shortSide = Math.min(width, height)
  if (shortSide >= RESOLUTION_PASS_MIN_SHORT_SIDE) {
    return {
      key: 'resolution',
      label,
      status: 'pass',
      detail: `${width} × ${height}，短邊 ${shortSide}px，細節傳遞充足。`,
    }
  }
  if (shortSide >= RESOLUTION_WARN_MIN_SHORT_SIDE) {
    return {
      key: 'resolution',
      label,
      status: 'warn',
      detail: `${width} × ${height}，短邊 ${shortSide}px——預覽可用，細節傳遞較弱（產品預設門檻 ${RESOLUTION_PASS_MIN_SHORT_SIDE}px）。`,
    }
  }
  return {
    key: 'resolution',
    label,
    status: 'fail',
    detail: `${width} × ${height}，短邊 ${shortSide}px 低於 ${RESOLUTION_WARN_MIN_SHORT_SIDE}px——表演細節可能不足，建議改用更高解析度素材（產品預設門檻，非供應商限制）。`,
  }
}

function assessAudio(hasAudio: boolean | null): MaterialReadinessRow {
  const label = '音訊'
  if (hasAudio === null) {
    return {
      key: 'audio',
      label,
      status: 'unknown',
      detail: '目前瀏覽器無法偵測音訊軌，請自行確認素材是否含同期聲。',
    }
  }
  if (hasAudio) {
    return { key: 'audio', label, status: 'pass', detail: '含同期聲——口型／台詞參考完整。' }
  }
  return { key: 'audio', label, status: 'warn', detail: '無同期聲——口型節奏參考弱。' }
}

function assessFaceCoverage(faceTrack: MaterialReadinessFaceTrack | null | undefined): MaterialReadinessRow {
  const label = '臉部覆蓋'
  if (!faceTrack) {
    return {
      key: 'faceCoverage',
      label,
      status: 'unknown',
      detail: '尚未執行臉部分析——建議先執行「分析臉部表演」再檢查臉部覆蓋。',
    }
  }
  const total = faceTrack.samples.length
  if (total === 0) {
    return {
      key: 'faceCoverage',
      label,
      status: 'unknown',
      detail: '臉部分析沒有任何取樣點，請重新執行臉部分析。',
    }
  }
  const detected = faceTrack.samples.filter((sample) => sample.faceBox !== null).length
  const coverage = detected / total
  const percent = Math.round(coverage * 100)
  const base = `臉部覆蓋率 ${percent}%（${detected}/${total} 個取樣點）`
  if (coverage >= FACE_COVERAGE_PASS_RATIO) {
    return { key: 'faceCoverage', label, status: 'pass', detail: `${base}，臉部軌跡穩定。` }
  }
  const segments = formatSegments(collectMissingSegments(faceTrack))
  if (coverage >= FACE_COVERAGE_WARN_RATIO) {
    return {
      key: 'faceCoverage',
      label,
      status: 'warn',
      detail: `${base}，部分片段漏檢。漏檢時間段：${segments}。`,
    }
  }
  return {
    key: 'faceCoverage',
    label,
    status: 'fail',
    detail: `${base}，覆蓋率過低——臉部近景與表情參考不可靠。漏檢時間段：${segments}。`,
  }
}

function assessVideo2Quota(durationSec: number): MaterialReadinessRow {
  const label = 'video 2 配額'
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return {
      key: 'video2Quota',
      label,
      status: 'unknown',
      detail: '無法讀取影片時長，無法計算 video 2（臉部近景參考）配額。',
    }
  }
  const quota = computeVideo2Quota(durationSec)
  if (quota.video2Enabled) {
    return {
      key: 'video2Quota',
      label,
      status: 'pass',
      detail: `剩餘 ${formatSeconds(quota.video2BudgetSeconds)} 秒可用於臉部近景參考（video 2）。`,
    }
  }
  return {
    key: 'video2Quota',
    label,
    status: 'warn',
    // computeVideo2Quota 停用時保證帶原因；此處防禦性 fallback 不應發生。
    detail: quota.disabledReason ?? 'video 2（臉部近景參考）已停用。',
  }
}

// ---------------------------------------------------------------------------
// 總結
// ---------------------------------------------------------------------------

function buildSummary(rows: readonly MaterialReadinessRow[], verdict: MaterialReadinessVerdict): string {
  const failCount = rows.filter((row) => row.status === 'fail').length
  const warnCount = rows.filter((row) => row.status === 'warn').length
  const unknownCount = rows.filter((row) => row.status === 'unknown').length
  if (verdict === 'fail') {
    return `素材不符合 Track B／B0 規格：${failCount} 項不通過，請先修正再進入生成流程。`
  }
  if (verdict === 'warn') {
    return `素材大致可用，但有 ${warnCount} 項需要注意。`
  }
  if (unknownCount > 0) {
    return `已檢查項目全部通過，尚有 ${unknownCount} 項未確認（建議先執行臉部分析）。`
  }
  return '素材符合 Track B／B0 規格，可進入下一步。'
}

/**
 * 對已載入的表演素材做 Track B / B0 規格體檢。
 * 全部本機計算；不觸碰生成側，也不發送任何請求。
 */
export function assessMaterialReadiness(input: MaterialReadinessInput): MaterialReadinessReport {
  const rows: MaterialReadinessRow[] = [
    assessDuration(input.durationSec),
    assessResolution(input.width, input.height),
    assessAudio(input.hasAudio),
    assessFaceCoverage(input.faceTrack),
    assessVideo2Quota(input.durationSec),
  ]
  const verdict: MaterialReadinessVerdict = rows.some((row) => row.status === 'fail')
    ? 'fail'
    : rows.some((row) => row.status === 'warn')
      ? 'warn'
      : 'ready'
  return { rows, verdict, summary: buildSummary(rows, verdict) }
}

// ---------------------------------------------------------------------------
// 參考素材順序（規劃預覽）
// ---------------------------------------------------------------------------

export const PREVIEW_PERFORMANCE_ASSET_ID = 'preview::performance-video'

export interface ReferenceMappingPreviewRow {
  /** prompt 引用 token，例如 'video 1'、'image 6'。 */
  token: string
  /** 角色說明，例如 '主表演影片'。 */
  role: string
  /** '本素材'（video 1）或 '規劃中'（其餘 slot）。 */
  note: string
}

/**
 * 以目前素材為 video 1，套用 §2.3 固定順序契約產生「規劃預覽」映射。
 * 其餘 slot 皆為佔位（規劃中）；video 2 依 §2.4 配額決定是否列出，
 * 停用原因由體檢報告的「video 2 配額」列說明。
 */
export function buildReferenceMappingPreview(durationSec: number): ReferenceMappingPreviewRow[] {
  const safeDuration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const quota = computeVideo2Quota(safeDuration)
  const mapping = buildReferenceOrderMapping({
    performanceVideo: { assetId: PREVIEW_PERFORMANCE_ASSET_ID, durationSeconds: safeDuration },
    faceCloseupVideo: quota.video2Enabled ? { assetId: 'preview::face-closeup' } : null,
    originalAudio: { assetId: 'preview::original-audio' },
    characterImages: [
      { assetId: 'preview::character-angle-1' },
      { assetId: 'preview::character-angle-2' },
      { assetId: 'preview::character-angle-3' },
    ],
    detailImages: [{ assetId: 'preview::detail-1' }, { assetId: 'preview::detail-2' }],
    backgroundConceptImage: { assetId: 'preview::background-concept' },
  })
  return mapping.rows.map((row) => ({
    token: row.token,
    role: row.role,
    note: row.assetId === PREVIEW_PERFORMANCE_ASSET_ID ? '本素材' : '規劃中',
  }))
}
