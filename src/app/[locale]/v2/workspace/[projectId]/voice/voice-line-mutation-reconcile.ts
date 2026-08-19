import type {
  VoiceLine,
  VoiceLineDraftPayload,
} from './voice-workspace-types'

export function isVoiceLineMutationOutcomeUnknown(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('status' in error)) return true
  const status = (error as { status?: unknown }).status
  return typeof status !== 'number' || status >= 500
}

export function shouldReconcileVoiceLineDelete(error: unknown): boolean {
  if (isVoiceLineMutationOutcomeUnknown(error)) return true
  if (!error || typeof error !== 'object' || !('status' in error)) return false
  return (error as { status?: unknown }).status === 404
}

export function wasVoiceLineUpdateApplied(
  lines: readonly VoiceLine[],
  lineId: string,
  payload: VoiceLineDraftPayload,
): boolean {
  const line = lines.find((candidate) => candidate.id === lineId)
  if (!line) return false
  return line.content === payload.content
    && line.speaker === payload.speaker
    && (line.matchedPanelId ?? null) === payload.matchedPanelId
}

export function wasVoiceLineDeleteApplied(
  lines: readonly VoiceLine[],
  lineId: string,
): boolean {
  return !lines.some((line) => line.id === lineId)
}
