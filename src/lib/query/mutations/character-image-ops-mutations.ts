import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import {
    clearTaskTargetOverlay,
    upsertTaskTargetOverlay,
} from '../task-target-overlay'
import {
    getPageLocale,
    invalidateQueryTemplates,
    requestJsonWithError,
} from './mutation-shared'

export function useModifyProjectCharacterImage(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssetAndProjectData = () =>
        invalidateQueryTemplates(queryClient, [
            queryKeys.projectAssets.all(projectId),
            queryKeys.projectData(projectId),
        ])

    return useMutation({
        mutationFn: async (params: {
            characterId: string
            appearanceId: string
            imageIndex: number
            modifyPrompt: string
            extraImageUrls?: string[]
        }) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/modify-asset-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'character',
                    ...params,
                }),
            }, 'Failed to modify image')
        },
        onMutate: ({ appearanceId }) => {
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
                intent: 'modify',
            })
        },
        onError: (_error, { appearanceId }) => {
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
            })
        },
        onSettled: invalidateProjectAssetAndProjectData,
    })
}

/**
 * 修改项目场景图片
 */

export function useRegenerateCharacterGroup(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async ({ characterId, appearanceId }: { characterId: string; appearanceId: string }) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/regenerate-group`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'character',
                    id: characterId,
                    appearanceId,
                })
            }, 'Failed to regenerate group')
        },
        onMutate: ({ appearanceId }) => {
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
                intent: 'regenerate',
            })
        },
        onError: (_error, { appearanceId }) => {
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
            })
        },
        onSettled: invalidateProjectAssets,
    })
}

/**
 * 重新生成单张角色图片
 */

export function useRegenerateSingleCharacterImage(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async ({
            characterId,
            appearanceId,
            imageIndex,
        }: {
            characterId: string
            appearanceId: string
            imageIndex: number
        }) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/regenerate-single-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'character',
                    id: characterId,
                    appearanceId,
                    imageIndex,
                })
            }, 'Failed to regenerate image')
        },
        onMutate: ({ appearanceId }) => {
            upsertTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
                intent: 'regenerate',
            })
        },
        onError: (_error, { appearanceId }) => {
            clearTaskTargetOverlay(queryClient, {
                projectId,
                targetType: 'CharacterAppearance',
                targetId: appearanceId,
            })
        },
        onSettled: invalidateProjectAssets,
    })
}

/**
 * 重新生成场景组图片
 */

export function useUpdateProjectAppearanceDescription(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async ({
            characterId,
            appearanceId,
            description,
            descriptionIndex,
        }: {
            characterId: string
            appearanceId: string
            description: string
            descriptionIndex?: number
        }) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/character/appearance`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    characterId,
                    appearanceId,
                    description,
                    descriptionIndex: typeof descriptionIndex === 'number' ? descriptionIndex : 0,
                }),
            }, 'Failed to update appearance description')
        },
        onSuccess: invalidateProjectAssets,
    })
}

export function useBatchGenerateCharacterImages(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (items: Array<{ characterId: string; appearanceId: string }>) => {
            const results = await Promise.allSettled(
                items.map(item =>
                    fetch(`/api/novel-promotion/${projectId}/generate-image`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Accept-Language': getPageLocale() },
                        body: JSON.stringify({
                            type: 'character',
                            id: item.characterId,
                            appearanceId: item.appearanceId
                        })
                    })
                )
            )
            return results
        },
        onMutate: (items) => {
            for (const item of items) {
                upsertTaskTargetOverlay(queryClient, {
                    projectId,
                    targetType: 'CharacterAppearance',
                    targetId: item.appearanceId,
                    intent: 'generate',
                })
            }
        },
        onError: (_error, items) => {
            for (const item of items) {
                clearTaskTargetOverlay(queryClient, {
                    projectId,
                    targetType: 'CharacterAppearance',
                    targetId: item.appearanceId,
                })
            }
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        }
    })
}

/**
 * Upload a single character reference image and expand it into a 3-view
 * (multi-angle) sheet via the REFERENCE_TO_CHARACTER worker. Two-step
 * chain: temp upload to get a signed URL, then submit the worker task
 * pointing at the existing CharacterAppearance row so the worker
 * overwrites it with the generated multi-view set.
 */
export function useUploadAndExpandCharacterToMultiView(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (params: {
            file: File
            characterId: string
            appearanceId: string
        }) => {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => {
                    const value = reader.result
                    if (typeof value === 'string') resolve(value)
                    else reject(new Error('FileReader produced no string'))
                }
                reader.onerror = () => reject(reader.error || new Error('FileReader error'))
                reader.readAsDataURL(params.file)
            })

            const uploadRes = await fetch('/api/asset-hub/upload-temp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageBase64: dataUrl }),
            })
            const uploadJson = await uploadRes.json().catch(() => null) as { success?: boolean; url?: string } | null
            if (!uploadRes.ok || !uploadJson?.url) {
                throw new Error('Failed to upload reference image')
            }

            return await requestJsonWithError(
                `/api/novel-promotion/${projectId}/reference-to-character`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        referenceImageUrls: [uploadJson.url],
                        characterId: params.characterId,
                        appearanceId: params.appearanceId,
                        isBackgroundJob: true,
                    }),
                },
                'Failed to start multi-view generation',
            )
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}
