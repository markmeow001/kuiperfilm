'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useSubmitPlaygroundRun,
  useUploadPlaygroundReference,
  type PlaygroundRunRow,
} from '@/lib/query/mutations/playground-mutations'
import { requestJsonWithError } from '@/lib/query/mutations/mutation-shared'
import { waitForTaskResult } from '@/lib/task/client'
import { depthRebuildAspectRatio } from './lib/depth-rebuild-workflow'
import { buildDepthRebuildReferenceMap } from './lib/depth-rebuild-reference-map'
import {
  clearPendingDepthRebuildGeneration,
  DEPTH_REBUILD_STORAGE_REQUIRED_MESSAGE,
  depthRebuildGenerationStorageKey,
  readPendingDepthRebuildGeneration,
  writePendingDepthRebuildGeneration,
  type PendingDepthRebuildGeneration,
  type PendingDepthRebuildSegment,
  type PendingDepthRebuildUploads,
} from './lib/depth-rebuild-generation-storage'
import { formatDepthRebuildTerminalError } from './lib/depth-rebuild-errors'
import type { DepthRebuildGuidePlan } from './lib/depth-rebuild-guide-plan'
import type { TrackBModelKey } from './lib/atlascloud-r2v-contract'
import type { SourceAudioMode } from '@/lib/playground/source-audio-contract'
import type { VideoMetadata } from './live-composite-types'
import type {
  DepthRebuildCharacterReference,
  DepthRebuildGenerationStatus,
  DepthRebuildResult,
  DepthRebuildSceneReference,
  LocalDepthGuide,
} from './depth-rebuild-assets'

interface UseDepthRebuildGenerationOptions {
  persistenceScopeKey: string
  metadata: VideoMetadata | null
  sourceVideoFile: File | null
  sourceVideoStorageKey: string | null
  sourceAudioMode: SourceAudioMode
  workspaceId: string | null
  depthGuide: LocalDepthGuide | null
  characters: readonly DepthRebuildCharacterReference[]
  sceneReferences: readonly DepthRebuildSceneReference[]
  guidePlan: DepthRebuildGuidePlan | null
  segmentPrompts: readonly string[]
  modelKey: TrackBModelKey
  resolution: string
  validationError: string | null
  onError: (message: string | null) => void
}

interface GenerateDepthRebuildOptions {
  depthGuideOverride?: LocalDepthGuide
  validationErrorOverride?: string | null
}

interface RunDetailResponse {
  run?: PlaygroundRunRow | null
}

interface CompletedSegmentResult extends DepthRebuildResult {
  tailFrameUrl: string | null
}

interface FinalizeResponse {
  runId: string
  resultKey: string
  url: string
}

interface SignedFinalResultResponse {
  resultKey: string
  url: string
}

class SubmittedRunTerminalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubmittedRunTerminalError'
  }
}

function isAbortError(caught: unknown): boolean {
  return caught instanceof Error && caught.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('Depth rebuild submission aborted')
  error.name = 'AbortError'
  throw error
}

function createClientRequestKey(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new Error('目前瀏覽器無法建立安全的請求識別碼，已停止送出')
  }
  return crypto.randomUUID()
}

function latestRunId(pending: PendingDepthRebuildGeneration | null): string | null {
  if (!pending) return null
  for (let index = pending.segments.length - 1; index >= 0; index -= 1) {
    const runId = pending.segments[index]?.runId
    if (runId) return runId
  }
  return null
}

function hasSubmittedWorkflow(pending: PendingDepthRebuildGeneration | null): boolean {
  return Boolean(
    pending?.finalResult
    || pending?.uploads
    || latestRunId(pending)
    || pending?.segments.some((segment) => segment.submissionAttempted),
  )
}

function resolveRunDetail(
  detail: RunDetailResponse,
  runId: string,
): CompletedSegmentResult | null {
  const run = detail.run
  if (!run) {
    throw new SubmittedRunTerminalError(
      `找不到已提交的深度重建任務：${runId}；可清除這筆舊紀錄後重新建立`,
    )
  }
  if (run.status === 'failed') {
    throw new SubmittedRunTerminalError(
      formatDepthRebuildTerminalError(run.errorMessage, runId),
    )
  }
  if (run.status !== 'succeeded') return null
  const resultUrl = run.resultUrls?.[0]
  if (!resultUrl) {
    throw new Error('重建任務已完成，但結果影片尚未可用；請稍後恢復同一任務')
  }
  return {
    runId,
    url: resultUrl,
    tailFrameUrl: run.tailFrameUrl ?? null,
  }
}

export function useDepthRebuildGeneration({
  persistenceScopeKey,
  metadata,
  sourceVideoFile,
  sourceVideoStorageKey,
  sourceAudioMode,
  workspaceId,
  depthGuide,
  characters,
  sceneReferences,
  guidePlan,
  segmentPrompts,
  modelKey,
  resolution,
  validationError,
  onError,
}: UseDepthRebuildGenerationOptions) {
  const persistenceStorageKey = depthRebuildGenerationStorageKey(persistenceScopeKey)
  const [initialPending] = useState(() => (
    readPendingDepthRebuildGeneration(persistenceStorageKey)
  ))
  const upload = useUploadPlaygroundReference()
  const submit = useSubmitPlaygroundRun()
  const [generationStatus, setGenerationStatus] = useState<DepthRebuildGenerationStatus>(
    initialPending?.finalResult ? 'generating' : 'idle',
  )
  const [generationProgress, setGenerationProgress] = useState<number | null>(
    initialPending?.finalResult ? 99 : null,
  )
  const [result, setResult] = useState<DepthRebuildResult | null>(null)
  const [pendingSnapshot, setPendingSnapshot] = useState<PendingDepthRebuildGeneration | null>(
    initialPending,
  )
  const [submittedRunId, setSubmittedRunId] = useState<string | null>(
    latestRunId(initialPending),
  )
  const [terminalFailure, setTerminalFailure] = useState(false)
  const inFlightRef = useRef(false)
  const pendingRef = useRef<PendingDepthRebuildGeneration | null>(initialPending)
  const persistenceStorageKeyRef = useRef(persistenceStorageKey)
  const activeAbortControllerRef = useRef<AbortController | null>(null)
  const resultRefreshAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    activeAbortControllerRef.current?.abort()
    resultRefreshAbortControllerRef.current?.abort()
  }, [])

  useEffect(() => {
    if (persistenceStorageKeyRef.current === persistenceStorageKey) return
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
    resultRefreshAbortControllerRef.current?.abort()
    resultRefreshAbortControllerRef.current = null
    const pending = readPendingDepthRebuildGeneration(persistenceStorageKey)
    persistenceStorageKeyRef.current = persistenceStorageKey
    pendingRef.current = pending
    setPendingSnapshot(pending)
    setSubmittedRunId(latestRunId(pending))
    setTerminalFailure(false)
    setResult(null)
    setGenerationProgress(pending?.finalResult ? 99 : null)
    setGenerationStatus(pending?.finalResult ? 'generating' : 'idle')
  }, [persistenceStorageKey])

  const persistPending = useCallback((pending: PendingDepthRebuildGeneration): void => {
    const stored = writePendingDepthRebuildGeneration(
      persistenceStorageKeyRef.current,
      pending,
    )
    if (!stored) throw new Error(DEPTH_REBUILD_STORAGE_REQUIRED_MESSAGE)
    pendingRef.current = pending
    setPendingSnapshot(pending)
  }, [])

  const refreshFinalResultUrl = useCallback(async (
    pending: PendingDepthRebuildGeneration,
    signal: AbortSignal,
  ): Promise<DepthRebuildResult> => {
    const stored = pending.finalResult
    if (!stored) throw new Error('找不到已完成的深度重建結果紀錄')
    const params = new URLSearchParams({ resultKey: stored.resultKey })
    const refreshed = await requestJsonWithError<SignedFinalResultResponse>(
      `/api/live-composite/depth-rebuild/finalize?${params.toString()}`,
      { method: 'GET', cache: 'no-store', signal },
      '深度重建已完成，但無法更新結果影片網址',
    )
    throwIfAborted(signal)
    if (refreshed.resultKey !== stored.resultKey) {
      throw new Error('伺服器回傳的深度重建結果與已保存紀錄不一致')
    }
    const finalResult = { ...stored, url: refreshed.url }
    persistPending({ ...pending, finalResult })
    return { runId: finalResult.runId, url: finalResult.url }
  }, [persistPending])

  useEffect(() => {
    const pending = pendingRef.current
    if (!pending?.finalResult) return
    const abortController = new AbortController()
    resultRefreshAbortControllerRef.current = abortController
    setGenerationStatus('generating')
    setGenerationProgress(99)
    void refreshFinalResultUrl(pending, abortController.signal)
      .then((refreshed) => {
        setResult(refreshed)
        setGenerationStatus('succeeded')
        setGenerationProgress(100)
        setTerminalFailure(false)
      })
      .catch((caught: unknown) => {
        if (isAbortError(caught)) return
        setGenerationStatus('failed')
        setGenerationProgress(null)
        setTerminalFailure(false)
        onError(caught instanceof Error
          ? caught.message
          : '深度重建已完成，但無法更新結果影片網址')
      })
      .finally(() => {
        if (resultRefreshAbortControllerRef.current === abortController) {
          resultRefreshAbortControllerRef.current = null
        }
      })
    return () => abortController.abort()
  }, [onError, persistenceStorageKey, refreshFinalResultUrl])

  function resetResult(): void {
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
    resultRefreshAbortControllerRef.current?.abort()
    resultRefreshAbortControllerRef.current = null
    pendingRef.current = null
    setPendingSnapshot(null)
    clearPendingDepthRebuildGeneration(persistenceStorageKeyRef.current)
    setSubmittedRunId(null)
    setTerminalFailure(false)
    setResult(null)
    setGenerationProgress(null)
    setGenerationStatus('idle')
  }

  async function fetchRunDetail(
    runId: string,
    signal: AbortSignal,
  ): Promise<RunDetailResponse> {
    return requestJsonWithError<RunDetailResponse>(
      `/api/playground/runs/${runId}`,
      { method: 'GET', cache: 'no-store', signal },
      '無法讀取已提交的深度重建任務',
    )
  }

  async function waitForSubmittedRun(
    runId: string,
    signal: AbortSignal,
    preflight: boolean,
    segmentIndex: number,
    segmentCount: number,
  ): Promise<CompletedSegmentResult> {
    if (preflight) {
      const existing = resolveRunDetail(await fetchRunDetail(runId, signal), runId)
      if (existing) return existing
    }

    try {
      await waitForTaskResult(runId, {
        intervalMs: 1500,
        timeoutMs: 30 * 60 * 1000,
        signal,
        onTaskUpdate: (task) => {
          if (typeof task.progress !== 'number') return
          setGenerationProgress(
            Math.min(99, ((segmentIndex * 100) + task.progress) / segmentCount),
          )
        },
      })
    } catch (pollError) {
      if (isAbortError(pollError)) throw pollError
      try {
        const recovered = resolveRunDetail(await fetchRunDetail(runId, signal), runId)
        if (recovered) return recovered
      } catch (detailError) {
        if (isAbortError(detailError) || detailError instanceof SubmittedRunTerminalError) {
          throw detailError
        }
      }
      throw pollError
    }

    const completed = resolveRunDetail(await fetchRunDetail(runId, signal), runId)
    if (!completed) {
      throw new Error('深度重建輪詢已結束，但任務仍未完成；請恢復同一任務')
    }
    return completed
  }

  function createPendingWorkflow(): PendingDepthRebuildGeneration {
    if (!metadata || !guidePlan) {
      throw new Error('自適應 Depth 引導計畫尚未建立')
    }
    if (segmentPrompts.length !== 1 || !segmentPrompts[0]) {
      throw new Error('自適應 Depth Prompt 與送出計畫不一致，請重新建立 Prompt')
    }
    const pending: PendingDepthRebuildGeneration = {
      workflowId: createClientRequestKey(),
      segments: [{ requestKey: createClientRequestKey() }],
      submission: {
        contractVersion: 2,
        segmentPrompts: [...segmentPrompts],
        segmentWindows: [{
          startSeconds: 0,
          durationSeconds: guidePlan.sourceDurationSeconds,
        }],
        guidePlan: {
          version: 2,
          strategy: guidePlan.strategy,
          sourceDurationSeconds: guidePlan.sourceDurationSeconds,
          outputDurationSeconds: guidePlan.outputDurationSeconds,
          criticalCenterSeconds: guidePlan.secondary?.criticalCenterSeconds
            ?? guidePlan.sourceDurationSeconds / 2,
          referenceVideoWindows: [
            {
              role: 'depth',
              startSeconds: guidePlan.fullDepth.sourceStartSeconds,
              durationSeconds: guidePlan.fullDepth.durationSeconds,
            },
            ...(guidePlan.secondary ? [{
              role: 'rgb' as const,
              startSeconds: guidePlan.secondary.sourceStartSeconds,
              durationSeconds: guidePlan.secondary.durationSeconds,
            }] : []),
          ],
        },
        modelKey,
        resolution,
        aspectRatio: depthRebuildAspectRatio(metadata.width, metadata.height),
        sourceAudioMode,
        ...(workspaceId ? { workspaceId } : {}),
      },
    }
    persistPending(pending)
    return pending
  }

  async function ensureUploads(
    pending: PendingDepthRebuildGeneration,
    signal: AbortSignal,
    activeDepthGuide: LocalDepthGuide | null,
  ): Promise<PendingDepthRebuildUploads> {
    if (pending.uploads) return pending.uploads
    const referenceMap = buildDepthRebuildReferenceMap(characters, sceneReferences)
    if (!activeDepthGuide || referenceMap.ordered.length === 0) {
      throw new Error('本機素材尚未完整上傳；請清除舊任務並重新建立')
    }
    if (!sourceVideoStorageKey && !sourceVideoFile) {
      throw new Error('找不到可信的原始 RGB 影片；請清除舊任務並重新上傳原片')
    }

    setGenerationStatus('uploading')
    const sourceUpload = sourceVideoStorageKey
      ? Promise.resolve({ key: sourceVideoStorageKey })
      : upload.mutateAsync({
        file: sourceVideoFile as File,
        type: 'video',
        signal,
      })
    const [uploadedSource, uploadedDepth, ...uploadedImages] = await Promise.all([
      sourceUpload,
      upload.mutateAsync({
        file: activeDepthGuide.file,
        type: 'video',
        signal,
      }),
      ...referenceMap.ordered.map((reference) => upload.mutateAsync({
        file: reference.image.file,
        type: 'image',
        signal,
      })),
    ])
    throwIfAborted(signal)
    const uploads: PendingDepthRebuildUploads = {
      sourceVideoKey: uploadedSource.key,
      depthVideoKey: uploadedDepth.key,
      imageKeys: uploadedImages.map((image) => image.key),
      imageNames: referenceMap.ordered.map((reference) => reference.name),
    }
    persistPending({ ...pending, uploads })
    return uploads
  }

  async function finalizeWorkflow(
    pending: PendingDepthRebuildGeneration,
    uploads: PendingDepthRebuildUploads,
    signal: AbortSignal,
  ): Promise<DepthRebuildResult> {
    const segmentRunIds = pending.segments.map((segment) => segment.runId)
    if (segmentRunIds.some((runId) => !runId)) {
      throw new Error('RGB＋Depth 分段任務尚未全部完成，不能合併')
    }
    const finalized = await requestJsonWithError<FinalizeResponse>(
      '/api/live-composite/depth-rebuild/finalize',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: pending.workflowId,
          segmentRunIds,
          sourceVideoKey: uploads.sourceVideoKey,
          sourceAudioMode: pending.submission.sourceAudioMode,
        }),
        signal,
      },
      '分段影片已完成，但最終合併失敗',
    )
    const finalResult = {
      runId: finalized.runId,
      resultKey: finalized.resultKey,
      url: finalized.url,
    }
    persistPending({ ...pending, uploads, finalResult })
    return { runId: finalResult.runId, url: finalResult.url }
  }

  async function generate(
    options: GenerateDepthRebuildOptions = {},
  ): Promise<DepthRebuildResult | null> {
    if (inFlightRef.current) {
      onError('已有一個深度重建任務正在送出或生成，請勿重複提交')
      return null
    }
    onError(null)
    setResult(null)
    setGenerationProgress(null)
    inFlightRef.current = true
    const abortController = new AbortController()
    activeAbortControllerRef.current = abortController
    try {
      let pending = pendingRef.current
      if (pending?.finalResult) {
        setGenerationStatus('generating')
        setGenerationProgress(99)
        const refreshed = await refreshFinalResultUrl(pending, abortController.signal)
        setResult(refreshed)
        setGenerationProgress(100)
        setGenerationStatus('succeeded')
        return refreshed
      }
      if (pending && !hasSubmittedWorkflow(pending)) {
        clearPendingDepthRebuildGeneration(persistenceStorageKeyRef.current)
        pendingRef.current = null
        setPendingSnapshot(null)
        pending = null
        setSubmittedRunId(null)
        setTerminalFailure(false)
      }
      const activeValidationError = options.validationErrorOverride !== undefined
        ? options.validationErrorOverride
        : validationError
      if (!pending && activeValidationError) {
        onError(activeValidationError)
        setGenerationStatus('failed')
        return null
      }
      pending ??= createPendingWorkflow()
      const uploads = await ensureUploads(
        pending,
        abortController.signal,
        options.depthGuideOverride ?? depthGuide,
      )
      pending = pendingRef.current ?? { ...pending, uploads }

      let previousSegment: CompletedSegmentResult | null = null
      for (let index = 0; index < pending.segments.length; index += 1) {
        throwIfAborted(abortController.signal)
        const segment: PendingDepthRebuildSegment | undefined = pending.segments[index]
        const window = pending.submission.segmentWindows[index]
        const segmentPrompt = pending.submission.segmentPrompts[index]
        if (!segment || !window || !segmentPrompt) {
          throw new Error(`第 ${index + 1} 段的已保存送出設定不完整；請清除後重新建立`)
        }

        let runId: string | undefined = segment.runId
        if (!runId) {
          const adaptiveGuide = pending.submission.contractVersion === 2
            ? pending.submission.guidePlan
            : undefined
          if (pending.submission.contractVersion === 2 && !adaptiveGuide) {
            throw new Error('已保存的自適應 Depth 引導契約不完整；請清除後重新建立')
          }
          if (!adaptiveGuide && index > 0 && !previousSegment?.tailFrameUrl) {
            throw new Error(
              `第 ${index} 段已完成，但沒有可用尾幀；為避免付費生成錯位，已停止送出下一段`,
            )
          }
          if (!segment.submissionAttempted) {
            pending = {
              ...pending,
              segments: pending.segments.map((entry, segmentIndex) => (
                segmentIndex === index
                  ? { ...entry, submissionAttempted: true }
                  : entry
              )),
            }
            persistPending(pending)
          }
          setGenerationStatus('submitting')
          const adaptiveReferenceVideos = adaptiveGuide
            ? [
                uploads.depthVideoKey,
                ...(adaptiveGuide.referenceVideoWindows.length === 2
                  ? [uploads.sourceVideoKey]
                  : []),
              ]
            : null
          const submitted = await submit.mutateAsync({
            prompt: segmentPrompt,
            referenceVideos: adaptiveReferenceVideos
              ?? [uploads.sourceVideoKey, uploads.depthVideoKey],
            referenceImages: [
              ...uploads.imageKeys,
              ...(!adaptiveGuide && previousSegment?.tailFrameUrl
                ? [previousSegment.tailFrameUrl]
                : []),
            ],
            referenceImageNames: [
              ...uploads.imageNames,
              ...(!adaptiveGuide && previousSegment?.tailFrameUrl
                ? ['前段末幀連續性參考']
                : []),
            ],
            outputType: 'video',
            modelKey: pending.submission.modelKey,
            resolution: pending.submission.resolution,
            normalizeSeedanceReferenceVideo: true,
            ...(adaptiveGuide ? {
              depthRebuildGuideContract: {
                version: 2 as const,
                strategy: adaptiveGuide.strategy,
                sourceVideoKey: uploads.sourceVideoKey,
                sourceDurationSeconds: adaptiveGuide.sourceDurationSeconds,
                outputDurationSeconds: adaptiveGuide.outputDurationSeconds,
                referenceVideoWindows: adaptiveGuide.referenceVideoWindows,
              },
            } : {
              depthRebuildDualGuide: true,
              referenceVideoWindow: window,
            }),
            workflowId: pending.workflowId,
            ...(!adaptiveGuide ? {
              segmentIndex: index,
              segmentCount: pending.segments.length,
            } : {}),
            aspectRatio: pending.submission.aspectRatio,
            durationSec: adaptiveGuide?.outputDurationSeconds ?? window.durationSeconds,
            sourceAudioMode: pending.submission.sourceAudioMode === 'preserve'
              ? 'reference-only'
              : pending.submission.sourceAudioMode,
            ...(pending.submission.workspaceId
              ? { workspaceId: pending.submission.workspaceId }
              : {}),
            idempotencyKey: segment.requestKey,
            signal: abortController.signal,
          })
          runId = submitted.run.id
          pending = {
            ...pending,
            segments: pending.segments.map((
              entry: PendingDepthRebuildSegment,
              segmentIndex: number,
            ): PendingDepthRebuildSegment => (
              segmentIndex === index ? { ...entry, runId } : entry
            )),
          }
          persistPending(pending)
          setSubmittedRunId(runId)
        } else {
          setSubmittedRunId(runId)
        }

        setTerminalFailure(false)
        setGenerationStatus('generating')
        previousSegment = await waitForSubmittedRun(
          runId,
          abortController.signal,
          Boolean(segment.runId),
          index,
          pending.segments.length,
        )
      }

      setGenerationStatus('generating')
      const nextResult = await finalizeWorkflow(pending, uploads, abortController.signal)
      setResult(nextResult)
      setGenerationProgress(100)
      setGenerationStatus('succeeded')
      setTerminalFailure(false)
      return nextResult
    } catch (caught) {
      if (isAbortError(caught)) return null
      setGenerationStatus('failed')
      setTerminalFailure(caught instanceof SubmittedRunTerminalError)
      onError(caught instanceof Error ? caught.message : '深度重建生成失敗')
      return null
    } finally {
      inFlightRef.current = false
      if (activeAbortControllerRef.current === abortController) {
        activeAbortControllerRef.current = null
      }
    }
  }

  const generationBusy =
    generationStatus === 'uploading'
    || generationStatus === 'submitting'
    || generationStatus === 'generating'
  const hasRecoverableWorkflow = hasSubmittedWorkflow(pendingSnapshot)

  return {
    generationStatus,
    generationProgress,
    submittedRunId,
    canResume: Boolean(
      hasRecoverableWorkflow && !result && !terminalFailure && !generationBusy
    ),
    result,
    generationBusy,
    generate,
    resetResult,
  }
}
