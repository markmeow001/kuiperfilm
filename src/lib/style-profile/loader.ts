/**
 * Style profile loader.
 *
 * 给定 NovelPromotionProject id，组装出运行时可用的 StyleProfile：
 * - positivePrompt / negativePrompt：直接读 schema 字段
 * - referenceImageUrls：把 styleReferenceImages（JSON array of MediaObject id）
 *   join 出 MediaObject.publicId，组成 `/m/<publicId>` URL
 *
 * 三栏全 null 视为「未配置」-> 回传 null。
 * 解析或 owner 校验失败的 mediaId 会被跳过并记录 warn。
 */

import type { PrismaClient } from '@prisma/client'
import { logWarn } from '@/lib/logging/core'

export interface StyleProfile {
  positivePrompt: string | null
  negativePrompt: string | null
  referenceImageUrls: string[]
}

interface NovelPromotionProjectStyleRow {
  id: string
  projectId: string
  stylePositivePrompt: string | null
  styleNegativePrompt: string | null
  styleReferenceImages: string | null
  project: { userId: string } | null
}

interface MediaObjectRow {
  id: string
  publicId: string
  storageKey: string
  uploadedByUserId: string | null
}

type LoaderPrisma = Pick<PrismaClient, 'novelPromotionProject' | 'mediaObject'>

function buildMediaUrl(publicId: string): string {
  return `/m/${encodeURIComponent(publicId)}`
}

function parseReferenceIds(rawJson: string): string[] {
  // explicit fail：JSON parse error 不静默吞
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch (err) {
    throw new Error(`STYLE_PROFILE_REFERENCE_IMAGES_INVALID_JSON: ${(err as Error).message}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error('STYLE_PROFILE_REFERENCE_IMAGES_NOT_ARRAY')
  }

  // 過濾掉 non-string / 空字串，但保留原順序
  return parsed
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim())
}

/**
 * Q-005: enforce ownership when materialising reference image URLs.
 * Only mediaObjects whose `uploadedByUserId` matches the project owner are returned;
 * mismatches (or rows with NULL owner before backfill completes) are dropped + warn-logged.
 * This prevents cross-user image leakage even if styleReferenceImages somehow contains
 * a foreign mediaId (e.g. legacy data, missed PATCH guard).
 */
async function resolveReferenceImageUrls(
  prisma: LoaderPrisma,
  mediaIds: string[],
  novelPromotionProjectId: string,
  projectOwnerUserId: string | null,
): Promise<string[]> {
  if (mediaIds.length === 0) return []

  const rows = (await prisma.mediaObject.findMany({
    where: { id: { in: mediaIds } },
  })) as unknown as MediaObjectRow[]

  const byId = new Map<string, MediaObjectRow>()
  for (const row of rows) {
    byId.set(row.id, row)
  }

  const resolvedUrls: string[] = []
  for (const id of mediaIds) {
    const row = byId.get(id)
    if (!row) {
      logWarn('[style-profile loader] reference image mediaId not found, skipping', {
        novelPromotionProjectId,
        mediaId: id,
      })
      continue
    }
    if (
      projectOwnerUserId == null ||
      row.uploadedByUserId == null ||
      row.uploadedByUserId !== projectOwnerUserId
    ) {
      logWarn('[style-profile loader] reference image owner mismatch, skipping', {
        novelPromotionProjectId,
        mediaId: id,
        rowOwner: row.uploadedByUserId,
        projectOwner: projectOwnerUserId,
      })
      continue
    }
    resolvedUrls.push(buildMediaUrl(row.publicId))
  }

  return resolvedUrls
}

/**
 * 通过 Project.id 載入 styleProfile（worker 場景用 — job.data.projectId 是 Project.id）。
 * 若 project 不是 novel-promotion 模式（沒有對應 NovelPromotionProject）-> 回傳 null。
 */
export async function loadStyleProfileByProjectId(
  prisma: LoaderPrisma,
  projectId: string,
): Promise<StyleProfile | null> {
  const novelData = (await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })) as { id: string } | null

  if (!novelData) return null
  return loadStyleProfile(prisma, novelData.id)
}

export async function loadStyleProfile(
  prisma: LoaderPrisma,
  novelPromotionProjectId: string,
): Promise<StyleProfile | null> {
  const selectClause = {
    id: true,
    projectId: true,
    stylePositivePrompt: true,
    styleNegativePrompt: true,
    styleReferenceImages: true,
    project: { select: { userId: true } },
  } as const

  // 优先按 NovelPromotionProject.id 查；若找不到，再按 Project.id（projectId）作 fallback。
  // Worker handler 传入的 job.data.projectId 是 Project.id，需要 fallback 才能解析。
  let project = (await prisma.novelPromotionProject.findUnique({
    where: { id: novelPromotionProjectId },
    select: selectClause,
  })) as unknown as NovelPromotionProjectStyleRow | null

  if (!project) {
    project = (await prisma.novelPromotionProject.findUnique({
      where: { projectId: novelPromotionProjectId },
      select: selectClause,
    })) as unknown as NovelPromotionProjectStyleRow | null
  }

  if (!project) {
    throw new Error(`STYLE_PROFILE_PROJECT_NOT_FOUND: ${novelPromotionProjectId}`)
  }

  const positivePrompt = project.stylePositivePrompt
  const negativePrompt = project.styleNegativePrompt
  const rawReferenceImages = project.styleReferenceImages

  const allNull = positivePrompt === null && negativePrompt === null && rawReferenceImages === null
  if (allNull) return null

  let referenceImageUrls: string[] = []
  if (rawReferenceImages !== null) {
    const mediaIds = parseReferenceIds(rawReferenceImages)
    referenceImageUrls = await resolveReferenceImageUrls(
      prisma,
      mediaIds,
      novelPromotionProjectId,
      project.project?.userId ?? null,
    )
  }

  return {
    positivePrompt,
    negativePrompt,
    referenceImageUrls,
  }
}
