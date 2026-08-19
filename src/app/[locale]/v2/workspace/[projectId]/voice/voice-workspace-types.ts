import type { SystemVoicePreset } from '@/lib/query/mutations/useVoiceMutations'

export type VoiceAsset = SystemVoicePreset

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
  voicePresetId: string
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

export type VoicePanelQueryState = 'loading' | 'error' | 'ready'

export interface VoicePanelOption {
  id: string
  label: string
}

export interface VoiceLineDraftPayload {
  content: string
  speaker: string
  matchedPanelId: string | null
  clientRequestId?: string
}

export type VoiceLineUpdatePayload = VoiceLineDraftPayload & {
  lineId: string
}
