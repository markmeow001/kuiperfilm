import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { addSignedUrlsToProject, deleteCOSObjects } from '@/lib/cos'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { logProjectAction } from '@/lib/logging/semantic'
import { requireUserAuth, isErrorResponse, requireProjectAccess } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

// Public-safe User projection — never leak password/email/lastLoginAt to
// clients. Default `include: { user: true }` would dump the full row.
const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  displayName: true,
  role: true,
} as const

// GET - 获取项目详情
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // 只获取基础项目信息，不包含模式特定数据
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      user: { select: PUBLIC_USER_SELECT }
    }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  // 更新最近访问时间（异步，不阻塞响应）
  prisma.project.update({
    where: { id: projectId },
    data: { lastAccessedAt: new Date() }
  }).catch(err => _ulogError('更新访问时间失败:', err))

  // 这个API只返回基础项目信息
  // 模式特定的数据应该通过各自的API获取（如 /api/novel-promotion/[projectId]）
  const projectWithSignedUrls = addSignedUrlsToProject(project)

  return NextResponse.json({ project: projectWithSignedUrls })
})

// PATCH - 更新项目配置
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session
  const body = await request.json()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { user: { select: PUBLIC_USER_SELECT } }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  // 更新项目
  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: body
  })

  logProjectAction(
    'UPDATE',
    session.user.id,
    session.user.name,
    projectId,
    updatedProject.name,
    { changes: body }
  )

  return NextResponse.json({ project: updatedProject })
})

/**
 * 收集项目的所有COS文件Key
 */
async function collectProjectCOSKeys(projectId: string): Promise<string[]> {
  const keys: string[] = []

  // 获取 NovelPromotionProject
  const novelPromotion = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      // 角色及其形象图片
      characters: {
        include: {
          appearances: true
        }
      },
      // 场景及其图片
      locations: {
        include: {
          images: true
        }
      },
      // 剧集（包含音频、分镜等）
      episodes: {
        include: {
          storyboards: {
            include: {
              panels: true
            }
          }
        }
      }
    }
  })

  if (!novelPromotion) return keys

  // 1. 收集角色形象图片
  for (const character of novelPromotion.characters) {
    for (const appearance of character.appearances) {
      const key = await resolveStorageKeyFromMediaValue(appearance.imageUrl)
      if (key) keys.push(key)
    }
  }

  // 2. 收集场景图片
  for (const location of novelPromotion.locations) {
    for (const image of location.images) {
      const key = await resolveStorageKeyFromMediaValue(image.imageUrl)
      if (key) keys.push(key)
    }
  }

  // 3. 收集剧集相关文件
  for (const episode of novelPromotion.episodes) {
    // 音频文件
    const audioKey = await resolveStorageKeyFromMediaValue(episode.audioUrl)
    if (audioKey) keys.push(audioKey)

    // 分镜图片
    for (const storyboard of episode.storyboards) {
      // 分镜整体图
      const sbKey = await resolveStorageKeyFromMediaValue(storyboard.storyboardImageUrl)
      if (sbKey) keys.push(sbKey)

      // 候选图片（JSON数组）
      if (storyboard.candidateImages) {
        try {
          const candidates = JSON.parse(storyboard.candidateImages)
          for (const url of candidates) {
            const key = await resolveStorageKeyFromMediaValue(url)
            if (key) keys.push(key)
          }
        } catch { }
      }

      // Panel 表中的图片和视频
      for (const panel of storyboard.panels) {
        const imgKey = await resolveStorageKeyFromMediaValue(panel.imageUrl)
        if (imgKey) keys.push(imgKey)

        const videoKey = await resolveStorageKeyFromMediaValue(panel.videoUrl)
        if (videoKey) keys.push(videoKey)
      }
    }
  }

  _ulogInfo(`[Project ${projectId}] 收集到 ${keys.length} 个 COS 文件待删除`)
  return keys
}

// DELETE - 软删除项目 (Phase 12.5 — 2026-05-22)
//
// 改前：hard delete + 立即清除 COS 文件
// 改後：soft delete (set deletedAt) + COS 文件保留 30 天
//   - 30 天內 owner / admin 可呼叫 POST /api/projects/:id/restore 恢復
//   - 30 天後 daily cron job 才真實 hard-delete + 清 COS
//   - 仍 audit log（destructive action）
//
// Auth: 走新 8-tier cascade `requireProjectAccess(action='write')`.
// Owner / admin / workspace owner / project editor 都能 soft-delete。
// Viewer 觸發 VIEWER_CANNOT_WRITE → 403.
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session

  // 8-tier cascade — owner / admin / ws_owner / editor collaborator
  // 都會通過 write check。viewer collaborator 會被 VIEWER_CANNOT_WRITE
  // 攔下。已 soft-deleted 的會被 NOT_FOUND 攔下 (idempotent)。
  const access = await requireProjectAccess(projectId, session.user.id, 'write')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND') throw new ApiError('NOT_FOUND')
    if (access.reason === 'VIEWER_CANNOT_WRITE') {
      throw new ApiError('FORBIDDEN', { code: 'VIEWER_CANNOT_DELETE' })
    }
    throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
  }

  // 取 project name 給 log / response（fetch deletedAt:null 雙重防護，
  // 雖然 requireProjectAccess 已過濾過 soft-deleted，這裡再保險一次以防
  // race condition: 另一個 request 在毫秒間隔內 soft-deleted 同一筆）。
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, userId: true, deletedAt: true },
  })
  if (!project || project.deletedAt) {
    throw new ApiError('NOT_FOUND')
  }

  // Soft delete：不動 COS 文件、不級聯刪 child rows。
  // child rows (panels / characters / 等) 看 project.deletedAt 應視為 hidden,
  // 但 DB 不動所以 restore 後完整恢復。
  const deletedAt = new Date()
  await prisma.project.update({
    where: { id: projectId },
    data: {
      deletedAt,
      deletedBy: session.user.id,
    },
  })

  logProjectAction(
    'DELETE',
    session.user.id,
    session.user.name,
    projectId,
    project.name,
    {
      softDelete: true,
      deletedAt: deletedAt.toISOString(),
      effectiveRole: access.effectiveRole,
      // 不再 cosFilesDeleted — 30 天後 cron 才真刪
    }
  )

  _ulogInfo(`[SOFT-DELETE] 项目已软删除: ${project.name} (${projectId}) by ${session.user.id}`)

  // 30 天恢復窗口 (per spec §3.2 grace period)
  const restorableUntil = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000)

  return NextResponse.json({
    success: true,
    softDeleted: true,
    deletedAt: deletedAt.toISOString(),
    restorableUntil: restorableUntil.toISOString(),
  })
})
