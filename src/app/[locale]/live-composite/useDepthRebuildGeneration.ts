'use client'

import { useEffect, useRef, useState } from 'react'
import {
  useSubmitPlaygroundRun,
  useUploadPlaygroundReference,
  type PlaygroundRunRow,
} from '@/lib/query/mutations/playground-mutations'
import { requestJsonWithError } from '@/lib/query/mutations/mutation-shared'
import { waitForTaskResult } from '@/lib/task/client'
import {
  depthRebuildAspectRatio,
  depthRebuildDurationSeconds,
} from './lib/depth-rebuild-workflow'
import { buildDepthRebuildReferenceMap } from './lib/depth-rebuild-reference-map'
import {
  clearPendingDepthRebuildGeneration,
  DEPTH_REBUILD_STORAGE_REQUIRED_MESSAGE,
  depthRebuildGenerationStorageKey,
  readPendingDepthRebuildGeneration,
  writePendingDepthRebuildGeneration,
} from './lib/depth-rebuild-generation-storage'
import type { TrackBModelKey } from './lib/atlascloud-r2v-contract'
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
  videoHasAudio: boolean | null
  workspaceId: string | null
  depthGuide: LocalDepthGuide | null
  characters: readonly DepthRebuildCharacterReference[]
  sceneReferences: readonly DepthRebuildSceneReference[]
  prompt: string
  modelKey: TrackBModelKey
  resolution: string
  validationError: string | null
  onError: (message: string | null) => void
}

interface RunDetailResponse {
  run?: PlaygroundRunRow | null
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

function resolveRunDetail(
  detail: RunDetailResponse,
  runId: string,
): DepthRebuildResult | null {
  const run = detail.run
  if (!run) {
    throw new SubmittedRunTerminalError(
      `找不到已提交的深度重建任務：${runId}；可清除這筆舊紀錄後重新建立`,
    )
  }
  if (run.status === 'failed') {
    throw new SubmittedRunTerminalError(
      run.errorMessage
        ? `深度重建供應商執行失敗：${run.errorMessage}`
        : `深度重建供應商執行失敗（任務 ${runId}）`,
    )
  }
  if (run.status !== 'succeeded') return null
  const resultUrl = run.resultUrls?.[0]
  if (!resultUrl) {
    throw new Error('重建任務已完成，但結果影片尚未可用；請稍後恢復同一任務')
  }
  return { runId, url: resultUrl }
}

export function useDepthRebuildGeneration({
  persistenceScopeKey,
  metadata,
  videoHasAudio,
  workspaceId,
  depthGuide,
  characters,
  sceneReferences,
  prompt,
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
  const [generationStatus, setGenerationStatus] = useState<DepthRebuildGenerationStatus>('idle')
  const [generationProgress, setGenerationProgress] = useState<number | null>(null)
  const [result, setResult] = useState<DepthRebuildResult | null>(null)
  const [submittedRunId, setSubmittedRunId] = useState<string | null>(
    initialPending?.runId ?? null,
  )
  const [terminalFailure, setTerminalFailure] = useState(false)
  const inFlightRef = useRef(false)
  const submittedRunIdRef = useRef<string | null>(initialPending?.runId ?? null)
  const clientRequestKeyRef = useRef<string | null>(initialPending?.requestKey ?? null)
  const persistenceStorageKeyRef = useRef(persistenceStorageKey)
  const activeAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    activeAbortControllerRef.current?.abort()
  }, [])

  useEffect(() => {
    if (persistenceStorageKeyRef.current === persistenceStorageKey) return
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
    const pending = readPendingDepthRebuildGeneration(persistenceStorageKey)
    persistenceStorageKeyRef.current = persistenceStorageKey
    submittedRunIdRef.current = pending?.runId ?? null
    clientRequestKeyRef.current = pending?.requestKey ?? null
    setSubmittedRunId(pending?.runId ?? null)
    setTerminalFailure(false)
    setResult(null)
    setGenerationProgress(null)
    setGenerationStatus('idle')
  }, [persistenceStorageKey])

  function resetResult(): void {
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
    submittedRunIdRef.current = null
    clientRequestKeyRef.current = null
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
  ): Promise<DepthRebuildResult> {
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
          setGenerationProgress(typeof task.progress === 'number' ? task.progress : null)
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

  async function generate(): Promise<DepthRebuildResult | null> {
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
      const existingRunId = submittedRunIdRef.current
      if (existingRunId) {
        setGenerationStatus('generating')
        const resumedResult = await waitForSubmittedRun(
          existingRunId,
          abortController.signal,
          true,
        )
        setResult(resumedResult)
        setGenerationProgress(100)
        setGenerationStatus('succeeded')
        setTerminalFailure(false)
        return resumedResult
      }

      if (validationError) {
        onError(validationError)
        setGenerationStatus('failed')
        return null
      }
      const referenceMap = buildDepthRebuildReferenceMap(characters, sceneReferences)
      if (!metadata || !depthGuide || referenceMap.ordered.length === 0) {
        onError('深度重建設定不完整')
        setGenerationStatus('failed')
        return null
      }

      const clientRequestKey =
        clientRequestKeyRef.current ?? createClientRequestKey()
      if (!clientRequestKeyRef.current) {
        const stored = writePendingDepthRebuildGeneration(
          persistenceStorageKeyRef.current,
          { requestKey: clientRequestKey },
        )
        if (!stored) throw new Error(DEPTH_REBUILD_STORAGE_REQUIRED_MESSAGE)
        clientRequestKeyRef.current = clientRequestKey
      }

      setGenerationStatus('uploading')
      const [uploadedDepth, ...uploadedImages] = await Promise.all([
        upload.mutateAsync({
          file: depthGuide.file,
          type: 'video',
          signal: abortController.signal,
        }),
        ...referenceMap.ordered.map((reference) => upload.mutateAsync({
          file: reference.image.file,
          type: 'image',
          signal: abortController.signal,
        })),
      ])
      throwIfAborted(abortController.signal)
      setGenerationStatus('submitting')
      const submitted = await submit.mutateAsync({
        prompt,
        referenceVideos: [uploadedDepth.key],
        referenceImages: uploadedImages.map((image) => image.key),
        referenceImageNames: referenceMap.ordered.map((reference) => reference.name),
        outputType: 'video',
        modelKey,
        resolution,
        normalizeSeedanceReferenceVideo: true,
        aspectRatio: depthRebuildAspectRatio(metadata.width, metadata.height),
        durationSec: depthRebuildDurationSeconds(metadata.duration),
        generateAudio: videoHasAudio !== true,
        ...(videoHasAudio === true ? { preserveSourceAudio: true } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        idempotencyKey: clientRequestKey,
        signal: abortController.signal,
      })
      const nextRunId = submitted.run.id
      submittedRunIdRef.current = nextRunId
      writePendingDepthRebuildGeneration(
        persistenceStorageKeyRef.current,
        { requestKey: clientRequestKey, runId: nextRunId },
      )
      setSubmittedRunId(nextRunId)
      setTerminalFailure(false)
      setGenerationStatus('generating')
      const nextResult = await waitForSubmittedRun(
        nextRunId,
        abortController.signal,
        false,
      )
      setResult(nextResult)
      setGenerationProgress(100)
      setGenerationStatus('succeeded')
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
    generationStatus === 'uploading' ||
    generationStatus === 'submitting' ||
    generationStatus === 'generating'

  return {
    generationStatus,
    generationProgress,
    submittedRunId,
    canResume: Boolean(submittedRunId && !result && !terminalFailure && !generationBusy),
    result,
    generationBusy,
    generate,
    resetResult,
  }
}
