import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/cos'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'

interface SpeakerVoiceConfig {
  voiceType?: string
  voiceId?: string
  audioUrl: string
}

/**
 * GET /api/novel-promotion/[projectId]/speaker-voice?episodeId=xxx
 * 获取剧集的发言人音色配置
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const { searchParams } = new URL(request.url)
  const episodeId = searchParams.get('episodeId')

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取剧集
  // ⚠️ Multi-user isolation: chain ownership through novelPromotionProject.projectId.
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { id: episodeId, novelPromotionProject: { projectId } },
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  // 解析发言人音色
  let speakerVoices: Record<string, SpeakerVoiceConfig> = {}
  if (episode.speakerVoices) {
    try {
      speakerVoices = JSON.parse(episode.speakerVoices)
      // 为音频URL生成签名
      for (const speaker of Object.keys(speakerVoices)) {
        if (speakerVoices[speaker].audioUrl && !speakerVoices[speaker].audioUrl.startsWith('http')) {
          speakerVoices[speaker].audioUrl = getSignedUrl(speakerVoices[speaker].audioUrl, 7200)
        }
      }
    } catch {
      speakerVoices = {}
    }
  }

  return NextResponse.json({ speakerVoices })
})

/**
 * PATCH /api/novel-promotion/[projectId]/speaker-voice
 * 为指定发言人直接设置音色（写入 episode.speakerVoices JSON）
 * 用于不在资产库中的角色在配音阶段内联绑定音色
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => null)
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId : ''
  const speaker = typeof body?.speaker === 'string' ? body.speaker.trim() : ''
  const audioUrl = typeof body?.audioUrl === 'string' ? body.audioUrl.trim() : ''
  const voiceType = typeof body?.voiceType === 'string' ? body.voiceType : 'uploaded'
  const voiceId = typeof body?.voiceId === 'string' ? body.voiceId : undefined

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!speaker) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!audioUrl) {
    throw new ApiError('INVALID_PARAMS')
  }

  const projectData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true }
  })
  if (!projectData) {
    throw new ApiError('NOT_FOUND')
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { id: episodeId, novelPromotionProjectId: projectData.id },
    select: { id: true, speakerVoices: true }
  })
  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  // 解析现有 speakerVoices，合并新条目
  let speakerVoices: Record<string, SpeakerVoiceConfig> = {}
  if (episode.speakerVoices) {
    try {
      speakerVoices = JSON.parse(episode.speakerVoices)
    } catch {
      speakerVoices = {}
    }
  }

  // 将前端传来的 audioUrl（可能是 /m/m_xxx 媒体路由）还原为原始 storageKey
  // 保证与资产库角色的 customVoiceUrl 格式一致，Worker 端能正确处理
  const resolvedStorageKey = await resolveStorageKeyFromMediaValue(audioUrl)
  const audioUrlToStore = resolvedStorageKey || audioUrl

  speakerVoices[speaker] = {
    voiceType,
    ...(voiceId ? { voiceId } : {}),
    audioUrl: audioUrlToStore
  }

  await prisma.novelPromotionEpisode.update({
    where: { id: episodeId },
    data: { speakerVoices: JSON.stringify(speakerVoices) }
  })

  return NextResponse.json({ success: true })
})
