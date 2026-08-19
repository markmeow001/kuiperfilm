'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { checkApiResponse } from '@/lib/error-handler'
import { resolveTaskErrorMessage } from '@/lib/task/error-message'
import { clearTaskTargetOverlay, upsertTaskTargetOverlay } from '../task-target-overlay'
import type { MediaRef } from '@/types/project'
import type {
    StoryboardBatchVideoQuote,
    StoryboardBatchVideoSubmission,
} from '@/lib/novel-promotion/storyboard-batch-video-contract'
import {
    parseStoryboardBatchVideoQuote,
    parseStoryboardBatchVideoSubmission,
} from '@/lib/novel-promotion/storyboard-batch-video-contract'

// ============ 类型定义 ============
export interface PanelCandidate {
    id: string
    imageUrl: string | null
    media?: MediaRef | null
    isSelected: boolean
    taskRunning: boolean
}

export interface PanelCharacterRef {
    name: string
    appearance?: string
}

export interface StoryboardPanel {
    id: string
    storyboardId?: string
    panelIndex: number
    panelNumber?: number | null
    imageUrl: string | null
    media?: MediaRef | null
    videoPrompt?: string | null
    srtSegment?: string | null
    videoUrl: string | null
    lipSyncVideoUrl?: string | null
    videoGenerationMode?: 'normal' | 'firstlastframe' | null
    videoMedia?: MediaRef | null
    lipSyncVideoMedia?: MediaRef | null
    multiShotGroupId?: string | null
    duration?: number | null
    imageTaskRunning?: boolean
    videoTaskRunning?: boolean
    lipSyncTaskRunning?: boolean
    imageErrorMessage?: string | null
    candidateImages?: string | null
    // Decoded server-side from the raw JSON column. See
    // /api/novel-promotion/[projectId]/storyboards/route.ts.
    characters?: PanelCharacterRef[]
    location?: string | null
}

export interface StoryboardGroup {
    id: string
    episodeId?: string
    clipId?: string
    referenceVideoUrl?: string | null
    panels: StoryboardPanel[]
}

export interface StoryboardData {
    storyboards: StoryboardGroup[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Runtime guard for the project-scoped storyboard endpoint.
 *
 * The envelope is intentionally not normalised into the obsolete `groups`
 * shape. A malformed response must fail the query rather than rendering a
 * believable empty timeline.
 */
export function parseStoryboardData(payload: unknown): StoryboardData {
    if (!isRecord(payload) || !Array.isArray(payload.storyboards)) {
        throw new Error('Invalid storyboard response')
    }

    for (const storyboard of payload.storyboards) {
        if (
            !isRecord(storyboard) ||
            typeof storyboard.id !== 'string' ||
            !Array.isArray(storyboard.panels)
        ) {
            throw new Error('Invalid storyboard response')
        }
        for (const panel of storyboard.panels) {
            if (
                !isRecord(panel) ||
                typeof panel.id !== 'string' ||
                typeof panel.panelIndex !== 'number'
            ) {
                throw new Error('Invalid storyboard response')
            }
        }
    }

    return { storyboards: payload.storyboards as StoryboardGroup[] }
}

type VideoGenerationOptionValue = string | number | boolean
type VideoGenerationOptions = Record<string, VideoGenerationOptionValue>

interface BatchVideoGenerationParams {
    videoModel: string
    generationOptions?: VideoGenerationOptions
}

export type StoryboardBatchVideoParams = BatchVideoGenerationParams

type StoryboardBatchVideoSubmitParams = BatchVideoGenerationParams & {
    batchRunId: string
    quoteFingerprint: string
}

async function readStoryboardBatchVideoError(response: Response): Promise<Error> {
    let message = `Batch video request failed: HTTP ${response.status}`
    try {
        const payload = await response.json() as {
            error?: { message?: unknown }
            message?: unknown
        }
        const candidate = payload.error?.message ?? payload.message
        if (typeof candidate === 'string' && candidate.trim()) message = candidate.trim()
    } catch {
        // The HTTP status remains an explicit error when the body is not JSON.
    }
    return Object.assign(new Error(message), { status: response.status })
}

function buildBatchVideoBody(
    episodeId: string,
    params: BatchVideoGenerationParams,
): Record<string, unknown> {
    return {
        all: true,
        episodeId,
        videoModel: params.videoModel,
        ...(params.generationOptions ? { generationOptions: params.generationOptions } : {}),
    }
}

// ============ 查询 Hooks ============

/**
 * 获取分镜数据
 *
 * The actual API lives at `/api/novel-promotion/[projectId]/storyboards?episodeId=...`
 * (project-scoped for auth). The earlier non-existent path
 * `/api/novel-promotion/episodes/[episodeId]/storyboards` returned 404
 * silently, which is why the V2 storyboard step always rendered empty
 * even after the worker successfully wrote panels — see user report
 * 「重新整理出來還是這樣, 沒有生成分鏡」 on a project with 18 panels
 * confirmed in DB.
 *
 * `projectId` is now required so the hook can build the auth-correct URL.
 * For back-compat with stale call sites that haven't been updated, we
 * accept null projectId by disabling the query entirely (same as null
 * episodeId) instead of falling back to the broken legacy path.
 */
export function useStoryboards(
    projectId: string | null,
    episodeId: string | null,
) {
    return useQuery({
        queryKey: queryKeys.storyboards.all(episodeId || ''),
        queryFn: async (): Promise<StoryboardData> => {
            if (!projectId || !episodeId) throw new Error('Project ID and Episode ID are required')
            const res = await fetch(
                `/api/novel-promotion/${projectId}/storyboards?episodeId=${encodeURIComponent(episodeId)}`,
            )
            if (!res.ok) throw new Error('Failed to fetch storyboards')
            const data: unknown = await res.json()
            return parseStoryboardData(data)
        },
        enabled: !!projectId && !!episodeId,
    })
}

// ============ Mutation Hooks ============

/**
 * 重新生成分镜图片
 */
export function useRegeneratePanelImage(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ panelId }: { panelId: string }) => {
            if (!projectId) throw new Error('Project ID is required')
            const res = await fetch(`/api/novel-promotion/${projectId}/regenerate-panel-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ panelId }),
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error(resolveTaskErrorMessage(error, 'Failed to regenerate'))
            }
            return res.json()
        },
        onMutate: async () => {
            if (!projectId) return
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
        },
        onSettled: () => {
            if (episodeId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
            }
        },
    })
}

/**
 * 修改分镜图片
 */
export function useModifyPanelImage(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (params: {
            panelId: string
            modifyPrompt: string
            extraImageUrls?: string[]
        }) => {
            if (!projectId) throw new Error('Project ID is required')
            const res = await fetch(`/api/novel-promotion/${projectId}/modify-panel-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error(resolveTaskErrorMessage(error, 'Failed to modify'))
            }
            return res.json()
        },
        onMutate: async () => {
            if (!projectId) return
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
        },
        onSettled: () => {
            if (episodeId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
            }
        },
    })
}

/**
 * 生成视频
 */
export function useGenerateVideo(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (params: {
            storyboardId: string
            panelIndex: number
            panelId?: string
            videoModel: string
            generationOptions?: VideoGenerationOptions
            firstLastFrame?: {
                lastFrameStoryboardId: string
                lastFramePanelIndex: number
                flModel: string
                customPrompt?: string
            }
        }) => {
            if (!projectId) throw new Error('Project ID is required')

            // 构建请求体
            const requestBody: {
                storyboardId: string
                panelIndex: number
                firstLastFrame?: {
                    lastFrameStoryboardId: string
                    lastFramePanelIndex: number
                    flModel: string
                    customPrompt?: string
                }
                videoModel: string
                generationOptions?: VideoGenerationOptions
            } = {
                storyboardId: params.storyboardId,
                panelIndex: params.panelIndex,
                videoModel: params.videoModel,
            }

            // 如果是首尾帧模式
            if (params.firstLastFrame) {
                requestBody.firstLastFrame = params.firstLastFrame
            }

            if (params.generationOptions && typeof params.generationOptions === 'object') {
                requestBody.generationOptions = params.generationOptions
            }

            const res = await fetch(`/api/novel-promotion/${projectId}/generate-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody),
            })
            // 🔥 使用统一错误处理
            await checkApiResponse(res)
            return res.json()
        },
        onMutate: async ({ panelId }) => {
            if (!projectId) return
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
            if (!panelId) return
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'NovelPromotionPanel',
                targetId: panelId,
                intent: 'generate',
            })
        },
        onError: (_error, { panelId }) => {
            if (!projectId || !panelId) return
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'NovelPromotionPanel',
                targetId: panelId,
            })
        },
        onSettled: () => {
            // 🔥 刷新缓存获取最新状态
            if (episodeId && projectId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
            }
        },
    })
}

/**
 * 批量生成视频
 *
 * 后端为每个需要生成的 panel 创建独立的 Panel 级任务，
 * 与单个生成走完全相同的 SSE → overlay → UI 流程。
 */
export function useEstimateStoryboardBatchVideos(
    projectId: string | null,
    episodeId: string | null,
) {
    return useMutation({
        mutationFn: async (params: StoryboardBatchVideoParams): Promise<StoryboardBatchVideoQuote> => {
            if (!projectId) throw new Error('Project ID is required')
            if (!episodeId) throw new Error('Episode ID is required')
            const response = await fetch(`/api/novel-promotion/${projectId}/generate-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({
                    ...buildBatchVideoBody(episodeId, params),
                    intent: 'estimate',
                }),
            })
            if (!response.ok) throw await readStoryboardBatchVideoError(response)
            return parseStoryboardBatchVideoQuote(await response.json())
        },
    })
}

export function useSubmitStoryboardBatchVideos(
    projectId: string | null,
    episodeId: string | null,
) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (params: StoryboardBatchVideoSubmitParams): Promise<StoryboardBatchVideoSubmission> => {
            if (!projectId) throw new Error('Project ID is required')
            if (!episodeId) throw new Error('Episode ID is required')
            const response = await fetch(`/api/novel-promotion/${projectId}/generate-video`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({
                    ...buildBatchVideoBody(episodeId, params),
                    intent: 'submit',
                    batchRunId: params.batchRunId,
                    quoteFingerprint: params.quoteFingerprint,
                }),
            })
            if (!response.ok) throw await readStoryboardBatchVideoError(response)
            return parseStoryboardBatchVideoSubmission(await response.json())
        },
        onMutate: async () => {
            if (!projectId) return
            await queryClient.invalidateQueries({
                queryKey: queryKeys.tasks.all(projectId),
                exact: false,
            })
        },
        onSettled: () => {
            if (!projectId || !episodeId) return
            void queryClient.invalidateQueries({
                queryKey: queryKeys.tasks.all(projectId),
                exact: false,
            })
            void queryClient.invalidateQueries({
                queryKey: queryKeys.generationJobs.all(),
            })
            void queryClient.invalidateQueries({
                queryKey: queryKeys.episodeData(projectId, episodeId),
            })
        },
    })
}

export function useBatchGenerateVideos(projectId: string | null, episodeId: string | null) {
    // Legacy workspace callers are intentionally quote-only. A batch may only
    // create tasks after the authenticated estimate is shown and confirmed.
    return useEstimateStoryboardBatchVideos(projectId, episodeId)
}

/**
 * 选择分镜候选图
 */
export function useSelectPanelCandidate(episodeId: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ panelId, candidateId }: { panelId: string; candidateId: string }) => {
            const res = await fetch(`/api/novel-promotion/panels/${panelId}/select-candidate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidateId }),
            })
            if (!res.ok) {
                const error = await res.json()
                throw new Error(resolveTaskErrorMessage(error, 'Failed to select candidate'))
            }
            return res.json()
        },
        onSettled: () => {
            if (episodeId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
            }
        },
    })
}

/**
 * V2 storyboard 編輯器:更新 panel 的 description(場景/構圖描述詞)+
 * srtSegment(對話/字幕),透過 PATCH /api/novel-promotion/:projectId/panel
 * 的 panelId 路徑。兩個欄位獨立可選 — 想只改 dialogue 不動 description
 * 就只送 srtSegment,反之亦然。
 */
export function useUpdatePanelText(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (params: {
            panelId: string
            description?: string
            srtSegment?: string
            /**
             * Updated panel.characters payload. Pass either an array of
             * `{name, appearance?}` entries (preferred) or a pre-serialized
             * JSON string. Used by the 出場角色 chip × remove flow (2026-05-13)
             * to drop a falsely-added character (e.g. single-char name 离
             * mis-extracted by the analyze LLM).
             */
            characters?: Array<{ name: string; appearance?: string }> | string | null
            /**
             * Updated panel.location (scene reference). String to set, null
             * to clear. Used by the 場景 chip × remove flow (2026-05-13).
             */
            location?: string | null
            /**
             * Group-level narrative draft (叙事提示词「保存敘事」), stored on
             * the group's FIRST panel. String to save, null to clear
             * (重生敘事). 2026-07-13 — pre-fix the save button only wrote
             * component state and a refresh reverted the edit.
             */
            groupNarrative?: string | null
            /** 時長 pick for the group (null = Auto). Same first-panel anchor. */
            groupDurationSec?: number | null
        }) => {
            if (!projectId) throw new Error('Project ID is required')
            const res = await fetch(`/api/novel-promotion/${projectId}/panel`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params),
            })
            if (!res.ok) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data?.error || 'Failed to update panel text')
            }
            return res.json()
        },
        onSuccess: () => {
            if (episodeId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
            }
        },
    })
}

/**
 * 刷新分镜数据
 */
export function useRefreshStoryboards(episodeId: string | null) {
    const queryClient = useQueryClient()

    return () => {
        if (episodeId) {
            queryClient.invalidateQueries({ queryKey: queryKeys.storyboards.all(episodeId) })
        }
    }
}

/**
 * 🔥 口型同步生成（乐观更新）
 */
export function useLipSync(projectId: string | null, episodeId: string | null) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (params: {
            storyboardId: string
            panelIndex: number
            voiceLineId: string
            panelId?: string
        }) => {
            const res = await fetch(`/api/novel-promotion/${projectId}/lip-sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storyboardId: params.storyboardId,
                    panelIndex: params.panelIndex,
                    voiceLineId: params.voiceLineId
                })
            })

            if (!res.ok) {
                const error = await res.json()
                throw new Error(resolveTaskErrorMessage(error, 'Lip sync failed'))
            }

            return res.json()
        },
        onMutate: async ({ panelId }) => {
            if (!projectId) return
            await queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
            if (!panelId) return
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'NovelPromotionPanel',
                targetId: panelId,
                intent: 'generate',
            })
        },
        onError: (_error, { panelId }) => {
            if (!projectId || !panelId) return
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'NovelPromotionPanel',
                targetId: panelId,
            })
        },
        onSettled: () => {
            // 请求完成后刷新数据
            if (projectId && episodeId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, episodeId) })
            }
        }
    })
}
