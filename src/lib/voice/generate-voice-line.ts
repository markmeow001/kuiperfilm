import { createHash } from 'node:crypto'
import type { Job } from 'bullmq'
import { getProviderConfig, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { getSignedUrl, getStorageObjectSize, toFetchableUrl, uploadToCOS } from '@/lib/cos'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import type { TaskJobData } from '@/lib/task/types'
import { resolveDurableAtlasCloudVoiceAudioUrl } from '@/lib/voice/atlascloud-voice-provider'
import { resolveDurableFalVoiceAudioUrl } from '@/lib/voice/fal-voice-provider'
import { fetchVoiceAudioResource } from '@/lib/voice/safe-audio-fetch'
import { inspectWaveAudio } from '@/lib/voice/wave-audio'
import {
  buildAtlasCloudSeedAudioText,
  countUnicodeCodePoints,
} from '@/lib/voice/atlascloud-seed-audio-input'
import {
  parseVoiceLineGenerationInput,
  resolveVoiceLineGenerationSnapshot,
  resolveSystemVoicePresetSource,
  voiceLineGenerationFingerprint,
  type VoiceLineGenerationInput,
} from '@/lib/voice/voice-generation-scope'
import {
  persistVoiceLinePreparedOutput,
  readVoiceLinePreparedOutput,
  reconcileVoiceLineLateUpload,
  voiceLineStorageKey,
  type VoiceLinePreparedOutput,
  type VoiceLineTaskResult,
} from '@/lib/voice/voice-line-publication'

type CheckCancelled = (stage: string) => Promise<void>

function getWavDurationFromBuffer(buffer: Buffer): number {
  try {
    const riff = buffer.slice(0, 4).toString('ascii')
    if (riff !== 'RIFF') {
      return Math.round((buffer.length * 8) / 128)
    }

    const byteRate = buffer.readUInt32LE(28)
    let offset = 12
    let dataSize = 0

    while (offset < buffer.length - 8) {
      const chunkId = buffer.slice(offset, offset + 4).toString('ascii')
      const chunkSize = buffer.readUInt32LE(offset + 4)

      if (chunkId === 'data') {
        dataSize = chunkSize
        break
      }

      offset += 8 + chunkSize
    }

    if (dataSize > 0 && byteRate > 0) {
      return Math.round((dataSize / byteRate) * 1000)
    }

    return Math.round((buffer.length * 8) / 128)
  } catch {
    return Math.round((buffer.length * 8) / 128)
  }
}

export async function generateVoiceWithIndexTTS2(params: {
  endpoint: string
  referenceAudioUrl: string
  text: string
  emotionPrompt?: string | null
  strength?: number
  falApiKey?: string
  checkCancelled?: CheckCancelled
  fetchOutputAudio?: (url: string) => Promise<Buffer>
  resolveProviderAudioUrl?: (input: {
    endpoint: string
    providerInput: {
      audio_url: string
      prompt: string
      should_use_prompt_for_emotion: boolean
      strength: number
      emotion_prompt?: string
    }
    apiKey: string
  }) => Promise<string>
}) {
  void params
  throw Object.assign(new Error('FAL_VOICE_NEW_SUBMISSIONS_DISABLED'), {
    code: 'INVALID_PARAMS',
  })
}

export async function generateVoiceLine(params: {
  job: Job<TaskJobData>
  projectId: string
  episodeId: string
  lineId: string
  taskId: string
  userId: string
  audioModel?: string
  providerText?: string
  sourceFingerprint: string
  generationInput: VoiceLineGenerationInput
  checkCancelled?: CheckCancelled
}) {
  const retryableError = (message: string, cause?: unknown) => Object.assign(
    new Error(message, cause === undefined ? undefined : { cause }),
    { code: 'EXTERNAL_ERROR' },
  )
  const checkCancelled = params.checkCancelled
  const fetchProviderOutputAudio = async (url: string): Promise<{ data: Buffer; contentType: string }> => {
    try {
      return await fetchVoiceAudioResource(url)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : ''
      const message = error instanceof Error ? error.message : String(error)
      const retryableTransport = code === 'DNS_FAILED'
        || code === 'NETWORK_FAILED'
        || code === 'TIMEOUT'
        || /^VOICE_AUDIO_UPSTREAM_STATUS_(?:408|429|5\d\d)$/.test(message)
      if (retryableTransport) {
        throw retryableError('VOICE_LINE_PROVIDER_OUTPUT_FETCH_RETRYABLE', error)
      }
      throw error
    }
  }
  const pinnedInput = parseVoiceLineGenerationInput(params.generationInput)
  if (!pinnedInput) {
    throw Object.assign(new Error('VOICE_LINE_PINNED_INPUT_REQUIRED'), { code: 'INVALID_PARAMS' })
  }
  const line = await resolveVoiceLineGenerationSnapshot({
    projectId: params.projectId,
    episodeId: params.episodeId,
    lineId: params.lineId,
  })
  const source = pinnedInput.source

  const text = (line.content || '').trim()
  if (!text) {
    throw new Error('Voice line text is empty')
  }

  const audioModel = params.audioModel?.trim() || ''
  const pinnedAudioModel = parseModelKeyStrict(audioModel)
  const providerFamily = pinnedAudioModel
    ? getProviderKey(pinnedAudioModel.provider).toLowerCase()
    : ''
  const isAtlasCloudTask = providerFamily === 'atlascloud'
  const isLegacyFalDrainTask = providerFamily === 'fal'
  if (
    !pinnedAudioModel
    || (!isAtlasCloudTask && !isLegacyFalDrainTask)
    || !/^[a-f0-9]{64}$/.test(params.sourceFingerprint)
  ) {
    throw Object.assign(new Error('VOICE_LINE_PINNED_INPUT_REQUIRED'), { code: 'INVALID_PARAMS' })
  }

  const inspectProviderOutput = (resource: { data: Buffer; contentType: string }) => ({
    data: resource.data,
    durationMs: isAtlasCloudTask
      ? inspectWaveAudio(resource.data, resource.contentType).durationMs
      : getWavDurationFromBuffer(resource.data),
  })

  if (isAtlasCloudTask) {
    const canonicalProviderText = buildAtlasCloudSeedAudioText({
      dialogue: pinnedInput.line.content,
      emotionPrompt: pinnedInput.line.emotionPrompt,
      emotionStrength: pinnedInput.line.emotionPrompt?.trim()
        ? pinnedInput.line.emotionStrength ?? 0.4
        : null,
    })
    if (params.providerText !== canonicalProviderText) {
      throw Object.assign(new Error('VOICE_LINE_PROVIDER_TEXT_MISMATCH'), {
        code: 'INVALID_PARAMS',
      })
    }
  }

  const pinnedFingerprint = voiceLineGenerationFingerprint({
    line: pinnedInput.line,
    source,
    audioModel,
  })
  if (pinnedFingerprint !== params.sourceFingerprint) {
    throw Object.assign(new Error('VOICE_LINE_PINNED_INPUT_INVALID'), { code: 'INVALID_PARAMS' })
  }

  const currentFingerprint = voiceLineGenerationFingerprint({
    line,
    source,
    audioModel,
  })
  if (currentFingerprint !== params.sourceFingerprint) {
    throw Object.assign(new Error('VOICE_LINE_INPUT_CHANGED'), { code: 'INVALID_PARAMS' })
  }

  const assertAtlasCloudModelEnabledForNewSubmit = async () => {
    if (!isAtlasCloudTask) {
      throw Object.assign(new Error('VOICE_LINE_LEGACY_FAL_NEW_SUBMIT_DISABLED'), {
        code: 'INVALID_PARAMS',
      })
    }
    const audioSelection = await resolveModelSelectionOrSingle(params.userId, audioModel, 'audio')
    const providerKey = getProviderKey(audioSelection.provider).toLowerCase()
    if (
      providerKey !== 'atlascloud'
      || audioSelection.provider !== pinnedAudioModel.provider
      || audioSelection.modelId !== pinnedAudioModel.modelId
      || audioSelection.modelKey !== audioModel
    ) {
      throw Object.assign(new Error('VOICE_LINE_AUDIO_MODEL_CHANGED'), { code: 'INVALID_PARAMS' })
    }
  }
  // A durable paid handoff must survive the model later being disabled. The
  // pinned model key is already authenticated by sourceFingerprint, so resume
  // reads only that exact provider credential and never re-selects a model.
  const resolvePinnedProviderApiKey = async () => (
    await getProviderConfig(params.userId, pinnedAudioModel.provider)
  ).apiKey

  const reconcileStoredOutput = async (marker: VoiceLinePreparedOutput): Promise<VoiceLineTaskResult | null> => {
    if (marker.state === 'cleanup_failed') throw retryableError('VOICE_LINE_OUTPUT_CLEANUP_FAILED')
    if (marker.state !== 'prepared') {
      throw Object.assign(new Error('VOICE_LINE_COMPLETION_RECONCILIATION_REQUIRED'), {
        code: 'INVALID_PARAMS',
      })
    }
    let storedBytes: number | null
    try {
      storedBytes = await getStorageObjectSize(marker.outputUrl)
    } catch (error) {
      throw retryableError('VOICE_LINE_UPLOAD_RECONCILIATION_REQUIRED', error)
    }
    if (storedBytes === marker.audioBytes) return marker.result
    if (storedBytes !== null) throw retryableError('VOICE_LINE_OUTPUT_SIZE_MISMATCH')
    return null
  }

  const uploadPreparedAudio = async (
    marker: VoiceLinePreparedOutput,
    audioData: Buffer,
    audioDuration: number,
  ): Promise<VoiceLineTaskResult> => {
    if (
      audioData.byteLength !== marker.audioBytes
      || createHash('sha256').update(audioData).digest('hex') !== marker.audioSha256
      || (audioDuration || null) !== marker.audioDuration
    ) {
      throw Object.assign(new Error('VOICE_LINE_PROVIDER_OUTPUT_CHANGED'), { code: 'INVALID_PARAMS' })
    }
    await checkCancelled?.('voice_line_pre_upload')
    try {
      await uploadToCOS(audioData, marker.outputUrl, 1)
    } catch (uploadError) {
      let storedBytes: number | null
      try {
        storedBytes = await getStorageObjectSize(marker.outputUrl)
      } catch (readError) {
        throw retryableError('VOICE_LINE_UPLOAD_RECONCILIATION_REQUIRED', {
          uploadError,
          readError,
        })
      }
      if (storedBytes === null) throw retryableError('VOICE_LINE_UPLOAD_FAILED', uploadError)
      if (storedBytes !== marker.audioBytes) {
        throw retryableError('VOICE_LINE_OUTPUT_SIZE_MISMATCH', uploadError)
      }
    }
    // Cancellation can win after the pre-upload check while the storage put
    // is in flight. Fence again before handing the result to completion so a
    // cancelled task can never publish that late output as successful.
    try {
      await checkCancelled?.('voice_line_post_upload')
    } catch (terminationError) {
      // The PUT is confirmed at this point. Cancellation may have reconciled
      // the marker while the upload was still in flight, so compensate the
      // late object using the exact durable marker before propagating the
      // terminal signal. Cleanup failures remain observable/retryable.
      await reconcileVoiceLineLateUpload(params.job, marker)
      throw terminationError
    }
    return marker.result
  }

  const preparedOutput = await readVoiceLinePreparedOutput(params.job)
  if (preparedOutput) {
    const existingResult = await reconcileStoredOutput(preparedOutput)
    if (existingResult) return existingResult

    // Marker exists but the exact object is absent. Resume only a previously
    // checkpointed provider request; never submit another paid request here.
    const providerAudioUrl = isAtlasCloudTask
      ? await resolveDurableAtlasCloudVoiceAudioUrl({
          job: params.job,
          modelId: pinnedAudioModel.modelId,
          resolveApiKey: resolvePinnedProviderApiKey,
          checkCancelled,
        })
      : await resolveDurableFalVoiceAudioUrl({
          job: params.job,
          endpoint: pinnedAudioModel.modelId,
          resolveApiKey: resolvePinnedProviderApiKey,
          checkCancelled,
        })
    await checkCancelled?.('voice_line_pre_output_fetch')
    const providerOutput = inspectProviderOutput(await fetchProviderOutputAudio(providerAudioUrl))
    return await uploadPreparedAudio(
      preparedOutput,
      providerOutput.data,
      providerOutput.durationMs,
    )
  }

  const resolveAtlasCloudInput = async () => {
    const providerText = params.providerText
    if (!providerText) {
      throw Object.assign(new Error('VOICE_LINE_PROVIDER_TEXT_REQUIRED'), {
        code: 'INVALID_PARAMS',
      })
    }
    await assertAtlasCloudModelEnabledForNewSubmit()
    const currentSource = await resolveSystemVoicePresetSource(source.presetId)
    if (currentSource.kind !== source.kind || currentSource.value !== source.value) {
      throw Object.assign(new Error('VOICE_LINE_PINNED_SOURCE_CHANGED'), {
        code: 'INVALID_PARAMS',
      })
    }
    let referenceFetchUrl = source.value
    let trustedInternalOrigins: readonly string[] | undefined
    if (source.kind === 'storage-key') {
      referenceFetchUrl = toFetchableUrl(getSignedUrl(source.value, 3600))
      let generatedOrigin: string
      try {
        generatedOrigin = new URL(referenceFetchUrl).origin
      } catch {
        throw new Error('VOICE_PRESET_MEDIA_INVALID')
      }
      trustedInternalOrigins = [generatedOrigin]
    }
    const referenceAudio = await fetchVoiceAudioResource(
      referenceFetchUrl,
      trustedInternalOrigins ? { trustedInternalOrigins } : undefined,
    )
    return {
      text: providerText,
      references: [{ audio_data: referenceAudio.data.toString('base64') }],
      format: 'wav' as const,
      sample_rate: 24_000 as const,
      pitch_rate: 0,
      speech_rate: 0,
      loudness_rate: 0,
    }
  }
  const providerAudioUrl = isAtlasCloudTask
    ? await resolveDurableAtlasCloudVoiceAudioUrl({
        job: params.job,
        modelId: pinnedAudioModel.modelId,
        resolveInput: resolveAtlasCloudInput,
        resolveApiKey: resolvePinnedProviderApiKey,
        checkCancelled,
      })
    : await resolveDurableFalVoiceAudioUrl({
        job: params.job,
        endpoint: pinnedAudioModel.modelId,
        resolveApiKey: resolvePinnedProviderApiKey,
        checkCancelled,
      })
  await checkCancelled?.('voice_line_pre_output_fetch')
  const providerOutput = inspectProviderOutput(await fetchProviderOutputAudio(providerAudioUrl))
  const generated = {
    audioData: providerOutput.data,
    audioDuration: providerOutput.durationMs,
  }

  const audioSha256 = createHash('sha256').update(generated.audioData).digest('hex')
  const storageKey = voiceLineStorageKey(params.job, audioSha256)
  const result: VoiceLineTaskResult = {
    lineId: line.id,
    // Keep the durable Task/marker result deterministic across overlapping
    // processors. Consumers sign the storage key at the read boundary.
    audioUrl: storageKey,
    storageKey,
    audioDuration: generated.audioDuration || null,
    ...(isAtlasCloudTask
      ? { actualCharacters: countUnicodeCodePoints(params.providerText || '') }
      : {}),
  }
  const marker: VoiceLinePreparedOutput = {
    kind: 'voice_line_publication_v1',
    state: 'prepared',
    taskId: params.taskId,
    projectId: params.projectId,
    episodeId: line.episodeId,
    lineId: line.id,
    sourceFingerprint: params.sourceFingerprint,
    outputUrl: storageKey,
    audioSha256,
    audioBytes: generated.audioData.byteLength,
    audioDuration: result.audioDuration,
    input: {
      speaker: line.speaker,
      content: line.content,
      voicePresetId: line.voicePresetId,
      emotionPrompt: line.emotionPrompt,
      emotionStrength: line.emotionStrength,
      speakerVoices: line.speakerVoices,
      audioUrl: line.audioUrl,
      audioMediaId: line.audioMediaId,
      audioDuration: line.audioDuration,
    },
    result,
  }
  await persistVoiceLinePreparedOutput(params.job, marker)
  return await uploadPreparedAudio(marker, generated.audioData, generated.audioDuration)
}

export function estimateVoiceLineMaxSeconds(content: string | null | undefined) {
  const chars = typeof content === 'string' ? content.length : 0
  return Math.max(5, Math.ceil(chars / 2))
}
