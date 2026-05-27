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
      type: 'image' | 'video'
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
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export function usePlaygroundRuns(workspaceId?: string | null) {
  return useQuery({
    queryKey: ['playgroundRuns', workspaceId ?? 'personal'],
    queryFn: async (): Promise<{ runs: PlaygroundRunRow[] }> => {
      const url = workspaceId
        ? `/api/playground/runs?workspaceId=${encodeURIComponent(workspaceId)}`
        : '/api/playground/runs'
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
