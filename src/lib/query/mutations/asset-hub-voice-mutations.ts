import { useMutation, useQueryClient } from '@tanstack/react-query'
import { requestVoidWithError } from './mutation-shared'
import { invalidateGlobalVoices } from './asset-hub-mutations-shared'

export function useDeleteVoice() {
  const queryClient = useQueryClient()
  const invalidateVoices = () => invalidateGlobalVoices(queryClient)

  return useMutation({
    mutationFn: async (voiceId: string) => {
      await requestVoidWithError(
        `/api/asset-hub/voices/${voiceId}`,
        { method: 'DELETE' },
        'Failed to delete voice',
      )
    },
    onSuccess: invalidateVoices,
  })
}

// useDesignAssetHubVoice / useSaveDesignedAssetHubVoice / useUploadAssetHubVoice
// were removed: POST /api/asset-hub/voice-design, /api/asset-hub/voices and
// /api/asset-hub/voices/upload all call rejectLegacyCustomVoiceWrite(), which
// throws unconditionally, so those hooks could only produce a failed request.
// Reinstate them alongside the real UI once VoiceSource ownership, Consent and
// Revocation records exist.
