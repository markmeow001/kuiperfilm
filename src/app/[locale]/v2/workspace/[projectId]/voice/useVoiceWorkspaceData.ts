'use client'

import { useQuery } from '@tanstack/react-query'
import type { SpeakerVoiceEntry, VoiceLine, VoiceWorkspaceData } from './voice-workspace-types'

export const voiceWorkspaceQueryKey = (projectId: string, episodeId: string) =>
  ['v2-voice-workspace', projectId, episodeId] as const

async function readJson<T>(url: string, fallbackMessage: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null
    throw new Error(payload?.message || payload?.error || fallbackMessage)
  }
  return await response.json() as T
}

export function useVoiceWorkspaceData(projectId: string, episodeId: string | null) {
  return useQuery({
    queryKey: voiceWorkspaceQueryKey(projectId, episodeId || ''),
    enabled: Boolean(projectId && episodeId),
    staleTime: 5000,
    refetchInterval: (query) => {
      const data = query.state.data as VoiceWorkspaceData | undefined
      return data?.voiceLines.some((line) => line.lineTaskRunning) ? 3000 : false
    },
    queryFn: async (): Promise<VoiceWorkspaceData> => {
      if (!episodeId) throw new Error('Episode ID is required')
      const query = new URLSearchParams({ episodeId })
      const [lines, voices, speakers] = await Promise.all([
        readJson<{ voiceLines?: VoiceLine[]; speakerStats?: Record<string, number> }>(
          `/api/novel-promotion/${projectId}/voice-lines?${query}`,
          'Failed to load voice lines',
        ),
        readJson<{ speakerVoices?: Record<string, SpeakerVoiceEntry> }>(
          `/api/novel-promotion/${projectId}/speaker-voice?${query}`,
          'Failed to load speaker voices',
        ),
        readJson<{ speakers?: string[] }>(
          `/api/novel-promotion/${projectId}/voice-lines?speakersOnly=1&${query}`,
          'Failed to load speakers',
        ),
      ])
      return {
        voiceLines: lines.voiceLines || [],
        speakerVoices: voices.speakerVoices || {},
        speakers: speakers.speakers || [],
        speakerStats: lines.speakerStats || {},
      }
    },
  })
}
