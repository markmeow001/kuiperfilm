'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import type {
  CandidateRegenerationControls,
  CandidateRegenerationSeedMode,
} from './visual-development-types'

interface UseCandidateRegenerationInput {
  projectId: string
  locale: string
  onRefresh: () => Promise<void>
}

interface CandidateRegenerationResponse {
  error?: {
    message?: string
    details?: { message?: string }
  }
}

export function useCandidateRegeneration(
  input: UseCandidateRegenerationInput,
): CandidateRegenerationControls {
  const t = useTranslations('visualDevelopment')
  const [regeneratingCandidateIds, setRegeneratingCandidateIds] = useState<string[]>([])

  const regenerate = useCallback(async (
    candidateId: string,
    prompt: string,
    seedMode: CandidateRegenerationSeedMode,
  ) => {
    if (!input.projectId || regeneratingCandidateIds.includes(candidateId)) return
    setRegeneratingCandidateIds((current) => [...current, candidateId])
    try {
      const response = await fetch(
        `/api/visual-development/${input.projectId}/candidates/${candidateId}/regenerate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt, seedMode, meta: { locale: input.locale } }),
        },
      )
      const payload = await response.json() as CandidateRegenerationResponse
      if (!response.ok) {
        window.alert(
          payload.error?.details?.message
          ?? payload.error?.message
          ?? t('workspace.candidatePrompt.regenerateFailed'),
        )
        return
      }
      await input.onRefresh()
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : t('workspace.candidatePrompt.regenerateFailed'),
      )
    } finally {
      setRegeneratingCandidateIds((current) => current.filter((id) => id !== candidateId))
    }
  }, [input, regeneratingCandidateIds, t])

  return useMemo(() => ({
    regeneratingCandidateIds,
    onRegenerateCandidate: (candidateId, prompt, seedMode) => {
      void regenerate(candidateId, prompt, seedMode)
    },
  }), [regenerate, regeneratingCandidateIds])
}
