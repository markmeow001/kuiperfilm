import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/cos'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  findExactSpeakerVoiceBinding,
  normalizeVoiceSpeaker,
  parseSpeakerVoiceBindings,
  replaceWithSystemSpeakerVoiceBinding,
  resolveSystemVoicePresetSource,
  VoiceGenerationScopeError,
} from '@/lib/voice/voice-generation-scope'

const MAX_SPEAKER_VOICE_WRITE_ATTEMPTS = 3

function rethrowVoiceBindingError(error: unknown): never {
  if (error instanceof VoiceGenerationScopeError) {
    throw new ApiError('INVALID_PARAMS', { reason: error.code })
  }
  throw error
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function hasRawCustomSource(value: Record<string, unknown>): boolean {
  return [value.audioUrl, value.voiceType, value.voiceId]
    .some((candidate) => readNonEmptyString(candidate) !== null)
}

function readEffectiveBindingPresetId(
  raw: string | null | undefined,
  speaker: string,
): string | null {
  const binding = findExactSpeakerVoiceBinding(parseSpeakerVoiceBindings(raw), speaker)
  return binding ? readNonEmptyString(binding.value.voicePresetId) : null
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = new URL(request.url).searchParams.get('episodeId')?.trim() || ''

  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
  if (isErrorResponse(authResult)) return authResult
  if (!episodeId) throw new ApiError('INVALID_PARAMS')

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { id: episodeId, novelPromotionProject: { projectId } },
    select: { id: true, speakerVoices: true },
  })
  if (!episode) throw new ApiError('NOT_FOUND')

  try {
    const entries = parseSpeakerVoiceBindings(episode.speakerVoices)
    const resolvedEntries = await Promise.all(entries.map(async ({ speaker, value }) => {
      if (hasRawCustomSource(value)) {
        throw new VoiceGenerationScopeError('VOICE_SOURCE_CONSENT_REQUIRED')
      }
      const voicePresetId = readNonEmptyString(value.voicePresetId)
      if (!voicePresetId) {
        throw new VoiceGenerationScopeError('VOICE_BINDING_INVALID')
      }
      const source = await resolveSystemVoicePresetSource(voicePresetId)
      return [speaker, {
        voicePresetId,
        audioUrl: source.kind === 'storage-key' ? getSignedUrl(source.value, 7200) : source.value,
      }] as const
    }))
    return NextResponse.json({ speakerVoices: Object.fromEntries(resolvedEntries) })
  } catch (error) {
    rethrowVoiceBindingError(error)
  }
})

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => null)
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId.trim() : ''
  const speaker = typeof body?.speaker === 'string' ? body.speaker.trim() : ''
  const voicePresetId = typeof body?.voicePresetId === 'string' ? body.voicePresetId.trim() : ''
  if (!episodeId || !speaker) throw new ApiError('INVALID_PARAMS')

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { id: episodeId, novelPromotionProject: { projectId } },
    select: { id: true, speakerVoices: true },
  })
  if (!episode) throw new ApiError('NOT_FOUND')

  if (
    readNonEmptyString(body?.audioUrl)
    || readNonEmptyString(body?.voiceType)
    || readNonEmptyString(body?.voiceId)
  ) {
    throw new ApiError('INVALID_PARAMS', { reason: 'VOICE_SOURCE_CONSENT_REQUIRED' })
  }
  if (!voicePresetId) {
    throw new ApiError('INVALID_PARAMS', { reason: 'VOICE_PRESET_REQUIRED' })
  }

  try {
    await resolveSystemVoicePresetSource(voicePresetId)
  } catch (error) {
    rethrowVoiceBindingError(error)
  }

  let speakerVoiceSnapshot = episode.speakerVoices
  for (let attempt = 0; attempt < MAX_SPEAKER_VOICE_WRITE_ATTEMPTS; attempt += 1) {
    let speakerVoices: string
    let bindingChanged: boolean
    try {
      bindingChanged = readEffectiveBindingPresetId(speakerVoiceSnapshot, speaker) !== voicePresetId
      speakerVoices = replaceWithSystemSpeakerVoiceBinding({
        raw: speakerVoiceSnapshot,
        speaker,
        voicePresetId,
      })
    } catch (error) {
      rethrowVoiceBindingError(error)
    }

    const result = await prisma.$transaction(async (tx) => {
      const episodeWrite = await tx.novelPromotionEpisode.updateMany({
        where: {
          id: episodeId,
          speakerVoices: speakerVoiceSnapshot,
          novelPromotionProject: { projectId },
        },
        data: { speakerVoices },
      })
      if (episodeWrite.count !== 1) return { committed: false }

      if (bindingChanged) {
        const scopedLines = await tx.novelPromotionVoiceLine.findMany({
          where: {
            episodeId,
            episode: { novelPromotionProject: { projectId } },
          },
          select: { id: true, speaker: true },
        })
        const normalizedSpeaker = normalizeVoiceSpeaker(speaker)
        const affectedLineIds = scopedLines
          .filter((line) => normalizeVoiceSpeaker(line.speaker) === normalizedSpeaker)
          .map((line) => line.id)
        if (affectedLineIds.length > 0) await tx.novelPromotionVoiceLine.updateMany({
          where: {
            id: { in: affectedLineIds },
            episodeId,
            episode: { novelPromotionProject: { projectId } },
          },
          data: {
            audioUrl: null,
            audioMediaId: null,
            audioDuration: null,
          },
        })
      }
      return { committed: true }
    }, { isolationLevel: 'Serializable' })
    if (result.committed) {
      return NextResponse.json({ success: true })
    }

    if (attempt + 1 >= MAX_SPEAKER_VOICE_WRITE_ATTEMPTS) {
      throw new ApiError('CONFLICT', { reason: 'SPEAKER_VOICE_WRITE_CONFLICT' })
    }
    const latestEpisode = await prisma.novelPromotionEpisode.findFirst({
      where: { id: episodeId, novelPromotionProject: { projectId } },
      select: { id: true, speakerVoices: true },
    })
    if (!latestEpisode) throw new ApiError('NOT_FOUND')
    speakerVoiceSnapshot = latestEpisode.speakerVoices
  }

  throw new ApiError('CONFLICT', { reason: 'SPEAKER_VOICE_WRITE_CONFLICT' })
})
