import { prisma } from '@/lib/prisma'
import { UserRole } from '@/lib/auth/user-role'

export type AnyObj = Record<string, unknown>

export function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function readRequiredString(value: unknown, field: string): string {
  const text = readText(value).trim()
  if (!text) {
    throw new Error(`${field} is required`)
  }
  return text
}

export function parseVisualResponse(responseText: string): AnyObj {
  let cleaned = responseText.trim()
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1)
  }
  return JSON.parse(cleaned) as AnyObj
}

export async function resolveProjectModel(projectId: string, userId?: string) {
  const [project, userPreference] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        novelPromotionData: {
          select: {
            id: true,
            analysisModel: true,
          },
        },
      },
    }),
    userId
      ? prisma.userPreference.findUnique({
          where: { userId },
          select: { analysisModel: true },
        })
      : Promise.resolve(null),
  ])
  if (!project) throw new Error('Project not found')
  if (!project.novelPromotionData) throw new Error('Novel promotion data not found')
  // Project-level override wins; otherwise fall back to user preference,
  // matching the contract used by resolveAnalysisModel in shot-ai-persist.
  if (!project.novelPromotionData.analysisModel && userPreference?.analysisModel) {
    project.novelPromotionData.analysisModel = userPreference.analysisModel
  }
  // Multi-user inheritance: if member's project + own pref are both
  // empty, fall back to admin's analysisModel. Mirrors the 4-tier
  // resolution in resolve-analysis-model.ts and getUserModelConfig.
  // Without this, character_profile_confirm fails for any non-admin
  // user with errorMessage "请先在项目设置中配置分析模型" even though
  // admin has analysisModel configured globally.
  if (!project.novelPromotionData.analysisModel && userId) {
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
      if (adminPref?.analysisModel) {
        project.novelPromotionData.analysisModel = adminPref.analysisModel
      }
    }
  }
  if (!project.novelPromotionData.analysisModel) throw new Error('请先在项目设置中配置分析模型')
  return project
}
