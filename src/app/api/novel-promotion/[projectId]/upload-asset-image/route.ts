import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteCOSObject, uploadToCOS, generateUniqueKey } from '@/lib/cos'
import sharp from 'sharp'
import { initializeFonts, createLabelSVG } from '@/lib/fonts'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import { detectSupportedImageType } from '@/lib/playground/image-file-type'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_INDEX = 31

interface CharacterAppearanceRecord {
  id: string
  imageUrls: string | null
  selectedIndex: number | null
}

interface LocationImageRecord {
  id: string
  imageIndex: number
}

interface LocationRecord {
  selectedImageId: string | null
  images?: LocationImageRecord[]
}

interface UploadAssetImageDb {
  $transaction<T>(callback: (transaction: UploadAssetImageDb) => Promise<T>): Promise<T>
  characterAppearance: {
    findFirst(args: Record<string, unknown>): Promise<CharacterAppearanceRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  novelPromotionLocation: {
    findFirst(args: Record<string, unknown>): Promise<LocationRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  locationImage: {
    update(args: Record<string, unknown>): Promise<{ id: string }>
    create(args: Record<string, unknown>): Promise<{ id: string }>
  }
  novelPromotionProp: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string } | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
}

type AssetType = 'character' | 'location' | 'prop'

function isAssetType(value: string): value is AssetType {
  return value === 'character' || value === 'location' || value === 'prop'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function persistUploadedAsset<T>(input: {
  projectId: string
  assetType: AssetType
  assetId: string
  imageKey: string
  persist: () => Promise<T>
}): Promise<T> {
  try {
    return await input.persist()
  } catch (persistenceError: unknown) {
    let cleanupError: unknown = null
    try {
      await deleteCOSObject(input.imageKey, { throwOnError: true })
    } catch (error: unknown) {
      cleanupError = error
    }

    createScopedLogger({
      module: 'api.upload-asset-image',
      action: 'asset_image_persistence_failed',
      projectId: input.projectId,
    }).error({
      action: 'asset_image_persistence_failed',
      message: 'asset image persistence failed after upload',
      details: {
        projectId: input.projectId,
        assetType: input.assetType,
        assetId: input.assetId,
        imageKey: input.imageKey,
        persistenceError: errorMessage(persistenceError),
        cleanupError: cleanupError === null ? null : errorMessage(cleanupError),
      },
    })

    throw new ApiError('INTERNAL_ERROR')
  }
}

/**
 * POST /api/novel-promotion/[projectId]/upload-asset-image
 * 上传用户自定义图片作为角色或场景资产
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const db = prisma as unknown as UploadAssetImageDb

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  // 解析表单数据
  const formData = await request.formData()
  const fileEntry = formData.get('file')
  const typeEntry = formData.get('type')
  const idEntry = formData.get('id')
  const appearanceIdEntry = formData.get('appearanceId')
  const imageIndexEntry = formData.get('imageIndex')
  const labelTextEntry = formData.get('labelText')

  if (
    !(fileEntry instanceof File)
    || typeof typeEntry !== 'string'
    || !isAssetType(typeEntry)
    || typeof idEntry !== 'string'
    || !idEntry
    || typeof labelTextEntry !== 'string'
    || !labelTextEntry
  ) {
    throw new ApiError('INVALID_PARAMS')
  }

  const file = fileEntry
  const type = typeEntry
  const id = idEntry
  const appearanceId = typeof appearanceIdEntry === 'string' && appearanceIdEntry
    ? appearanceIdEntry
    : null
  const imageIndex = typeof imageIndexEntry === 'string' && imageIndexEntry
    ? imageIndexEntry
    : null
  const labelText = labelTextEntry

  let appearance: CharacterAppearanceRecord | null = null
  let location: LocationRecord | null = null
  let prop: { id: string } | null = null

  if (type === 'character') {
    if (!appearanceId) {
      throw new ApiError('INVALID_PARAMS')
    }
    appearance = await db.characterAppearance.findFirst({
      where: {
        id: appearanceId,
        characterId: id,
        character: { novelPromotionProject: { projectId } },
      },
    })
    if (!appearance) {
      throw new ApiError('NOT_FOUND')
    }
  } else if (type === 'location') {
    location = await db.novelPromotionLocation.findFirst({
      where: { id, novelPromotionProject: { projectId } },
      include: { images: { orderBy: { imageIndex: 'asc' } } },
    })
    if (!location) {
      throw new ApiError('NOT_FOUND')
    }
  } else {
    prop = await db.novelPromotionProp.findFirst({
      where: { id, novelPromotionProject: { projectId } },
      select: { id: true },
    })
    if (!prop) {
      throw new ApiError('NOT_FOUND', { code: 'PROP_NOT_IN_PROJECT' })
    }
  }

  let parsedImageIndex: number | null = null
  if (imageIndex !== null) {
    if (!/^\d+$/.test(imageIndex)) {
      throw new ApiError('INVALID_PARAMS')
    }
    parsedImageIndex = Number(imageIndex)
    if (
      !Number.isSafeInteger(parsedImageIndex)
      || parsedImageIndex < 0
      || parsedImageIndex > MAX_IMAGE_INDEX
    ) {
      throw new ApiError('INVALID_PARAMS')
    }
  }

  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    throw new ApiError('INVALID_PARAMS')
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  if (
    buffer.length < 1
    || buffer.length > MAX_IMAGE_BYTES
    || detectSupportedImageType(buffer) === null
  ) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 初始化字体（在 Vercel 环境中需要）
  await initializeFonts()

  // 添加文字标识符
  const meta = await sharp(buffer).metadata()
  const w = meta.width || 2160
  const h = meta.height || 2160
  const fontSize = Math.floor(h * 0.04)
  const pad = Math.floor(fontSize * 0.5)
  const barH = fontSize + pad * 2

  // 创建SVG文字条
  const svg = await createLabelSVG(w, barH, fontSize, pad, labelText)

  // 添加文字条到图片顶部
  const processed = await sharp(buffer)
    .extend({ top: barH, bottom: 0, left: 0, right: 0, background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()

  // 生成唯一key并上传
  const keyPrefix = type === 'character'
    ? `char-${id}-${appearanceId}-upload`
    : type === 'prop'
      ? `prop-${id}-upload`
      : `loc-${id}-upload`
  const key = generateUniqueKey(keyPrefix, 'jpg')
  await uploadToCOS(processed, key)

  // 更新数据库
  if (type === 'character' && appearance !== null) {
    const { targetIndex } = await persistUploadedAsset({
      projectId,
      assetType: type,
      assetId: id,
      imageKey: key,
      persist: async () => {
        // 解析现有图片数组
        const imageUrls = decodeImageUrlsFromDb(
          appearance.imageUrls,
          'characterAppearance.imageUrls',
        )

        // 如果指定了imageIndex，替换对应位置的图片
        const targetIndex = parsedImageIndex ?? imageUrls.length

        // 确保数组足够大
        while (imageUrls.length <= targetIndex) {
          imageUrls.push('')
        }

        imageUrls[targetIndex] = key

        // 计算是否需要同步更新 imageUrl
        // 当上传的图片是选中的图片时，或者是第一张图片且没有选中任何图片时
        const selectedIndex = appearance.selectedIndex
        const shouldUpdateImageUrl =
          selectedIndex === targetIndex ||  // 上传的是选中的图片
          (selectedIndex === null && targetIndex === 0) ||  // 没有选中任何图片，上传的是第一张
          imageUrls.filter(u => !!u).length === 1  // 只有一张有效图片

        const updateData: Record<string, unknown> = {
          imageUrls: encodeImageUrls(imageUrls)
        }

        if (shouldUpdateImageUrl) {
          updateData.imageUrl = key
        }

        await db.characterAppearance.update({
          where: { id: appearance.id },
          data: updateData,
        })

        return { targetIndex }
      },
    })

    return NextResponse.json({
      success: true,
      imageKey: key,
      imageIndex: targetIndex
    })

  } else if (type === 'location' && location !== null) {
    const { returnImageIndex } = await persistUploadedAsset({
      projectId,
      assetType: type,
      assetId: id,
      imageKey: key,
      persist: async () => db.$transaction(async (transaction) => {
        // 如果指定了imageIndex，更新对应的图片记录
        let returnImageIndex: number
        if (parsedImageIndex !== null) {
          const targetImageIndex = parsedImageIndex
          const existingImage = location.images?.find((img) => img.imageIndex === targetImageIndex)
          returnImageIndex = targetImageIndex

          if (existingImage) {
            const updated = await transaction.locationImage.update({
              where: { id: existingImage.id },
              data: { imageUrl: key }
            })
            if (!location.selectedImageId) {
              await transaction.novelPromotionLocation.update({
                where: { id },
                data: { selectedImageId: updated.id }
              })
            }
          } else {
            const created = await transaction.locationImage.create({
              data: {
                locationId: id,
                imageIndex: targetImageIndex,
                imageUrl: key,
                description: labelText,
                isSelected: targetImageIndex === 0
              }
            })
            if (!location.selectedImageId) {
              await transaction.novelPromotionLocation.update({
                where: { id },
                data: { selectedImageId: created.id }
              })
            }
          }
        } else {
          // 创建新的图片记录
          const maxIndex = location.images?.length || 0
          returnImageIndex = maxIndex
          const created = await transaction.locationImage.create({
            data: {
              locationId: id,
              imageIndex: maxIndex,
              imageUrl: key,
              description: labelText,
              isSelected: maxIndex === 0
            }
          })
          if (!location.selectedImageId) {
            await transaction.novelPromotionLocation.update({
              where: { id },
              data: { selectedImageId: created.id }
            })
          }
        }

        return { returnImageIndex }
      }),
    })

    return NextResponse.json({
      success: true,
      imageKey: key,
      imageIndex: returnImageIndex
    })
  } else if (type === 'prop' && prop !== null) {
    // 道具图片上传 — 跟角色/场景一样把 COS key 写回 imageUrl
    // (Phase 11.3 Stage C: NovelPromotionProp 单图模型,没有 images[] 数组,
    // 所以这里不处理 imageIndex,直接覆盖 imageUrl。)
    await persistUploadedAsset({
      projectId,
      assetType: type,
      assetId: id,
      imageKey: key,
      persist: async () => db.novelPromotionProp.update({
        where: { id: prop.id },
        data: { imageUrl: key },
      }),
    })

    return NextResponse.json({
      success: true,
      imageKey: key,
      imageIndex: 0,
    })
  }

  throw new ApiError('INVALID_PARAMS')
})
