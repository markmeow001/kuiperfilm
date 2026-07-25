import {
  MAX_DURATION_SECONDS,
  MAX_TOTAL_REFERENCE_VIDEO_SECONDS,
  MIN_DURATION_SECONDS,
} from './atlascloud-r2v-contract'

/**
 * 每個生成分段固定同時使用原始 RGB 與同步 Depth 兩支參考影片。
 * AtlasCloud 的 15 秒上限計算的是所有 reference videos 的總長度。
 */
export const DEPTH_REBUILD_REFERENCE_VIDEOS_PER_SEGMENT = 2

export const MAX_DUAL_GUIDE_SEGMENT_SECONDS =
  MAX_TOTAL_REFERENCE_VIDEO_SECONDS / DEPTH_REBUILD_REFERENCE_VIDEOS_PER_SEGMENT

export interface DepthRebuildSegmentPlanItem {
  /** 此生成段落在原片中的起點（秒，含）。 */
  sourceStart: number
  /** 此生成段落在原片中的終點（秒，不含；最後一段等於原片完整長度）。 */
  sourceEnd: number
  /** Seedance 這一筆任務的輸出秒數。 */
  outputDuration: number
  /** RGB 與 Depth 兩支同長參考影片的合計秒數。 */
  referenceTotalSeconds: number
}

export class DepthRebuildSegmentPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DepthRebuildSegmentPlanError'
  }
}

function assertSourceDuration(sourceDurationSeconds: number): void {
  if (!Number.isFinite(sourceDurationSeconds)) {
    throw new DepthRebuildSegmentPlanError('原片秒數無效，無法建立 RGB＋Depth 分段計畫')
  }
  if (
    sourceDurationSeconds < MIN_DURATION_SECONDS
    || sourceDurationSeconds > MAX_DURATION_SECONDS
  ) {
    throw new DepthRebuildSegmentPlanError(
      `原片需介於 ${MIN_DURATION_SECONDS}–${MAX_DURATION_SECONDS} 秒，收到 ${sourceDurationSeconds} 秒`,
    )
  }
}

function buildEvenSegments(
  sourceDurationSeconds: number,
  segmentCount: number,
): readonly DepthRebuildSegmentPlanItem[] {
  return Array.from({ length: segmentCount }, (_unused, index) => {
    // 直接由完整原片長度計算每個邊界，避免逐段累加造成時間漂移；
    // 最後一段的 sourceEnd 必定精確回到呼叫端提供的完整原片長度。
    const sourceStart = (sourceDurationSeconds * index) / segmentCount
    const sourceEnd = index === segmentCount - 1
      ? sourceDurationSeconds
      : (sourceDurationSeconds * (index + 1)) / segmentCount
    const outputDuration = sourceEnd - sourceStart

    return {
      sourceStart,
      sourceEnd,
      outputDuration,
      referenceTotalSeconds: outputDuration * DEPTH_REBUILD_REFERENCE_VIDEOS_PER_SEGMENT,
    }
  })
}

/**
 * 將完整原片規劃成可提交給 AtlasCloud Seedance R2V 的生成段落。
 *
 * 契約：
 * - 每段同時傳入一支 RGB 與一支 Depth，兩支長度皆等於輸出長度。
 * - 每筆請求的 reference videos 合計不得超過 15 秒，因此每段最多 7.5 秒。
 * - Seedance 每段輸出至少 4 秒。
 * - 使用最少合法段數並平均切分；不裁短、不補幀，也不隱式吞掉尾段。
 * - 找不到合法切法時顯式拋錯，交由 UI 在付費提交前阻擋。
 */
export function buildDepthRebuildSegmentPlan(
  sourceDurationSeconds: number,
): readonly DepthRebuildSegmentPlanItem[] {
  assertSourceDuration(sourceDurationSeconds)

  const minimumSegmentCount = Math.ceil(
    sourceDurationSeconds / MAX_DUAL_GUIDE_SEGMENT_SECONDS,
  )
  const maximumSegmentCount = Math.floor(sourceDurationSeconds / MIN_DURATION_SECONDS)

  if (minimumSegmentCount > maximumSegmentCount) {
    throw new DepthRebuildSegmentPlanError(
      `原片 ${sourceDurationSeconds} 秒無法在不裁短的前提下建立合法雙引導分段：`
      + `每段需至少 ${MIN_DURATION_SECONDS} 秒，且 RGB＋Depth 合計不得超過 `
      + `${MAX_TOTAL_REFERENCE_VIDEO_SECONDS} 秒`,
    )
  }

  const segments = buildEvenSegments(sourceDurationSeconds, minimumSegmentCount)
  const invalidSegment = segments.find((segment) => (
    segment.outputDuration < MIN_DURATION_SECONDS
    || segment.outputDuration > MAX_DURATION_SECONDS
    || segment.referenceTotalSeconds > MAX_TOTAL_REFERENCE_VIDEO_SECONDS
  ))

  if (invalidSegment) {
    throw new DepthRebuildSegmentPlanError(
      `原片 ${sourceDurationSeconds} 秒的分段計畫違反 Seedance 時長或 AtlasCloud 參考影片配額`,
    )
  }

  return segments
}
