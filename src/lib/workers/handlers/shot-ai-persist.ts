import { prisma } from '@/lib/prisma'
import { composeModelKey, parseModelKeyStrict } from '@/lib/model-config-contract'
import { UserRole } from '@/lib/auth/user-role'

function normalizeModelKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = parseModelKeyStrict(trimmed)
  if (!parsed) return null
  return composeModelKey(parsed.provider, parsed.modelId)
}

export async function resolveAnalysisModel(projectId: string, userId: string): Promise<{
  id: string
  analysisModel: string
}> {
  const [novelData, userPreference] = await Promise.all([
    prisma.novelPromotionProject.findUnique({
      where: { projectId },
      select: { id: true, analysisModel: true },
    }),
    prisma.userPreference.findUnique({
      where: { userId },
      select: { analysisModel: true },
    }),
  ])
  if (!novelData) throw new Error('Novel promotion project not found')

  // 优先读项目配置，fallback 到用户全局设置
  let analysisModel =
    normalizeModelKey(novelData.analysisModel) ??
    normalizeModelKey(userPreference?.analysisModel)

  // Multi-user inheritance: member's project + own pref both empty →
  // fall through to admin's preference. Mirrors the same admin
  // fallback already in resolve-analysis-model.ts (4-tier resolution).
  // Without this, shot_ai_persist tasks fail for non-admin users with
  // "请先在项目设置中配置分析模型" even when admin has it configured.
  if (!analysisModel) {
    const admin = await prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (admin && admin.id !== userId) {
      const adminPref = await prisma.userPreference.findUnique({
        where: { userId: admin.id },
        select: { analysisModel: true },
      })
      analysisModel = normalizeModelKey(adminPref?.analysisModel)
    }
  }

  if (!analysisModel) throw new Error('请先在项目设置中配置分析模型')

  return { id: novelData.id, analysisModel }
}

export async function requireProjectLocation(locationId: string, projectInternalId: string) {
  const location = await prisma.novelPromotionLocation.findFirst({
    where: {
      id: locationId,
      novelPromotionProjectId: projectInternalId,
    },
    select: {
      id: true,
      name: true,
    },
  })
  if (!location) throw new Error('Location not found')
  return location
}

export async function persistLocationDescription(params: {
  locationId: string
  imageIndex: number
  modifiedDescription: string
}) {
  const locationImage = await prisma.locationImage.findFirst({
    where: {
      locationId: params.locationId,
      imageIndex: params.imageIndex,
    },
    select: {
      id: true,
    },
  })
  if (!locationImage) throw new Error('Location image not found')

  await prisma.locationImage.update({
    where: { id: locationImage.id },
    data: { description: params.modifiedDescription },
  })

  return await prisma.novelPromotionLocation.findUnique({
    where: { id: params.locationId },
    include: { images: { orderBy: { imageIndex: 'asc' } } },
  })
}
