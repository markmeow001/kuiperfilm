/**
 * Phase T-1 (2026-05-27) — Playground client hooks.
 *
 * useUploadPlaygroundReference(type='image'|'video')  — multipart upload
 * useSubmitPlaygroundRun()                            — POST /api/playground/run
 * usePlaygroundRuns(workspaceId?)                     — GET list
 *
 * onSuccess invalidates the runs query so the history rail refreshes after
 * a submit. Each hook uses the existing requestJsonWithError pattern so
 * errors flow through the unified TASK_STILL_PROCESSING / friendly-error
 * pipeline.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJsonWithError } from './mutation-shared'
import { waitForTaskResult } from '@/lib/task/client'
import type { ReconstructionAnalysisResult } from '@/lib/playground/reconstruction-contract'
import type { SourceAudioMode } from '@/lib/playground/source-audio-contract'

interface UploadResult {
  success: boolean
  key: string
  signedUrl: string
}

export function useUploadPlaygroundReference() {
  return useMutation({
    mutationFn: async ({
      file,
      type,
      signal,
    }: {
      file: File
      type: 'image' | 'video' | 'audio'
      signal?: AbortSignal
    }): Promise<UploadResult> => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', type)
      return await requestJsonWithError(
        '/api/playground/upload-reference',
        { method: 'POST', body: formData, signal },
        '參考素材上傳失敗',
      ) as UploadResult
    },
  })
}

export function useAnalyzePlaygroundVideo() {
  return useMutation({
    mutationFn: async ({
      videoKey,
      locale,
    }: {
      videoKey: string
      locale: string
    }): Promise<ReconstructionAnalysisResult> => {
      const submitted = await requestJsonWithError(
        '/api/playground/analyze-video',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoKey, locale }),
        },
        '實拍鏡頭分析失敗',
      ) as { taskId?: string }
      if (!submitted.taskId) throw new Error('分析任務沒有回傳 taskId')
      return await waitForTaskResult(submitted.taskId, {
        intervalMs: 1500,
        timeoutMs: 5 * 60 * 1000,
      }) as unknown as ReconstructionAnalysisResult
    },
  })
}

export interface PlaygroundRunSubmission {
  prompt: string
  referenceImages?: string[]
  referenceVideos?: string[]
  referenceText?: string
  /** 首尾帧: last-frame image (own COS key or https URL). First frame = referenceImages[0]. */
  lastFrameUrl?: string
  /** Kling O3 具名主体绑定（≤6 × 1-4 图）；prompt 打名字，worker 换 <<<element_N>>>。 */
  elements?: Array<{ name: string; imageKeys: string[] }>
  /** 非 Kling video：與 referenceImages 對齊的命名陣列，worker 前置「參考圖對應」映射表。 */
  referenceImageNames?: Array<string | null>
  /** video 音效開關（🔊 chip，2026-07-12）。缺省 = 各 generator 預設（開）。 */
  generateAudio?: boolean
  /** 實拍重建：抽出參考影片音軌供模型遵循，並在結果上重新封裝原始對白音軌。 */
  preserveSourceAudio?: boolean
  /**
   * 深度重建來源音訊策略。新流程只傳這個欄位，不可再同時傳
   * preserveSourceAudio / generateAudio；舊流程未傳時維持既有行為。
   */
  sourceAudioMode?: SourceAudioMode
  /** 深度重建：worker 將唯一參考影片正規化為 AtlasCloud Seedance 2.0 可接受的 MP4/H264。 */
  normalizeSeedanceReferenceVideo?: boolean
  /** 局部重绘遮罩（own COS key；透明区=重绘区）。需搭配 referenceImages[0] 底图。 */
  maskImage?: string
  outputType: 'image' | 'video'
  modelKey: string
  resolution?: string
  aspectRatio?: string
  durationSec?: number
  workspaceId?: string | null
}

export interface PlaygroundRunRequest extends PlaygroundRunSubmission {
  /** HTTP 重試沿用同一值；只送 header，不進入 provider payload。 */
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface PlaygroundRunResult {
  success: boolean
  run: {
    id: string
    status: string
    resultUrl: string
    outputType: string
    modelKey: string
    createdAt: string
    completedAt: string
  }
}

export function useSubmitPlaygroundRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      request: PlaygroundRunRequest,
    ): Promise<PlaygroundRunResult> => {
      const {
        idempotencyKey,
        signal,
        ...submission
      } = request
      return await requestJsonWithError(
        '/api/playground/run',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
          },
          body: JSON.stringify(submission),
          signal,
        },
        '生成失敗',
      ) as PlaygroundRunResult
    },
    onSuccess: (_data, request) => {
      queryClient.invalidateQueries({
        queryKey: ['playgroundRuns', request.workspaceId ?? 'personal'],
      })
    },
  })
}

export interface PlaygroundRunRow {
  id: string
  prompt: string
  outputType: 'image' | 'video'
  modelKey: string
  status: 'pending' | 'running' | 'succeeded' | 'failed'
  resultUrls: string[] | null
  /** 视频结果尾帧(签名 URL)— 画布续镜链用;非视频/未抽出为 null/缺省。 */
  tailFrameUrl?: string | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export interface PlaygroundCostEstimate {
  amountUsd: number | null
  unit: 'flat' | 'per_second' | 'capability' | 'unknown'
  detail?: string
  perSecond?: number
  perGeneration?: number
}

/**
 * Phase T-3 (2026-05-27) — Playground cost estimate.
 * Fetches /api/playground/estimate-cost for the current selection.
 * Returns null amount when pricing is unknown; UI shows "—" in that case.
 */
export function usePlaygroundCostEstimate(params: {
  modelKey: string
  outputType: 'image' | 'video'
  durationSec?: number
  resolution?: string
  generationMode?: string
}) {
  const { modelKey, outputType, durationSec, resolution, generationMode } = params
  return useQuery({
    queryKey: ['playgroundCostEstimate', modelKey, outputType, durationSec, resolution, generationMode],
    enabled: Boolean(modelKey),
    queryFn: async (): Promise<PlaygroundCostEstimate> => {
      const sp = new URLSearchParams({ modelKey, outputType })
      if (durationSec) sp.set('durationSec', String(durationSec))
      if (resolution) sp.set('resolution', resolution)
      if (generationMode) sp.set('generationMode', generationMode)
      return await requestJsonWithError(
        `/api/playground/estimate-cost?${sp.toString()}`,
        { method: 'GET' },
        'Failed to estimate cost',
      ) as PlaygroundCostEstimate
    },
    // Pricing is essentially static — only changes on deploy. 5min stale is plenty.
    staleTime: 5 * 60 * 1000,
  })
}

export function usePlaygroundRuns(workspaceId?: string | null, limit?: number) {
  return useQuery({
    queryKey: ['playgroundRuns', workspaceId ?? 'personal', limit ?? 'default'],
    queryFn: async (): Promise<{ runs: PlaygroundRunRow[] }> => {
      const params = new URLSearchParams()
      if (workspaceId) params.set('workspaceId', workspaceId)
      if (limit) params.set('limit', String(limit))
      const qs = params.toString()
      const url = qs ? `/api/playground/runs?${qs}` : '/api/playground/runs'
      return await requestJsonWithError(
        url,
        { method: 'GET' },
        'Failed to fetch playground runs',
      ) as { runs: PlaygroundRunRow[] }
    },
    refetchInterval: (query) => {
      // Auto-refetch if any run is pending/running (worker hasn't finished).
      const data = query.state.data as { runs: PlaygroundRunRow[] } | undefined
      const hasInFlight = data?.runs?.some((r) => r.status === 'pending' || r.status === 'running')
      return hasInFlight ? 3000 : false
    },
  })
}
