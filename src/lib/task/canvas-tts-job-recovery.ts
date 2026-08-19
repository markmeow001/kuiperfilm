import { getProviderKey } from '@/lib/api-config'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { isSafeReference } from '@/lib/playground/reference-guard'
import { resolveTaskLocaleFromBody } from '@/lib/task/resolve-locale'
import {
  TASK_STATUS,
  TASK_TYPE,
  type TaskBillingInfo,
  type TaskJobData,
} from '@/lib/task/types'
import type { VoiceLineRecoveryTask } from '@/lib/task/voice-line-job-recovery'
import { buildAtlasCloudSeedAudioText } from '@/lib/voice/atlascloud-seed-audio-input'

const ATLASCLOUD_SEED_AUDIO_MODEL_ID = 'bytedance/seed-audio-1.0'

type ProviderHandoff = {
  provider: 'atlascloud' | 'fal'
  modelId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function canonicalString(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.trim() !== value) return null
  return value
}

function taskBillingInfo(value: unknown): TaskBillingInfo | null | undefined {
  if (value === null || value === undefined) return null
  if (!isRecord(value) || typeof value.billable !== 'boolean') return undefined
  return value as TaskBillingInfo
}

export function canvasTtsRecoveryJobData(
  task: VoiceLineRecoveryTask,
  providerHandoff: ProviderHandoff,
): TaskJobData | null {
  if (
    task.status !== TASK_STATUS.QUEUED
    && task.status !== TASK_STATUS.PROCESSING
  ) return null
  if (
    providerHandoff.provider !== 'atlascloud'
    || task.episodeId !== null
    || task.projectId !== 'playground'
    || task.targetType !== 'canvas-tts'
    || !canonicalString(task.id)
    || !canonicalString(task.userId)
    || !canonicalString(task.targetId)
    || !isRecord(task.payload)
  ) return null

  const payload = task.payload
  const locale = resolveTaskLocaleFromBody(payload)
  const billingInfo = taskBillingInfo(task.billingInfo)
  const text = canonicalString(payload.text)
  const referenceAudioKey = canonicalString(payload.referenceAudioKey)
  const emotionPrompt = payload.emotionPrompt === undefined
    ? ''
    : canonicalString(payload.emotionPrompt)
  const strength = payload.strength
  const providerText = canonicalString(payload.providerText)
  const audioModel = canonicalString(payload.audioModel)
  const parsedAudioModel = parseModelKeyStrict(audioModel)

  if (
    !locale
    || billingInfo === undefined
    || !text
    || !referenceAudioKey
    || !referenceAudioKey.startsWith(`voice/playground-ref/${task.userId}/`)
    || !isSafeReference(referenceAudioKey, task.userId)
    || emotionPrompt === null
    || typeof strength !== 'number'
    || !Number.isFinite(strength)
    || strength < 0
    || strength > 1
    || !providerText
    || !audioModel
    || !parsedAudioModel
    || parsedAudioModel.modelKey !== audioModel
    || getProviderKey(parsedAudioModel.provider) !== 'atlascloud'
    || parsedAudioModel.modelId !== ATLASCLOUD_SEED_AUDIO_MODEL_ID
    || parsedAudioModel.modelId !== providerHandoff.modelId
  ) return null

  let expectedProviderText: string
  try {
    expectedProviderText = buildAtlasCloudSeedAudioText({
      dialogue: text,
      emotionPrompt,
      emotionStrength: emotionPrompt ? strength : null,
    })
  } catch {
    return null
  }
  if (providerText !== expectedProviderText) return null

  return {
    taskId: task.id,
    type: TASK_TYPE.CANVAS_TTS,
    locale,
    projectId: task.projectId,
    episodeId: null,
    targetType: task.targetType,
    targetId: task.targetId,
    payload,
    billingInfo,
    userId: task.userId,
    trace: null,
    providerExternalId: task.externalId,
  }
}
