export interface PendingDepthRebuildSegment {
  requestKey: string
  runId?: string
}

export interface PendingDepthRebuildUploads {
  sourceVideoKey: string
  depthVideoKey: string
  imageKeys: string[]
  imageNames: string[]
}

export interface PendingDepthRebuildSubmission {
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
    if (record.runId !== undefined && !nonEmptyString(record.runId)) return null
    segments.push({
      requestKey: record.requestKey,
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

function parseSubmission(value: unknown): PendingDepthRebuildSubmission | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
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
      || window.durationSeconds > 7.5
    ) {
      return null
    }
    segmentWindows.push({
      startSeconds: window.startSeconds,
      durationSeconds: window.durationSeconds,
    })
  }
  return {
    segmentPrompts: [...record.segmentPrompts],
    segmentWindows,
    modelKey: record.modelKey,
    resolution: record.resolution,
    aspectRatio: record.aspectRatio,
    sourceAudioMode: record.sourceAudioMode as PendingDepthRebuildSubmission['sourceAudioMode'],
    ...(nonEmptyString(record.workspaceId) ? { workspaceId: record.workspaceId } : {}),
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
