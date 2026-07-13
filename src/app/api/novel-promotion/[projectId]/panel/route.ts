import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { serializeStructuredJsonField } from '@/lib/novel-promotion/panel-ai-data-sync'
import { defaultPanelGenerationMode } from '@/lib/novel-promotion/generation-mode'

/**
 * Phase 1.5C — fetch a project's generationMode for stamping a new panel.
 * Used only on the create-if-missing cold paths (PATCH/PUT), so the lookup
 * stays off the common update path. projectId is already auth-verified by
 * the caller's requireProjectAuthLight.
 */
async function fetchProjectGenerationMode(projectId: string): Promise<string | null> {
  const np = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { generationMode: true },
  })
  return np?.generationMode ?? null
}

function parseNullableNumberField(value: unknown): number | null {
  if (value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new ApiError('INVALID_PARAMS')
}

function toStructuredJsonField(value: unknown, fieldName: string): string | null {
  try {
    return serializeStructuredJsonField(value, fieldName)
  } catch (error) {
    const message = error instanceof Error ? error.message : `${fieldName} must be valid JSON`
    throw new ApiError('INVALID_PARAMS', { message })
  }
}

/**
 * POST /api/novel-promotion/[projectId]/panel
 * 新增一个 Panel
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
  const {
    storyboardId,
    shotType,
    cameraMove,
    description,
    location,
    characters,
    srtStart,
    srtEnd,
    duration,
    videoPrompt,
    firstLastFramePrompt,
    // 2026-05-13 — manual panel creation in multi-shot view needs to
    // immediately appear as a new group (otherwise the new panel has
    // multiShotGroupId=null and is invisible in the groups layout).
    // Caller passes a fresh group id (e.g. `manual-<uuid>`) so the
    // panel becomes its own 1-shot group; user can later use 自動切組
    // to merge it into a larger group or pick the auto-derived layout.
    multiShotGroupId,
    multiShotGroupOrder,
  } = body

  if (!storyboardId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 验证 storyboard 存在，并获取现有 panels 以计算正确的 panelIndex
  // ⚠️ Multi-user isolation: chain ownership through episode → project.
  const storyboard = await prisma.novelPromotionStoryboard.findFirst({
    where: {
      id: storyboardId,
      episode: { novelPromotionProject: { projectId } },
    },
    include: {
      panels: {
        orderBy: { panelIndex: 'desc' },
        take: 1
      },
      // Phase 1.5C — project-level mode decides the new panel's
      // panelGenerationMode (r2v-narrative → r2v_with_subjects).
      episode: {
        select: { novelPromotionProject: { select: { generationMode: true } } }
      }
    }
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND')
  }

  // 自动计算正确的 panelIndex（取最大值 + 1，避免唯一约束冲突）
  const maxPanelIndex = storyboard.panels.length > 0 ? storyboard.panels[0].panelIndex : -1
  const newPanelIndex = maxPanelIndex + 1
  const newPanelNumber = newPanelIndex + 1

  // 创建新的 Panel 记录
  const newPanel = await prisma.novelPromotionPanel.create({
    data: {
      storyboardId,
      panelIndex: newPanelIndex,
      panelNumber: newPanelNumber,
      shotType: shotType ?? null,
      cameraMove: cameraMove ?? null,
      description: description ?? null,
      location: location ?? null,
      characters: characters ?? null,
      srtStart: srtStart ?? null,
      srtEnd: srtEnd ?? null,
      duration: duration ?? null,
      videoPrompt: videoPrompt ?? null,
      firstLastFramePrompt: firstLastFramePrompt ?? null,
      multiShotGroupId: typeof multiShotGroupId === 'string' && multiShotGroupId.length > 0
        ? multiShotGroupId
        : null,
      multiShotGroupOrder: typeof multiShotGroupOrder === 'number'
        ? multiShotGroupOrder
        : null,
      panelGenerationMode: defaultPanelGenerationMode({
        projectGenerationMode: storyboard.episode?.novelPromotionProject?.generationMode,
      }),
    }
  })

  // 更新 panelCount
  const panelCount = await prisma.novelPromotionPanel.count({
    where: { storyboardId }
  })

  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: { panelCount }
  })

  return NextResponse.json({ success: true, panel: newPanel })
})

/**
 * DELETE /api/novel-promotion/[projectId]/panel
 * 删除一个 Panel
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
  const panelId = searchParams.get('panelId')

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取要删除的 Panel 信息
  // ⚠️ Multi-user isolation: chain ownership through storyboard → episode → project.
  const panel = await prisma.novelPromotionPanel.findFirst({
    where: {
      id: panelId,
      storyboard: { episode: { novelPromotionProject: { projectId } } },
    },
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  const storyboardId = panel.storyboardId

  // 使用事务确保删除和重新排序的原子性
  // 采用原始 SQL 批量更新以避免循环导致的性能问题
  await prisma.$transaction(async (tx) => {
    // 1. 删除 Panel
    await tx.novelPromotionPanel.delete({
      where: { id: panelId }
    })

    // 2. 使用原始 SQL 批量重新排序所有 panels
    // 先获取已删除 panel 的原始索引，用于确定需要更新的范围
    const deletedPanelIndex = panel.panelIndex

    // 使用 Prisma 批量更新，采用两阶段偏移避免唯一约束冲突
    const maxPanel = await tx.novelPromotionPanel.findFirst({
      where: { storyboardId },
      orderBy: { panelIndex: 'desc' },
      select: { panelIndex: true }
    })
    const maxPanelIndex = maxPanel?.panelIndex ?? -1
    const offset = maxPanelIndex + 1000

    // 阶段1：整体上移，避免与原索引冲突
    await tx.novelPromotionPanel.updateMany({
      where: {
        storyboardId,
        panelIndex: { gt: deletedPanelIndex }
      },
      data: {
        panelIndex: { increment: offset },
        panelNumber: { increment: offset }
      }
    })

    // 阶段2：回落到正确位置（整体 -offset -1）
    await tx.novelPromotionPanel.updateMany({
      where: {
        storyboardId,
        panelIndex: { gt: deletedPanelIndex + offset }
      },
      data: {
        panelIndex: { decrement: offset + 1 },
        panelNumber: { decrement: offset + 1 }
      }
    })

    // 3. 获取更新后的 panel 总数
    const panelCount = await tx.novelPromotionPanel.count({
      where: { storyboardId }
    })

    // 4. 更新 storyboard 的 panelCount
    await tx.novelPromotionStoryboard.update({
      where: { id: storyboardId },
      data: { panelCount }
    })
  }, {
    maxWait: 15000, // 等待事务开始的最长时间：15 秒
    timeout: 30000  // 事务执行超时：30 秒 (针对大量 panels 的批量更新)
  })

  return NextResponse.json({ success: true })
})

/**
 * PATCH /api/novel-promotion/[projectId]/panel
 * 更新单个 Panel 的属性（视频提示词等）
 * 支持两种更新方式：
 * 1. 通过 panelId 直接更新（推荐，用于清除错误等操作）
 * 2. 通过 storyboardId + panelIndex 更新（兼容旧接口）
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const {
    panelId,
    storyboardId,
    panelIndex,
    videoPrompt,
    firstLastFramePrompt,
    description, // V2 storyboard editor — scene/composition prompt
    srtSegment,  // V2 storyboard editor — dialogue/subtitle text
    characters,  // V2 storyboard editor — JSON string of panel.characters
                 // (used by 出場角色 chip × remove flow, 2026-05-13)
    location,    // V2 storyboard editor — scene name (used by 場景 chip × remove)
    groupNarrative, // V2 narrative editor 保存敘事 — group draft on the FIRST
                    // panel (string = save, null = clear via 重生敘事, 2026-07-13)
    groupDurationSec, // V2 narrative editor 時長 pick — number = save, null = Auto
  } = body

  // 🔥 方式1：通过 panelId 直接更新（优先）
  if (panelId) {
    // ⚠️ Multi-user isolation: chain through storyboard → episode → project.
    const panel = await prisma.novelPromotionPanel.findFirst({
      where: {
        id: panelId,
        storyboard: { episode: { novelPromotionProject: { projectId } } },
      },
    })

    if (!panel) {
      throw new ApiError('NOT_FOUND')
    }

    // 构建更新数据
    const updateData: {
      videoPrompt?: string | null
      firstLastFramePrompt?: string | null
      description?: string | null
      srtSegment?: string | null
      characters?: string | null
      location?: string | null
      groupNarrative?: string | null
      groupDurationSec?: number | null
    } = {}
    if (groupDurationSec !== undefined) {
      if (groupDurationSec === null) {
        updateData.groupDurationSec = null
      } else if (typeof groupDurationSec === 'number' && Number.isInteger(groupDurationSec) && groupDurationSec > 0 && groupDurationSec <= 600) {
        updateData.groupDurationSec = groupDurationSec
      } else {
        throw new ApiError('INVALID_PARAMS', { message: 'groupDurationSec must be null or an integer 1-600' })
      }
    }
    if (groupNarrative !== undefined) {
      if (groupNarrative === null) {
        updateData.groupNarrative = null
      } else if (typeof groupNarrative === 'string') {
        updateData.groupNarrative = groupNarrative.trim() || null
      } else {
        throw new ApiError('INVALID_PARAMS', { message: 'groupNarrative must be null or string' })
      }
    }
    if (videoPrompt !== undefined) updateData.videoPrompt = videoPrompt
    if (firstLastFramePrompt !== undefined) updateData.firstLastFramePrompt = firstLastFramePrompt
    if (description !== undefined) {
      const trimmed = typeof description === 'string' ? description : null
      updateData.description = trimmed
    }
    if (srtSegment !== undefined) {
      const trimmed = typeof srtSegment === 'string' ? srtSegment : null
      updateData.srtSegment = trimmed
    }
    if (characters !== undefined) {
      // Accept either a JSON-string (legacy) or an array (preferred). Always
      // persist as a JSON string so the column shape stays consistent.
      if (characters === null) {
        updateData.characters = null
      } else if (typeof characters === 'string') {
        updateData.characters = characters
      } else if (Array.isArray(characters)) {
        updateData.characters = JSON.stringify(characters)
      } else {
        throw new ApiError('INVALID_PARAMS', { message: 'characters must be null, string, or array' })
      }
    }
    if (location !== undefined) {
      // Accept string (set) or null (clear). Worker treats null as 'no scene
      // ref' and frees up that SubjectInfos slot for character/prop refs.
      if (location === null) {
        updateData.location = null
      } else if (typeof location === 'string') {
        updateData.location = location.trim() || null
      } else {
        throw new ApiError('INVALID_PARAMS', { message: 'location must be null or string' })
      }
    }

    await prisma.novelPromotionPanel.update({
      where: { id: panelId },
      data: updateData
    })

    return NextResponse.json({ success: true })
  }

  // 🔥 方式2：通过 storyboardId + panelIndex 更新（兼容旧接口）
  if (!storyboardId || panelIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 验证 storyboard 存在
  // ⚠️ Multi-user isolation: chain through episode → project.
  const storyboard = await prisma.novelPromotionStoryboard.findFirst({
    where: {
      id: storyboardId,
      episode: { novelPromotionProject: { projectId } },
    },
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND')
  }

  // 构建更新数据
  const updateData: {
    videoPrompt?: string | null
    firstLastFramePrompt?: string | null
  } = {}
  if (videoPrompt !== undefined) {
    updateData.videoPrompt = videoPrompt
  }
  if (firstLastFramePrompt !== undefined) {
    updateData.firstLastFramePrompt = firstLastFramePrompt
  }

  // 尝试更新 Panel
  const updatedPanel = await prisma.novelPromotionPanel.updateMany({
    where: {
      storyboardId,
      panelIndex
    },
    data: updateData
  })

  // 如果 Panel 不存在，创建它（Panel 表是唯一数据源）
  if (updatedPanel.count === 0) {
    // 创建新的 Panel 记录
    await prisma.novelPromotionPanel.create({
      data: {
        storyboardId,
        panelIndex,
        panelNumber: panelIndex + 1,
        imageUrl: null,
        videoPrompt: videoPrompt ?? null,
        firstLastFramePrompt: firstLastFramePrompt ?? null,
        panelGenerationMode: defaultPanelGenerationMode({
          projectGenerationMode: await fetchProjectGenerationMode(projectId),
        }),
      }
    })
  }

  return NextResponse.json({ success: true })
})

/**
 * PUT /api/novel-promotion/[projectId]/panel
 * 完整更新单个 Panel 的所有属性（用于文字分镜编辑）
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
  const {
    storyboardId,
    panelIndex,
    panelNumber,
    shotType,
    cameraMove,
    description,
    location,
    characters,
    srtStart,
    srtEnd,
    duration,
    videoPrompt,
    firstLastFramePrompt,
    actingNotes,  // 演技指导数据
    photographyRules,  // 单镜头摄影规则
  } = body

  if (!storyboardId || panelIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 验证 storyboard 存在
  // ⚠️ Multi-user isolation: chain through episode → project.
  const storyboard = await prisma.novelPromotionStoryboard.findFirst({
    where: {
      id: storyboardId,
      episode: { novelPromotionProject: { projectId } },
    },
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND')
  }

  // 构建更新数据 - 包含所有可编辑字段
  const updateData: {
    panelNumber?: number | null
    shotType?: string | null
    cameraMove?: string | null
    description?: string | null
    location?: string | null
    characters?: string | null
    srtStart?: number | null
    srtEnd?: number | null
    duration?: number | null
    videoPrompt?: string | null
    firstLastFramePrompt?: string | null
    actingNotes?: string | null
    photographyRules?: string | null
  } = {}
  if (panelNumber !== undefined) updateData.panelNumber = panelNumber
  if (shotType !== undefined) updateData.shotType = shotType
  if (cameraMove !== undefined) updateData.cameraMove = cameraMove
  if (description !== undefined) updateData.description = description
  if (location !== undefined) updateData.location = location
  if (characters !== undefined) updateData.characters = characters
  if (srtStart !== undefined) updateData.srtStart = parseNullableNumberField(srtStart)
  if (srtEnd !== undefined) updateData.srtEnd = parseNullableNumberField(srtEnd)
  if (duration !== undefined) updateData.duration = parseNullableNumberField(duration)
  if (videoPrompt !== undefined) updateData.videoPrompt = videoPrompt
  if (firstLastFramePrompt !== undefined) updateData.firstLastFramePrompt = firstLastFramePrompt
  // JSON 字段存为规范化 JSON 字符串
  if (actingNotes !== undefined) {
    updateData.actingNotes = toStructuredJsonField(actingNotes, 'actingNotes')
  }
  if (photographyRules !== undefined) {
    updateData.photographyRules = toStructuredJsonField(photographyRules, 'photographyRules')
  }

  // 查找现有 Panel
  const existingPanel = await prisma.novelPromotionPanel.findUnique({
    where: {
      storyboardId_panelIndex: {
        storyboardId,
        panelIndex
      }
    }
  })

  if (existingPanel) {
    // 更新现有 Panel
    await prisma.novelPromotionPanel.update({
      where: { id: existingPanel.id },
      data: updateData
    })
  } else {
    // 创建新的 Panel 记录
    await prisma.novelPromotionPanel.create({
      data: {
        storyboardId,
        panelIndex,
        panelNumber: panelNumber ?? panelIndex + 1,
        shotType: shotType ?? null,
        cameraMove: cameraMove ?? null,
        description: description ?? null,
        location: location ?? null,
        characters: characters ?? null,
        srtStart: srtStart ?? null,
        srtEnd: srtEnd ?? null,
        duration: duration ?? null,
        videoPrompt: videoPrompt ?? null,
        firstLastFramePrompt: firstLastFramePrompt ?? null,
        actingNotes: actingNotes !== undefined ? toStructuredJsonField(actingNotes, 'actingNotes') : null,
        photographyRules: photographyRules !== undefined ? toStructuredJsonField(photographyRules, 'photographyRules') : null,
        panelGenerationMode: defaultPanelGenerationMode({
          projectGenerationMode: await fetchProjectGenerationMode(projectId),
        }),
      }
    })
  }

  // Panel 表是唯一数据源，不再同步到 storyboardTextJson
  // 只更新 panelCount 用于快速查询
  const panelCount = await prisma.novelPromotionPanel.count({
    where: { storyboardId }
  })

  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: { panelCount }
  })

  return NextResponse.json({ success: true })
})
