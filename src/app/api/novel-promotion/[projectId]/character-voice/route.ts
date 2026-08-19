import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  resolveCharacterVoiceWrite,
  VoiceSourceWritePolicyError,
} from '@/lib/voice/character-voice-write-policy'

const CONSENT_REQUIRED_DETAILS = {
  reason: 'VOICE_SOURCE_CONSENT_REQUIRED',
  message: 'Custom voice sources require durable ownership and consent records before use',
} as const

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => null)
  const characterId = typeof body?.characterId === 'string' ? body.characterId.trim() : ''
  if (!characterId) throw new ApiError('INVALID_PARAMS')

  const character = await prisma.novelPromotionCharacter.findFirst({
    where: { id: characterId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!character) throw new ApiError('NOT_FOUND')

  // Until VoiceSource + Consent are durable, this endpoint may only remove a
  // legacy custom source. Accepting a URL, media route, provider voice id, or
  // client-side consent flag would recreate the unauditable clone boundary.
  let voiceWrite
  try {
    voiceWrite = resolveCharacterVoiceWrite(body)
    if (voiceWrite.kind !== 'clear') throw new VoiceSourceWritePolicyError()
  } catch (error) {
    if (error instanceof VoiceSourceWritePolicyError) {
      throw new ApiError('INVALID_PARAMS', CONSENT_REQUIRED_DETAILS)
    }
    throw error
  }

  const result = await prisma.novelPromotionCharacter.updateMany({
    where: { id: characterId, novelPromotionProject: { projectId } },
    data: voiceWrite.data,
  })
  if (result.count !== 1) throw new ApiError('NOT_FOUND')

  return NextResponse.json({
    success: true,
    character: {
      id: characterId,
      voiceType: null,
      voiceId: null,
      customVoiceUrl: null,
      customVoiceMediaId: null,
    },
  })
})

export const POST = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  // A no-migration patch cannot truthfully record who supplied the sample,
  // whose voice it is, the consent scope, or revocation. Reject before reading
  // file/base64 bodies and before any storage/provider call.
  throw new ApiError('INVALID_PARAMS', CONSENT_REQUIRED_DETAILS)
})
