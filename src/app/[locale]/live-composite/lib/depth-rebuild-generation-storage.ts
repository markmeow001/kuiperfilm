export interface PendingDepthRebuildSegment {
  requestKey: string
  submissionAttempted?: boolean
  runId?: string
}

export interface PendingDepthRebuildGuidePlanV2 {
  version: 2
  strategy: 'full-depth-full-rgb' | 'full-depth-critical-rgb' | 'full-depth-only'
  sourceDurationSeconds: number
  outputDurationSeconds: number
  criticalCenterSeconds: number
  referenceVideoWindows: Array<{
    role: 'depth' | 'rgb'
    startSeconds: number
    durationSeconds: number
  }>
}

export interface PendingDepthRebuildUploads {
  sourceVideoKey: string
  depthVideoKey: string
  imageKeys: string[]
  imageNames: string[]
}

export interface PendingDepthRebuildSubmission {
  /** 舊紀錄未保存時視為 v1；新工作流一律寫入 v2。 */
  contractVersion?: 1 | 2
  segmentPrompts: string[]
  segmentWindows: Array<{
    startSeconds: number
    durationSeconds: number
  }>
  modelKey: string
  resolution: string
  aspectRatio: string
  sourceAudioMode: 'preserve' | 'reference-only' | 'generate'
  workspaceId?: string
  guidePlan?: PendingDepthRebuildGuidePlanV2
}

export interface PendingDepthRebuildGeneration {
  workflowId: string
  segments: PendingDepthRebuildSegment[]
  submission: PendingDepthRebuildSubmission
  uploads?: PendingDepthRebuildUploads
  finalResult?: {
    runId: string
    resultKey: string
    url: string
  }
}

export const DEPTH_REBUILD_STORAGE_REQUIRED_MESSAGE =
  '瀏覽器無法安全保存這次付費任務，已停止送出；請確認未停用工作階段儲存空間後重試'

export function depthRebuildGenerationStorageKey(scopeKey: string): string {
  return `kuiper:depth-rebuild-generation:${encodeURIComponent(scopeKey)}`
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseSegments(value: unknown): PendingDepthRebuildSegment[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) return null
  const segments: PendingDepthRebuildSegment[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const record = entry as Record<string, unknown>
    if (!nonEmptyString(record.requestKey)) return null
    if (
      record.submissionAttempted !== undefined
      && typeof record.submissionAttempted !== 'boolean'
    ) return null
    if (record.runId !== undefined && !nonEmptyString(record.runId)) return null
    segments.push({
      requestKey: record.requestKey,
      ...(typeof record.submissionAttempted === 'boolean'
        ? { submissionAttempted: record.submissionAttempted }
        : {}),
      ...(nonEmptyString(record.runId) ? { runId: record.runId } : {}),
    })
  }
  return segments
}

function parseUploads(value: unknown): PendingDepthRebuildUploads | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (!nonEmptyString(record.sourceVideoKey) || !nonEmptyString(record.depthVideoKey)) return undefined
  if (!Array.isArray(record.imageKeys) || !record.imageKeys.every(nonEmptyString)) return undefined
  if (!Array.isArray(record.imageNames) || !record.imageNames.every(nonEmptyString)) return undefined
  if (record.imageKeys.length !== record.imageNames.length) return undefined
  return {
    sourceVideoKey: record.sourceVideoKey,
    depthVideoKey: record.depthVideoKey,
    imageKeys: [...record.imageKeys],
    imageNames: [...record.imageNames],
  }
}

function timesEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.001
}

const V2_MIN_SOURCE_SECONDS = 4
const V2_MAX_SOURCE_SECONDS = 15
const V2_MIN_REFERENCE_SECONDS = 2
const V2_NOMINAL_DUAL_REFERENCE_SECONDS = 14.5
const V2_HARD_REFERENCE_SECONDS = 15
const V2_PLAN_KEYS = [
  'version',
  'strategy',
  'sourceDurationSeconds',
  'outputDurationSeconds',
  'criticalCenterSeconds',
  'referenceVideoWindows',
] as const
const V2_WINDOW_KEYS = ['role', 'startSeconds', 'durationSeconds'] as const

function hasOnlyRequiredKeys(
  record: Record<string, unknown>,
  requiredKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(record)
  return actualKeys.length === requiredKeys.length
    && requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
}

function parseGuidePlanV2(value: unknown): PendingDepthRebuildGuidePlanV2 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!hasOnlyRequiredKeys(record, V2_PLAN_KEYS)) return null
  const strategy = record.strategy
  if (
    record.version !== 2
    || (
      strategy !== 'full-depth-full-rgb'
      && strategy !== 'full-depth-critical-rgb'
      && strategy !== 'full-depth-only'
    )
    || typeof record.sourceDurationSeconds !== 'number'
    || !Number.isFinite(record.sourceDurationSeconds)
    || record.sourceDurationSeconds < V2_MIN_SOURCE_SECONDS
    || record.sourceDurationSeconds > V2_MAX_SOURCE_SECONDS
    || typeof record.outputDurationSeconds !== 'number'
    || !Number.isInteger(record.outputDurationSeconds)
    || record.outputDurationSeconds < V2_MIN_SOURCE_SECONDS
    || record.outputDurationSeconds > V2_MAX_SOURCE_SECONDS
    || record.outputDurationSeconds !== Math.ceil(record.sourceDurationSeconds)
    || typeof record.criticalCenterSeconds !== 'number'
    || !Number.isFinite(record.criticalCenterSeconds)
    || record.criticalCenterSeconds < 0
    || record.criticalCenterSeconds > record.sourceDurationSeconds
    || !Array.isArray(record.referenceVideoWindows)
  ) return null
  const expectedWindowCount = strategy === 'full-depth-only' ? 1 : 2
  if (record.referenceVideoWindows.length !== expectedWindowCount) return null

  const parsedWindows: PendingDepthRebuildGuidePlanV2['referenceVideoWindows'] = []
  for (let index = 0; index < expectedWindowCount; index += 1) {
    const rawWindow = record.referenceVideoWindows[index]
    if (!rawWindow || typeof rawWindow !== 'object' || Array.isArray(rawWindow)) {
      return null
    }
    const window = rawWindow as Record<string, unknown>
    if (!hasOnlyRequiredKeys(window, V2_WINDOW_KEYS)) return null
    const expectedRole = index === 0 ? 'depth' : 'rgb'
    if (
      window.role !== expectedRole
      || typeof window.startSeconds !== 'number'
      || typeof window.durationSeconds !== 'number'
      || !Number.isFinite(window.startSeconds)
      || !Number.isFinite(window.durationSeconds)
      || window.startSeconds < 0
      || window.durationSeconds < V2_MIN_REFERENCE_SECONDS
      || window.durationSeconds > V2_HARD_REFERENCE_SECONDS
      || window.startSeconds + window.durationSeconds
        > record.sourceDurationSeconds + 0.001
    ) return null
    parsedWindows.push({
      role: expectedRole,
      startSeconds: window.startSeconds,
      durationSeconds: window.durationSeconds,
    })
  }

  const depthWindow = parsedWindows[0]
  if (
    !depthWindow
    || depthWindow.role !== 'depth'
    || !timesEqual(depthWindow.startSeconds, 0)
    || !timesEqual(depthWindow.durationSeconds, record.sourceDurationSeconds)
  ) return null

  const rgbWindow = parsedWindows[1]
  if (strategy === 'full-depth-full-rgb') {
    if (
      !rgbWindow
      || !timesEqual(rgbWindow.startSeconds, 0)
      || !timesEqual(rgbWindow.durationSeconds, record.sourceDurationSeconds)
    ) return null
  } else if (strategy === 'full-depth-critical-rgb') {
    if (
      !rgbWindow
      || rgbWindow.durationSeconds >= record.sourceDurationSeconds
      || record.criticalCenterSeconds < rgbWindow.startSeconds - 0.001
      || record.criticalCenterSeconds
        > rgbWindow.startSeconds + rgbWindow.durationSeconds + 0.001
    ) return null
  } else if (rgbWindow) {
    return null
  }

  const totalReferenceSeconds = parsedWindows.reduce(
    (sum, window) => sum + window.durationSeconds,
    0,
  )
  if (totalReferenceSeconds > V2_HARD_REFERENCE_SECONDS + 0.001) return null
  if (
    parsedWindows.length === 2
    && totalReferenceSeconds > V2_NOMINAL_DUAL_REFERENCE_SECONDS + 0.001
  ) return null

  return {
    version: 2,
    strategy,
    sourceDurationSeconds: record.sourceDurationSeconds,
    outputDurationSeconds: record.outputDurationSeconds,
    criticalCenterSeconds: record.criticalCenterSeconds,
    referenceVideoWindows: parsedWindows,
  }
}

function parseSubmission(value: unknown): PendingDepthRebuildSubmission | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const contractVersion = record.contractVersion === undefined
    ? 1
    : record.contractVersion
  if (contractVersion !== 1 && contractVersion !== 2) return null
  const guidePlan = contractVersion === 2 ? parseGuidePlanV2(record.guidePlan) : null
  if (
    !Array.isArray(record.segmentPrompts)
    || record.segmentPrompts.length === 0
    || record.segmentPrompts.length > 2
    || !record.segmentPrompts.every(nonEmptyString)
    || !Array.isArray(record.segmentWindows)
    || record.segmentWindows.length !== record.segmentPrompts.length
    || !nonEmptyString(record.modelKey)
    || !nonEmptyString(record.resolution)
    || !nonEmptyString(record.aspectRatio)
    || !['preserve', 'reference-only', 'generate'].includes(String(record.sourceAudioMode))
    || (record.workspaceId !== undefined && !nonEmptyString(record.workspaceId))
    || (contractVersion === 2 && (!guidePlan || record.segmentPrompts.length !== 1))
  ) {
    return null
  }
  const segmentWindows: PendingDepthRebuildSubmission['segmentWindows'] = []
  for (const entry of record.segmentWindows) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const window = entry as Record<string, unknown>
    if (
      typeof window.startSeconds !== 'number'
      || !Number.isFinite(window.startSeconds)
      || window.startSeconds < 0
      || typeof window.durationSeconds !== 'number'
      || !Number.isFinite(window.durationSeconds)
      || window.durationSeconds < 4
      || window.durationSeconds > (contractVersion === 2 ? 15 : 7.5)
    ) {
      return null
    }
    segmentWindows.push({
      startSeconds: window.startSeconds,
      durationSeconds: window.durationSeconds,
    })
  }
  if (
    contractVersion === 2
    && guidePlan
    && (
      segmentWindows.length !== 1
      || !timesEqual(segmentWindows[0]?.startSeconds ?? -1, 0)
      || !timesEqual(
        segmentWindows[0]?.durationSeconds ?? -1,
        guidePlan.sourceDurationSeconds,
      )
    )
  ) return null
  return {
    contractVersion,
    segmentPrompts: [...record.segmentPrompts],
    segmentWindows,
    modelKey: record.modelKey,
    resolution: record.resolution,
    aspectRatio: record.aspectRatio,
    sourceAudioMode: record.sourceAudioMode as PendingDepthRebuildSubmission['sourceAudioMode'],
    ...(nonEmptyString(record.workspaceId) ? { workspaceId: record.workspaceId } : {}),
    ...(guidePlan ? { guidePlan } : {}),
  }
}

function parseFinalResult(value: unknown): PendingDepthRebuildGeneration['finalResult'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    !nonEmptyString(record.runId)
    || !nonEmptyString(record.resultKey)
    || !nonEmptyString(record.url)
  ) return undefined
  return {
    runId: record.runId,
    resultKey: record.resultKey,
    url: record.url,
  }
}

export function readPendingDepthRebuildGeneration(
  key: string,
): PendingDepthRebuildGeneration | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const segments = parseSegments(parsed.segments)
    const submission = parseSubmission(parsed.submission)
    if (
      !nonEmptyString(parsed.workflowId)
      || !segments
      || !submission
      || segments.length !== submission.segmentPrompts.length
    ) {
      window.sessionStorage.removeItem(key)
      return null
    }
    return {
      workflowId: parsed.workflowId,
      segments,
      submission,
      ...(parseUploads(parsed.uploads) ? { uploads: parseUploads(parsed.uploads) } : {}),
      ...(parseFinalResult(parsed.finalResult) ? { finalResult: parseFinalResult(parsed.finalResult) } : {}),
    }
  } catch {
    return null
  }
}

export function writePendingDepthRebuildGeneration(
  key: string,
  pending: PendingDepthRebuildGeneration,
): boolean {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(pending))
    return true
  } catch {
    return false
  }
}

export function clearPendingDepthRebuildGeneration(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // The paid requests are already protected by their persisted request keys.
  }
}
