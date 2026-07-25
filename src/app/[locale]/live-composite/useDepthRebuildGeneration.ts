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
import type { TrackBModelKey } from './lib/atlascloud-r2v-contract'
import type { VideoMetadata } from './live-composite-types'
import type {
  DepthRebuildGenerationStatus,
  DepthRebuildResult,
  LocalDepthGuide,
  LocalDepthReferenceImage,
} from './depth-rebuild-assets'

interface UseDepthRebuildGenerationOptions {
  metadata: VideoMetadata | null
  videoHasAudio: boolean | null
  workspaceId: string | null
  depthGuide: LocalDepthGuide | null
  characterImage: LocalDepthReferenceImage | null
  sceneImage: LocalDepthReferenceImage | null
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
  if (!run) throw new Error(`找不到已提交的深度重建任務：${runId}`)
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
  metadata,
  videoHasAudio,
  workspaceId,
  depthGuide,
  characterImage,
  sceneImage,
  prompt,
  modelKey,
  resolution,
  validationError,
  onError,
}: UseDepthRebuildGenerationOptions) {
  const upload = useUploadPlaygroundReference()
  const submit = useSubmitPlaygroundRun()
  const [generationStatus, setGenerationStatus] = useState<DepthRebuildGenerationStatus>('idle')
  const [generationProgress, setGenerationProgress] = useState<number | null>(null)
  const [result, setResult] = useState<DepthRebuildResult | null>(null)
  const [submittedRunId, setSubmittedRunId] = useState<string | null>(null)
  const [terminalFailure, setTerminalFailure] = useState(false)
  const inFlightRef = useRef(false)
  const submittedRunIdRef = useRef<string | null>(null)
  const clientRequestKeyRef = useRef<string | null>(null)
  const activeAbortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => () => {
    activeAbortControllerRef.current?.abort()
  }, [])

  function resetResult(): void {
    activeAbortControllerRef.current?.abort()
    activeAbortControllerRef.current = null
    submittedRunIdRef.current = null
    clientRequestKeyRef.current = null
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
      if (!metadata || !depthGuide || !characterImage) {
        onError('深度重建設定不完整')
        setGenerationStatus('failed')
        return null
      }

      setGenerationStatus('uploading')
      const [uploadedDepth, uploadedCharacter, uploadedScene] = await Promise.all([
        upload.mutateAsync({
          file: depthGuide.file,
          type: 'video',
          signal: abortController.signal,
        }),
        upload.mutateAsync({
          file: characterImage.file,
          type: 'image',
          signal: abortController.signal,
        }),
        sceneImage
          ? upload.mutateAsync({
              file: sceneImage.file,
              type: 'image',
              signal: abortController.signal,
            })
          : Promise.resolve(null),
      ])
      throwIfAborted(abortController.signal)
      setGenerationStatus('submitting')
      const clientRequestKey =
        clientRequestKeyRef.current ?? createClientRequestKey()
      clientRequestKeyRef.current = clientRequestKey
      const submitted = await submit.mutateAsync({
        prompt,
        referenceVideos: [uploadedDepth.key],
        referenceImages: [
          uploadedCharacter.key,
          ...(uploadedScene ? [uploadedScene.key] : []),
        ],
        referenceImageNames: [
          '新角色',
          ...(uploadedScene ? ['新場景'] : []),
        ],
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
