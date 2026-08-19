/**
 * Canvas infinite-canvas Audio (TTS) node handler.
 *
 * The route pins an exact AtlasCloud audio model and the exact provider-visible
 * text. This worker validates that snapshot, safely loads the caller-owned
 * reference audio, and delegates the paid handoff to the shared durable Atlas
 * provider adapter. Retries resume the prediction recorded on the same task.
 */
import type { Job } from 'bullmq'
import { getProviderConfig, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { getSignedUrl, toFetchableUrl, uploadToCOS } from '@/lib/cos'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { isSafeReference } from '@/lib/playground/reference-guard'
import type { TaskJobData } from '@/lib/task/types'
import {
  ATLASCLOUD_SEED_AUDIO_MODEL_ID,
  resolveDurableAtlasCloudVoiceAudioUrl,
  type AtlasCloudVoiceInput,
} from '@/lib/voice/atlascloud-voice-provider'
import {
  buildAtlasCloudSeedAudioText,
  countUnicodeCodePoints,
} from '@/lib/voice/atlascloud-seed-audio-input'
import { fetchVoiceAudioResource } from '@/lib/voice/safe-audio-fetch'
import { inspectWaveAudio } from '@/lib/voice/wave-audio'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'

const RESULT_URL_TTL_SECONDS = 7 * 24 * 3600

function trustedOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    throw new Error('CANVAS_TTS_REFERENCE_URL_INVALID')
  }
}

export async function handleCanvasTtsTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  const referenceAudioKey = typeof payload.referenceAudioKey === 'string'
    ? payload.referenceAudioKey.trim()
    : ''
  const emotionPrompt = typeof payload.emotionPrompt === 'string' ? payload.emotionPrompt.trim() : ''
  const strength = typeof payload.strength === 'number' && Number.isFinite(payload.strength)
    ? payload.strength
    : Number.NaN
  const audioModel = typeof payload.audioModel === 'string' ? payload.audioModel.trim() : ''
  const providerText = typeof payload.providerText === 'string' ? payload.providerText : ''

  if (!text) throw new Error('CANVAS_TTS: text is required')
  if (!referenceAudioKey) throw new Error('CANVAS_TTS: referenceAudioKey is required')
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new Error('CANVAS_TTS: strength must be between 0 and 1')
  }
  if (!referenceAudioKey.startsWith('voice/') || !isSafeReference(referenceAudioKey, job.data.userId)) {
    throw new Error('CANVAS_TTS: referenceAudioKey must be the caller\'s own voice key')
  }

  const pinnedAudioModel = parseModelKeyStrict(audioModel)
  if (
    !pinnedAudioModel
    || getProviderKey(pinnedAudioModel.provider).toLowerCase() !== 'atlascloud'
    || pinnedAudioModel.modelId !== ATLASCLOUD_SEED_AUDIO_MODEL_ID
  ) {
    throw new Error('CANVAS_TTS_PROVIDER_UNSUPPORTED')
  }
  const expectedProviderText = buildAtlasCloudSeedAudioText({
    dialogue: text,
    emotionPrompt,
    emotionStrength: emotionPrompt ? strength : null,
  })
  if (!providerText || providerText !== expectedProviderText) {
    throw new Error('CANVAS_TTS_PINNED_PROVIDER_TEXT_INVALID')
  }

  await reportTaskProgress(job, 15, { stage: 'canvas_tts_prepare' })
  await assertTaskActive(job, 'canvas_tts_prepare')

  const resolveInput = async (): Promise<AtlasCloudVoiceInput> => {
    const currentSelection = await resolveModelSelectionOrSingle(
      job.data.userId,
      audioModel,
      'audio',
    )
    if (
      getProviderKey(currentSelection.provider).toLowerCase() !== 'atlascloud'
      || currentSelection.provider !== pinnedAudioModel.provider
      || currentSelection.modelId !== pinnedAudioModel.modelId
      || currentSelection.modelKey !== audioModel
    ) {
      throw new Error('CANVAS_TTS_AUDIO_MODEL_CHANGED')
    }

    await assertTaskActive(job, 'canvas_tts_pre_reference_fetch')
    const referenceAudioUrl = toFetchableUrl(getSignedUrl(referenceAudioKey, 3600))
    const referenceAudio = await fetchVoiceAudioResource(referenceAudioUrl, {
      trustedInternalOrigins: [trustedOrigin(referenceAudioUrl)],
    })
    return {
      text: providerText,
      references: [{ audio_data: referenceAudio.data.toString('base64') }],
      format: 'wav',
      sample_rate: 24_000,
      pitch_rate: 0,
      speech_rate: 0,
      loudness_rate: 0,
    }
  }

  const resolveApiKey = async (): Promise<string> => (
    await getProviderConfig(job.data.userId, pinnedAudioModel.provider)
  ).apiKey
  const checkCancelled = async (stage: string): Promise<void> => {
    await assertTaskActive(job, stage.replace(/^voice_line_/, 'canvas_tts_'))
  }

  await reportTaskProgress(job, 45, { stage: 'canvas_tts_generate' })
  await assertTaskActive(job, 'canvas_tts_pre_provider')
  const providerAudioUrl = await resolveDurableAtlasCloudVoiceAudioUrl({
    job,
    modelId: pinnedAudioModel.modelId,
    resolveInput,
    resolveApiKey,
    checkCancelled,
  })

  await assertTaskActive(job, 'canvas_tts_pre_output_fetch')
  const providerAudio = await fetchVoiceAudioResource(providerAudioUrl)
  const wave = inspectWaveAudio(providerAudio.data, providerAudio.contentType)

  await assertTaskActive(job, 'canvas_tts_pre_persist')
  const audioKey = `voice/playground-ref/${job.data.userId}/tts-${job.data.targetId}.wav`
  const cosKey = await uploadToCOS(providerAudio.data, audioKey)
  const audioUrl = getSignedUrl(cosKey, RESULT_URL_TTL_SECONDS)

  await reportTaskProgress(job, 95, { stage: 'canvas_tts_done' })

  return {
    success: true,
    audioUrl,
    audioKey: cosKey,
    durationMs: wave.durationMs,
    actualCharacters: countUnicodeCodePoints(providerText),
  }
}
