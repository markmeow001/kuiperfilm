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
    }: {
      file: File
      type: 'image' | 'video' | 'audio'
    }): Promise<UploadResult> => {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', type)
      return await requestJsonWithError(
        '/api/playground/upload-reference',
        { method: 'POST', body: formData },
        '參考素材上傳失敗',
      ) as UploadResult
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
  outputType: 'image' | 'video'
  modelKey: string
  resolution?: string
  aspectRatio?: string
  durationSec?: number
  workspaceId?: string | null
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
      submission: PlaygroundRunSubmission,
    ): Promise<PlaygroundRunResult> => {
      return await requestJsonWithError(
        '/api/playground/run',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(submission),
        },
        '生成失敗',
      ) as PlaygroundRunResult
    },
    onSuccess: (_data, submission) => {
      queryClient.invalidateQueries({
        queryKey: ['playgroundRuns', submission.workspaceId ?? 'personal'],
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
