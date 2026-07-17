import { logError as _ulogError, logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuth, requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { propagateCharacterRename } from '@/lib/novel-promotion/rename-propagation'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

// 更新角色信息（名字或介绍）
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
    characterId,
    name,
    introduction,
    voiceId,
    voiceType,
    customVoiceUrl,
  } = body

  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // P0 #2 — voice binding from v2 VoicePage. The "voice" payload is
  // optional and orthogonal to name/introduction; either group is a
  // valid update.
  const isVoiceUpdate = voiceId !== undefined || voiceType !== undefined || customVoiceUrl !== undefined
  if (!name && introduction === undefined && !isVoiceUpdate) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 构建更新数据
  const updateData: {
    name?: string
    introduction?: string
    voiceId?: string | null
    voiceType?: string | null
    customVoiceUrl?: string | null
  } = {}
  if (name) updateData.name = name.trim()
  if (introduction !== undefined) updateData.introduction = introduction.trim()
  if (voiceId !== undefined) updateData.voiceId = typeof voiceId === 'string' && voiceId ? voiceId : null
  if (voiceType !== undefined) updateData.voiceType = typeof voiceType === 'string' && voiceType ? voiceType : null
  if (customVoiceUrl !== undefined) updateData.customVoiceUrl = typeof customVoiceUrl === 'string' && customVoiceUrl ? customVoiceUrl : null

  // ⚠️ Multi-user isolation: ensure the character belongs to this project.
  // Also fetch the existing name so we can detect a rename + propagate
  // it to every panel that references the old name.
  const owned = await prisma.novelPromotionCharacter.findFirst({
    where: { id: characterId, novelPromotionProject: { projectId } },
    select: { id: true, name: true },
  })
  if (!owned) {
    throw new ApiError('NOT_FOUND')
  }

  // Phase R-2 (2026-05-22) — when name changes, atomically rewrite
  // every panel.characters JSON in the project that references the
  // old name. Pre-Phase-R-2 the catalog row updated but panels still
  // had the old name → multi-shot worker's findCharacterByName lookup
  // returned undefined → ref image silently dropped → renamed
  // character no longer anchored any shot.
  const isRename =
    typeof updateData.name === 'string' &&
    updateData.name.length > 0 &&
    updateData.name !== owned.name
  const oldName = owned.name

  const character = await prisma.$transaction(async (tx) => {
    const updated = await tx.novelPromotionCharacter.update({
      where: { id: characterId },
      data: updateData,
    })
    if (isRename) {
      const result = await propagateCharacterRename(tx, projectId, oldName, updated.name)
      _ulogInfo(
        `✓ 角色改名 propagated: "${oldName}" → "${updated.name}" — ${result.panelsRewritten}/${result.panelsScanned} panels rewritten`,
      )
    }
    return updated
  })

  return NextResponse.json({ success: true, character })
})

// 删除角色（级联删除关联的形象记录）
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const characterId = searchParams.get('id')

  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // ⚠️ Multi-user isolation: ensure the character belongs to this project.
  const owned = await prisma.novelPromotionCharacter.findFirst({
    where: { id: characterId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!owned) {
    throw new ApiError('NOT_FOUND')
  }

  // 删除角色（CharacterAppearance 会级联删除）
  await prisma.novelPromotionCharacter.delete({
    where: { id: characterId }
  })

  return NextResponse.json({ success: true })
})

// 新增角色
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
  const taskLocale = resolveTaskLocale(request, body)
  const bodyMeta = toObject((body as Record<string, unknown>).meta)
  const acceptLanguage = request.headers.get('accept-language') || ''
  const {
    name,
    description,
    referenceImageUrl,
    referenceImageUrls,
    generateFromReference,
    artStyle,
    customDescription,  // 🔥 新增：文生图模式使用的自定义描述
    episodeId,
  } = body

  if (!name) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 🔥 支持多张参考图（最多 5 张），兼容单张旧格式
  let allReferenceImages: string[] = []
  if (referenceImageUrls && Array.isArray(referenceImageUrls)) {
    allReferenceImages = referenceImageUrls.slice(0, 5)
  } else if (referenceImageUrl) {
    allReferenceImages = [referenceImageUrl]
  }

  const descText = description?.trim() || `${name.trim()} 的角色设定`
  const normalizedEpisodeId = typeof episodeId === 'string' ? episodeId.trim() : ''
  const { character, appearance } = await prisma.$transaction(async (tx) => {
    if (normalizedEpisodeId) {
      const episode = await tx.novelPromotionEpisode.findFirst({
        where: { id: normalizedEpisodeId, novelPromotionProjectId: novelData.id },
        select: { id: true },
      })
      if (!episode) throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_FOUND' })
    }

    const createdCharacter = await tx.novelPromotionCharacter.create({
      data: {
        novelPromotionProjectId: novelData.id,
        name: name.trim(),
        aliases: null,
      },
    })
    const createdAppearance = await tx.characterAppearance.create({
      data: {
        characterId: createdCharacter.id,
        appearanceIndex: PRIMARY_APPEARANCE_INDEX,
        changeReason: '初始形象',
        description: descText,
        descriptions: JSON.stringify([descText]),
        imageUrls: encodeImageUrls([]),
        previousImageUrls: encodeImageUrls([]),
      },
    })
    if (normalizedEpisodeId) {
      await tx.episodeCharacter.create({
        data: {
          episodeId: normalizedEpisodeId,
          characterId: createdCharacter.id,
          appearanceId: createdAppearance.id,
          role: 'manual',
        },
      })
    }
    return { character: createdCharacter, appearance: createdAppearance }
  })

  if (generateFromReference && allReferenceImages.length > 0) {
    const { getBaseUrl } = await import('@/lib/env')
    const baseUrl = getBaseUrl()
    fetch(`${baseUrl}/api/novel-promotion/${projectId}/reference-to-character`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || '',
        ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {})
      },
      body: JSON.stringify({
        referenceImageUrls: allReferenceImages,
        characterName: name.trim(),
        characterId: character.id,
        appearanceId: appearance.id,
        isBackgroundJob: true,
        artStyle: artStyle || 'american-comic',
        customDescription: customDescription || undefined,  // 🔥 传递自定义描述（文生图模式）
        locale: taskLocale || undefined,
        meta: {
          ...bodyMeta,
          locale: taskLocale || bodyMeta.locale || undefined,
        },
      })
    }).catch(err => {
      _ulogError('[Character API] 参考图后台生成任务触发失败:', err)
    })
  } else if (description?.trim()) {
    // 普通创建：触发后台图片生成
    const { getBaseUrl } = await import('@/lib/env')
    const baseUrl = getBaseUrl()
    fetch(`${baseUrl}/api/novel-promotion/${projectId}/generate-character-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || '',
        ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {})
      },
      body: JSON.stringify({
        characterId: character.id,
        appearanceIndex: PRIMARY_APPEARANCE_INDEX,
        artStyle: artStyle || 'american-comic',
        locale: taskLocale || undefined,
        meta: {
          ...bodyMeta,
          locale: taskLocale || bodyMeta.locale || undefined,
        },
      })
    }).catch(err => {
      _ulogError('[Character API] 后台图片生成任务触发失败:', err)
    })
  }

  // 返回包含形象的角色数据
  const characterWithAppearances = await prisma.novelPromotionCharacter.findUnique({
    where: { id: character.id },
    include: { appearances: true }
  })

  return NextResponse.json({ success: true, character: characterWithAppearances })
})
