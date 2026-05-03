import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { computeEpisodeProgress } from '@/app/[locale]/workspace/[projectId]/components/episode-progress'
import { pickEpisodeThumbnail } from '@/app/[locale]/workspace/[projectId]/components/episode-thumbnail'
import { resolveMediaRefFromLegacyValue } from '@/lib/media/service'

/**
 * GET - 获取项目的所有剧集（含 progress + thumbnail，不回大欄位）
 *
 * Phase 11.1: 為「劇 → 集」dashboard 提供集列表。
 * - 嚴格 select：避免拉到 prompt / imageHistory 等大欄位
 * - 計算 progress（劇本 / 分鏡 / 視頻）與 thumbnailUrl
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { novelData } = authResult

  const episodes = await prisma.novelPromotionEpisode.findMany({
    where: { novelPromotionProjectId: novelData.id },
    orderBy: { episodeNumber: 'asc' },
    select: {
      id: true,
      episodeNumber: true,
      name: true,
      description: true,
      novelText: true,
      createdAt: true,
      updatedAt: true,
      clips: { select: { id: true, screenplay: true } },
      storyboards: {
        select: {
          id: true,
          panels: { select: { id: true, imageUrl: true, videoUrl: true } },
        },
      },
      shots: { select: { id: true, imageUrl: true } },
    },
  })

  // Resolve thumbnails through the media-ref pipeline so the URL the
  // client sees is a signed, browser-fetchable URL (not a raw COS
  // key). Without this the mobile project home renders "no
  // thumbnail" placeholders even when the panels have generated
  // images. Caught 2026-05-03 after the mobile redirect rolled out
  // and a phone user reported "上面都沒顯示圖片或影片".
  const enriched = await Promise.all(
    episodes.map(async (episode) => {
      const progress = computeEpisodeProgress({
        clips: episode.clips,
        storyboards: episode.storyboards,
      })
      const rawThumb = pickEpisodeThumbnail({
        storyboards: episode.storyboards,
        shots: episode.shots,
      })
      const signedThumb = rawThumb ? await resolveMediaRefFromLegacyValue(rawThumb) : null

      return {
        id: episode.id,
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        description: episode.description,
        novelText: episode.novelText,
        createdAt: episode.createdAt,
        updatedAt: episode.updatedAt,
        progress,
        thumbnailUrl: signedThumb?.url || rawThumb,
      }
    }),
  )

  return NextResponse.json({ episodes: enriched })
})

/**
 * POST - 创建新剧集
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { novelData } = authResult

  const body = await request.json()
  const { name, description } = body

  if (!name || name.trim().length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取下一个剧集编号
  const lastEpisode = await prisma.novelPromotionEpisode.findFirst({
    where: { novelPromotionProjectId: novelData.id },
    orderBy: { episodeNumber: 'desc' }
  })
  const nextEpisodeNumber = (lastEpisode?.episodeNumber || 0) + 1

  // 创建剧集
  const episode = await prisma.novelPromotionEpisode.create({
    data: {
      novelPromotionProjectId: novelData.id,
      episodeNumber: nextEpisodeNumber,
      name: name.trim(),
      description: description?.trim() || null
    }
  })

  // 更新最后编辑的剧集ID
  await prisma.novelPromotionProject.update({
    where: { id: novelData.id },
    data: { lastEpisodeId: episode.id }
  })

  return NextResponse.json({ episode }, { status: 201 })
})
