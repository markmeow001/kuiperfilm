import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { addLocationPromptSuffix, LOCATION_IMAGE_RATIO } from '@/lib/constants'
import { parseLocationSummary, metadataToPromptPrefix } from '@/lib/location-metadata'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
} from '../utils'
import {
  AnyObj,
  generateLabeledImageToCos,
  pickFirstString,
} from './image-task-handler-shared'
import { loadStyleProfile } from '@/lib/style-profile/loader'

interface LocationImageRecord {
  id: string
  locationId: string
  description: string | null
  imageIndex: number
  location?: { name: string } | null
}

interface LocationWithImages {
  id: string
  name: string
  images?: LocationImageRecord[]
}

interface LocationImageTaskDb {
  locationImage: {
    findUnique(args: Record<string, unknown>): Promise<LocationImageRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  novelPromotionLocation: {
    findUnique(args: Record<string, unknown>): Promise<LocationWithImages | null>
    findMany(args: Record<string, unknown>): Promise<LocationWithImages[]>
  }
}

export async function handleLocationImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const userId = job.data.userId
  const db = prisma as unknown as LocationImageTaskDb
  const models = await getProjectModels(projectId, userId)
  const modelId = models.locationModel
  if (!modelId) throw new Error('Location model not configured')

  // Q-006: artStyle / artStylePrompt are deactivated. Prompt is built purely from
  // the location description; styleProfile is the only style anchor and is
  // injected at the chokepoint.

  // targetId may be locationId (group) or locationImageId (single)
  const maybeLocationImage = await db.locationImage.findUnique({
    where: { id: job.data.targetId },
    include: { location: true },
  })

  let locationImages: LocationImageRecord[] = []
  // 用于存储 locationId -> name 的映射，避免 images 子集缺少 location 关联
  const locationNameMap: Record<string, string> = {}

  if (maybeLocationImage) {
    // 来源 location 名字已 include，先记录
    if (maybeLocationImage.location?.name) {
      locationNameMap[maybeLocationImage.locationId] = maybeLocationImage.location.name
    }
    if (payload.imageIndex !== undefined) {
      locationImages = [maybeLocationImage]
    } else {
      const location = await db.novelPromotionLocation.findUnique({
        where: { id: maybeLocationImage.locationId },
        include: { images: { orderBy: { imageIndex: 'asc' } } },
      })
      if (location?.name) {
        locationNameMap[maybeLocationImage.locationId] = location.name
      }
      locationImages = location?.images || [maybeLocationImage]
    }
  } else {
    const locationId = pickFirstString(payload.id, payload.locationId, job.data.targetId)
    if (!locationId) throw new Error('Location id missing')

    const location = await db.novelPromotionLocation.findUnique({
      where: { id: locationId },
      include: { images: { orderBy: { imageIndex: 'asc' } } },
    })

    if (!location || !location.images?.length) {
      throw new Error('Location images not found')
    }

    // 记录 location 名字
    locationNameMap[locationId] = location.name

    if (payload.imageIndex !== undefined) {
      const image = location.images.find((it) => it.imageIndex === Number(payload.imageIndex))
      if (!image) throw new Error(`Location image not found for imageIndex=${payload.imageIndex}`)
      locationImages = [image]
    } else {
      locationImages = location.images
    }
  }

  // 補充查詢缺失的 location 名字 + summary(後者帶環境設置 metadata)
  const missingLocationIds = Array.from(new Set(locationImages.map((it) => it.locationId)))
    .filter((id) => !locationNameMap[id])
  if (missingLocationIds.length > 0) {
    const extras = await db.novelPromotionLocation.findMany({
      where: { id: { in: missingLocationIds } } as Record<string, unknown>,
    })
    for (const loc of extras) {
      locationNameMap[loc.id] = loc.name
    }
  }

  // 把所有相關 location 的 summary 也撈一次,給環境 metadata prompt
  // prefix 用。這裡是 worker 端唯一拿得到 metadata 的入口 — 上面 if/else
  // 兩條分支只記了 name,沒撈 summary,所以這裡統一補一次。
  const allLocationIds = Array.from(new Set(locationImages.map((it) => it.locationId)))
  const locationSummaryMap: Record<string, string | null> = {}
  if (allLocationIds.length > 0) {
    // db wrapper's findMany return type is LocationWithImages regardless
    // of `select`, so we cast to access summary defensively.
    const rows = (await db.novelPromotionLocation.findMany({
      where: { id: { in: allLocationIds } } as Record<string, unknown>,
    })) as Array<{ id: string; summary?: string | null }>
    for (const r of rows) {
      locationSummaryMap[r.id] = r.summary ?? null
    }
  }

  const locationIds = allLocationIds

  // Phase 11.5 / Bug-4: chokepoint owns prepend + capability filter. Handler passes
  // raw userPrompt + raw styleProfile.
  const styleProfile = await loadStyleProfile(prisma, projectId)

  for (let i = 0; i < locationImages.length; i++) {
    const item = locationImages[i]
    // 优先用映射表中的名字，回退到 item.location?.name，最后才用默认值
    const name = locationNameMap[item.locationId] || item.location?.name || '场景'
    const promptBody = item.description || ''
    if (!promptBody) continue

    // Inject 環境設置 metadata at the top of the user prompt block so
    // GEM-3.1 sees it before the description. metadataToPromptPrefix
    // returns '' when no metadata is set,so legacy locations behave
    // exactly like before.
    const meta = parseLocationSummary(locationSummaryMap[item.locationId] ?? null).metadata
    const metaPrefix = metadataToPromptPrefix(meta)
    const composedBody = metaPrefix ? `${metaPrefix}\n\n${promptBody}` : promptBody
    const userPrompt = addLocationPromptSuffix(composedBody)

    await reportTaskProgress(job, 20 + Math.floor((i / Math.max(locationImages.length, 1)) * 55), {
      stage: 'generate_location_image',
      imageId: item.id,
    })

    const cosKey = await generateLabeledImageToCos({
      job,
      userId,
      modelId,
      prompt: userPrompt,
      label: name,
      targetId: item.id,
      keyPrefix: 'location',
      options: {
        // Approach A 寬景參考圖 — 16:9 給了左中右三區的橫向空間,
        // 後續 panel 從不同 viewport 切入時才有「同場景不同位置」的
        // 視覺一致性可以引用。1:1 過去太擠,場景看起來像置物櫃內景。
        aspectRatio: LOCATION_IMAGE_RATIO,
      },
      styleProfile,
    })

    await assertTaskActive(job, 'persist_location_image')
    await db.locationImage.update({
      where: { id: item.id },
      data: { imageUrl: cosKey },
    })
  }

  return {
    updated: locationImages.length,
    locationIds,
  }
}
