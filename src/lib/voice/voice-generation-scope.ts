import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'

export type VoiceGenerationScopeErrorCode =
  | 'VOICE_LINE_SCOPE_MISMATCH'
  | 'VOICE_BINDING_INVALID'
  | 'VOICE_SOURCE_REQUIRED'
  | 'VOICE_SOURCE_CONSENT_REQUIRED'
  | 'VOICE_PRESET_NOT_TRUSTED'
  | 'VOICE_PRESET_MEDIA_INVALID'

export class VoiceGenerationScopeError extends Error {
  readonly code: VoiceGenerationScopeErrorCode

  constructor(code: VoiceGenerationScopeErrorCode) {
    super(code)
    this.name = 'VoiceGenerationScopeError'
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>

export type SpeakerVoiceBindingEntry = {
  speaker: string
  value: UnknownRecord
}

export type CanonicalVoiceSource = {
  presetId: string
  kind: 'storage-key' | 'external-url'
  value: string
}

export type VoiceLineGenerationSnapshot = {
  id: string
  episodeId: string
  speaker: string
  content: string
  voicePresetId: string | null
  emotionPrompt: string | null
  emotionStrength: number | null
  speakerVoices: string | null
  audioUrl: string | null
  audioMediaId: string | null
  audioDuration: number | null
}

export type VoiceLineGenerationInput = {
  line: VoiceLineGenerationSnapshot
  source: CanonicalVoiceSource
}

/**
 * Pins every provider-visible input before a billable Voice task is queued.
 * The explicit tuple avoids depending on object insertion order and makes a
 * queued/retried task fail closed when dialogue, emotion, binding, source, or
 * resolved model changes.
 */
export function voiceLineGenerationFingerprint(params: {
  line: VoiceLineGenerationSnapshot
  source: CanonicalVoiceSource
  audioModel: string
}): string {
  const canonical = JSON.stringify([
    'voice_line_generation_v1',
    params.line.id,
    params.line.episodeId,
    params.line.speaker,
    params.line.content,
    params.line.voicePresetId,
    params.line.emotionPrompt,
    params.line.emotionStrength,
    params.line.speakerVoices,
    params.line.audioUrl,
    params.line.audioMediaId,
    params.line.audioDuration,
    params.source.presetId,
    params.source.kind,
    params.source.value,
    params.audioModel,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readRequiredPinnedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function readNullablePinnedString(value: unknown): string | null | undefined {
  return value === null || typeof value === 'string' ? value : undefined
}

/**
 * Treat queued task payloads as untrusted durable envelopes. The route stores
 * this exact provider-visible snapshot before submission so a retry can resume
 * an already-paid provider request without reloading a later-deleted preset.
 */
export function parseVoiceLineGenerationInput(value: unknown): VoiceLineGenerationInput | null {
  if (!isRecord(value) || !isRecord(value.line) || !isRecord(value.source)) return null

  const id = readRequiredPinnedString(value.line.id)
  const episodeId = readRequiredPinnedString(value.line.episodeId)
  const speaker = readRequiredPinnedString(value.line.speaker)
  const content = readRequiredPinnedString(value.line.content)
  const voicePresetId = readNullablePinnedString(value.line.voicePresetId)
  const emotionPrompt = readNullablePinnedString(value.line.emotionPrompt)
  const speakerVoices = readNullablePinnedString(value.line.speakerVoices)
  const emotionStrength = value.line.emotionStrength
  const audioUrl = readNullablePinnedString(value.line.audioUrl)
  const audioMediaId = readNullablePinnedString(value.line.audioMediaId)
  const audioDuration = value.line.audioDuration
  const presetId = readRequiredPinnedString(value.source.presetId)
  const sourceValue = readRequiredPinnedString(value.source.value)
  const sourceKind = value.source.kind

  if (
    !id
    || !episodeId
    || !speaker
    || !content
    || voicePresetId === undefined
    || emotionPrompt === undefined
    || speakerVoices === undefined
    || audioUrl === undefined
    || audioMediaId === undefined
    || (emotionStrength !== null
      && (typeof emotionStrength !== 'number' || !Number.isFinite(emotionStrength)))
    || (audioDuration !== null
      && (typeof audioDuration !== 'number'
        || !Number.isInteger(audioDuration)
        || audioDuration < 0))
    || !presetId
    || !sourceValue
    || (sourceKind !== 'storage-key' && sourceKind !== 'external-url')
  ) {
    return null
  }

  return {
    line: {
      id,
      episodeId,
      speaker,
      content,
      voicePresetId,
      emotionPrompt,
      emotionStrength,
      speakerVoices,
      audioUrl,
      audioMediaId,
      audioDuration,
    },
    source: {
      presetId,
      kind: sourceKind,
      value: sourceValue,
    },
  }
}

export function normalizeVoiceSpeaker(value: string): string {
  return value.trim().toLocaleLowerCase('und')
}

export function parseSpeakerVoiceBindings(
  raw: string | null | undefined,
): SpeakerVoiceBindingEntry[] {
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new VoiceGenerationScopeError('VOICE_BINDING_INVALID')
  }
  if (!isRecord(parsed)) {
    throw new VoiceGenerationScopeError('VOICE_BINDING_INVALID')
  }

  const normalizedSpeakers = new Set<string>()
  return Object.entries(parsed).map(([speaker, value]) => {
    const normalizedSpeaker = normalizeVoiceSpeaker(speaker)
    if (!normalizedSpeaker || normalizedSpeakers.has(normalizedSpeaker) || !isRecord(value)) {
      throw new VoiceGenerationScopeError('VOICE_BINDING_INVALID')
    }
    normalizedSpeakers.add(normalizedSpeaker)
    return { speaker, value }
  })
}

export function findExactSpeakerVoiceBinding(
  entries: readonly SpeakerVoiceBindingEntry[],
  speaker: string,
): SpeakerVoiceBindingEntry | null {
  const normalizedSpeaker = normalizeVoiceSpeaker(speaker)
  if (!normalizedSpeaker) return null
  return entries.find((entry) => normalizeVoiceSpeaker(entry.speaker) === normalizedSpeaker) ?? null
}

export function replaceWithSystemSpeakerVoiceBinding(params: {
  raw: string | null | undefined
  speaker: string
  voicePresetId: string
}): string {
  const normalizedSpeaker = normalizeVoiceSpeaker(params.speaker)
  if (!normalizedSpeaker) {
    throw new VoiceGenerationScopeError('VOICE_BINDING_INVALID')
  }
  const retained = parseSpeakerVoiceBindings(params.raw)
    .filter((entry) => normalizeVoiceSpeaker(entry.speaker) !== normalizedSpeaker)
    .map((entry) => [entry.speaker, entry.value] as const)
  retained.push([params.speaker.trim(), { voicePresetId: params.voicePresetId }])
  return JSON.stringify(Object.fromEntries(retained))
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function bindingPresetId(binding: SpeakerVoiceBindingEntry): string | null {
  const rawPresetId = binding.value.voicePresetId
  if (rawPresetId !== undefined && rawPresetId !== null && !readNonEmptyString(rawPresetId)) {
    throw new VoiceGenerationScopeError('VOICE_BINDING_INVALID')
  }

  const hasRawCustomSource = [
    binding.value.audioUrl,
    binding.value.voiceId,
    binding.value.voiceType,
  ].some((value) => readNonEmptyString(value) !== null)
  if (hasRawCustomSource) {
    throw new VoiceGenerationScopeError('VOICE_SOURCE_CONSENT_REQUIRED')
  }
  return readNonEmptyString(rawPresetId)
}

function canonicalSourceFromSystemPreset(preset: {
  id: string
  audioUrl: string
  audioMediaId: string | null
  audioMedia: {
    id: string
    storageKey: string
  } | null
}): CanonicalVoiceSource {
  const relationStorageKey = preset.audioMediaId && preset.audioMedia?.id === preset.audioMediaId
    ? preset.audioMedia.storageKey.trim()
    : ''
  if (relationStorageKey) {
    return {
      presetId: preset.id,
      kind: 'storage-key',
      value: relationStorageKey,
    }
  }

  const raw = preset.audioUrl.trim()
  if (!raw || /^data:/i.test(raw) || raw.startsWith('/m/')) {
    throw new VoiceGenerationScopeError('VOICE_PRESET_MEDIA_INVALID')
  }
  if (/^https?:/i.test(raw)) {
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      throw new VoiceGenerationScopeError('VOICE_PRESET_MEDIA_INVALID')
    }
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || !parsed.hostname
      || parsed.username
      || parsed.password
    ) {
      throw new VoiceGenerationScopeError('VOICE_PRESET_MEDIA_INVALID')
    }
    return {
      presetId: preset.id,
      kind: 'external-url',
      value: parsed.toString(),
    }
  }
  if (raw.startsWith('/api/files/')) {
    const encodedKey = raw.slice('/api/files/'.length).split(/[?#]/, 1)[0]
    try {
      const storageKey = decodeURIComponent(encodedKey).replace(/^\/+/, '')
      if (!storageKey) throw new Error('empty storage key')
      return { presetId: preset.id, kind: 'storage-key', value: storageKey }
    } catch {
      throw new VoiceGenerationScopeError('VOICE_PRESET_MEDIA_INVALID')
    }
  }
  if (raw.startsWith('/')) {
    throw new VoiceGenerationScopeError('VOICE_PRESET_MEDIA_INVALID')
  }
  return {
    presetId: preset.id,
    kind: 'storage-key',
    value: raw.replace(/^\/+/, ''),
  }
}

export async function resolveSystemVoicePresetSource(
  voicePresetId: string,
): Promise<CanonicalVoiceSource> {
  const presetId = voicePresetId.trim()
  if (!presetId) {
    throw new VoiceGenerationScopeError('VOICE_PRESET_NOT_TRUSTED')
  }
  const preset = await prisma.voicePreset.findFirst({
    where: { id: presetId, isSystem: true },
    select: {
      id: true,
      isSystem: true,
      audioUrl: true,
      audioMediaId: true,
      audioMedia: {
        select: {
          id: true,
          publicId: true,
          storageKey: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
    },
  })
  if (!preset) {
    throw new VoiceGenerationScopeError('VOICE_PRESET_NOT_TRUSTED')
  }
  return canonicalSourceFromSystemPreset(preset)
}

export async function resolveVoiceLineGenerationSnapshot(params: {
  projectId: string
  episodeId: string
  lineId: string
}): Promise<VoiceLineGenerationSnapshot> {
  const line = await prisma.novelPromotionVoiceLine.findFirst({
    where: {
      id: params.lineId,
      episodeId: params.episodeId,
      episode: { novelPromotionProject: { projectId: params.projectId } },
    },
    select: {
      id: true,
      episodeId: true,
      speaker: true,
      content: true,
      voicePresetId: true,
      emotionPrompt: true,
      emotionStrength: true,
      audioUrl: true,
      audioMediaId: true,
      audioDuration: true,
      episode: {
        select: {
          speakerVoices: true,
        },
      },
    },
  })
  if (!line) {
    throw new VoiceGenerationScopeError('VOICE_LINE_SCOPE_MISMATCH')
  }
  return {
    id: line.id,
    episodeId: line.episodeId,
    speaker: line.speaker,
    content: line.content,
    voicePresetId: line.voicePresetId,
    emotionPrompt: line.emotionPrompt,
    emotionStrength: line.emotionStrength,
    speakerVoices: line.episode.speakerVoices,
    audioUrl: line.audioUrl,
    audioMediaId: line.audioMediaId,
    audioDuration: line.audioDuration,
  }
}

export async function resolveVoiceLineGenerationInput(params: {
  projectId: string
  episodeId: string
  lineId: string
}) {
  const line = await prisma.novelPromotionVoiceLine.findFirst({
    where: {
      id: params.lineId,
      episodeId: params.episodeId,
      episode: { novelPromotionProject: { projectId: params.projectId } },
    },
    select: {
      id: true,
      episodeId: true,
      speaker: true,
      content: true,
      voicePresetId: true,
      emotionPrompt: true,
      emotionStrength: true,
      audioUrl: true,
      audioMediaId: true,
      audioDuration: true,
      episode: {
        select: {
          speakerVoices: true,
          novelPromotionProject: {
            select: {
              characters: {
                select: {
                  name: true,
                  voiceType: true,
                  voiceId: true,
                  customVoiceUrl: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (!line) {
    throw new VoiceGenerationScopeError('VOICE_LINE_SCOPE_MISMATCH')
  }

  const bindings = parseSpeakerVoiceBindings(line.episode.speakerVoices)
  const exactBinding = findExactSpeakerVoiceBinding(bindings, line.speaker)
  let presetId = exactBinding ? bindingPresetId(exactBinding) : null
  if (!presetId) {
    presetId = readNonEmptyString(line.voicePresetId)
  }

  if (!presetId) {
    const normalizedSpeaker = normalizeVoiceSpeaker(line.speaker)
    const character = line.episode.novelPromotionProject.characters.find(
      (candidate) => normalizeVoiceSpeaker(candidate.name) === normalizedSpeaker,
    )
    if (
      character
      && [character.customVoiceUrl, character.voiceId, character.voiceType]
        .some((value) => readNonEmptyString(value) !== null)
    ) {
      throw new VoiceGenerationScopeError('VOICE_SOURCE_CONSENT_REQUIRED')
    }
    throw new VoiceGenerationScopeError('VOICE_SOURCE_REQUIRED')
  }

  const source = await resolveSystemVoicePresetSource(presetId)
  return {
    line: {
      id: line.id,
      episodeId: line.episodeId,
      speaker: line.speaker,
      content: line.content,
      voicePresetId: line.voicePresetId,
      emotionPrompt: line.emotionPrompt,
      emotionStrength: line.emotionStrength,
      speakerVoices: line.episode.speakerVoices,
      audioUrl: line.audioUrl,
      audioMediaId: line.audioMediaId,
      audioDuration: line.audioDuration,
    },
    source,
  }
}
