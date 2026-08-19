import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { resolveTaskResponse } from '@/lib/task/client'
import {
    clearTaskTargetOverlay,
    upsertTaskTargetOverlay,
} from '../task-target-overlay'
import {
    invalidateQueryTemplates,
    requestJsonWithError,
    requestTaskResponseWithError,
} from './mutation-shared'
import {
    fetchRegeneratePanelImage,
    fetchDownloadProjectImages,
    fetchUploadPanelImage,
} from './storyboard-panel-mutations-utils'
import type {
    ModifyStoryboardImagePayload,
    CreatePanelVariantPayload,
} from './storyboard-panel-mutations-utils'
import type { ManualStoryboardInitialPanel } from '@/lib/novel-promotion/manual-storyboard-create'

interface ManualPanelEditResponse {
    success: true
    replayed?: boolean
    panel?: {
        id: string
        storyboardId: string
        panelIndex: number
        panelNumber: number | null
    }
}

function invalidateStoryboardPanelEdit(
    queryClient: QueryClient,
    projectId: string,
    episodeId: string,
) {
    void queryClient.invalidateQueries({
        queryKey: queryKeys.storyboards.all(episodeId),
    })
    invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
}

export function useInsertManualProjectPanel(projectId: string, episodeId: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: {
            idempotencyKey: string
            anchorPanelId: string
            position: 'before' | 'after'
            panel: ManualStoryboardInitialPanel
        }) => {
            if (!episodeId) throw new Error('Episode ID is required')
            return await requestJsonWithError<ManualPanelEditResponse>(
                `/api/novel-promotion/${projectId}/episodes/${episodeId}/panels`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'insert panel failed',
            )
        },
        onSuccess: () => {
            if (episodeId) invalidateStoryboardPanelEdit(queryClient, projectId, episodeId)
        },
    })
}

export function useMoveManualProjectPanel(projectId: string, episodeId: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: { panelId: string; direction: 'earlier' | 'later' }) => {
            if (!episodeId) throw new Error('Episode ID is required')
            return await requestJsonWithError<ManualPanelEditResponse>(
                `/api/novel-promotion/${projectId}/episodes/${episodeId}/panels`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'move panel failed',
            )
        },
        onSuccess: () => {
            if (episodeId) invalidateStoryboardPanelEdit(queryClient, projectId, episodeId)
        },
    })
}

export function useDeleteManualProjectPanel(projectId: string, episodeId: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ panelId }: { panelId: string }) => {
            if (!episodeId) throw new Error('Episode ID is required')
            return await requestJsonWithError<{ success: true }>(
                `/api/novel-promotion/${projectId}/episodes/${episodeId}/panels`,
                {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ panelId }),
                },
                'delete panel failed',
            )
        },
        onSuccess: () => {
            if (episodeId) invalidateStoryboardPanelEdit(queryClient, projectId, episodeId)
        },
    })
}

export function useRegenerateProjectPanelImage(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ panelId, count }: { panelId: string; count?: number }) =>
            fetchRegeneratePanelImage(projectId, panelId, count ?? 1),
        onMutate: ({ panelId }) => {
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'NovelPromotionPanel',
                targetId: panelId,
                intent: 'regenerate',
            })
        },
        onError: (_error, { panelId }) => {
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'NovelPromotionPanel',
                targetId: panelId,
            })
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}

/**
 * 修改镜头图片（storyboard）
 */

export function useModifyProjectStoryboardImage(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: ModifyStoryboardImagePayload) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/modify-storyboard-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '修改失败')
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}

/**
 * 下载剧集全部图片（zip）
 */

export function useDownloadProjectImages(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }) =>
            fetchDownloadProjectImages(projectId, episodeId),
    })
}

/**
 * 更新分镜 panel
 */

export function useUpdateProjectPanel(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (payload: Record<string, unknown>) =>
            await requestJsonWithError(
                `/api/novel-promotion/${projectId}/panel`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                '保存失败',
            ),
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
            // 2026-05-02 — also bust the storyboards cache. The
            // V2StoryboardClient's `selected` panel is read out of
            // useStoryboards(episodeId), and chip groups (景別/運鏡)
            // saving via this mutation didn't update that cache,
            // so the chip's amber highlight stayed on the old
            // value even though the DB write succeeded — user
            // reported "點了之後沒看到那個按鈕啟動的樣子, 這樣使用者
            // 根本不知道有沒有按到". Invalidating by the parent
            // ['storyboards'] prefix matches every (episodeId)-keyed
            // sub-query without forcing the call site to thread
            // episodeId through.
            void queryClient.invalidateQueries({ queryKey: ['storyboards'] })
        },
    })
}

/**
 * 选择/取消镜头候选图（项目）
 */

export function useCreateProjectPanel(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: Record<string, unknown>) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/panel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '添加失败')
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}

/**
 * 删除 panel
 */

export function useDeleteProjectPanel(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ panelId }: { panelId: string }) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/panel?panelId=${panelId}`, {
                method: 'DELETE',
            }, '删除失败')
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}

/**
 * 删除 storyboard group
 */

export function useDeleteProjectStoryboardGroup(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ storyboardId }: { storyboardId: string }) => {
            return await requestJsonWithError(
                `/api/novel-promotion/${projectId}/storyboard-group?storyboardId=${storyboardId}`,
                { method: 'DELETE' },
                '删除失败',
            )
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}

/**
 * 异步重生成文字分镜
 */

export function useRegenerateProjectStoryboardText(projectId: string) {
    return useMutation({
        mutationFn: async ({ storyboardId }: { storyboardId: string }) => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/regenerate-storyboard-text`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storyboardId, async: true }),
                },
                'regenerate storyboard text failed',
            )
            return resolveTaskResponse(response)
        },
    })
}

/**
 * 新增 storyboard group
 */

export function useCreateProjectStoryboardGroup(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: {
            episodeId: string
            insertIndex: number
            idempotencyKey?: string
            initialPanel?: {
                description: string
                characterNames: string[]
                locationName: string | null
                durationSeconds: number
            }
        }) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/storyboard-group`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '添加失败')
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}

/**
 * 移动 storyboard group
 */

export function useMoveProjectStoryboardGroup(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: { episodeId: string; clipId: string; direction: 'up' | 'down' }) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/storyboard-group`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '移动失败')
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}

/**
 * 插入 panel（异步）
 */

export function useInsertProjectPanel(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: { storyboardId: string; insertAfterPanelId: string; userInput: string }) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/insert-panel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '插入分镜失败')
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}

/**
 * 生成镜头变体（异步）
 */

export function useCreateProjectPanelVariant(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (payload: CreatePanelVariantPayload) => {
            return await requestJsonWithError<{ panelId: string }>(`/api/novel-promotion/${projectId}/panel-variant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }, '生成变体失败')
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}

/**
 * 上传面板图片
 */

export function useUploadProjectPanelImage(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ panelId, file }: { panelId: string; file: File }) =>
            fetchUploadPanelImage(projectId, panelId, file),
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}

/**
 * 清除 storyboard 错误
 */
export function useClearProjectStoryboardError(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async ({ storyboardId }: { storyboardId: string }) =>
            await requestJsonWithError(
                `/api/novel-promotion/${projectId}/storyboards`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ storyboardId }),
                },
                '清除分镜错误失败',
            ),
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}
