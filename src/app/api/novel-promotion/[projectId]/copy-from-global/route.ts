import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { updateCharacterAppearanceLabels, updateLocationImageLabels } from '@/lib/image-label'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { assertNoVoiceLineTaskOutputReferences } from '@/lib/media/recursive-write-policy'
import { assertMediaObjectIdsDoNotReferenceVoiceLineTaskOutputs } from '@/lib/media/write-policy'
import {
    resolveCharacterVoiceWrite,
    VoiceSourceWritePolicyError,
    type CharacterVoiceClearData,
} from '@/lib/voice/character-voice-write-policy'

interface GlobalCharacterAppearanceSource {
    appearanceIndex: number
    changeReason: string
    description: string | null
    descriptions: string | null
    imageUrl: string | null
    imageUrls: string | null
    imageMediaId?: string | null
    selectedIndex: number | null
}

interface GlobalCharacterSource {
    name: string
    voiceId: string | null
    voiceType: string | null
    customVoiceUrl: string | null
    customVoiceMediaId: string | null
    appearances: GlobalCharacterAppearanceSource[]
}

interface GlobalLocationImageSource {
    imageIndex: number
    description: string | null
    imageUrl: string | null
    imageMediaId?: string | null
    isSelected: boolean
}

interface GlobalLocationSource {
    name: string
    summary: string | null
    images: GlobalLocationImageSource[]
}

interface GlobalVoiceSource {
    name: string
    voiceId: string | null
    voiceType: string | null
    customVoiceUrl: string | null
    customVoiceMediaId: string | null
}

interface CopyFromGlobalDb {
    globalCharacter: {
        findFirst(args: Record<string, unknown>): Promise<GlobalCharacterSource | null>
    }
    globalLocation: {
        findFirst(args: Record<string, unknown>): Promise<GlobalLocationSource | null>
    }
    globalVoice: {
        findFirst(args: Record<string, unknown>): Promise<GlobalVoiceSource | null>
    }
}

function requireClearOnlyVoiceWrite(source: {
    voiceId: string | null
    voiceType: string | null
    customVoiceUrl: string | null
    customVoiceMediaId: string | null
}): CharacterVoiceClearData {
    try {
        const decision = resolveCharacterVoiceWrite(source)
        if (decision.kind !== 'clear') throw new VoiceSourceWritePolicyError()
        return decision.data
    } catch (error) {
        if (error instanceof VoiceSourceWritePolicyError) {
            throw new ApiError('INVALID_PARAMS', { reason: error.code })
        }
        throw error
    }
}

/**
 * POST /api/novel-promotion/[projectId]/copy-from-global
 * 从资产中心复制角色/场景的形象数据到项目资产
 * 
 * 复制而非引用：即使全局资产被删除，项目资产也不受影响
 */
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params
    const db = prisma as unknown as CopyFromGlobalDb

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    const session = authResult.session

    const body = await request.json()
    const { type, targetId, globalAssetId } = body

    if (!type || !targetId || !globalAssetId) {
        throw new ApiError('INVALID_PARAMS')
    }

    if (type === 'character') {
        return await copyCharacterFromGlobal(db, projectId, session.user.id, targetId, globalAssetId)
    } else if (type === 'location') {
        return await copyLocationFromGlobal(db, session.user.id, targetId, globalAssetId)
    } else if (type === 'voice') {
        return await copyVoiceFromGlobal(projectId, session.user.id, targetId, globalAssetId)
    } else {
        throw new ApiError('INVALID_PARAMS')
    }
})

/**
 * 复制全局角色的形象到项目角色
 */
async function copyCharacterFromGlobal(
    db: CopyFromGlobalDb,
    projectId: string,
    userId: string,
    targetId: string,
    globalCharacterId: string,
) {
    _ulogInfo(`[Copy from Global] 复制角色: global=${globalCharacterId} -> project=${targetId}`)

    // Resolve the nested target before reading/copying any global asset. A
    // foreign character must never cause appearance or voice writes.
    const projectCharacter = await prisma.novelPromotionCharacter.findFirst({
        where: { id: targetId, novelPromotionProject: { projectId } },
        include: { appearances: true }
    })

    if (!projectCharacter) {
        throw new ApiError('NOT_FOUND')
    }

    // 1. 获取全局角色及其形象
    const globalCharacter = await db.globalCharacter.findFirst({
        where: { id: globalCharacterId, userId },
        include: { appearances: true }
    })

    if (!globalCharacter) {
        throw new ApiError('NOT_FOUND')
    }

    await assertNoVoiceLineTaskOutputReferences(globalCharacter.appearances)
    await assertMediaObjectIdsDoNotReferenceVoiceLineTaskOutputs(
        globalCharacter.appearances.flatMap((appearance) => [appearance.imageMediaId]),
    )

    // Copying an asset may not smuggle a legacy custom voice binding into a
    // durable project character. With no consent schema, only a triple-null
    // clear is representable safely.
    const voiceClear = requireClearOnlyVoiceWrite(globalCharacter)

    // 4. 🔥 更新黑边标签：使用项目角色名替换资产中心的角色名
    _ulogInfo(`[Copy from Global] 更新黑边标签: ${globalCharacter.name} -> ${projectCharacter.name}`)
    const updatedLabels = await updateCharacterAppearanceLabels(
        globalCharacter.appearances.map((app) => ({
            imageUrl: app.imageUrl,
            imageUrls: encodeImageUrls(decodeImageUrlsFromDb(app.imageUrls, 'globalCharacterAppearance.imageUrls')),
            changeReason: app.changeReason
        })),
        projectCharacter.name
    )

    // 5-6. Recheck ownership and perform every database write atomically.
    const updatedCharacter = await prisma.$transaction(async (tx) => {
        const currentCharacter = await tx.novelPromotionCharacter.findFirst({
            where: { id: targetId, novelPromotionProject: { projectId } },
            include: { appearances: true },
        })
        if (!currentCharacter) throw new ApiError('NOT_FOUND')

        if (currentCharacter.appearances.length > 0) {
            await tx.characterAppearance.deleteMany({
                where: {
                    characterId: targetId,
                    character: { novelPromotionProject: { projectId } },
                },
            })
            _ulogInfo(`[Copy from Global] 删除了 ${currentCharacter.appearances.length} 个旧形象`)
        }

        for (let i = 0; i < globalCharacter.appearances.length; i++) {
            const app = globalCharacter.appearances[i]
            const labelUpdate = updatedLabels[i]
            const originalImageUrls = decodeImageUrlsFromDb(
                app.imageUrls,
                'globalCharacterAppearance.imageUrls',
            )
            await tx.characterAppearance.create({
                data: {
                    characterId: targetId,
                    appearanceIndex: app.appearanceIndex,
                    changeReason: app.changeReason,
                    description: app.description,
                    descriptions: app.descriptions,
                    imageUrl: labelUpdate?.imageUrl || app.imageUrl,
                    imageUrls: labelUpdate?.imageUrls || encodeImageUrls(originalImageUrls),
                    previousImageUrls: encodeImageUrls([]),
                    selectedIndex: app.selectedIndex,
                },
            })
        }

        const write = await tx.novelPromotionCharacter.updateMany({
            where: { id: targetId, novelPromotionProject: { projectId } },
            data: {
                sourceGlobalCharacterId: globalCharacterId,
                profileConfirmed: true,
                ...voiceClear,
            },
        })
        if (write.count !== 1) throw new ApiError('NOT_FOUND')

        const updated = await tx.novelPromotionCharacter.findFirst({
            where: { id: targetId, novelPromotionProject: { projectId } },
            include: { appearances: true },
        })
        if (!updated) throw new ApiError('NOT_FOUND')
        return updated
    })

    _ulogInfo(`[Copy from Global] 复制了 ${globalCharacter.appearances.length} 个形象（已更新标签）`)

    _ulogInfo(`[Copy from Global] 角色复制完成: ${projectCharacter.name}`)

    return NextResponse.json({
        success: true,
        character: updatedCharacter,
        copiedAppearancesCount: globalCharacter.appearances.length
    })
}

/**
 * 复制全局场景的图片到项目场景
 */
async function copyLocationFromGlobal(db: CopyFromGlobalDb, userId: string, targetId: string, globalLocationId: string) {
    _ulogInfo(`[Copy from Global] 复制场景: global=${globalLocationId} -> project=${targetId}`)

    // 1. 获取全局场景及其图片
    const globalLocation = await db.globalLocation.findFirst({
        where: { id: globalLocationId, userId },
        include: { images: true }
    })

    if (!globalLocation) {
        throw new ApiError('NOT_FOUND')
    }

    await assertNoVoiceLineTaskOutputReferences(globalLocation.images)
    await assertMediaObjectIdsDoNotReferenceVoiceLineTaskOutputs(
        globalLocation.images.flatMap((image) => [image.imageMediaId]),
    )

    // 2. 获取项目场景
    const projectLocation = await prisma.novelPromotionLocation.findUnique({
        where: { id: targetId },
        include: { images: true }
    })

    if (!projectLocation) {
        throw new ApiError('NOT_FOUND')
    }

    // 3. 删除项目场景的旧图片
    if (projectLocation.images.length > 0) {
        await prisma.locationImage.deleteMany({
            where: { locationId: targetId }
        })
        _ulogInfo(`[Copy from Global] 删除了 ${projectLocation.images.length} 个旧图片`)
    }

    // 4. 🔥 更新黑边标签：使用项目场景名替换资产中心的场景名
    _ulogInfo(`[Copy from Global] 更新黑边标签: ${globalLocation.name} -> ${projectLocation.name}`)
    const updatedLabels = await updateLocationImageLabels(
        globalLocation.images.map((img) => ({
            imageUrl: img.imageUrl
        })),
        projectLocation.name
    )

    // 5. 复制全局图片到项目（使用更新后的图片URL）
    const copiedImages: Array<{ id: string; imageIndex: number; imageUrl: string | null }> = []
    for (let i = 0; i < globalLocation.images.length; i++) {
        const img = globalLocation.images[i]
        const labelUpdate = updatedLabels[i]

        const newImage = await prisma.locationImage.create({
            data: {
                locationId: targetId,
                imageIndex: img.imageIndex,
                description: img.description,
                // 🔥 使用更新了标签的新图片URL
                imageUrl: labelUpdate?.imageUrl || img.imageUrl,
                isSelected: img.isSelected
            }
        })
        copiedImages.push(newImage)
    }
    _ulogInfo(`[Copy from Global] 复制了 ${copiedImages.length} 个图片（已更新标签）`)

    const selectedFromGlobal = globalLocation.images.find((img) => img.isSelected)
    const selectedImageId = selectedFromGlobal
        ? copiedImages.find(i => i.imageIndex === selectedFromGlobal.imageIndex)?.id
        : copiedImages.find(i => i.imageUrl)?.id || null
    await prisma.novelPromotionLocation.update({
        where: { id: targetId },
        data: { selectedImageId }
    })

    // 6. 更新项目场景：记录来源ID 和 summary
    const updatedLocation = await prisma.novelPromotionLocation.update({
        where: { id: targetId },
        data: {
            sourceGlobalLocationId: globalLocationId,
            summary: globalLocation.summary
        },
        include: { images: true }
    })

    _ulogInfo(`[Copy from Global] 场景复制完成: ${projectLocation.name}`)

    return NextResponse.json({
        success: true,
        location: updatedLocation,
        copiedImagesCount: copiedImages.length
    })
}

/**
 * 复制全局音色到项目角色
 */
async function copyVoiceFromGlobal(
    projectId: string,
    userId: string,
    targetCharacterId: string,
    globalVoiceId: string,
) {
    _ulogInfo(`[Copy from Global] 复制音色: global=${globalVoiceId} -> project character=${targetCharacterId}`)

    const copied = await prisma.$transaction(async (tx) => {
        const projectCharacter = await tx.novelPromotionCharacter.findFirst({
            where: {
                id: targetCharacterId,
                novelPromotionProject: { projectId },
            },
        })
        if (!projectCharacter) throw new ApiError('NOT_FOUND')

        const globalVoice = await tx.globalVoice.findFirst({
            where: { id: globalVoiceId, userId },
        })
        if (!globalVoice) throw new ApiError('NOT_FOUND')

        const voiceClear = requireClearOnlyVoiceWrite(globalVoice)
        const write = await tx.novelPromotionCharacter.updateMany({
            where: {
                id: targetCharacterId,
                novelPromotionProject: { projectId },
            },
            data: voiceClear,
        })
        if (write.count !== 1) throw new ApiError('NOT_FOUND')

        const updatedCharacter = await tx.novelPromotionCharacter.findFirst({
            where: {
                id: targetCharacterId,
                novelPromotionProject: { projectId },
            },
        })
        if (!updatedCharacter) throw new ApiError('NOT_FOUND')
        return { projectCharacter, globalVoice, updatedCharacter }
    })

    _ulogInfo(`[Copy from Global] 音色复制完成: ${copied.projectCharacter.name} <- ${copied.globalVoice.name}`)

    return NextResponse.json({
        success: true,
        character: copied.updatedCharacter,
        voiceName: copied.globalVoice.name
    })
}
