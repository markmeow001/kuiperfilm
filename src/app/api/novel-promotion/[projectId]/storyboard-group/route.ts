import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { defaultPanelGenerationMode } from '@/lib/novel-promotion/generation-mode'
import {
  deriveManualStoryboardIds,
  manualStoryboardPanelMatches,
  normalizeManualStoryboardIdempotencyKey,
  parseManualStoryboardInitialPanel,
} from '@/lib/novel-promotion/manual-storyboard-create'

/**
 * POST /api/novel-promotion/[projectId]/storyboard-group
 * 添加一组新的分镜（创建 Clip + Storyboard + 初始 Panel）
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId : ''
  const rawInsertIndex = body?.insertIndex

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (
    rawInsertIndex !== undefined
    && (!Number.isInteger(rawInsertIndex) || rawInsertIndex < 0)
  ) {
    throw new ApiError('INVALID_PARAMS')
  }

  let initialPanel: ReturnType<typeof parseManualStoryboardInitialPanel>
  let idempotencyKey: string | null = null
  try {
    initialPanel = parseManualStoryboardInitialPanel(body?.initialPanel)
    idempotencyKey = initialPanel
      ? normalizeManualStoryboardIdempotencyKey(body?.idempotencyKey)
      : null
  } catch {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取剧集和现有 clips
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    include: {
      clips: { orderBy: { createdAt: 'asc' } },
      // Phase 1.5C — project mode decides the initial panel's panelGenerationMode.
      novelPromotionProject: { select: { generationMode: true } }
    }
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const existingClips = episode.clips
  const insertAt = rawInsertIndex !== undefined ? rawInsertIndex : existingClips.length

  // 计算新 clip 的 createdAt 时间，用于排序
  let newCreatedAt: Date

  if (existingClips.length === 0) {
    // 没有现有 clips，使用当前时间
    newCreatedAt = new Date()
  } else if (insertAt === 0) {
    // 插入到开头，设置为第一个 clip 之前的时间
    const firstClip = existingClips[0]
    newCreatedAt = new Date(firstClip.createdAt.getTime() - 1000) // 减1秒
  } else if (insertAt >= existingClips.length) {
    // 插入到结尾，设置为最后一个 clip 之后的时间
    const lastClip = existingClips[existingClips.length - 1]
    newCreatedAt = new Date(lastClip.createdAt.getTime() + 1000) // 加1秒
  } else {
    // 插入到中间，设置为前后两个 clip 时间的中间值
    const prevClip = existingClips[insertAt - 1]
    const nextClip = existingClips[insertAt]
    const midTime = (prevClip.createdAt.getTime() + nextClip.createdAt.getTime()) / 2
    newCreatedAt = new Date(midTime)
  }

  if (initialPanel && idempotencyKey) {
    const ids = deriveManualStoryboardIds(projectId, episodeId, idempotencyKey)
    const charactersJson = JSON.stringify(initialPanel.characterNames)
    const panelGenerationMode = defaultPanelGenerationMode({
      projectGenerationMode: episode.novelPromotionProject?.generationMode,
    })

    const result = await prisma.$transaction(async (tx) => {
      const scopedEpisode = await tx.novelPromotionEpisode.findFirst({
        where: {
          id: episodeId,
          novelPromotionProject: { projectId },
        },
        select: { id: true },
      })
      if (!scopedEpisode) throw new ApiError('NOT_FOUND')

      const clipCreate = await tx.novelPromotionClip.createMany({
        data: [{
          id: ids.clipId,
          episodeId,
          summary: initialPanel.description.slice(0, 500),
          content: initialPanel.description,
          location: initialPanel.locationName,
          characters: charactersJson,
          duration: initialPanel.durationSeconds,
          createdAt: newCreatedAt,
        }],
        skipDuplicates: true,
      })
      const storyboardCreate = await tx.novelPromotionStoryboard.createMany({
        data: [{
          id: ids.storyboardId,
          episodeId,
          clipId: ids.clipId,
          panelCount: 1,
        }],
        skipDuplicates: true,
      })
      const panelCreate = await tx.novelPromotionPanel.createMany({
        data: [{
          id: ids.panelId,
          storyboardId: ids.storyboardId,
          panelIndex: 0,
          panelNumber: 1,
          shotType: null,
          cameraMove: null,
          description: initialPanel.description,
          characters: charactersJson,
          location: initialPanel.locationName,
          duration: initialPanel.durationSeconds,
          multiShotGroupId: ids.multiShotGroupId,
          multiShotGroupOrder: 0,
          panelGenerationMode,
        }],
        skipDuplicates: true,
      })

      const reconciled = await tx.novelPromotionStoryboard.findFirst({
        where: {
          id: ids.storyboardId,
          episodeId,
          episode: { novelPromotionProject: { projectId } },
        },
        include: {
          clip: true,
          panels: { where: { id: ids.panelId } },
        },
      })
      const panel = reconciled?.panels[0] ?? null
      if (
        !reconciled
        || !reconciled.clip
        || reconciled.clip.id !== ids.clipId
        || reconciled.clip.episodeId !== episodeId
        || reconciled.clipId !== ids.clipId
        || !panel
        || !manualStoryboardPanelMatches(
          panel as Record<string, unknown>,
          initialPanel,
          ids.multiShotGroupId,
        )
      ) {
        throw new ApiError('CONFLICT', {
          code: 'MANUAL_STORYBOARD_IDEMPOTENCY_CONFLICT',
          message: 'Manual storyboard create outcome could not be safely reconciled',
        })
      }

      return {
        clip: reconciled.clip,
        storyboard: reconciled,
        panel,
        replayed:
          clipCreate.count === 0
          && storyboardCreate.count === 0
          && panelCreate.count === 0,
      }
    })

    _ulogInfo(
      `[添加手動分鏡] episodeId=${episodeId}, clipId=${result.clip.id}, storyboardId=${result.storyboard.id}, replayed=${result.replayed}`,
    )

    return NextResponse.json({ success: true, ...result })
  }

  // Legacy group-only callers keep their original one-placeholder behavior.
  // The V2 manual flow always supplies initialPanel and never enters this path.
  const result = await prisma.$transaction(async (tx) => {
    const scopedEpisode = await tx.novelPromotionEpisode.findFirst({
      where: {
        id: episodeId,
        novelPromotionProject: { projectId },
      },
      select: { id: true },
    })
    if (!scopedEpisode) throw new ApiError('NOT_FOUND')

    // 1. 创建新的 Clip（手动添加类型）
    const newClip = await tx.novelPromotionClip.create({
      data: {
        episodeId,
        summary: '手动添加的分镜组',
        content: '',
        location: null,
        characters: null,
        createdAt: newCreatedAt
      }
    })

    // 2. 创建关联的 Storyboard
    const newStoryboard = await tx.novelPromotionStoryboard.create({
      data: {
        episodeId,
        clipId: newClip.id,
        panelCount: 1
      }
    })

    // 3. 创建初始的 Panel
    const newPanel = await tx.novelPromotionPanel.create({
      data: {
        storyboardId: newStoryboard.id,
        panelIndex: 0,
        panelNumber: 1,
        shotType: '中景',
        cameraMove: '固定',
        description: '新镜头描述',
        characters: '[]',
        panelGenerationMode: defaultPanelGenerationMode({
          projectGenerationMode: episode.novelPromotionProject?.generationMode,
        })
      }
    })

    return { clip: newClip, storyboard: newStoryboard, panel: newPanel }
  })

  _ulogInfo(`[添加分镜组] episodeId=${episodeId}, clipId=${result.clip.id}, storyboardId=${result.storyboard.id}, insertAt=${insertAt}`)

  return NextResponse.json({
    success: true,
    clip: result.clip,
    storyboard: result.storyboard,
    panel: result.panel
  })
})

/**
 * PUT /api/novel-promotion/[projectId]/storyboard-group
 * 调整分镜组顺序（通过修改 clip 的 createdAt）
 */
export const PUT = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId : ''
  const clipId = typeof body?.clipId === 'string' ? body.clipId : ''
  const direction = body?.direction

  if (!episodeId || !clipId || (direction !== 'up' && direction !== 'down')) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取剧集和所有 clips（按 createdAt 排序）
  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProject: { projectId },
    },
    include: {
      clips: { orderBy: { createdAt: 'asc' } }
    }
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const clips = episode.clips
  const currentIndex = clips.findIndex(c => c.id === clipId)

  if (currentIndex === -1) {
    throw new ApiError('NOT_FOUND')
  }

  // 计算目标位置
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

  // 检查边界
  if (targetIndex < 0 || targetIndex >= clips.length) {
    throw new ApiError('INVALID_PARAMS')
  }

  const currentClip = clips[currentIndex]
  const targetClip = clips[targetIndex]

  // 交换两个 clip 的 createdAt（加减小量时间避免冲突）
  const tempTime = currentClip.createdAt.getTime()
  const targetTime = targetClip.createdAt.getTime()

  // 使用事务更新
  await prisma.$transaction(async (tx) => {
    // 先把当前 clip 移到一个临时时间
    const parkedCurrent = await tx.novelPromotionClip.updateMany({
      where: {
        id: currentClip.id,
        episodeId,
        episode: { novelPromotionProject: { projectId } },
      },
      data: { createdAt: new Date(0) } // 临时时间
    })
    if (parkedCurrent.count !== 1) throw new ApiError('NOT_FOUND')

    // 更新目标 clip 的时间
    const movedTarget = await tx.novelPromotionClip.updateMany({
      where: {
        id: targetClip.id,
        episodeId,
        episode: { novelPromotionProject: { projectId } },
      },
      data: { createdAt: new Date(tempTime) }
    })
    if (movedTarget.count !== 1) throw new ApiError('NOT_FOUND')

    // 更新当前 clip 到目标时间
    const movedCurrent = await tx.novelPromotionClip.updateMany({
      where: {
        id: currentClip.id,
        episodeId,
        episode: { novelPromotionProject: { projectId } },
      },
      data: { createdAt: new Date(targetTime) }
    })
    if (movedCurrent.count !== 1) throw new ApiError('NOT_FOUND')
  })

  _ulogInfo(`[移动分镜组] clipId=${clipId}, direction=${direction}, ${currentIndex} -> ${targetIndex}`)

  return NextResponse.json({ success: true })
})

/**
 * DELETE /api/novel-promotion/[projectId]/storyboard-group
 * 删除整个分镜组（Clip + Storyboard + 所有 Panels）
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
  const storyboardId = searchParams.get('storyboardId')

  if (!storyboardId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取 storyboard 及其关联的 clip
  const storyboard = await prisma.novelPromotionStoryboard.findFirst({
    where: {
      id: storyboardId,
      episode: { novelPromotionProject: { projectId } },
    },
    include: {
      panels: true,
      clip: true
    }
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND')
  }

  // 使用事务删除（Prisma 的 cascade 会自动处理关联删除，但我们显式删除以确保一致性）
  await prisma.$transaction(async (tx) => {
    // 1. 删除所有关联的 Panels
    await tx.novelPromotionPanel.deleteMany({
      where: {
        storyboardId,
        storyboard: {
          episode: { novelPromotionProject: { projectId } },
        },
      }
    })

    // 2. 删除 Storyboard
    const deletedStoryboard = await tx.novelPromotionStoryboard.deleteMany({
      where: {
        id: storyboardId,
        episode: { novelPromotionProject: { projectId } },
      },
    })
    if (deletedStoryboard.count !== 1) {
      throw new ApiError('NOT_FOUND')
    }

    // 3. 删除关联的 Clip（如果存在）
    if (storyboard.clipId) {
      const deletedClip = await tx.novelPromotionClip.deleteMany({
        where: {
          id: storyboard.clipId,
          episode: { novelPromotionProject: { projectId } },
        },
      })
      if (deletedClip.count !== 1) {
        throw new ApiError('NOT_FOUND')
      }
    }
  })

  _ulogInfo(`[删除分镜组] storyboardId=${storyboardId}, clipId=${storyboard.clipId}, panelCount=${storyboard.panels.length}`)

  return NextResponse.json({ success: true })
})
