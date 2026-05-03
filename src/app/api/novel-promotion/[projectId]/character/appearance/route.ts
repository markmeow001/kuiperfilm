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
 * Body: { characterId, changeReason, description }
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
  const { characterId, changeReason, description } = body

  if (!characterId || !changeReason || !description) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 验证角色存在
  const character = await prisma.novelPromotionCharacter.findUnique({
    where: { id: characterId },
    include: {
      appearances: { orderBy: { appearanceIndex: 'asc' } },
      novelPromotionProject: true
    }
  })

  if (!character) {
    throw new ApiError('NOT_FOUND')
  }

  // 验证角色属于当前项目
  if (character.novelPromotionProject.projectId !== projectId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 计算新的 appearanceIndex
  const maxIndex = character.appearances.reduce(
    (max, app) => Math.max(max, app.appearanceIndex),
    0
  )
  const newIndex = maxIndex + 1

  // 创建子形象
  const newAppearance = await prisma.characterAppearance.create({
    data: {
      characterId,
      appearanceIndex: newIndex,
      changeReason: changeReason.trim(),
      description: description.trim(),
      descriptions: JSON.stringify([description.trim()]),
      imageUrls: encodeImageUrls([]),
      previousImageUrls: encodeImageUrls([])}
  })

  _ulogInfo(`✓ 添加子形象: ${character.name} - ${changeReason} (index: ${newIndex})`)

  // 2026-05-04 — auto-bind 新 appearance 到專案內每一集。
  //
  // 起因:iangyc 報「上傳了角色圖但生圖沒用到」。trace 發現 user
  // 上傳新造型後 EpisodeCharacter.appearanceId 仍是 NULL,worker 走
  // fallback 用 appearance[0](初始形象),不是 user 上傳的那張。
  //
  // 設計選擇:user 明確要求(2026-05-04)「之後每一集上傳角色後都會
  // 自動綁定在同一個專案內」。從此每次新增 appearance 視為「換臉宣告」,
  // 套用到該角色在所有 episode 的 binding;最新上傳 wins。
  //
  // 取捨:這會破壞「ep1-10 用 appearance A, ep11+ 用 appearance B」
  // 的 multi-appearance use case。但內部 10-20 人 TikTok 短劇場景下,
  // user 直覺「上傳=換臉」遠優先。需要跨集區間造型時 user 仍可在主體頁
  // 的「每集綁定」UI 手動 PATCH 覆寫。
  //
  // Best-effort:binding 失敗不應該擋住 appearance 建立(已回 200)。
  // 失敗只 log,不 throw。下次上傳會再 upsert 一次,自我修復。
  try {
    const episodes = await prisma.novelPromotionEpisode.findMany({
      where: { novelPromotionProjectId: character.novelPromotionProjectId },
      select: { id: true },
    })
    if (episodes.length > 0) {
      await prisma.$transaction(
        episodes.map((ep) =>
          prisma.episodeCharacter.upsert({
            where: {
              episodeId_characterId: {
                episodeId: ep.id,
                characterId,
              },
            },
            update: { appearanceId: newAppearance.id },
            create: {
              episodeId: ep.id,
              characterId,
              appearanceId: newAppearance.id,
              role: 'manual',
            },
          }),
        ),
      )
      _ulogInfo(
        `✓ 自動綁定 appearance ${newAppearance.id} 到 ${episodes.length} 集 (project=${projectId}, character=${character.name})`,
      )
    }
  } catch (bindErr) {
    _ulogWarn(
      `[appearance auto-bind] 綁定失敗(不影響 appearance 建立): ${(bindErr as Error)?.message ?? bindErr}`,
    )
  }

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
