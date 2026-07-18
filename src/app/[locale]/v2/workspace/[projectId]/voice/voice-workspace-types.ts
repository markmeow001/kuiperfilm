import type { GlobalVoice } from '@/lib/query/hooks/useGlobalAssets'

export type VoiceAsset = GlobalVoice

export interface VoiceLine {
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

export interface SpeakerVoiceEntry {
  voiceType: string
  voiceId?: string
  audioUrl: string
}

export interface VoiceWorkspaceData {
  voiceLines: VoiceLine[]
  speakerVoices: Record<string, SpeakerVoiceEntry>
  speakers: string[]
  speakerStats: Record<string, number>
}

export type VoiceLineSavePayload = {
  lineId: string
  emotionPrompt: string | null
  emotionStrength: number
}
