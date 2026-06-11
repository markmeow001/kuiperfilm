import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, requireProjectAccess } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import { applyAdminFallbackToNovelPromotionProject } from '@/lib/multi-user/preference-inheritance'

// Public-safe User projection — never leak password/email/lastLoginAt.
const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  displayName: true,
  role: true,
} as const

/**
 * 统一的项目数据加载API
 * 返回项目基础信息、全局配置、全局资产和剧集列表
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Phase V (2026-05-28) — switched from hard `project.userId === session.user.id`
  // to the Phase 12.5 8-tier cascade so workspace members / admin / collaborators
  // can read the project data. Without this, /api/workspaces/[id]/projects would
  // list a teammate's project but clicking through returned 403 → empty UI.
  const access = await requireProjectAccess(projectId, session.user.id, 'read')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND' || access.reason === 'NOT_AUTHENTICATED') {
      throw new ApiError('NOT_FOUND')
    }
    throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
  }

  // 获取基础项目信息
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      user: { select: PUBLIC_USER_SELECT },
      // Phase 2.5 (2026-06-10) — Skill anchor. Workspace home shows
      // the active Skill chip; the storyboard workers will read this
      // at submit time to drive the pipeline.
      originSkill: {
        select: {
          id: true,
          slug: true,
          name: true,
          nameEn: true,
          authorDisplay: true,
          authorType: true,
          isFeatured: true,
        },
      },
    },
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  // 🔥 更新最近访问时间（异步，不阻塞响应）
  prisma.project.update({
    where: { id: projectId },
    data: { lastAccessedAt: new Date() }
  }).catch(err => _ulogError('更新访问时间失败:', err))

  // ⚡ 并行执行：加载 novel-promotion 数据
  // 注意：characters/locations 延迟加载，首次只获取 episodes 列表
  const novelPromotionData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      // 剧集列表（基础信息）- 首页必需
      episodes: {
        orderBy: { episodeNumber: 'asc' }
      },
      // ⚡ 角色和场景数据 - 资产显示必需
      characters: {
        include: {
          appearances: true
        },
        orderBy: { createdAt: 'asc' }
      },
      locations: {
        include: {
          images: true
        },
        orderBy: { createdAt: 'asc' }
      }
    }
  })

  if (!novelPromotionData) {
    throw new ApiError('NOT_FOUND')
  }

  // 转换为稳定媒体 URL（并保留兼容字段）
  const novelPromotionDataWithSignedUrls = await attachMediaFieldsToProject(novelPromotionData)

  // Multi-user inheritance: any model field still NULL on this project
  // gets filled from admin's UserPreference at read time. Without this,
  // projects created by non-admin members BEFORE the project-creation
  // write-side fallback (commit a15bad0) would surface NULL videoModel /
  // characterModel / etc. and the v2 storyboard UI would gate the
  // multi-shot button with "請先在 profile / 預設模型配置 中選擇視頻模型".
  // The injection is response-only — DB rows stay NULL so an admin
  // changing the team default propagates without per-project rewrites.
  await applyAdminFallbackToNovelPromotionProject({
    requestUserId: session.user.id,
    data: novelPromotionDataWithSignedUrls as Record<string, unknown>,
  })

  const fullProject = {
    ...project,
    novelPromotionData: novelPromotionDataWithSignedUrls
    // 🔥 不再用 userPreference 覆盖任何字段
    // editModel 等配置应该直接使用 novelPromotionData 中的值
  }

  return NextResponse.json({ project: fullProject })
})
