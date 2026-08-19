'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { requestJsonWithError } from './mutation-shared'

export type CancelGenerationJobResponse = {
    success: boolean
    cancelled: boolean
    task?: {
        projectId: string
    }
}

export function useCancelGenerationJob(
    projectId?: string | null,
    failureMessage = '取消任务失败',
) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (taskId: string) => {
            try {
                return await requestJsonWithError<CancelGenerationJobResponse>(
                    `/api/tasks/${encodeURIComponent(taskId)}`,
                    { method: 'DELETE' },
                    failureMessage,
                )
            } catch (error) {
                if (
                    error instanceof Error
                    && typeof (error as Error & { status?: unknown }).status === 'number'
                ) {
                    throw error
                }
                throw new Error(failureMessage)
            }
        },
        onSuccess: async (response) => {
            const invalidations = [
                queryClient.invalidateQueries({ queryKey: queryKeys.generationJobs.all() }),
            ]
            const affectedProjectId = response.task?.projectId || projectId
            if (affectedProjectId) {
                invalidations.push(
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.tasks.all(affectedProjectId),
                        exact: false,
                    }),
                )
            }
            await Promise.all(invalidations)
        },
    })
}

export function useDismissFailedTasks(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (taskIds: string[]) => {
            return await requestJsonWithError<{ success: boolean; dismissed: number }>(
                '/api/tasks/dismiss',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskIds }),
                },
                '关闭错误失败',
            )
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false }),
                queryClient.invalidateQueries({ queryKey: queryKeys.generationJobs.all() }),
            ])
        },
    })
}
