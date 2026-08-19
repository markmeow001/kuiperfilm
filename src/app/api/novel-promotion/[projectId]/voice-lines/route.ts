import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveVoiceLineMediaRef } from '@/lib/media/service'
import { findNovelPromotionEpisodeInProject } from '@/lib/novel-promotion/project-scope'
import { getPrismaErrorCode } from '@/lib/prisma-error'
import {
  resolveSystemVoicePresetSource,
  VoiceGenerationScopeError,
} from '@/lib/voice/voice-generation-scope'

function rethrowVoicePresetError(error: unknown): never {
  if (error instanceof VoiceGenerationScopeError) {
    throw new ApiError('INVALID_PARAMS', { reason: error.code })
  }
  throw error
}

const CLIENT_REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function deterministicVoiceLineId(projectId: string, episodeId: string, clientRequestId: string): string {
  const digest = createHash('sha256')
    .update(`${projectId}\u0000${episodeId}\u0000${clientRequestId}`)
    .digest('hex')
    .slice(0, 32)
  return `voice_line_${digest}`
}

async function validateVoicePresetWrite(value: unknown): Promise<string | null> {
  if (value === null) return null
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }
  const voicePresetId = value.trim()
  try {
    await resolveSystemVoicePresetSource(voicePresetId)
  } catch (error) {
    rethrowVoicePresetError(error)
  }
  return voicePresetId
}

async function resolveMatchedPanelData(
  tx: Pick<Prisma.TransactionClient, 'novelPromotionPanel'>,
  projectId: string,
  matchedPanelId: string | null | undefined,
  expectedEpisodeId: string,
) {
  if (matchedPanelId === undefined) {
    return null
  }

  if (matchedPanelId === null) {
    return {
      matchedPanelId: null,
      matchedStoryboardId: null,
      matchedPanelIndex: null
    }
  }

  const panel = await tx.novelPromotionPanel.findFirst({
    where: {
      id: matchedPanelId,
      storyboard: {
        episodeId: expectedEpisodeId,
        episode: { novelPromotionProject: { projectId } },
      },
    },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      storyboard: {
        select: {
          episodeId: true
        }
      }
    }
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }
  return {
    matchedPanelId: panel.id,
    matchedStoryboardId: panel.storyboardId,
    matchedPanelIndex: panel.panelIndex
  }
}

async function withVoiceLineMedia<T extends Record<string, unknown>>(line: T) {
  const audioMedia = await resolveVoiceLineMediaRef(line.audioMediaId, line.audioUrl)
  const matchedPanel = line.matchedPanel as
    | {
      storyboardId?: string | null
      panelIndex?: number | null
    }
    | null
    | undefined
  return {
    ...line,
    media: audioMedia,
    audioMedia,
    audioUrl: audioMedia?.url || line.audioUrl || null,
    matchedStoryboardId: matchedPanel?.storyboardId ?? line.matchedStoryboardId,
    matchedPanelIndex: matchedPanel?.panelIndex ?? line.matchedPanelIndex}
}

/**
 * GET /api/novel-promotion/[projectId]/voice-lines?episodeId=xxx
 * 获取剧集的台词列表
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const episodeId = searchParams.get('episodeId')
  const speakersOnly = searchParams.get('speakersOnly')

  if (speakersOnly === '1') {
    if (!episodeId) {
      throw new ApiError('INVALID_PARAMS')
    }

    const episode = await prisma.novelPromotionEpisode.findFirst({
      where: {
        id: episodeId,
        novelPromotionProject: { projectId }
      },
      select: { id: true }
    })
    if (!episode) {
      throw new ApiError('NOT_FOUND')
    }

    const speakerRows = await prisma.novelPromotionVoiceLine.findMany({
      where: {
        episodeId,
        episode: { novelPromotionProject: { projectId } },
      },
      select: { speaker: true },
      distinct: ['speaker'],
      orderBy: { speaker: 'asc' }
    })

    return NextResponse.json({
      speakers: speakerRows.map(item => item.speaker).filter(Boolean)
    })
  }

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const episode = await findNovelPromotionEpisodeInProject(projectId, episodeId)
  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  // 获取台词列表（包含匹配的 Panel 信息）
  const voiceLines = await prisma.novelPromotionVoiceLine.findMany({
    where: {
      episodeId,
      episode: { novelPromotionProject: { projectId } },
    },
    orderBy: { lineIndex: 'asc' },
    include: {
      matchedPanel: {
        select: {
          id: true,
          storyboardId: true,
          panelIndex: true
        }
      }
    }
  })

  // 转换为稳定媒体 URL，并添加兼容字段
  const voiceLinesWithUrls = await Promise.all(voiceLines.map(withVoiceLineMedia))

  // 统计发言人
  const speakerStats: Record<string, number> = {}
  for (const line of voiceLines) {
    speakerStats[line.speaker] = (speakerStats[line.speaker] || 0) + 1
  }

  return NextResponse.json({
    voiceLines: voiceLinesWithUrls,
    count: voiceLines.length,
    speakerStats
  })
})

/**
 * POST /api/novel-promotion/[projectId]/voice-lines
 * 新增单条台词
 * Body: { episodeId, content, speaker, matchedPanelId?: string | null }
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json() as Record<string, unknown>
  const { episodeId, content, speaker, matchedPanelId, clientRequestId } = body

  if (typeof episodeId !== 'string' || !episodeId.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (typeof speaker !== 'string' || !speaker.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (typeof clientRequestId !== 'string' || !CLIENT_REQUEST_ID_PATTERN.test(clientRequestId.trim())) {
    throw new ApiError('INVALID_PARAMS')
  }

  const normalizedEpisodeId = episodeId.trim()
  const normalizedClientRequestId = clientRequestId.trim().toLowerCase()
  const voiceLineId = deterministicVoiceLineId(projectId, normalizedEpisodeId, normalizedClientRequestId)
  const normalizedPanelId = matchedPanelId === undefined || matchedPanelId === null
    ? matchedPanelId
    : typeof matchedPanelId === 'string' && matchedPanelId.trim()
      ? matchedPanelId.trim()
      : (() => { throw new ApiError('INVALID_PARAMS') })()

  let created: Record<string, unknown>
  try {
    created = await prisma.$transaction(async (tx) => {
      const episode = await tx.novelPromotionEpisode.findFirst({
        where: {
          id: normalizedEpisodeId,
          novelPromotionProject: { projectId },
        },
        select: { id: true },
      })
      if (!episode) throw new ApiError('NOT_FOUND')

      const lineScope = {
        id: voiceLineId,
        episodeId: normalizedEpisodeId,
        episode: { novelPromotionProject: { projectId } },
      }
      const existing = await tx.novelPromotionVoiceLine.findFirst({
        where: lineScope,
        include: {
          matchedPanel: {
            select: {
              id: true,
              storyboardId: true,
              panelIndex: true,
            },
          },
        },
      })
      if (existing) {
        const samePayload = existing.content === content.trim()
          && existing.speaker === speaker.trim()
          && (existing.matchedPanelId ?? null) === (normalizedPanelId ?? null)
        if (!samePayload) {
          throw new ApiError('CONFLICT', {
            code: 'VOICE_LINE_IDEMPOTENCY_CONFLICT',
            message: 'This dialogue request key was already used with different content.',
          })
        }
        return existing
      }

      const matchedPanelData = await resolveMatchedPanelData(
        tx,
        projectId,
        normalizedPanelId,
        normalizedEpisodeId,
      )

      const maxLine = await tx.novelPromotionVoiceLine.findFirst({
        where: {
          episodeId: normalizedEpisodeId,
          episode: { novelPromotionProject: { projectId } },
        },
        orderBy: { lineIndex: 'desc' },
        select: { lineIndex: true },
      })
      await tx.novelPromotionVoiceLine.createMany({
        data: {
          id: voiceLineId,
          episodeId: normalizedEpisodeId,
          lineIndex: (maxLine?.lineIndex ?? 0) + 1,
          content: content.trim(),
          speaker: speaker.trim(),
          ...(matchedPanelData || {}),
        },
        skipDuplicates: true,
      })

      const reconciled = await tx.novelPromotionVoiceLine.findFirst({
        where: lineScope,
        include: {
          matchedPanel: {
            select: {
              id: true,
              storyboardId: true,
              panelIndex: true,
            },
          },
        },
      })
      if (!reconciled) {
        throw new ApiError('CONFLICT', {
          code: 'VOICE_LINE_CREATE_NOT_RECONCILED',
          message: 'The dialogue line could not be reconciled. Reload and retry.',
        })
      }
      const samePayload = reconciled.content === content.trim()
        && reconciled.speaker === speaker.trim()
        && (reconciled.matchedPanelId ?? null) === (matchedPanelData?.matchedPanelId ?? null)
      if (!samePayload) {
        throw new ApiError('CONFLICT', {
          code: 'VOICE_LINE_IDEMPOTENCY_CONFLICT',
          message: 'This dialogue request key was already used with different content.',
        })
      }
      return reconciled
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (getPrismaErrorCode(error) === 'P2002') {
      throw new ApiError('CONFLICT', {
        code: 'VOICE_LINE_INDEX_CONFLICT',
        message: 'Voice line order changed. Reload and retry.',
      })
    }
    throw error
  }

  const voiceLine = await withVoiceLineMedia(created)

  return NextResponse.json({
    success: true,
    voiceLine
  })
})

/**
 * PATCH /api/novel-promotion/[projectId]/voice-lines
 * 更新台词设置（内容、发言人、情绪设置、音频URL）
 * Body: { lineId, content, speaker, emotionPrompt, emotionStrength, audioUrl } 
 *    或 { speaker, episodeId, voicePresetId } (批量更新同一发言人的音色)
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const body = await request.json() as Record<string, unknown>
  const {
    lineId,
    speaker,
    episodeId,
    voicePresetId,
    emotionPrompt,
    emotionStrength,
    content,
    audioUrl,
    matchedPanelId
  } = body

  // 单条更新
  if (lineId) {
    if (typeof lineId !== 'string' || !lineId.trim() || typeof episodeId !== 'string' || !episodeId.trim()) {
      throw new ApiError('INVALID_PARAMS')
    }
    const normalizedLineId = lineId.trim()
    const normalizedEpisodeId = episodeId.trim()

    const updateData: Prisma.NovelPromotionVoiceLineUncheckedUpdateManyInput = {}
    const hasVoicePresetUpdate = Object.prototype.hasOwnProperty.call(body, 'voicePresetId')
    const nextVoicePresetId = hasVoicePresetUpdate
      ? await validateVoicePresetWrite(voicePresetId)
      : undefined
    if (hasVoicePresetUpdate) {
      updateData.voicePresetId = nextVoicePresetId
    }
    const hasEmotionPromptUpdate = Object.prototype.hasOwnProperty.call(body, 'emotionPrompt')
    let nextEmotionPrompt: string | null | undefined
    if (hasEmotionPromptUpdate) {
      if (emotionPrompt !== null && typeof emotionPrompt !== 'string') {
        throw new ApiError('INVALID_PARAMS')
      }
      nextEmotionPrompt = typeof emotionPrompt === 'string'
        ? (emotionPrompt.trim() || null)
        : null
      updateData.emotionPrompt = nextEmotionPrompt
    }
    const hasEmotionStrengthUpdate = Object.prototype.hasOwnProperty.call(body, 'emotionStrength')
    let nextEmotionStrength: number | undefined
    if (hasEmotionStrengthUpdate) {
      if (typeof emotionStrength !== 'number' || !Number.isFinite(emotionStrength) || emotionStrength < 0.1 || emotionStrength > 1) {
        throw new ApiError('INVALID_PARAMS')
      }
      nextEmotionStrength = emotionStrength
      updateData.emotionStrength = nextEmotionStrength
    }
    if (content !== undefined) {
      if (typeof content !== 'string' || !content.trim()) {
        throw new ApiError('INVALID_PARAMS')
      }
      updateData.content = content.trim()
    }
    if (speaker !== undefined) {
      if (typeof speaker !== 'string' || !speaker.trim()) {
        throw new ApiError('INVALID_PARAMS')
      }
      updateData.speaker = speaker.trim()
    }
    if (audioUrl !== undefined) {
      // Project custom-voice upload/design is disabled. Keep this endpoint as
      // a removal path only: allowing an arbitrary non-null value here could
      // create a new VoiceLine reference between the terminal publication's
      // global zero-reference proof and its exact-key storage cleanup.
      // Generated audio is published exclusively by the task-scoped atomic
      // completion transaction in voice-line-publication.ts.
      if (audioUrl !== null) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'VOICE_LINE_AUDIO_WRITE_REQUIRES_GENERATION_TASK',
        })
      }
      updateData.audioUrl = null
      updateData.audioMediaId = null
    }
    if (
      matchedPanelId !== undefined
      && matchedPanelId !== null
      && (typeof matchedPanelId !== 'string' || !matchedPanelId.trim())
    ) {
      throw new ApiError('INVALID_PARAMS')
    }

    const hasMatchedPanelUpdate = Object.prototype.hasOwnProperty.call(body, 'matchedPanelId')
    if (!hasMatchedPanelUpdate && Object.keys(updateData).length === 0) {
      throw new ApiError('INVALID_PARAMS')
    }

    const updated = await prisma.$transaction(async (tx) => {
      const ownedLine = await tx.novelPromotionVoiceLine.findFirst({
        where: {
          id: normalizedLineId,
          episodeId: normalizedEpisodeId,
          episode: { novelPromotionProject: { projectId } },
        },
        select: {
          id: true,
          episodeId: true,
          content: true,
          speaker: true,
          voicePresetId: true,
          emotionPrompt: true,
          emotionStrength: true,
        },
      })
      if (!ownedLine) throw new ApiError('NOT_FOUND')

      const contentChanged = typeof updateData.content === 'string'
        && updateData.content !== ownedLine.content
      const speakerChanged = typeof updateData.speaker === 'string'
        && updateData.speaker !== ownedLine.speaker
      const voicePresetChanged = nextVoicePresetId !== undefined
        && nextVoicePresetId !== ownedLine.voicePresetId
      const emotionPromptChanged = nextEmotionPrompt !== undefined
        && nextEmotionPrompt !== ownedLine.emotionPrompt
      const emotionStrengthChanged = nextEmotionStrength !== undefined
        && nextEmotionStrength !== ownedLine.emotionStrength
      if (
        contentChanged
        || speakerChanged
        || voicePresetChanged
        || emotionPromptChanged
        || emotionStrengthChanged
      ) {
        updateData.audioUrl = null
        updateData.audioMediaId = null
        updateData.audioDuration = null
      }

      if (hasMatchedPanelUpdate) {
        const matchedPanelData = await resolveMatchedPanelData(
          tx,
          projectId,
          matchedPanelId === null ? null : (matchedPanelId as string).trim(),
          normalizedEpisodeId,
        )
        if (matchedPanelData) Object.assign(updateData, matchedPanelData)
      }

      const scope = {
        id: normalizedLineId,
        episodeId: normalizedEpisodeId,
        episode: { novelPromotionProject: { projectId } },
      }
      const write = await tx.novelPromotionVoiceLine.updateMany({
        where: scope,
        data: updateData,
      })
      if (write.count !== 1) throw new ApiError('NOT_FOUND')

      const scopedLine = await tx.novelPromotionVoiceLine.findFirst({
        where: scope,
        include: {
          matchedPanel: {
            select: {
              id: true,
              storyboardId: true,
              panelIndex: true,
            },
          }
        },
      })
      if (!scopedLine) throw new ApiError('NOT_FOUND')
      return scopedLine
    }, { isolationLevel: 'Serializable' })

    return NextResponse.json({
      success: true,
      voiceLine: await withVoiceLineMedia(updated)
    })
  }

  // 批量更新同一发言人（仅支持更新音色）
  const batchSpeaker = typeof speaker === 'string' ? speaker.trim() : ''
  if (batchSpeaker && episodeId) {
    if (!Object.prototype.hasOwnProperty.call(body, 'voicePresetId')) {
      throw new ApiError('INVALID_PARAMS')
    }
    const ownedEpisode = await prisma.novelPromotionEpisode.findFirst({
      where: {
        id: episodeId,
        novelPromotionProject: { projectId }
      },
      select: { id: true }
    })
    if (!ownedEpisode) {
      throw new ApiError('NOT_FOUND')
    }
    const trustedVoicePresetId = await validateVoicePresetWrite(voicePresetId)
    const changedPresetFilter = trustedVoicePresetId === null
      ? { voicePresetId: { not: null } }
      : {
          OR: [
            { voicePresetId: null },
            { voicePresetId: { not: trustedVoicePresetId } },
          ],
        }
    const result = await prisma.novelPromotionVoiceLine.updateMany({
      where: {
        episodeId,
        speaker: batchSpeaker,
        episode: { novelPromotionProject: { projectId } },
        ...changedPresetFilter,
      },
      data: {
        voicePresetId: trustedVoicePresetId,
        audioUrl: null,
        audioMediaId: null,
        audioDuration: null,
      }
    })
    return NextResponse.json({
      success: true,
      updatedCount: result.count,
      speaker: batchSpeaker,
      voicePresetId: trustedVoicePresetId
    })
  }

  throw new ApiError('INVALID_PARAMS')
})

/**
 * DELETE /api/novel-promotion/[projectId]/voice-lines?lineId=xxx
 * 删除单条台词
 */
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const lineId = searchParams.get('lineId')
  const episodeId = searchParams.get('episodeId')

  if (!lineId || !episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  const remainingCount = await prisma.$transaction(async (tx) => {
    const scope = {
      episodeId,
      episode: { novelPromotionProject: { projectId } },
    }
    const lineToDelete = await tx.novelPromotionVoiceLine.findFirst({
      where: { id: lineId, ...scope },
      select: { id: true, episodeId: true, lineIndex: true },
    })
    if (!lineToDelete) throw new ApiError('NOT_FOUND')

    const deleted = await tx.novelPromotionVoiceLine.deleteMany({
      where: { id: lineId, ...scope },
    })
    if (deleted.count !== 1) throw new ApiError('NOT_FOUND')

    const remainingLines = await tx.novelPromotionVoiceLine.findMany({
      where: scope,
      select: { id: true, lineIndex: true },
      orderBy: { lineIndex: 'asc' },
    })
    const maxLineIndex = remainingLines.reduce(
      (maximum, line) => Math.max(maximum, line.lineIndex),
      0,
    )
    const temporaryBase = maxLineIndex + remainingLines.length + 1

    for (let index = 0; index < remainingLines.length; index += 1) {
      const line = remainingLines[index]
      const write = await tx.novelPromotionVoiceLine.updateMany({
        where: { id: line.id, ...scope },
        data: { lineIndex: temporaryBase + index + 1 },
      })
      if (write.count !== 1) throw new ApiError('NOT_FOUND')
    }
    for (let index = 0; index < remainingLines.length; index += 1) {
      const line = remainingLines[index]
      const write = await tx.novelPromotionVoiceLine.updateMany({
        where: { id: line.id, ...scope },
        data: { lineIndex: index + 1 },
      })
      if (write.count !== 1) throw new ApiError('NOT_FOUND')
    }

    return remainingLines.length
  }, { isolationLevel: 'Serializable' })

  return NextResponse.json({
    success: true,
    deletedId: lineId,
    remainingCount
  })
})
