import {
  MAX_DURATION_SECONDS,
  MAX_TOTAL_REFERENCE_VIDEO_SECONDS,
  MIN_DURATION_SECONDS,
} from './atlascloud-r2v-contract'

/**
 * 雙影片引導刻意保留 0.5 秒編碼誤差空間；單支完整 Depth 仍可使用
 * AtlasCloud 的 15 秒硬上限。
 */
export const DEPTH_REBUILD_SOFT_REFERENCE_BUDGET_SECONDS = 14.5
export const DEPTH_REBUILD_MIN_SECONDARY_SECONDS = 2

export type DepthRebuildGuideStrategy =
  | 'full-depth-full-rgb'
  | 'full-depth-critical-rgb'
  | 'full-depth-only'

export interface DepthRebuildGuideWindow {
  sourceStartSeconds: number
  sourceEndSeconds: number
  durationSeconds: number
  isFullSource: boolean
}

export interface DepthRebuildFullDepthGuide extends DepthRebuildGuideWindow {
  kind: 'depth'
  selection: 'full-source'
  isFullSource: true
}

export interface DepthRebuildSecondaryRgbGuide extends DepthRebuildGuideWindow {
  kind: 'rgb'
  selection: 'full-source' | 'critical-window'
  /** 關鍵片段的目標中心；完整 RGB 時為 null。 */
  criticalCenterSeconds: number | null
}

export interface DepthRebuildGuideBudget {
  /** 兩支參考影片共用的安全額度，已為編碼誤差保留 0.5 秒。 */
  softBudgetSeconds: number
  /** AtlasCloud 所有 reference videos 的供應商硬上限。 */
  hardLimitSeconds: number
  minimumSecondarySeconds: number
  remainingSoftBudgetSeconds: number
  withinSoftBudget: boolean
  withinHardLimit: boolean
}

export interface DepthRebuildGuideDisplayFacts {
  sourceSeconds: number
  outputSeconds: number
  referenceVideoCount: 1 | 2
  fullDepthSeconds: number
  secondaryRgbSeconds: number | null
  totalReferenceSeconds: number
  softBudgetSeconds: number
  hardLimitSeconds: number
}

export interface DepthRebuildGuidePlan {
  strategy: DepthRebuildGuideStrategy
  sourceDurationSeconds: number
  /** Seedance 輸出只傳 4–15 的整數秒數；完成後由 finalize 裁回原片長度。 */
  outputDurationSeconds: number
  /** video 1：始終為完整同步 Depth，不因第二支參考而裁短。 */
  fullDepth: DepthRebuildFullDepthGuide
  /** video 2：完整 RGB、關鍵 RGB 片段，或 null。 */
  secondary: DepthRebuildSecondaryRgbGuide | null
  totalReferenceSeconds: number
  budget: DepthRebuildGuideBudget
  displayFacts: DepthRebuildGuideDisplayFacts
}

export interface BuildDepthRebuildGuidePlanOptions {
  /** RGB 關鍵片段在原片中的目標中心。省略時使用原片中點。 */
  criticalCenterSeconds?: number
}

export class DepthRebuildGuidePlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DepthRebuildGuidePlanError'
  }
}

const FLOAT_TOLERANCE = 1e-9

function roundSeconds(value: number): number {
  return Math.round(value * 1_000) / 1_000
}

function floorToTenth(value: number): number {
  return Math.floor((value + FLOAT_TOLERANCE) * 10) / 10
}

function assertSourceDuration(sourceDurationSeconds: number): void {
  if (!Number.isFinite(sourceDurationSeconds)) {
    throw new DepthRebuildGuidePlanError('原片秒數必須是有限數字')
  }

  if (
    sourceDurationSeconds < MIN_DURATION_SECONDS
    || sourceDurationSeconds > MAX_DURATION_SECONDS
  ) {
    throw new DepthRebuildGuidePlanError(
      `原片需介於 ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} 秒，收到 ${sourceDurationSeconds} 秒`,
    )
  }
}

function resolveCriticalCenter(
  sourceDurationSeconds: number,
  criticalCenterSeconds: number | undefined,
): number {
  if (criticalCenterSeconds === undefined) {
    return sourceDurationSeconds / 2
  }

  if (!Number.isFinite(criticalCenterSeconds)) {
    throw new DepthRebuildGuidePlanError('關鍵動作中心秒數必須是有限數字')
  }

  if (criticalCenterSeconds < 0 || criticalCenterSeconds > sourceDurationSeconds) {
    throw new DepthRebuildGuidePlanError(
      `關鍵動作中心需介於 0–${sourceDurationSeconds} 秒，收到 ${criticalCenterSeconds} 秒`,
    )
  }

  return criticalCenterSeconds
}

function buildCriticalWindow(
  sourceDurationSeconds: number,
  durationSeconds: number,
  criticalCenterSeconds: number,
): DepthRebuildSecondaryRgbGuide {
  const maximumStart = sourceDurationSeconds - durationSeconds
  const centeredStart = criticalCenterSeconds - durationSeconds / 2
  const sourceStartSeconds = roundSeconds(
    Math.min(Math.max(centeredStart, 0), maximumStart),
  )
  const sourceEndSeconds = roundSeconds(sourceStartSeconds + durationSeconds)

  return {
    kind: 'rgb',
    selection: 'critical-window',
    sourceStartSeconds,
    sourceEndSeconds,
    durationSeconds,
    isFullSource: false,
    criticalCenterSeconds,
  }
}

/**
 * 建立單筆 Seedance R2V 的自適應引導計畫。
 *
 * - video 1 始終是完整 Depth。
 * - 短片使用完整 RGB 作為 video 2。
 * - 較長影片只使用安全額度內、至少 2 秒的關鍵 RGB 片段。
 * - 剩餘額度不足 2 秒時只送完整 Depth，不裁短主引導、不平均拆段。
 */
export function buildDepthRebuildGuidePlan(
  sourceDurationSeconds: number,
  options: BuildDepthRebuildGuidePlanOptions = {},
): DepthRebuildGuidePlan {
  assertSourceDuration(sourceDurationSeconds)
  const criticalCenterSeconds = resolveCriticalCenter(
    sourceDurationSeconds,
    options.criticalCenterSeconds,
  )
  const outputDurationSeconds = Math.ceil(sourceDurationSeconds)
  const fullDepth: DepthRebuildFullDepthGuide = {
    kind: 'depth',
    selection: 'full-source',
    sourceStartSeconds: 0,
    sourceEndSeconds: sourceDurationSeconds,
    durationSeconds: sourceDurationSeconds,
    isFullSource: true,
  }

  const fullRgbFits = sourceDurationSeconds * 2
    <= DEPTH_REBUILD_SOFT_REFERENCE_BUDGET_SECONDS + FLOAT_TOLERANCE
  const secondaryBudgetSeconds = roundSeconds(
    DEPTH_REBUILD_SOFT_REFERENCE_BUDGET_SECONDS - sourceDurationSeconds,
  )

  let strategy: DepthRebuildGuideStrategy
  let secondary: DepthRebuildSecondaryRgbGuide | null

  if (fullRgbFits) {
    strategy = 'full-depth-full-rgb'
    secondary = {
      kind: 'rgb',
      selection: 'full-source',
      sourceStartSeconds: 0,
      sourceEndSeconds: sourceDurationSeconds,
      durationSeconds: sourceDurationSeconds,
      isFullSource: true,
      criticalCenterSeconds: null,
    }
  } else if (secondaryBudgetSeconds >= DEPTH_REBUILD_MIN_SECONDARY_SECONDS) {
    strategy = 'full-depth-critical-rgb'
    secondary = buildCriticalWindow(
      sourceDurationSeconds,
      floorToTenth(secondaryBudgetSeconds),
      criticalCenterSeconds,
    )
  } else {
    strategy = 'full-depth-only'
    secondary = null
  }

  const totalReferenceSeconds = roundSeconds(
    sourceDurationSeconds + (secondary?.durationSeconds ?? 0),
  )
  const withinSoftBudget = totalReferenceSeconds
    <= DEPTH_REBUILD_SOFT_REFERENCE_BUDGET_SECONDS + FLOAT_TOLERANCE
  const withinHardLimit = totalReferenceSeconds
    <= MAX_TOTAL_REFERENCE_VIDEO_SECONDS + FLOAT_TOLERANCE

  if (!withinHardLimit) {
    throw new DepthRebuildGuidePlanError(
      `參考影片合計 ${totalReferenceSeconds} 秒超過 AtlasCloud ${MAX_TOTAL_REFERENCE_VIDEO_SECONDS} 秒硬上限`,
    )
  }

  const budget: DepthRebuildGuideBudget = {
    softBudgetSeconds: DEPTH_REBUILD_SOFT_REFERENCE_BUDGET_SECONDS,
    hardLimitSeconds: MAX_TOTAL_REFERENCE_VIDEO_SECONDS,
    minimumSecondarySeconds: DEPTH_REBUILD_MIN_SECONDARY_SECONDS,
    remainingSoftBudgetSeconds: roundSeconds(Math.max(
      0,
      DEPTH_REBUILD_SOFT_REFERENCE_BUDGET_SECONDS - totalReferenceSeconds,
    )),
    withinSoftBudget,
    withinHardLimit,
  }

  return {
    strategy,
    sourceDurationSeconds,
    outputDurationSeconds,
    fullDepth,
    secondary,
    totalReferenceSeconds,
    budget,
    displayFacts: {
      sourceSeconds: sourceDurationSeconds,
      outputSeconds: outputDurationSeconds,
      referenceVideoCount: secondary === null ? 1 : 2,
      fullDepthSeconds: sourceDurationSeconds,
      secondaryRgbSeconds: secondary?.durationSeconds ?? null,
      totalReferenceSeconds,
      softBudgetSeconds: DEPTH_REBUILD_SOFT_REFERENCE_BUDGET_SECONDS,
      hardLimitSeconds: MAX_TOTAL_REFERENCE_VIDEO_SECONDS,
    },
  }
}
