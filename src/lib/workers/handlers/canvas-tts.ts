/**
 * Canvas 无限画布 — Audio (TTS) node handler.
 *
 * text + a user-uploaded reference voice clip → cloned speech via FAL IndexTTS2
 * (the same model the prod voice pipeline uses). Runs on the VOICE worker; the
 * result audio url/key is written to Task.result and read back by the canvas
 * via GET /api/tasks/[taskId]. No project/episode/voice-line row required —
 * this is the standalone canvas path.
 *
 * Reuses generateVoiceWithIndexTTS2 + the audio model/key resolution so we
 * don't duplicate the FAL wiring.
 */
import type { Job } from 'bullmq'
import { generateVoiceWithIndexTTS2 } from '@/lib/voice/generate-voice-line'
import { getAudioApiKey, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { getSignedUrl, uploadToCOS } from '@/lib/cos'
import { isSafeReference } from '@/lib/playground/reference-guard'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'

// Result signed-URL lifetime — long enough that reopening a saved canvas after
// a break still plays (VOICE_LINE stores the raw key + re-signs; the canvas
// persists the node's audioUrl, so a short TTL would 403 on reload).
const RESULT_URL_TTL_SECONDS = 7 * 24 * 3600

export async function handleCanvasTtsTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  const referenceAudioKey = typeof payload.referenceAudioKey === 'string' ? payload.referenceAudioKey : ''
  const emotionPrompt = typeof payload.emotionPrompt === 'string' ? payload.emotionPrompt.trim() : ''
  const strength = typeof payload.strength === 'number' ? payload.strength : 0.4
  const audioModel = typeof payload.audioModel === 'string' ? payload.audioModel : undefined

  if (!text) throw new Error('CANVAS_TTS: text is required')
  if (!referenceAudioKey) throw new Error('CANVAS_TTS: referenceAudioKey is required')
  // Defense-in-depth: the worker is the last line — re-validate the key is the
  // caller's own bare voice key, never trust the payload blindly (no http/data
  // URL passthrough → no server-side fetch of an attacker-controlled URL).
  if (!referenceAudioKey.startsWith('voice/') || !isSafeReference(referenceAudioKey, job.data.userId)) {
    throw new Error('CANVAS_TTS: referenceAudioKey must be the caller\'s own voice key')
  }

  await reportTaskProgress(job, 15, { stage: 'canvas_tts_prepare' })
  await assertTaskActive(job, 'canvas_tts_prepare')

  const referenceAudioUrl = getSignedUrl(referenceAudioKey, 3600)

  // Resolve the FAL audio endpoint + key (must be a fal-provider audio model).
  const audioSelection = await resolveModelSelectionOrSingle(job.data.userId, audioModel, 'audio')
  if (getProviderKey(audioSelection.provider).toLowerCase() !== 'fal') {
    throw new Error(`CANVAS_TTS_PROVIDER_UNSUPPORTED: ${audioSelection.provider}`)
  }
  const falApiKey = await getAudioApiKey(job.data.userId, audioSelection.modelKey)

  await reportTaskProgress(job, 45, { stage: 'canvas_tts_generate' })
  await assertTaskActive(job, 'canvas_tts_generate')

  const generated = await generateVoiceWithIndexTTS2({
    endpoint: audioSelection.modelId,
    referenceAudioUrl,
    text,
    emotionPrompt: emotionPrompt || null,
    strength,
    falApiKey,
  })

  await assertTaskActive(job, 'canvas_tts_persist')
  const audioKey = `voice/playground-ref/${job.data.userId}/tts-${job.data.targetId}.wav`
  const cosKey = await uploadToCOS(generated.audioData, audioKey)
  const audioUrl = getSignedUrl(cosKey, RESULT_URL_TTL_SECONDS)

  await reportTaskProgress(job, 95, { stage: 'canvas_tts_done' })

  return {
    success: true,
    audioUrl,
    audioKey: cosKey,
    durationMs: generated.audioDuration ?? null,
  }
}
