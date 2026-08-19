import { logInfo as _ulogInfo, logWarn as _ulogWarn } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteCOSObject } from '@/lib/cos'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST - 为现有角色添加子形象
 * Body: { characterId, changeReason, description, episodeId? }
 *
 * episodeId 有值时，造型与该集的 EpisodeCharacter 绑定在同一交易写入。
 * episodeId 缺省时只建立项目造型目录记录，不推断或改写任何剧集绑定。
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId, { action: 'write' })
  if (isErrorResponse(authResult)) return authResult

  const body = (await request.json()) as {
    characterId?: unknown
    changeReason?: unknown
    description?: unknown
    episodeId?: unknown
  }
  const characterId = typeof body.characterId === 'string' ? body.characterId.trim() : ''
  const changeReason = typeof body.changeReason === 'string' ? body.changeReason.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const hasEpisodeId = body.episodeId !== undefined && body.episodeId !== null
  const episodeId = typeof body.episodeId === 'string' ? body.episodeId.trim() : ''

  if (!characterId || !changeReason || !description || (hasEpisodeId && !episodeId)) {
    throw new ApiError('INVALID_PARAMS')
  }

  // URL project 是第一层权限边界；foreign character 对外统一表现为不存在。
  const character = await prisma.novelPromotionCharacter.findFirst({
    where: {
      id: characterId,
      novelPromotionProject: { projectId },
    },
    select: {
      id: true,
      name: true,
      novelPromotionProjectId: true,
      appearances: {
        orderBy: { appearanceIndex: 'asc' },
        select: { appearanceIndex: true },
      },
    },
  })

  if (!character) {
    throw new ApiError('NOT_FOUND')
  }

  // 若指定集数，必须与已验证角色属于同一个 NovelPromotionProject。
  // 在写交易前完成链路验证，避免先建 catalog row 再发现 binding 非法。
  if (episodeId) {
    const episode = await prisma.novelPromotionEpisode.findFirst({
      where: {
        id: episodeId,
        novelPromotionProjectId: character.novelPromotionProjectId,
      },
      select: { id: true },
    })
    if (!episode) {
      throw new ApiError('NOT_FOUND')
    }
  }

  const maxIndex = character.appearances.reduce(
    (max, app) => Math.max(max, app.appearanceIndex),
    0
  )
  const newIndex = maxIndex + 1

  const newAppearance = await prisma.$transaction(async (tx) => {
    const appearance = await tx.characterAppearance.create({
      data: {
        characterId,
        appearanceIndex: newIndex,
        changeReason,
        description,
        descriptions: JSON.stringify([description]),
        imageUrls: encodeImageUrls([]),
        previousImageUrls: encodeImageUrls([]),
      },
    })

    if (episodeId) {
      await tx.episodeCharacter.upsert({
        where: {
          episodeId_characterId: {
            episodeId,
            characterId,
          },
        },
        update: { appearanceId: appearance.id },
        create: {
          episodeId,
          characterId,
          appearanceId: appearance.id,
          role: 'manual',
        },
      })
    }

    return appearance
  })

  _ulogInfo(
    `✓ 添加子形象: ${character.name} - ${changeReason} (index: ${newIndex}, episode=${episodeId || 'catalog-only'})`,
  )

  return NextResponse.json({
    success: true,
    appearance: newAppearance
  })
})

/**
 * PATCH - 更新角色形象描述与/或造型名稱(changeReason)
 *
 * Body: {
 *   characterId,
 *   appearanceId,
 *   description?,        // 任一非空才更新對應欄位
 *   changeReason?,
 *   descriptionIndex?
 * }
 *
 * 設計:description 與 changeReason 各自可選,讓前端可以單獨改名或單獨
 * 改描述,不會被另一條欄位的空字串誤洗。但兩者都缺時是無效呼叫(400)。
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
  const { characterId, appearanceId, description, changeReason, descriptionIndex } = body

  if (!characterId || !appearanceId) {
    throw new ApiError('INVALID_PARAMS')
  }
  const hasDescription = typeof description === 'string' && description.trim().length > 0
  const hasChangeReason = typeof changeReason === 'string' && changeReason.trim().length > 0
  if (!hasDescription && !hasChangeReason) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'NO_FIELDS_TO_UPDATE',
      message: 'description 或 changeReason 至少要傳一個非空字串',
    })
  }

  // 验证形象存在
  const appearance = await prisma.characterAppearance.findUnique({
    where: { id: appearanceId },
    include: { character: { include: { novelPromotionProject: true } } }
  })

  if (!appearance) {
    throw new ApiError('NOT_FOUND')
  }

  if (appearance.characterId !== characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 验证角色属于当前项目
  if (appearance.character.novelPromotionProject.projectId !== projectId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Build the update payload conditionally so an empty changeReason
  // doesn't blow away the existing one.
  const updateData: {
    description?: string
    descriptions?: string
    changeReason?: string
  } = {}

  if (hasDescription) {
    const trimmedDesc = description.trim()
    let descriptions: string[] = []
    try {
      descriptions = appearance.descriptions ? JSON.parse(appearance.descriptions) : []
    } catch {
      descriptions = []
    }
    const idx = typeof descriptionIndex === 'number' ? descriptionIndex : 0
    if (idx >= 0 && idx < descriptions.length) {
      descriptions[idx] = trimmedDesc
    } else {
      descriptions.push(trimmedDesc)
    }
    updateData.description = trimmedDesc
    updateData.descriptions = JSON.stringify(descriptions)
  }
  if (hasChangeReason) {
    updateData.changeReason = changeReason.trim()
  }

  await prisma.characterAppearance.update({
    where: { id: appearanceId },
    data: updateData,
  })

  _ulogInfo(
    `✓ 更新形象: ${appearance.character.name} - ${appearance.changeReason || '形象' + appearance.appearanceIndex}` +
      (hasDescription ? ' [desc]' : '') +
      (hasChangeReason ? ' [name]' : ''),
  )

  return NextResponse.json({
    success: true
  })
})

/**
 * DELETE - 删除单个角色形象
 * Query params: characterId, appearanceId
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
  const characterId = searchParams.get('characterId')
  const appearanceId = searchParams.get('appearanceId')

  if (!characterId || !appearanceId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 获取形象记录
  const appearance = await prisma.characterAppearance.findUnique({
    where: { id: appearanceId },
    include: { character: true }
  })

  if (!appearance) {
    throw new ApiError('NOT_FOUND')
  }

  if (appearance.characterId !== characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 检查是否是最后一个形象
  const appearanceCount = await prisma.characterAppearance.count({
    where: { characterId }
  })

  if (appearanceCount <= 1) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 删除 COS 中的图片
  const deletedImages: string[] = []

  // 删除主图片
  if (appearance.imageUrl) {
    const key = await resolveStorageKeyFromMediaValue(appearance.imageUrl)
    if (key) {
      try {
        await deleteCOSObject(key)
        deletedImages.push(key)
      } catch {
        _ulogWarn('Failed to delete COS image:', key)
      }
    }
  }

  // 删除图片数组中的所有图片
  try {
    const urls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
    for (const url of urls) {
      if (url) {
        const key = await resolveStorageKeyFromMediaValue(url)
        if (key && !deletedImages.includes(key)) {
          try {
            await deleteCOSObject(key)
            deletedImages.push(key)
          } catch {
            _ulogWarn('Failed to delete COS image:', key)
          }
        }
      }
    }
  } catch {
    // contract violation is surfaced by migration/validation scripts; keep delete idempotent
  }

  // 删除数据库记录
  await prisma.characterAppearance.delete({
    where: { id: appearanceId }
  })

  // 重新排序剩余形象的 appearanceIndex
  const remainingAppearances = await prisma.characterAppearance.findMany({
    where: { characterId },
    orderBy: { appearanceIndex: 'asc' }
  })

  for (let i = 0; i < remainingAppearances.length; i++) {
    if (remainingAppearances[i].appearanceIndex !== i) {
      await prisma.characterAppearance.update({
        where: { id: remainingAppearances[i].id },
        data: { appearanceIndex: i }
      })
    }
  }

  _ulogInfo(`✓ 删除形象: ${appearance.character.name} - ${appearance.changeReason || '形象' + appearance.appearanceIndex}`)
  _ulogInfo(`✓ 删除了 ${deletedImages.length} 张 COS 图片`)

  return NextResponse.json({
    success: true,
    deletedImages: deletedImages.length
  })
})
