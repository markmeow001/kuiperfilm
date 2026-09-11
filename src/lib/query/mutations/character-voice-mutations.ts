import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import {
    invalidateQueryTemplates,
    requestJsonWithError,
} from './mutation-shared'

// Custom-voice upload and AI-designed-voice save hooks used to live here. Both
// POSTed to /api/novel-promotion/[projectId]/character-voice, which now rejects
// unconditionally with VOICE_SOURCE_CONSENT_REQUIRED, so they could only ever
// produce a failed request. They are removed rather than left exported so no
// new caller can pick them up before VoiceSource/Consent/Revocation exist.

export function useUpdateProjectCharacterVoiceSettings(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
    return useMutation({
        mutationFn: async ({
            characterId,
            voiceType,
            voiceId,
            customVoiceUrl,
        }: {
            characterId: string
            voiceType: 'custom' | null
            voiceId?: string
            customVoiceUrl?: string
        }) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/character`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterId, voiceType, voiceId, customVoiceUrl }),
            }, '更新音色失败')
        },
        onSettled: invalidateProjectAssets,
    })
}
