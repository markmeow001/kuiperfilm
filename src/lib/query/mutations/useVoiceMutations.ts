import { useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { resolveTaskResponse } from '@/lib/task/client'
import {
    requestBlobWithError,
    requestJsonWithError,
    requestTaskResponseWithError,
    requestVoidWithError,
} from './mutation-shared'
import {
    pinVoiceGenerationClientRequest,
    clearVoiceGenerationRequestPin,
    tryReadVoiceGenerationRequestPin,
    requireValidVoiceGenerationResponse,
    shouldRetainVoiceGenerationRequestId,
    voiceGenerationActionFingerprint,
    writeVoiceGenerationRequestPin,
    type GenerateProjectVoiceResponse,
    type GenerateProjectVoiceVariables,
    type VoiceGenerationRequestPin,
} from './voice-generation-request'

type ProjectVoiceLine = {
    id: string
    lineIndex: number
    speaker: string
    content: string
    emotionPrompt: string | null
    emotionStrength: number | null
    audioUrl: string | null
    lineTaskRunning: boolean
    matchedPanelId?: string | null
    matchedStoryboardId?: string | null
    matchedPanelIndex?: number | null
}

type SpeakerVoiceConfig = {
    voicePresetId: string
    audioUrl: string
}

function requireProjectVoiceLineResponse(
    payload: { voiceLine?: ProjectVoiceLine },
): { voiceLine: ProjectVoiceLine } {
    if (!payload.voiceLine || typeof payload.voiceLine.id !== 'string' || !payload.voiceLine.id) {
        throw new Error('Invalid voice line response')
    }
    return { voiceLine: payload.voiceLine }
}

export type SystemVoicePreset = {
    id: string
    name: string
    description: string | null
    gender: string | null
    previewUrl: string
}

export type UpdateProjectVoiceLinePayload = {
    episodeId: string
    lineId: string
    content?: string
    speaker?: string
    matchedPanelId?: string | null
    voicePresetId?: string | null
    emotionPrompt?: string | null
    emotionStrength?: number
    audioUrl?: string | null
}

export function useProjectVoicePresets(projectId: string) {
    return useQuery({
        queryKey: ['project-system-voice-presets', projectId],
        enabled: Boolean(projectId),
        staleTime: 60_000,
        queryFn: async (): Promise<SystemVoicePreset[]> => {
            const data = await requestJsonWithError<{ voicePresets?: SystemVoicePreset[] }>(
                `/api/novel-promotion/${projectId}/voice-presets`,
                { method: 'GET' },
                'Failed to load system voice presets',
            )
            return data.voicePresets || []
        },
    })
}

export function useDesignProjectVoice(projectId: string) {
    return useMutation({
        mutationFn: async (payload: {
            voicePrompt: string
            previewText: string
            preferredName: string
            language: 'zh'
        }) => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/voice-design`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'Failed to design voice',
            )
            return await resolveTaskResponse<{
                success?: boolean
                voiceId?: string
                targetModel?: string
                audioBase64?: string
                requestId?: string
            }>(response)
        },
    })
}

/**
 * 分析镜头变体（项目）
 */

export function useFetchProjectVoiceStageData(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }): Promise<{
            voiceLines: ProjectVoiceLine[]
            speakerVoices: Record<string, SpeakerVoiceConfig>
            speakers: string[]
        }> => {
            const [linesData, voicesData, speakersData] = await Promise.all([
                requestJsonWithError<{ voiceLines?: ProjectVoiceLine[] }>(
                    `/api/novel-promotion/${projectId}/voice-lines?episodeId=${episodeId}`,
                    { method: 'GET' },
                    '获取台词失败',
                ),
                requestJsonWithError<{ speakerVoices?: Record<string, SpeakerVoiceConfig> }>(
                    `/api/novel-promotion/${projectId}/speaker-voice?episodeId=${episodeId}`,
                    { method: 'GET' },
                    '获取角色音色失败',
                ),
                requestJsonWithError<{ speakers?: string[] }>(
                    `/api/novel-promotion/${projectId}/voice-lines?speakersOnly=1&episodeId=${encodeURIComponent(episodeId)}`,
                    { method: 'GET' },
                    '获取说话人失败',
                ),
            ])

            return {
                voiceLines: linesData.voiceLines || [],
                speakerVoices: voicesData.speakerVoices || {},
                speakers: speakersData.speakers || [],
            }
        },
    })
}

/**
 * 分析配音台词
 */

export function useAnalyzeProjectVoice(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }) => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/voice-analyze`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ episodeId, async: true }),
                },
                'voice analyze failed',
            )
            return resolveTaskResponse(response)
        },
    })
}

/**
 * 生成单条/批量配音
 */

export function useGenerateProjectVoice(projectId: string) {
    const requestPinsRef = useRef(new Map<string, VoiceGenerationRequestPin>())
    return useMutation({
        mutationFn: async (variables: GenerateProjectVoiceVariables) => {
            const actionFingerprint = voiceGenerationActionFingerprint(variables)
            const storageScope = { projectId, actionFingerprint }
            const storage = typeof window === 'undefined' ? null : window.sessionStorage
            const persistedPin = storage
                ? tryReadVoiceGenerationRequestPin(storage, storageScope)
                : null
            const pinnedRequest = pinVoiceGenerationClientRequest(
                variables,
                requestPinsRef.current.get(actionFingerprint) ?? persistedPin,
            )
            requestPinsRef.current.set(actionFingerprint, pinnedRequest.pin)
            if (storage) {
                writeVoiceGenerationRequestPin(storage, storageScope, pinnedRequest.pin)
            }

            try {
                const response = await requestJsonWithError<GenerateProjectVoiceResponse>(
                    `/api/novel-promotion/${projectId}/voice-generate`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(pinnedRequest.body),
                    },
                    'voice generate failed',
                )
                const validResponse = requireValidVoiceGenerationResponse(response, variables)
                requestPinsRef.current.delete(actionFingerprint)
                if (storage) clearVoiceGenerationRequestPin(storage, storageScope)
                return validResponse
            } catch (error) {
                const errorWithStatus = error instanceof Error
                    ? error as Error & { status?: unknown }
                    : null
                const status = typeof errorWithStatus?.status === 'number'
                    ? errorWithStatus.status
                    : null
                if (shouldRetainVoiceGenerationRequestId(status)) {
                    requestPinsRef.current.set(actionFingerprint, pinnedRequest.pin)
                    if (storage) {
                        writeVoiceGenerationRequestPin(storage, storageScope, pinnedRequest.pin)
                    }
                } else {
                    requestPinsRef.current.delete(actionFingerprint)
                    if (storage) clearVoiceGenerationRequestPin(storage, storageScope)
                }
                throw error
            }
        },
    })
}

/**
 * 创建台词
 */

export function useCreateProjectVoiceLine(projectId: string) {
    return useMutation({
        mutationFn: async (payload: {
            episodeId: string
            content: string
            speaker: string
            matchedPanelId?: string | null
            clientRequestId?: string
        }) => {
            const response = await requestJsonWithError<{ voiceLine?: ProjectVoiceLine }>(
                `/api/novel-promotion/${projectId}/voice-lines`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...payload,
                        clientRequestId: payload.clientRequestId ?? crypto.randomUUID(),
                    }),
                },
                'add failed',
            )
            return requireProjectVoiceLineResponse(response)
        },
    })
}

/**
 * 更新台词字段
 */

export function useUpdateProjectVoiceLine(projectId: string) {
    return useMutation({
        mutationFn: async (payload: UpdateProjectVoiceLinePayload) => {
            const response = await requestJsonWithError<{ voiceLine?: ProjectVoiceLine }>(
                `/api/novel-promotion/${projectId}/voice-lines`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'update failed',
            )
            return requireProjectVoiceLineResponse(response)
        },
    })
}

/**
 * 删除台词
 */

export function useDeleteProjectVoiceLine(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId, lineId }: { episodeId: string; lineId: string }) => {
            await requestVoidWithError(
                `/api/novel-promotion/${projectId}/voice-lines?lineId=${encodeURIComponent(lineId)}&episodeId=${encodeURIComponent(episodeId)}`,
                { method: 'DELETE' },
                'delete failed',
            )
            return null
        },
    })
}

/**
 * 下载配音 zip
 */

export function useDownloadProjectVoices(projectId: string) {
    return useMutation({
        mutationFn: async ({ episodeId }: { episodeId: string }) =>
            await requestBlobWithError(
                `/api/novel-promotion/${projectId}/download-voices?episodeId=${episodeId}`,
                { method: 'GET' },
                'download failed',
            ),
    })
}

/**
 * 为发言人直接设置音色（写入 episode.speakerVoices）
 * 用于不在资产库中的角色在配音阶段内联绑定音色
 */
export function useUpdateSpeakerVoice(projectId: string) {
    return useMutation({
        mutationFn: async (payload: {
            episodeId: string
            speaker: string
            voicePresetId: string
        }) =>
            await requestJsonWithError<{ success: boolean }>(
                `/api/novel-promotion/${projectId}/speaker-voice`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'update speaker voice failed',
            ),
    })
}
