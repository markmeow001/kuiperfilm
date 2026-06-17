import { NextRequest, NextResponse, after } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadToCOS, generateUniqueKey } from '@/lib/cos'
import sharp from 'sharp'
import { initializeFonts, createLabelSVG } from '@/lib/fonts'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import { redescribeAssetFromImage } from '@/lib/novel-promotion/asset-image-redescribe'

interface CharacterAppearanceRecord {
  id: string
  imageUrls: string | null
  selectedIndex: number | null
  description: string | null
  descriptions: string | null
}

interface LocationImageRecord {
  id: string
  imageIndex: number
  description?: string | null
}

interface LocationRecord {
  selectedImageId: string | null
  images?: LocationImageRecord[]
}

interface UploadAssetImageDb {
  characterAppearance: {
    findUnique(args: Record<string, unknown>): Promise<CharacterAppearanceRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  novelPromotionLocation: {
    findUnique(args: Record<string, unknown>): Promise<LocationRecord | null>
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

  // 初始化字体（在 Vercel 环境中需要）
  await initializeFonts()

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  // 解析表单数据
  const formData = await request.formData()
  const file = formData.get('file') as File
  const type = formData.get('type') as string // 'character' | 'location'
  const id = formData.get('id') as string // characterId 或 locationId
  const appearanceId = formData.get('appearanceId') as string | null  // UUID
  const imageIndex = formData.get('imageIndex') as string | null
  const labelText = formData.get('labelText') as string // 文字标识符

  if (!file || !type || !id || !labelText) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 读取文件
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

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
  if (type === 'character' && appearanceId !== null) {
    // 更新角色形象图片 - 使用 UUID 直接查询
    const appearance = await db.characterAppearance.findUnique({
      where: { id: appearanceId }
    })

    if (!appearance) {
      throw new ApiError('NOT_FOUND')
    }

    // 解析现有图片数组
    const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')

    // 如果指定了imageIndex，替换对应位置的图片
    const targetIndex = imageIndex !== null ? parseInt(imageIndex) : imageUrls.length

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

    // 更新数据库
    await db.characterAppearance.update({
      where: { id: appearance.id },
      data: updateData
    })

    // Auto-rewrite appearance.description to match the uploaded image.
    // See lib/novel-promotion/asset-image-redescribe.ts for the full
    // rationale (iangyc 2026-05-12 case — uploaded 古裝劍仙 ref but
    // description still said "modern white suit", panel gen trusted
    // text over image).
    //
    // Only rewrite when the uploaded image is the appearance's selected
    // image — that's the one panel gen actually feeds to the model.
    // 2026-06-16 — run the vision-LLM description rewrite AFTER the response
    // is sent (Next 15 `after`). The image + imageUrl are already persisted
    // above, so the upload returns immediately and the card's "上傳中" overlay
    // clears at once instead of waiting the full LLM round-trip (which made
    // uploads look stuck until a manual refresh, esp. on slower LLM providers).
    if (shouldUpdateImageUrl) {
      const appearanceId = appearance.id
      const prevDescription = appearance.description ?? null
      const prevDescriptions = appearance.descriptions ?? null
      after(async () => {
        try {
          const result = await redescribeAssetFromImage({
            kind: 'character',
            imageKeyOrUrl: key,
            projectId,
            userId: authResult.session.user.id,
            entityId: appearanceId,
          })
          if (result.ok) {
            await db.characterAppearance.update({
              where: { id: appearanceId },
              data: {
                previousDescription: prevDescription,
                previousDescriptions: prevDescriptions,
                description: result.description,
                // Worker's pickAppearanceDescription prefers `descriptions`
                // (plural JSON array) over `description` (singular); reset the
                // array to the new value so both readers see the same story.
                descriptions: JSON.stringify([result.description]),
              },
            })
          } else {
            createScopedLogger({
              module: 'api.upload-asset-image',
              action: 'character_appearance_describe',
            }).warn({
              message: 'character description rewrite skipped',
              details: { appearanceId, code: result.code, error: result.message },
            })
          }
        } catch (err) {
          createScopedLogger({
            module: 'api.upload-asset-image',
            action: 'character_appearance_describe',
          }).warn({ message: 'character description rewrite failed (after)', details: { appearanceId, error: (err as Error)?.message } })
        }
      })
    }

    return NextResponse.json({
      success: true,
      imageKey: key,
      imageIndex: targetIndex
    })

  } else if (type === 'location') {
    // 更新场景图片
    const location = await db.novelPromotionLocation.findUnique({
      where: { id },
      include: { images: { orderBy: { imageIndex: 'asc' } } }
    })

    if (!location) {
      throw new ApiError('NOT_FOUND')
    }

    // 如果指定了imageIndex，更新对应的图片记录
    let touchedImage: { id: string; previousDescription: string | null } | null = null
    let returnImageIndex: number
    if (imageIndex !== null) {
      const targetImageIndex = parseInt(imageIndex)
      const existingImage = location.images?.find((img) => img.imageIndex === targetImageIndex)
      returnImageIndex = targetImageIndex

      if (existingImage) {
        const updated = await db.locationImage.update({
          where: { id: existingImage.id },
          data: { imageUrl: key }
        })
        if (!location.selectedImageId) {
          await prisma.novelPromotionLocation.update({
            where: { id },
            data: { selectedImageId: updated.id }
          })
        }
        touchedImage = {
          id: existingImage.id,
          previousDescription: (existingImage as { description?: string | null }).description ?? null,
        }
      } else {
        const created = await db.locationImage.create({
          data: {
            locationId: id,
            imageIndex: targetImageIndex,
            imageUrl: key,
            description: labelText,
            isSelected: targetImageIndex === 0
          }
        })
        if (!location.selectedImageId) {
          await prisma.novelPromotionLocation.update({
            where: { id },
            data: { selectedImageId: created.id }
          })
        }
        touchedImage = { id: created.id, previousDescription: null }
      }
    } else {
      // 创建新的图片记录
      const maxIndex = location.images?.length || 0
      returnImageIndex = maxIndex
      const created = await db.locationImage.create({
        data: {
          locationId: id,
          imageIndex: maxIndex,
          imageUrl: key,
          description: labelText,
          isSelected: maxIndex === 0
        }
      })
      if (!location.selectedImageId) {
        await prisma.novelPromotionLocation.update({
          where: { id },
          data: { selectedImageId: created.id }
        })
      }
      touchedImage = { id: created.id, previousDescription: null }
    }

    // Auto-rewrite LocationImage.description from the uploaded image —
    // mirrors the character path. Panel gen reads pick.description to
    // build the 场景 line of the image prompt, so this keeps text and
    // image in sync. `labelText` from the form is just the view-name
    // label (e.g. "窗邊"); we overwrite it with the LLM's read of the
    // actual scene contents.
    // 2026-06-16 — defer the vision-LLM rewrite to after() (see character path).
    if (touchedImage) {
      const touchedImageId = touchedImage.id
      const prevDescription = touchedImage.previousDescription
      after(async () => {
        try {
          const result = await redescribeAssetFromImage({
            kind: 'location',
            imageKeyOrUrl: key,
            projectId,
            userId: authResult.session.user.id,
            entityId: touchedImageId,
          })
          if (result.ok) {
            await prisma.locationImage.update({
              where: { id: touchedImageId },
              data: {
                previousDescription: prevDescription,
                description: result.description,
              },
            })
          } else {
            createScopedLogger({
              module: 'api.upload-asset-image',
              action: 'location_image_describe',
            }).warn({
              message: 'location description rewrite skipped',
              details: { locationImageId: touchedImageId, code: result.code, error: result.message },
            })
          }
        } catch (err) {
          createScopedLogger({
            module: 'api.upload-asset-image',
            action: 'location_image_describe',
          }).warn({ message: 'location description rewrite failed (after)', details: { locationImageId: touchedImageId, error: (err as Error)?.message } })
        }
      })
    }

    return NextResponse.json({
      success: true,
      imageKey: key,
      imageIndex: returnImageIndex
    })
  } else if (type === 'prop') {
    // 道具图片上传 — 跟角色/场景一样把 COS key 写回 imageUrl
    // (Phase 11.3 Stage C: NovelPromotionProp 单图模型,没有 images[] 数组,
    // 所以这里不处理 imageIndex,直接覆盖 imageUrl。)
    const prop = await db.novelPromotionProp.findFirst({
      where: { id, novelPromotionProject: { projectId } },
      select: { id: true },
    })

    if (!prop) {
      throw new ApiError('NOT_FOUND', { code: 'PROP_NOT_IN_PROJECT' })
    }

    await db.novelPromotionProp.update({
      where: { id: prop.id },
      data: { imageUrl: key },
    })

    // Auto-rewrite prop.description from the uploaded image — deferred to
    // after() (see character path) so the upload returns immediately.
    {
      const propId = prop.id
      after(async () => {
        try {
          const propResult = await redescribeAssetFromImage({
            kind: 'prop',
            imageKeyOrUrl: key,
            projectId,
            userId: authResult.session.user.id,
            entityId: propId,
          })
          if (propResult.ok) {
            await db.novelPromotionProp.update({
              where: { id: propId },
              data: { description: propResult.description },
            })
          } else {
            createScopedLogger({
              module: 'api.upload-asset-image',
              action: 'prop_describe',
            }).warn({
              message: 'prop description rewrite skipped',
              details: { propId, code: propResult.code, error: propResult.message },
            })
          }
        } catch (err) {
          createScopedLogger({
            module: 'api.upload-asset-image',
            action: 'prop_describe',
          }).warn({ message: 'prop description rewrite failed (after)', details: { propId, error: (err as Error)?.message } })
        }
      })
    }

    return NextResponse.json({
      success: true,
      imageKey: key,
      imageIndex: 0,
    })
  }

  throw new ApiError('INVALID_PARAMS')
})
