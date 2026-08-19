import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { getSignedUrl } from '@/lib/cos'
import {
  resolveSystemVoicePresetSource,
  VoiceGenerationScopeError,
} from '@/lib/voice/voice-generation-scope'

const PREVIEW_URL_TTL_SECONDS = 2 * 60 * 60

export const GET = apiHandler(async (
  _request: Request,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
  if (isErrorResponse(authResult)) return authResult

  const presets = await prisma.voicePreset.findMany({
    where: { isSystem: true },
    select: { id: true, name: true, description: true, gender: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  })

  const voicePresets = []
  for (const preset of presets) {
    try {
      const source = await resolveSystemVoicePresetSource(preset.id)
      const previewUrl = source.kind === 'storage-key'
        ? getSignedUrl(source.value, PREVIEW_URL_TTL_SECONDS)
        : source.value
      voicePresets.push({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        gender: preset.gender,
        previewUrl,
      })
    } catch (error) {
      // A malformed or stale system row must not poison the safe catalog or
      // leak its raw media reference. Infrastructure failures still surface.
      if (error instanceof VoiceGenerationScopeError) continue
      throw error
    }
  }

  return NextResponse.json({ voicePresets })
})
