'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useGenerationJobs } from '../hooks/useGenerationJobs'
import { queryKeys } from '../keys'
import type { JobStatus, JobView } from '@/lib/task/job-view'
import { useCancelGenerationJob } from './task-mutations'
import {
  invalidateQueryTemplates,
  requestJsonWithError,
  type MutationRequestError,
} from './mutation-shared'

export type AutoGroupVariables = { episodeId: string }

/** The route acknowledges a durable Task; grouping is returned by the worker. */
export interface AutoGroupResult {
  success: boolean
  async: true
  taskId: string
  runId?: string | null
  status: string
  deduped: boolean
}

export type AutoGroupUiStatus =
  | 'idle'
  | 'submitting'
  | 'reconciling'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AutoGroupMessages {
  submitFailed: string
  outcomeUnknown: string
  invalidResponse: string
  cancelFailed: string
}

export interface AutoGroupOptions {
  canCancelTasks: boolean
  messages: AutoGroupMessages
}

type AutoGroupBaseMutation = UseMutationResult<AutoGroupResult, Error, AutoGroupVariables>

export interface AutoGroupMutation {
  mutate: AutoGroupBaseMutation['mutate']
  mutateAsync: AutoGroupBaseMutation['mutateAsync']
  reset: AutoGroupBaseMutation['reset']
  isPending: boolean
  isError: boolean
  error: Error | null
  status: AutoGroupUiStatus
  progress: number
  taskId: string | null
  latestJob: JobView | null
  canCancel: boolean
  cancelCurrent: () => Promise<void>
  isCancelling: boolean
}

type SubmittedTask = {
  episodeId: string
  taskId: string
}

type SubmissionAttempt = {
  episodeId: string
  baselineTaskIds: string[]
}

type ReconciliationAttempt = SubmissionAttempt & {
  error: OutcomeUnknownError
}

type OutcomeUnknownError = MutationRequestError & {
  outcomeUnknown: true
}

const SAFE_MESSAGES: AutoGroupMessages = {
  submitFailed: 'Auto-group request failed',
  outcomeUnknown: 'Connection lost while submitting. Checking the task queue…',
  invalidResponse: 'The server returned an invalid task response. Checking the task queue…',
  cancelFailed: 'Cancel request failed',
}

function nonEmptyMessage(value: string, fallback: string): string {
  return value.trim() || fallback
}

function taskFailure(job: JobView | null): MutationRequestError | null {
  if (!job?.error) return null
  const error = new Error(job.error.message) as MutationRequestError
  error.status = job.error.httpStatus
  error.payload = {
    error: {
      code: job.error.code,
      message: job.error.message,
      retryable: job.error.retryable,
    },
  }
  return error
}

function hasHttpStatus(error: unknown): error is MutationRequestError {
  return error instanceof Error
    && typeof (error as MutationRequestError).status === 'number'
}

function isDefinitiveHttpRejection(error: unknown): error is MutationRequestError {
  if (!hasHttpStatus(error)) return false
  const status = error.status
  return typeof status === 'number'
    && status >= 400
    && status < 500
    && status !== 408
}

function isOutcomeUnknownError(error: unknown): error is OutcomeUnknownError {
  return error instanceof Error
    && (error as OutcomeUnknownError).outcomeUnknown === true
}

function outcomeUnknownError(message: string): OutcomeUnknownError {
  const error = new Error(message) as OutcomeUnknownError
  error.outcomeUnknown = true
  return error
}

function withoutEpisode<T>(record: Record<string, T>, episodeId: string): Record<string, T> {
  if (!(episodeId in record)) return record
  const next = { ...record }
  delete next[episodeId]
  return next
}

function isAutoGroupResult(value: unknown): value is AutoGroupResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Record<string, unknown>
  return result.success === true
    && result.async === true
    && typeof result.taskId === 'string'
    && result.taskId.trim().length > 0
    && typeof result.status === 'string'
    && typeof result.deduped === 'boolean'
}

function toUiStatus(
  jobStatus: JobStatus | null,
  submitting: boolean,
  reconciling: boolean,
  waitingForSubmittedTask: boolean,
): AutoGroupUiStatus {
  if (submitting) return 'submitting'
  if (reconciling) return 'reconciling'
  if (waitingForSubmittedTask) return 'queued'
  if (jobStatus === 'queued') return 'queued'
  if (jobStatus === 'running') return 'running'
  if (jobStatus === 'completed') return 'completed'
  if (jobStatus === 'failed') return 'failed'
  if (jobStatus === 'cancelled') return 'cancelled'
  return 'idle'
}

/**
 * Submit once, then follow the durable Task through the shared Job Center API.
 * Unknown POST outcomes reconcile against newly observed task IDs instead of
 * encouraging a second request that could duplicate paid work.
 */
export function useAutoGroupMultiShot(
  projectId: string,
  episodeId: string | null | undefined,
  options: AutoGroupOptions,
): AutoGroupMutation {
  const queryClient = useQueryClient()
  const [submittedTasks, setSubmittedTasks] = useState<Record<string, SubmittedTask>>({})
  const [reconciliationAttempts, setReconciliationAttempts] = useState<
    Record<string, ReconciliationAttempt>
  >({})
  const completedInvalidationKeysRef = useRef(new Set<string>())
  const messages = {
    submitFailed: nonEmptyMessage(options.messages.submitFailed, SAFE_MESSAGES.submitFailed),
    outcomeUnknown: nonEmptyMessage(options.messages.outcomeUnknown, SAFE_MESSAGES.outcomeUnknown),
    invalidResponse: nonEmptyMessage(options.messages.invalidResponse, SAFE_MESSAGES.invalidResponse),
    cancelFailed: nonEmptyMessage(options.messages.cancelFailed, SAFE_MESSAGES.cancelFailed),
  }
  const jobs = useGenerationJobs({
    projectId,
    episodeId,
    types: ['auto_group_multi_shot'],
    limit: 10,
    enabled: Boolean(episodeId),
  })
  const fetchedJobs = useMemo(
    () => jobs.data?.pages.flatMap((page) => page.tasks) ?? [],
    [jobs.data?.pages],
  )
  const cancelMutation = useCancelGenerationJob(projectId, messages.cancelFailed)
  const cancelMutationError = cancelMutation.error
  const resetCancelMutation = cancelMutation.reset

  const mutation = useMutation<
    AutoGroupResult,
    Error,
    AutoGroupVariables,
    SubmissionAttempt
  >({
    onMutate: (variables) => {
      cancelMutation.reset()
      const attempt = {
        episodeId: variables.episodeId,
        baselineTaskIds: fetchedJobs.map((job) => job.id),
      }
      return attempt
    },
    mutationFn: async ({ episodeId: requestedEpisodeId }) => {
      try {
        const result = await requestJsonWithError<unknown>(
          `/api/novel-promotion/${projectId}/episodes/${requestedEpisodeId}/auto-group-multi-shot`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          },
          messages.submitFailed,
        )
        if (!isAutoGroupResult(result)) {
          throw outcomeUnknownError(messages.invalidResponse)
        }
        return result
      } catch (error) {
        if (isOutcomeUnknownError(error) || isDefinitiveHttpRejection(error)) throw error
        throw outcomeUnknownError(messages.outcomeUnknown)
      }
    },
    onSuccess: async (result, variables) => {
      setReconciliationAttempts((current) => withoutEpisode(current, variables.episodeId))
      setSubmittedTasks((current) => ({
        ...current,
        [variables.episodeId]: { episodeId: variables.episodeId, taskId: result.taskId },
      }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.generationJobs.all() }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.tasks.all(projectId),
          exact: false,
        }),
      ])
    },
    onError: async (error, _variables, context) => {
      if (context && isOutcomeUnknownError(error)) {
        setReconciliationAttempts((current) => ({
          ...current,
          [context.episodeId]: { ...context, error },
        }))
        await queryClient.invalidateQueries({ queryKey: queryKeys.generationJobs.all() })
        return
      }
      if (context) {
        setReconciliationAttempts((current) => withoutEpisode(current, context.episodeId))
      }
    },
  })

  const reconcilingAttempt = episodeId
    ? reconciliationAttempts[episodeId] ?? null
    : null
  const reconciledJob = reconcilingAttempt
    ? fetchedJobs.find((job) => !reconcilingAttempt.baselineTaskIds.includes(job.id)) ?? null
    : null
  const submittedTaskId = episodeId ? submittedTasks[episodeId]?.taskId ?? null : null
  const trackedTaskId = submittedTaskId ?? reconciledJob?.id ?? null
  const reconcilingWithoutTask = Boolean(reconcilingAttempt && !reconciledJob)
  const latestJob = trackedTaskId
    ? fetchedJobs.find((job) => job.id === trackedTaskId) ?? null
    : reconcilingWithoutTask
      ? null
      : fetchedJobs[0] ?? null
  const waitingForSubmittedTask = Boolean(submittedTaskId && !latestJob)
  const submittingCurrentEpisode = mutation.isPending
    && mutation.variables?.episodeId === episodeId
  const status = toUiStatus(
    latestJob?.status ?? null,
    submittingCurrentEpisode,
    reconcilingWithoutTask,
    waitingForSubmittedTask,
  )
  const progress = status === 'completed'
    ? 100
    : latestJob?.progress ?? 0
  const taskError = status === 'failed' ? taskFailure(latestJob) : null
  const reconciliationError = reconciledJob ? null : reconcilingAttempt?.error ?? null
  const mutationOutcomeAlreadyReconciled = Boolean(
    submittedTaskId && isOutcomeUnknownError(mutation.error),
  )
  const mutationError = mutation.variables?.episodeId === episodeId
    && !reconcilingAttempt
    && !reconciledJob
    && !mutationOutcomeAlreadyReconciled
    ? mutation.error
    : null
  const cancelOutcomeConfirmed = Boolean(
    latestJob?.status === 'cancelled' || latestJob?.status === 'completed',
  )
  const cancelError = cancelOutcomeConfirmed ? null : cancelMutationError
  const error = reconciliationError
    ?? mutationError
    ?? cancelError
    ?? taskError
    ?? jobs.error
    ?? null
  const taskId = latestJob?.id ?? trackedTaskId
  const canCancel = Boolean(
    options.canCancelTasks
    && taskId
    && (waitingForSubmittedTask || latestJob?.canCancel),
  )

  useEffect(() => {
    if (status !== 'completed' || !episodeId || !latestJob) return
    const invalidationKey = `${episodeId}:${latestJob.id}`
    if (completedInvalidationKeysRef.current.has(invalidationKey)) return
    completedInvalidationKeysRef.current.add(invalidationKey)
    void invalidateQueryTemplates(queryClient, [
      queryKeys.projectData(projectId),
      queryKeys.storyboards.all(episodeId),
    ])
  }, [episodeId, latestJob, projectId, queryClient, status])

  useEffect(() => {
    if (!episodeId || !reconciledJob) return
    setSubmittedTasks((current) => ({
      ...current,
      [episodeId]: { episodeId, taskId: reconciledJob.id },
    }))
    setReconciliationAttempts((current) => withoutEpisode(current, episodeId))
  }, [episodeId, reconciledJob])

  useEffect(() => {
    if (!cancelOutcomeConfirmed || !cancelMutationError) return
    resetCancelMutation()
  }, [cancelMutationError, cancelOutcomeConfirmed, resetCancelMutation])

  function mutate(
    variables: AutoGroupVariables,
    mutateOptions?: Parameters<AutoGroupBaseMutation['mutate']>[1],
  ): void {
    if (status === 'reconciling') return
    mutation.mutate(variables, mutateOptions)
  }

  async function mutateAsync(
    variables: AutoGroupVariables,
    mutateOptions?: Parameters<AutoGroupBaseMutation['mutateAsync']>[1],
  ): Promise<AutoGroupResult> {
    if (status === 'reconciling') throw new Error(messages.outcomeUnknown)
    return await mutation.mutateAsync(variables, mutateOptions)
  }

  function reset(): void {
    if (episodeId) {
      setReconciliationAttempts((current) => withoutEpisode(current, episodeId))
      setSubmittedTasks((current) => withoutEpisode(current, episodeId))
    }
    cancelMutation.reset()
    mutation.reset()
  }

  async function cancelCurrent(): Promise<void> {
    if (!taskId || !canCancel) return
    try {
      await cancelMutation.mutateAsync(taskId)
    } finally {
      await jobs.refetch()
    }
  }

  return {
    mutate,
    mutateAsync,
    reset,
    isPending: status === 'submitting'
      || status === 'reconciling'
      || status === 'queued'
      || status === 'running',
    isError: status !== 'reconciling' && Boolean(error),
    error,
    status,
    progress,
    taskId,
    latestJob,
    canCancel,
    cancelCurrent,
    isCancelling: cancelMutation.isPending,
  }
}
