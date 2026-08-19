import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import archiver from 'archiver'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { SsrfSafeFetchError } from '@/lib/http/ssrf-safe-fetch'
import {
  fetchOwnedVoiceLineAudio,
  resolveOwnedVoiceLineAudioSource,
  VoiceLineAudioSourceError,
  voiceAudioFileExtension,
  type VoiceLineAudioSourceInput,
} from '@/lib/novel-promotion/voice-line-audio-source'

const VOICE_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024

type DownloadVoiceLine = VoiceLineAudioSourceInput & {
  lineIndex: number
  speaker: string
  content: string
}

function safeVoiceFilename(line: DownloadVoiceLine, contentType: string): string {
  const safeSpeaker = line.speaker.replace(/[\\/:*?"<>|\r\n]/g, '_')
  const safeContent = line.content
    .slice(0, 15)
    .replace(/[\\/:*?"<>|\r\n]/g, '_')
    .replace(/\s+/g, '_')
  const ext = voiceAudioFileExtension(contentType)
  return `${String(line.lineIndex).padStart(3, '0')}_${safeSpeaker}_${safeContent}.${ext}`
}

async function buildArchive(files: ReadonlyArray<{ name: string; data: Buffer }>): Promise<Buffer> {
  const archive = archiver('zip', { zlib: { level: 9 } })
  const chunks: Buffer[] = []

  return await new Promise<Buffer>((resolve, reject) => {
    archive.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)))
    archive.once('end', () => resolve(Buffer.concat(chunks)))
    archive.once('error', reject)
    for (const file of files) {
      archive.append(file.data, { name: file.name })
    }
    void archive.finalize().catch(reject)
  })
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const episodeId = new URL(request.url).searchParams.get('episodeId')?.trim() || ''

  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
  if (isErrorResponse(authResult)) return authResult
  const { project } = authResult

  if (episodeId) {
    const episode = await prisma.novelPromotionEpisode.findFirst({
      where: { id: episodeId, novelPromotionProject: { projectId } },
      select: { id: true },
    })
    if (!episode) throw new ApiError('NOT_FOUND')
  }

  const voiceLines = await prisma.novelPromotionVoiceLine.findMany({
    where: {
      audioUrl: { not: null },
      ...(episodeId ? { episodeId } : {}),
      episode: { novelPromotionProject: { projectId } },
    },
    orderBy: { lineIndex: 'asc' },
    select: {
      id: true,
      episodeId: true,
      lineIndex: true,
      speaker: true,
      content: true,
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
  if (voiceLines.length === 0) throw new ApiError('NOT_FOUND')

  try {
    // Resolve every persisted source before the first outbound read. A single
    // forged/raw/stale line invalidates the whole request with zero partial
    // fetches, matching the archive's all-or-nothing contract.
    const sources = voiceLines.map((line) => resolveOwnedVoiceLineAudioSource(
      { projectId, episodeId: line.episodeId },
      line,
    ))
    const declaredBytes = sources.reduce(
      (total, source) => total + (source.declaredSizeBytes ?? BigInt(0)),
      BigInt(0),
    )
    if (declaredBytes > BigInt(VOICE_ARCHIVE_MAX_BYTES)) {
      throw new VoiceLineAudioSourceError()
    }

    const files: Array<{ name: string; data: Buffer }> = []
    let totalBytes = 0
    for (let index = 0; index < voiceLines.length; index += 1) {
      const line = voiceLines[index]
      const source = sources[index]
      const audio = await fetchOwnedVoiceLineAudio(source)
      totalBytes += audio.data.byteLength
      if (totalBytes > VOICE_ARCHIVE_MAX_BYTES) {
        throw new VoiceLineAudioSourceError()
      }
      files.push({
        name: safeVoiceFilename(line, audio.contentType),
        data: audio.data,
      })
    }

    const archiveBuffer = await buildArchive(files)
    _ulogInfo(`Prepared ${files.length} scoped voice files for project ${projectId}`)
    return new Response(new Uint8Array(archiveBuffer), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(archiveBuffer.byteLength),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(project.name)}_voices.zip"`,
      },
    })
  } catch (error) {
    if (error instanceof VoiceLineAudioSourceError) {
      throw new ApiError('INVALID_PARAMS', { reason: error.message })
    }
    if (error instanceof SsrfSafeFetchError) {
      throw new ApiError('NETWORK_ERROR', { reason: error.code })
    }
    throw new ApiError('NETWORK_ERROR', {
      reason: error instanceof Error ? error.message : 'VOICE_DOWNLOAD_FAILED',
    })
  }
})
