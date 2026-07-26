import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { prisma } from '@/lib/prisma'
import { getSignedUrl, toFetchableUrl, uploadToCOS } from '@/lib/cos'
import { filterAuthorizedStorageReferences } from '@/lib/playground/reference-guard'
import { isSourceAudioMode, type SourceAudioMode } from '@/lib/playground/source-audio-contract'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import {
  DEPTH_REBUILD_MAX_REFERENCE_DURATION_SEC,
  DEPTH_REBUILD_MAX_SEGMENTS,
  DEPTH_REBUILD_MAX_SOURCE_DURATION_SEC,
  DEPTH_REBUILD_MIN_REFERENCE_DURATION_SEC,
  depthRebuildTimesEqual,
  isDepthRebuildSegmentIdentity,
} from '@/lib/live-composite/depth-rebuild-server-contract'

const execFileAsync = promisify(execFile)
const PLAYGROUND_PROJECT_ID = 'playground'
const MAX_SEGMENT_RUNS = DEPTH_REBUILD_MAX_SEGMENTS
const MAX_INPUT_BYTES = 256 * 1024 * 1024
const MAX_TOTAL_INPUT_BYTES = 384 * 1024 * 1024
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024
const MAX_MEDIA_DIMENSION = 4096
const MAX_MEDIA_PIXELS = 4096 * 2160
const MEDIA_DURATION_TOLERANCE_SEC = 0.5
const DOWNLOAD_TIMEOUT_MS = 120_000
const MEDIA_TOOL_TIMEOUT_MS = 10 * 60 * 1000
const MEDIA_TOOL_MAX_BUFFER = 4 * 1024 * 1024
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export type DepthRebuildFinalizeErrorCode =
  | 'DEPTH_REBUILD_FINALIZE_PAYLOAD_INVALID'
  | 'DEPTH_REBUILD_FINALIZE_WORKFLOW_ID_INVALID'
  | 'DEPTH_REBUILD_FINALIZE_SEGMENT_RUNS_INVALID'
  | 'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_DUPLICATE'
  | 'DEPTH_REBUILD_FINALIZE_SOURCE_KEY_INVALID'
  | 'DEPTH_REBUILD_FINALIZE_SOURCE_MODE_INVALID'
  | 'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_FOUND_OR_NOT_OWNED'
  | 'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_TYPE_INVALID'
  | 'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_COMPLETED'
  | 'DEPTH_REBUILD_FINALIZE_SEGMENT_RESULT_MISSING'
  | 'DEPTH_REBUILD_FINALIZE_SEGMENT_RESULT_KEY_INVALID'
  | 'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID'
  | 'DEPTH_REBUILD_FINALIZE_WORKFLOW_MISMATCH'
  | 'DEPTH_REBUILD_FINALIZE_SOURCE_NOT_AUTHORIZED'
  | 'DEPTH_REBUILD_FINALIZE_DOWNLOAD_FAILED'
  | 'DEPTH_REBUILD_FINALIZE_INPUT_TOO_LARGE'
  | 'DEPTH_REBUILD_FINALIZE_MEDIA_INVALID'
  | 'DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED'
  | 'DEPTH_REBUILD_FINALIZE_MEDIA_TOOL_FAILED'
  | 'DEPTH_REBUILD_FINALIZE_SOURCE_AUDIO_MISSING'
  | 'DEPTH_REBUILD_FINALIZE_GENERATED_AUDIO_MISSING'
  | 'DEPTH_REBUILD_FINALIZE_OUTPUT_EMPTY'
  | 'DEPTH_REBUILD_FINALIZE_OUTPUT_TOO_LARGE'

export class DepthRebuildFinalizeError extends Error {
  readonly code: DepthRebuildFinalizeErrorCode

  constructor(code: DepthRebuildFinalizeErrorCode, message: string) {
    super(message)
    this.name = 'DepthRebuildFinalizeError'
    this.code = code
  }
}

export interface DepthRebuildFinalizeInput {
  workflowId: string
  segmentRunIds: string[]
  sourceVideoKey: string
  sourceAudioMode: SourceAudioMode
}

export interface DepthRebuildFinalizeResult {
  workflowId: string
  inputFingerprint: string
  resultKey: string
  durationSec: number
}

/** Identical inputs retry to one object; changed inputs never overwrite an earlier workflow result. */
export function buildDepthRebuildResultKey(
  userId: string,
  workflowId: string,
  inputFingerprint: string,
): string {
  const safeUserId = userId.replace(/[^A-Za-z0-9_-]/g, '_')
  if (
    !safeUserId
    || !SAFE_ID_PATTERN.test(workflowId)
    || !/^[a-f0-9]{24,64}$/.test(inputFingerprint)
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_WORKFLOW_ID_INVALID',
      '無法建立安全的完稿儲存 key',
    )
  }
  return `video/playground-ref/${safeUserId}/depth-rebuild/${workflowId}/${inputFingerprint}/final.mp4`
}

export interface SegmentTaskRow {
  id: string
  userId: string
  projectId: string
  type: string
  status: string
  result: unknown
  payload: unknown
}

export interface ResolvedDepthRebuildSegment {
  taskId: string
  resultKey: string
  contractVersion: 1 | 2
  workflowId: string
  segmentIndex: number
  segmentCount: number
  sourceVideoKey: string
  depthVideoKey: string
  startSeconds: number
  /** 供應商實際生成秒數；v2 可能比來源多一小段安全尾幀。 */
  durationSeconds: number
  sourceDurationSeconds: number
  outputDurationSeconds: number
  referenceVideoWindows: Array<{
    role: 'depth' | 'rgb'
    startSeconds: number
    durationSeconds: number
  }>
  modelKey: string
  resolution: string
  aspectRatio: string
  sourceAudioMode: SourceAudioMode
}

export interface ResolvedDepthRebuildWorkflowContract {
  segments: ResolvedDepthRebuildSegment[]
  segmentKeys: string[]
  inputFingerprint: string
  totalDurationSec: number
}

export interface FinalizeMediaProbe {
  durationSec: number
  width: number
  height: number
  hasVideo: boolean
  hasAudio: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Storage keys are data, never FFmpeg/fetch URLs. */
export function isFirstPartyStorageKey(value: string): boolean {
  if (
    !value
    || value.includes('://')
    || value.includes('..')
    || value.includes('\\')
    || value.includes('\0')
    || value.includes('?')
    || value.includes('#')
    || value.includes('%')
    || value.includes('//')
  ) {
    return false
  }
  return value.startsWith('images/') || value.startsWith('video/') || value.startsWith('voice/')
}

export function parseDepthRebuildFinalizeInput(raw: unknown): DepthRebuildFinalizeInput {
  if (!isRecord(raw)) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_PAYLOAD_INVALID',
      '完稿請求格式無效',
    )
  }
  const workflowId = typeof raw.workflowId === 'string' ? raw.workflowId.trim() : ''
  if (!SAFE_ID_PATTERN.test(workflowId)) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_WORKFLOW_ID_INVALID',
      'workflowId 必須是 1–128 字元的英數識別碼',
    )
  }
  if (
    !Array.isArray(raw.segmentRunIds)
    || raw.segmentRunIds.length < 1
    || raw.segmentRunIds.length > MAX_SEGMENT_RUNS
    || raw.segmentRunIds.some((id) => typeof id !== 'string' || !SAFE_ID_PATTERN.test(id.trim()))
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_RUNS_INVALID',
      `segmentRunIds 必須依序提供 1–${MAX_SEGMENT_RUNS} 筆有效任務識別碼`,
    )
  }
  const segmentRunIds = raw.segmentRunIds.map((id) => (id as string).trim())
  if (new Set(segmentRunIds).size !== segmentRunIds.length) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_DUPLICATE',
      'segmentRunIds 不可包含重複任務',
    )
  }
  const sourceVideoKey = typeof raw.sourceVideoKey === 'string' ? raw.sourceVideoKey.trim() : ''
  if (!isFirstPartyStorageKey(sourceVideoKey)) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SOURCE_KEY_INVALID',
      '原始影片必須使用本平台第一方儲存 key，不接受網址',
    )
  }
  if (!isSourceAudioMode(raw.sourceAudioMode)) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SOURCE_MODE_INVALID',
      'sourceAudioMode 必須是 preserve、reference-only 或 generate',
    )
  }
  return {
    workflowId,
    segmentRunIds,
    sourceVideoKey,
    sourceAudioMode: raw.sourceAudioMode,
  }
}

function resultUrls(result: unknown): unknown[] {
  if (!isRecord(result)) return []
  return Array.isArray(result.resultUrls) ? result.resultUrls : []
}

/** Preserve caller order; database `in` queries do not guarantee row order. */
export function resolveOrderedSegmentKeys(
  tasks: readonly SegmentTaskRow[],
  segmentRunIds: readonly string[],
  userId: string,
): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  return segmentRunIds.map((runId) => {
    const task = byId.get(runId)
    if (!task || task.userId !== userId) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_FOUND_OR_NOT_OWNED',
        `找不到可用的片段任務「${runId}」`,
      )
    }
    if (task.projectId !== PLAYGROUND_PROJECT_ID || task.type !== TASK_TYPE.PLAYGROUND_VIDEO) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_TYPE_INVALID',
        `任務「${runId}」不是 Playground 影片生成任務`,
      )
    }
    if (task.status !== TASK_STATUS.COMPLETED) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_COMPLETED',
        `片段任務「${runId}」尚未完成`,
      )
    }
    const key = resultUrls(task.result)[0]
    if (typeof key !== 'string' || !key.trim()) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_SEGMENT_RESULT_MISSING',
        `片段任務「${runId}」沒有可用結果`,
      )
    }
    const normalized = key.trim()
    if (!isFirstPartyStorageKey(normalized)) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_SEGMENT_RESULT_KEY_INVALID',
        `片段任務「${runId}」回傳了非第一方儲存結果`,
      )
    }
    return normalized
  })
}

function parseNonEmptyPayloadString(
  payload: Record<string, unknown>,
  field: string,
  taskId: string,
): string {
  const value = payload[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
      `片段任務「${taskId}」缺少固定的 ${field} 契約`,
    )
  }
  return value.trim()
}

function parseAdaptiveSegmentTaskContract(
  task: SegmentTaskRow,
  resultKey: string,
  payload: Record<string, unknown>,
): ResolvedDepthRebuildSegment {
  const identity = {
    workflowId: payload.workflowId,
    segmentIndex: payload.segmentIndex,
    segmentCount: payload.segmentCount,
  }
  const referenceVideos = Array.isArray(payload.referenceVideos)
    ? payload.referenceVideos
    : []
  const rawWindows = Array.isArray(payload.referenceVideoWindows)
    ? payload.referenceVideoWindows
    : []
  const strategy = payload.strategy
  const sourceVideoKey = typeof payload.sourceVideoKey === 'string'
    ? payload.sourceVideoKey.trim()
    : ''
  const sourceDurationSeconds = payload.sourceDurationSeconds
  const outputDurationSeconds = payload.outputDurationSeconds
  const taskDuration = payload.duration
  if (
    payload.normalizeSeedanceReferenceVideo !== true
    || !isDepthRebuildSegmentIdentity(identity)
    || identity.segmentIndex !== 0
    || identity.segmentCount !== 1
    || !['full-depth-full-rgb', 'full-depth-critical-rgb', 'full-depth-only'].includes(String(strategy))
    || !isFirstPartyStorageKey(sourceVideoKey)
    || typeof sourceDurationSeconds !== 'number'
    || !Number.isFinite(sourceDurationSeconds)
    || sourceDurationSeconds < 4
    || sourceDurationSeconds > 15
    || typeof outputDurationSeconds !== 'number'
    || !Number.isInteger(outputDurationSeconds)
    || outputDurationSeconds < 4
    || outputDurationSeconds > 15
    || outputDurationSeconds !== Math.ceil(sourceDurationSeconds)
    || typeof taskDuration !== 'number'
    || !Number.isFinite(taskDuration)
    || !depthRebuildTimesEqual(taskDuration, outputDurationSeconds)
    || referenceVideos.length < 1
    || referenceVideos.length > 2
    || referenceVideos.some((value) => typeof value !== 'string' || !isFirstPartyStorageKey(value))
    || new Set(referenceVideos).size !== referenceVideos.length
    || referenceVideos[0] === sourceVideoKey
    || rawWindows.length !== referenceVideos.length
    || !isSourceAudioMode(payload.sourceAudioMode)
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
      `任務「${task.id}」不是可完稿的自適應 Depth 工作流`,
    )
  }

  const referenceVideoWindows: ResolvedDepthRebuildSegment['referenceVideoWindows'] = []
  for (let index = 0; index < rawWindows.length; index += 1) {
    const rawWindow = rawWindows[index]
    const expectedRole = index === 0 ? 'depth' : 'rgb'
    if (!isRecord(rawWindow)) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
        `任務「${task.id}」的參考影片時間窗格式無效`,
      )
    }
    const startSeconds = rawWindow.startSeconds
    const durationSeconds = rawWindow.durationSeconds
    if (
      rawWindow.role !== expectedRole
      || typeof startSeconds !== 'number'
      || !Number.isFinite(startSeconds)
      || startSeconds < 0
      || typeof durationSeconds !== 'number'
      || !Number.isFinite(durationSeconds)
      || durationSeconds < (expectedRole === 'depth' ? 4 : 2)
      || durationSeconds > 15
      || startSeconds + durationSeconds > sourceDurationSeconds + 0.001
    ) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
        `任務「${task.id}」的 ${expectedRole.toUpperCase()} 時間窗無效`,
      )
    }
    referenceVideoWindows.push({ role: expectedRole, startSeconds, durationSeconds })
  }

  const depthWindow = referenceVideoWindows[0]
  const rgbWindow = referenceVideoWindows[1]
  const totalReferenceDuration = referenceVideoWindows.reduce(
    (sum, window) => sum + window.durationSeconds,
    0,
  )
  const fullRgb = Boolean(
    rgbWindow
    && depthRebuildTimesEqual(rgbWindow.startSeconds, 0)
    && depthRebuildTimesEqual(rgbWindow.durationSeconds, sourceDurationSeconds),
  )
  if (
    !depthWindow
    || !depthRebuildTimesEqual(depthWindow.startSeconds, 0)
    || !depthRebuildTimesEqual(depthWindow.durationSeconds, sourceDurationSeconds)
    || totalReferenceDuration > 15.001
    || (referenceVideoWindows.length === 2 && totalReferenceDuration > 14.501)
    || (rgbWindow && referenceVideos[1] !== sourceVideoKey)
    || (strategy === 'full-depth-only' && rgbWindow !== undefined)
    || (strategy === 'full-depth-full-rgb' && !fullRgb)
    || (strategy === 'full-depth-critical-rgb' && (!rgbWindow || fullRgb))
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
      `任務「${task.id}」的自適應引導策略、順序或總秒數不一致`,
    )
  }

  return {
    taskId: task.id,
    resultKey,
    contractVersion: 2,
    workflowId: identity.workflowId,
    segmentIndex: identity.segmentIndex,
    segmentCount: identity.segmentCount,
    sourceVideoKey,
    depthVideoKey: referenceVideos[0] as string,
    startSeconds: 0,
    durationSeconds: outputDurationSeconds,
    sourceDurationSeconds,
    outputDurationSeconds,
    referenceVideoWindows,
    modelKey: parseNonEmptyPayloadString(payload, 'modelKey', task.id),
    resolution: parseNonEmptyPayloadString(payload, 'resolution', task.id),
    aspectRatio: parseNonEmptyPayloadString(payload, 'aspectRatio', task.id),
    sourceAudioMode: payload.sourceAudioMode,
  }
}

function parseSegmentTaskContract(
  task: SegmentTaskRow,
  resultKey: string,
): ResolvedDepthRebuildSegment {
  if (!isRecord(task.payload)) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
      `片段任務「${task.id}」沒有可驗證的工作流契約`,
    )
  }
  const taskMeta = isRecord(task.payload.meta) ? task.payload.meta : null
  const payload = taskMeta && isRecord(taskMeta.depthRebuildContract)
    ? taskMeta.depthRebuildContract
    : null
  if (!payload || (payload.version !== 1 && payload.version !== 2)) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
      `片段任務「${task.id}」沒有持久化的 RGB＋Depth 工作流契約`,
    )
  }
  if (payload.version === 2) {
    return parseAdaptiveSegmentTaskContract(task, resultKey, payload)
  }
  const identity = {
    workflowId: payload.workflowId,
    segmentIndex: payload.segmentIndex,
    segmentCount: payload.segmentCount,
  }
  const windowValue = payload.referenceVideoWindow
  const referenceVideos = Array.isArray(payload.referenceVideos)
    ? payload.referenceVideos
    : []
  if (
    payload.depthRebuildDualGuide !== true
    || payload.normalizeSeedanceReferenceVideo !== true
    || !isDepthRebuildSegmentIdentity(identity)
    || !isRecord(windowValue)
    || referenceVideos.length !== 2
    || referenceVideos.some((value) => typeof value !== 'string' || !isFirstPartyStorageKey(value))
    || referenceVideos[0] === referenceVideos[1]
    || !isSourceAudioMode(payload.sourceAudioMode)
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
      `片段任務「${task.id}」不是可完稿的 RGB＋Depth 分段任務`,
    )
  }
  const startSeconds = windowValue.startSeconds
  const durationSeconds = windowValue.durationSeconds
  const taskDuration = payload.duration
  if (
    typeof startSeconds !== 'number'
    || !Number.isFinite(startSeconds)
    || startSeconds < 0
    || typeof durationSeconds !== 'number'
    || !Number.isFinite(durationSeconds)
    || durationSeconds < DEPTH_REBUILD_MIN_REFERENCE_DURATION_SEC
    || durationSeconds > DEPTH_REBUILD_MAX_REFERENCE_DURATION_SEC
    || startSeconds + durationSeconds > DEPTH_REBUILD_MAX_SOURCE_DURATION_SEC
    || typeof taskDuration !== 'number'
    || !Number.isFinite(taskDuration)
    || !depthRebuildTimesEqual(taskDuration, durationSeconds)
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
      `片段任務「${task.id}」的時間窗與輸出秒數不一致`,
    )
  }
  return {
    taskId: task.id,
    resultKey,
    contractVersion: 1,
    workflowId: identity.workflowId,
    segmentIndex: identity.segmentIndex,
    segmentCount: identity.segmentCount,
    sourceVideoKey: referenceVideos[0] as string,
    depthVideoKey: referenceVideos[1] as string,
    startSeconds,
    durationSeconds,
    sourceDurationSeconds: durationSeconds,
    outputDurationSeconds: durationSeconds,
    referenceVideoWindows: [
      { role: 'rgb', startSeconds, durationSeconds },
      { role: 'depth', startSeconds, durationSeconds },
    ],
    modelKey: parseNonEmptyPayloadString(payload, 'modelKey', task.id),
    resolution: parseNonEmptyPayloadString(payload, 'resolution', task.id),
    aspectRatio: parseNonEmptyPayloadString(payload, 'aspectRatio', task.id),
    sourceAudioMode: payload.sourceAudioMode,
  }
}

function buildDepthRebuildInputFingerprint(
  input: DepthRebuildFinalizeInput,
  segments: readonly ResolvedDepthRebuildSegment[],
): string {
  const canonical = {
    workflowId: input.workflowId,
    sourceVideoKey: input.sourceVideoKey,
    sourceAudioMode: input.sourceAudioMode,
    segments: segments.map((segment) => ({
      taskId: segment.taskId,
      resultKey: segment.resultKey,
      contractVersion: segment.contractVersion,
      segmentIndex: segment.segmentIndex,
      segmentCount: segment.segmentCount,
      sourceVideoKey: segment.sourceVideoKey,
      depthVideoKey: segment.depthVideoKey,
      startSeconds: segment.startSeconds,
      durationSeconds: segment.durationSeconds,
      sourceDurationSeconds: segment.sourceDurationSeconds,
      outputDurationSeconds: segment.outputDurationSeconds,
      referenceVideoWindows: segment.referenceVideoWindows,
      modelKey: segment.modelKey,
      resolution: segment.resolution,
      aspectRatio: segment.aspectRatio,
      sourceAudioMode: segment.sourceAudioMode,
    })),
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** Rejects ordinary Playground tasks and validates one immutable RGB＋Depth workflow. */
export function resolveDepthRebuildWorkflowContract(
  tasks: readonly SegmentTaskRow[],
  input: DepthRebuildFinalizeInput,
  userId: string,
): ResolvedDepthRebuildWorkflowContract {
  const segmentKeys = resolveOrderedSegmentKeys(tasks, input.segmentRunIds, userId)
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const segments = input.segmentRunIds.map((taskId, requestedIndex) => {
    const task = byId.get(taskId)
    if (!task) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_SEGMENT_RUN_NOT_FOUND_OR_NOT_OWNED',
        `找不到可用的片段任務「${taskId}」`,
      )
    }
    const segment = parseSegmentTaskContract(task, segmentKeys[requestedIndex])
    if (segment.workflowId !== input.workflowId) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_WORKFLOW_MISMATCH',
        `片段任務「${taskId}」不屬於指定工作流`,
      )
    }
    if (
      segment.segmentIndex !== requestedIndex
      || segment.segmentCount !== input.segmentRunIds.length
      || segment.sourceVideoKey !== input.sourceVideoKey
    ) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
        `片段任務「${taskId}」的順序、片段總數或 RGB 來源不一致`,
      )
    }
    return segment
  })

  const expectedSegmentAudioMode: SourceAudioMode = input.sourceAudioMode === 'generate'
    ? 'generate'
    : 'reference-only'
  const first = segments[0]
  let expectedStartSeconds = 0
  for (const segment of segments) {
    if (
      !first
      || segment.contractVersion !== first.contractVersion
      || segment.depthVideoKey !== first.depthVideoKey
      || segment.modelKey !== first.modelKey
      || segment.resolution !== first.resolution
      || segment.aspectRatio !== first.aspectRatio
      || segment.sourceAudioMode !== expectedSegmentAudioMode
      || !depthRebuildTimesEqual(segment.startSeconds, expectedStartSeconds)
    ) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
        'RGB＋Depth 片段的來源、模型、畫質、音訊策略或連續時間窗不一致',
      )
    }
    expectedStartSeconds += segment.sourceDurationSeconds
  }
  if (expectedStartSeconds > DEPTH_REBUILD_MAX_SOURCE_DURATION_SEC) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_CONTRACT_INVALID',
      `RGB＋Depth 工作流不可超過 ${DEPTH_REBUILD_MAX_SOURCE_DURATION_SEC} 秒`,
    )
  }

  return {
    segments,
    segmentKeys,
    inputFingerprint: buildDepthRebuildInputFingerprint(input, segments),
    totalDurationSec: expectedStartSeconds,
  }
}

function evenDimension(value: number): number {
  const floored = Math.max(2, Math.floor(value))
  return floored % 2 === 0 ? floored : floored - 1
}

function assertMediaDimensions(media: FinalizeMediaProbe, label: string): void {
  const pixels = media.width * media.height
  if (
    !media.hasVideo
    || !Number.isFinite(media.width)
    || !Number.isFinite(media.height)
    || media.width <= 0
    || media.height <= 0
    || media.width > MAX_MEDIA_DIMENSION
    || media.height > MAX_MEDIA_DIMENSION
    || !Number.isFinite(pixels)
    || pixels > MAX_MEDIA_PIXELS
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED',
      `${label} 的畫面尺寸超過伺服器完稿上限`,
    )
  }
}

export function assertDepthRebuildMediaLimits(input: {
  segmentMedia: readonly FinalizeMediaProbe[]
  sourceMedia: FinalizeMediaProbe | null
  expectedDurations: readonly number[]
  targetDurationSec?: number
}): void {
  if (
    input.segmentMedia.length < 1
    || input.segmentMedia.length !== input.expectedDurations.length
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_INVALID',
      '完稿片段與工作流時間窗數量不一致',
    )
  }
  let actualTotalDuration = 0
  let expectedTotalDuration = 0
  input.segmentMedia.forEach((media, index) => {
    assertMediaDimensions(media, `第 ${index + 1} 段影片`)
    const expectedDuration = input.expectedDurations[index]
    if (
      !Number.isFinite(media.durationSec)
      || media.durationSec <= 0
      || !Number.isFinite(expectedDuration)
      || expectedDuration <= 0
      || Math.abs(media.durationSec - expectedDuration) > MEDIA_DURATION_TOLERANCE_SEC
    ) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED',
        `第 ${index + 1} 段影片秒數與已驗證的工作流時間窗不一致`,
      )
    }
    actualTotalDuration += media.durationSec
    expectedTotalDuration += expectedDuration
  })
  if (
    actualTotalDuration > DEPTH_REBUILD_MAX_SOURCE_DURATION_SEC + MEDIA_DURATION_TOLERANCE_SEC
    || actualTotalDuration > expectedTotalDuration + (MEDIA_DURATION_TOLERANCE_SEC * input.segmentMedia.length)
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED',
      '完稿片段總秒數超過工作流上限',
    )
  }
  const targetDurationSec = input.targetDurationSec ?? expectedTotalDuration
  if (
    !Number.isFinite(targetDurationSec)
    || targetDurationSec <= 0
    || targetDurationSec > DEPTH_REBUILD_MAX_SOURCE_DURATION_SEC
    || targetDurationSec > expectedTotalDuration + MEDIA_DURATION_TOLERANCE_SEC
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED',
      '完稿目標秒數與已驗證的工作流不一致',
    )
  }
  if (input.sourceMedia) {
    assertMediaDimensions(input.sourceMedia, '原始影片')
    if (
      !Number.isFinite(input.sourceMedia.durationSec)
      || input.sourceMedia.durationSec <= 0
      || input.sourceMedia.durationSec > DEPTH_REBUILD_MAX_SOURCE_DURATION_SEC + MEDIA_DURATION_TOLERANCE_SEC
      || Math.abs(input.sourceMedia.durationSec - targetDurationSec) > MEDIA_DURATION_TOLERANCE_SEC
    ) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED',
        '原始影片秒數與已驗證的工作流時間窗不一致',
      )
    }
  }
}

/** Hard concat only: no overlap, dissolve or timing-altering transition. */
export function buildDepthRebuildFinalizeFfmpegArgs(input: {
  segmentPaths: readonly string[]
  segmentMedia: readonly FinalizeMediaProbe[]
  sourceVideoPath: string | null
  sourceMedia: FinalizeMediaProbe | null
  sourceAudioMode: SourceAudioMode
  targetDurationSec?: number
  outputPath: string
}): string[] {
  if (input.segmentPaths.length === 0 || input.segmentPaths.length !== input.segmentMedia.length) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_INVALID',
      '完稿片段數量無效',
    )
  }
  if (input.segmentMedia.some((media) => !media.hasVideo || media.durationSec <= 0)) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_INVALID',
      '其中一段生成結果不是有效影片',
    )
  }
  if (
    input.sourceAudioMode === 'preserve'
    && (!input.sourceVideoPath || !input.sourceMedia?.hasAudio || input.sourceMedia.durationSec <= 0)
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SOURCE_AUDIO_MISSING',
      '保留原音模式需要原始影片音軌',
    )
  }
  if (input.sourceAudioMode === 'generate' && input.segmentMedia.some((media) => !media.hasAudio)) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_GENERATED_AUDIO_MISSING',
      'AI 生音模式下每段生成影片都必須包含音軌',
    )
  }

  const width = evenDimension(input.segmentMedia[0]?.width ?? 0)
  const height = evenDimension(input.segmentMedia[0]?.height ?? 0)
  const durations = input.segmentMedia.map((media) => media.durationSec)
  const segmentDuration = durations.reduce((sum, duration) => sum + duration, 0)
  const outputDuration = input.targetDurationSec
    ?? (input.sourceAudioMode === 'preserve' ? input.sourceMedia!.durationSec : segmentDuration)
  if (
    !Number.isFinite(outputDuration)
    || outputDuration <= 0
    || outputDuration > DEPTH_REBUILD_MAX_SOURCE_DURATION_SEC
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_LIMIT_EXCEEDED',
      '完稿輸出秒數超過工作流上限',
    )
  }
  const videoNormalize = input.segmentPaths.map((_, index) => (
    `[${index}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p,` +
    `settb=AVTB,setpts=PTS-STARTPTS[v${index}]`
  ))
  const videoConcat = `${input.segmentPaths.map((_, index) => `[v${index}]`).join('')}concat=n=${input.segmentPaths.length}:v=1:a=0[joinedv]`
  const filters = [
    ...videoNormalize,
    videoConcat,
    `[joinedv]tpad=stop_mode=clone:stop_duration=${outputDuration.toFixed(3)},` +
      `trim=duration=${outputDuration.toFixed(3)},setpts=PTS-STARTPTS[outv]`,
  ]

  if (input.sourceAudioMode === 'generate') {
    const audioNormalize = durations.map((duration, index) => (
      `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `apad,atrim=duration=${duration.toFixed(3)},asetpts=PTS-STARTPTS[a${index}]`
    ))
    const audioConcat = `${input.segmentPaths.map((_, index) => `[a${index}]`).join('')}concat=n=${input.segmentPaths.length}:v=0:a=1[outa]`
    filters.push(...audioNormalize, audioConcat)
  } else if (input.sourceAudioMode === 'preserve') {
    const sourceIndex = input.segmentPaths.length
    filters.push(
      `[${sourceIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `atrim=duration=${outputDuration.toFixed(3)},asetpts=PTS-STARTPTS[outa]`,
    )
  }

  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...input.segmentPaths.flatMap((segmentPath) => ['-i', segmentPath]),
    ...(input.sourceAudioMode === 'preserve' && input.sourceVideoPath
      ? ['-i', input.sourceVideoPath]
      : []),
    '-filter_complex', filters.join(';'),
    '-map', '[outv]',
    ...(input.sourceAudioMode === 'reference-only' ? [] : ['-map', '[outa]']),
    '-t', outputDuration.toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    ...(input.sourceAudioMode === 'reference-only'
      ? ['-an']
      : ['-c:a', 'aac', '-b:a', '192k']),
    '-movflags', '+faststart',
    input.outputPath,
  ]
  return args
}

async function downloadStorageKeyToFile(
  key: string,
  outputPath: string,
  remainingTotalBytes: number,
): Promise<number> {
  if (!isFirstPartyStorageKey(key)) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SEGMENT_RESULT_KEY_INVALID',
      '媒體來源不是第一方儲存 key',
    )
  }
  const effectiveMaxBytes = Math.min(MAX_INPUT_BYTES, remainingTotalBytes)
  if (effectiveMaxBytes <= 0) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_INPUT_TOO_LARGE',
      '完稿輸入影片合計不可超過 384 MB',
    )
  }
  let response: Response
  try {
    response = await fetch(toFetchableUrl(getSignedUrl(key, 3600)), {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
  } catch (error) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_DOWNLOAD_FAILED',
      `影片下載失敗：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok || !response.body) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_DOWNLOAD_FAILED',
      `影片下載失敗（HTTP ${response.status}）`,
    )
  }
  const declaredBytes = Number(response.headers.get('content-length') ?? 0)
  if (Number.isFinite(declaredBytes) && declaredBytes > effectiveMaxBytes) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_INPUT_TOO_LARGE',
      '完稿輸入影片超過單檔或合計容量上限',
    )
  }
  let receivedBytes = 0
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength
      if (receivedBytes > effectiveMaxBytes) {
        throw new DepthRebuildFinalizeError(
          'DEPTH_REBUILD_FINALIZE_INPUT_TOO_LARGE',
          '完稿輸入影片超過單檔或合計容量上限',
        )
      }
      controller.enqueue(chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body.pipeThrough(limiter) as never),
    createWriteStream(outputPath),
  )
  if (receivedBytes === 0) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_DOWNLOAD_FAILED',
      '下載到的影片是空檔案',
    )
  }
  return receivedBytes
}

async function probeMedia(inputPath: string): Promise<FinalizeMediaProbe> {
  let stdout: string
  try {
    const result = await execFileAsync(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries', 'format=duration:stream=codec_type,width,height',
        '-of', 'json',
        inputPath,
      ],
      { timeout: MEDIA_TOOL_TIMEOUT_MS, maxBuffer: MEDIA_TOOL_MAX_BUFFER },
    )
    stdout = result.stdout
  } catch (error) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_INVALID',
      `無法讀取影片資訊：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_INVALID',
      'ffprobe 回傳無效資料',
    )
  }
  if (!isRecord(parsed)) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_INVALID',
      '無法讀取影片資訊',
    )
  }
  const streams = Array.isArray(parsed.streams) ? parsed.streams.filter(isRecord) : []
  const video = streams.find((stream) => stream.codec_type === 'video')
  const durationSec = Number(isRecord(parsed.format) ? parsed.format.duration : NaN)
  const width = Number(video?.width)
  const height = Number(video?.height)
  if (
    !video
    || !Number.isFinite(durationSec)
    || durationSec <= 0
    || !Number.isFinite(width)
    || width <= 0
    || !Number.isFinite(height)
    || height <= 0
  ) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_MEDIA_INVALID',
      '影片缺少有效視訊軌、尺寸或秒數',
    )
  }
  return {
    durationSec,
    width,
    height,
    hasVideo: true,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  }
}

export async function finalizeDepthRebuildWorkflow(
  userId: string,
  input: DepthRebuildFinalizeInput,
): Promise<DepthRebuildFinalizeResult> {
  const tasks = await prisma.task.findMany({
    where: {
      id: { in: input.segmentRunIds },
      userId,
    },
    select: {
      id: true,
      userId: true,
      projectId: true,
      type: true,
      status: true,
      result: true,
      payload: true,
    },
  })
  const workflow = resolveDepthRebuildWorkflowContract(tasks, input, userId)
  const sourceGuard = await filterAuthorizedStorageReferences([
    input.sourceVideoKey,
    workflow.segments[0].depthVideoKey,
  ], userId)
  if (sourceGuard.safe.length !== 2 || sourceGuard.rejected.length > 0) {
    throw new DepthRebuildFinalizeError(
      'DEPTH_REBUILD_FINALIZE_SOURCE_NOT_AUTHORIZED',
      'RGB 或 Depth 來源不屬於目前使用者可讀的第一方儲存空間',
    )
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'depth-rebuild-finalize-'))
  try {
    const segmentPaths = workflow.segmentKeys.map((_, index) => path.join(dir, `segment-${index}.mp4`))
    let totalInputBytes = 0
    for (let index = 0; index < workflow.segmentKeys.length; index += 1) {
      totalInputBytes += await downloadStorageKeyToFile(
        workflow.segmentKeys[index],
        segmentPaths[index],
        MAX_TOTAL_INPUT_BYTES - totalInputBytes,
      )
    }

    let sourceVideoPath: string | null = null
    if (input.sourceAudioMode === 'preserve') {
      sourceVideoPath = path.join(dir, 'source.mp4')
      totalInputBytes += await downloadStorageKeyToFile(
        sourceGuard.safe[0],
        sourceVideoPath,
        MAX_TOTAL_INPUT_BYTES - totalInputBytes,
      )
    }

    const segmentMedia = await Promise.all(segmentPaths.map(probeMedia))
    let sourceMedia: FinalizeMediaProbe | null = null
    if (sourceVideoPath) {
      sourceMedia = await probeMedia(sourceVideoPath)
      if (!sourceMedia.hasAudio) {
        throw new DepthRebuildFinalizeError(
          'DEPTH_REBUILD_FINALIZE_SOURCE_AUDIO_MISSING',
          '原始影片沒有可保留的音軌',
        )
      }
    }
    assertDepthRebuildMediaLimits({
      segmentMedia,
      sourceMedia,
      expectedDurations: workflow.segments.map((segment) => segment.durationSeconds),
      targetDurationSec: workflow.totalDurationSec,
    })
    const outputPath = path.join(dir, 'final.mp4')
    try {
      await execFileAsync(
        'ffmpeg',
        buildDepthRebuildFinalizeFfmpegArgs({
          segmentPaths,
          segmentMedia,
          sourceVideoPath,
          sourceMedia,
          sourceAudioMode: input.sourceAudioMode,
          targetDurationSec: workflow.totalDurationSec,
          outputPath,
        }),
        { timeout: MEDIA_TOOL_TIMEOUT_MS, maxBuffer: MEDIA_TOOL_MAX_BUFFER },
      )
    } catch (error) {
      if (error instanceof DepthRebuildFinalizeError) throw error
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_MEDIA_TOOL_FAILED',
        `伺服器完稿失敗：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const outputStat = await stat(outputPath)
    if (outputStat.size <= 0) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_OUTPUT_EMPTY',
        '完稿輸出是空檔案',
      )
    }
    if (outputStat.size > MAX_OUTPUT_BYTES) {
      throw new DepthRebuildFinalizeError(
        'DEPTH_REBUILD_FINALIZE_OUTPUT_TOO_LARGE',
        '完稿輸出不可超過 128 MB',
      )
    }
    const resultKey = buildDepthRebuildResultKey(
      userId,
      input.workflowId,
      workflow.inputFingerprint,
    )
    await uploadToCOS(await readFile(outputPath), resultKey)
    return {
      workflowId: input.workflowId,
      inputFingerprint: workflow.inputFingerprint,
      resultKey,
      durationSec: workflow.totalDurationSec,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
