import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { isAdmin, UserRole } from '@/lib/auth/user-role'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { toMoneyNumber } from '@/lib/billing/money'
import { STYLE_PROFILE_PRESETS } from '@/lib/style-profile/presets'
import { normalizeGenerationMode, normalizeOpeningPacing } from '@/lib/novel-promotion/generation-mode'

const PROJECT_LAST_STEPS = ['home', 'script', 'subjects', 'storyboard', 'voice', 'final'] as const
type ProjectLastStep = (typeof PROJECT_LAST_STEPS)[number]

type EffectiveProjectRole =
  | 'owner'
  | 'admin'
  | 'ws_owner'
  | 'ws_owner_legacy'
  | 'editor'
  | 'viewer'

interface ProjectAccessProjection {
  userId: string
  workspaceId: string | null
  collaborators: Array<{ role: string }>
  workspace: {
    ownerEditorId: string
    members: Array<{ role: string }>
  } | null
  user: {
    workspaceMemberships: Array<{ workspaceId: string }>
  }
}

function normalizeLastStep(value: string | null | undefined): ProjectLastStep | null {
  if (!value) return null
  return (PROJECT_LAST_STEPS as readonly string[]).includes(value)
    ? value as ProjectLastStep
    : null
}

function normalizeProjectGrantRole(role: string | null | undefined): 'editor' | 'viewer' {
  return role === UserRole.EDITOR ? UserRole.EDITOR : UserRole.VIEWER
}

function resolveEffectiveProjectRole(
  project: ProjectAccessProjection,
  requesterId: string,
  requesterIsAdmin: boolean,
): EffectiveProjectRole {
  if (project.userId === requesterId) return UserRole.OWNER
  if (requesterIsAdmin) return UserRole.ADMIN
  if (project.workspace?.ownerEditorId === requesterId) return 'ws_owner'
  if (project.workspaceId === null && project.user.workspaceMemberships.length > 0) {
    return 'ws_owner_legacy'
  }
  if (project.collaborators[0]) {
    return normalizeProjectGrantRole(project.collaborators[0].role)
  }
  return normalizeProjectGrantRole(project.workspace?.members[0]?.role)
}

// GET - 获取用户的项目（支持分页和搜索）
export const GET = apiHandler(async (request: NextRequest) => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // 获取查询参数
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = parseInt(searchParams.get('pageSize') || '12', 10)
  const search = searchParams.get('search') || ''
  // Phase 12.5 (2026-05-24) — `?ws=<workspaceId>` filter.
  // Empty / absent => personal (caller's own projects, status quo).
  // Set       => projects in that workspace where caller is a WorkspaceMember
  //              (or owner / admin — they bypass member check).
  // Gate against enumeration: caller MUST be a member of the requested
  // workspace, otherwise return empty list (don't throw 403, just no rows).
  const wsParam = (searchParams.get('ws') || '').trim()

  // 构建查询条件
  // Phase 12.5 (2026-05-22) — exclude soft-deleted (deletedAt IS NULL).
  // Soft-deleted projects show up in admin restore queue, not user lists.
  const where: Record<string, unknown> = {
    deletedAt: null,
  }
  let requesterIsAdmin = false

  if (wsParam) {
    // Workspace mode: caller must be a member (owner or member row),
    // otherwise return empty list. Admin bypasses for support purposes.
    const [requester, workspace] = await Promise.all([
      prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } }),
      prisma.workspace.findUnique({
        where: { id: wsParam },
        select: { id: true, ownerEditorId: true },
      }),
    ])
    const isAdminUser = isAdmin(requester?.role)
    requesterIsAdmin = isAdminUser
    const isWsOwner = workspace?.ownerEditorId === session.user.id
    if (!workspace) {
      return NextResponse.json({
        projects: [],
        pagination: { page: 1, pageSize, total: 0, totalPages: 0 },
      })
    }
    if (!isAdminUser && !isWsOwner) {
      const membership = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: wsParam, userId: session.user.id } },
        select: { workspaceId: true },
      })
      if (!membership) {
        return NextResponse.json({
          projects: [],
          pagination: { page: 1, pageSize, total: 0, totalPages: 0 },
        })
      }
    }
    where.workspaceId = wsParam
  } else {
    // Personal mode: caller's own projects only (status quo, pre-12.5).
    where.userId = session.user.id
  }

  // 如果有搜索关键词，搜索名称和描述
  if (search.trim()) {
    where.OR = [
      { name: { contains: search.trim(), mode: 'insensitive' } },
      { description: { contains: search.trim(), mode: 'insensitive' } }
    ]
  }

  // ⚡ 并行执行：获取总数 + 分页数据
  // 排序优先级：最近访问时间（有值的优先） > 更新时间
  const [total, allProjects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },  // 先按更新时间排序获取所有匹配项目
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        // These three narrow projections mirror requireProjectAccess's
        // cascade without issuing one permission query per project.
        collaborators: {
          where: { userId: session.user.id },
          select: { role: true },
          take: 1,
        },
        workspace: {
          select: {
            ownerEditorId: true,
            members: {
              where: { userId: session.user.id },
              select: { role: true },
              take: 1,
            },
          },
        },
        user: {
          select: {
            workspaceMemberships: {
              where: { workspace: { ownerEditorId: session.user.id } },
              select: { workspaceId: true },
              take: 1,
            },
          },
        },
      },
    })
  ])

  // 在应用层重新排序：
  // 1. 新创建但未访问过的项目（无 lastAccessedAt）按创建时间降序排在最前
  // 2. 访问过的项目按访问时间降序
  const projects = [...allProjects].sort((a, b) => {
    // 两个都没有访问时间，按创建时间降序（新创建的排前面）
    if (!a.lastAccessedAt && !b.lastAccessedAt) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }
    // 只有 a 没有访问时间（新创建），a 排前面
    if (!a.lastAccessedAt && b.lastAccessedAt) return -1
    // 只有 b 没有访问时间（新创建），b 排前面
    if (a.lastAccessedAt && !b.lastAccessedAt) return 1
    // 两个都有访问时间，按访问时间降序
    return new Date(b.lastAccessedAt!).getTime() - new Date(a.lastAccessedAt!).getTime()
  })

  // 获取项目 ID 列表
  const projectIds = projects.map(p => p.id)

  // ⚡ 并行获取：费用 + 项目统计（章节数、图片数、视频数）+ 使用者進度
  const [costsByProject, novelProjects, projectStates] = await Promise.all([
    // 一次性获取所有项目的费用（代替 N+1 查询）
    prisma.usageCost.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds } },
      _sum: { cost: true }
    }),
    // 一次性获取所有项目的统计数据
    prisma.novelPromotionProject.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        projectId: true,
        _count: {
          select: {
            episodes: true,
            characters: true,
            locations: true}
        },
        episodes: {
          orderBy: { episodeNumber: 'asc' },
          select: {
            episodeNumber: true,
            novelText: true,
            storyboards: {
              select: {
                _count: {
                  select: { panels: true }
                },
                panels: {
                  where: {
                    OR: [
                      { imageUrl: { not: null } },
                      { videoUrl: { not: null } },
                    ]
                  },
                  select: {
                    imageUrl: true,
                    videoUrl: true}
                }
              }
            }
          }
        }
      }
    }),
    // Per-user sticky step must be loaded in one batch. It describes where
    // this requester last worked; it is not inferred from project assets.
    prisma.userProjectState.findMany({
      where: {
        userId: session.user.id,
        projectId: { in: projectIds },
      },
      select: { projectId: true, lastStep: true },
    }),
  ])

  // 构建费用映射表
  const costMap = new Map(
    costsByProject.map(item => [item.projectId, toMoneyNumber(item._sum.cost)])
  )
  const lastStepMap = new Map(
    projectStates.map(state => [state.projectId, normalizeLastStep(state.lastStep)])
  )

  // 构建统计映射表 + 第一集预览
  const statsMap = new Map<string, { episodes: number; images: number; videos: number; panels: number; firstEpisodePreview: string | null }>(
    novelProjects.map(np => {
      let imageCount = 0
      let videoCount = 0
      let panelCount = 0
      for (const ep of np.episodes) {
        for (const sb of ep.storyboards) {
          panelCount += sb._count.panels
          for (const panel of sb.panels) {
            if (panel.imageUrl) imageCount++
            if (panel.videoUrl) videoCount++
          }
        }
      }
      // 取第一集的 novelText 前 100 字作为预览
      const firstEp = np.episodes[0]
      const preview = firstEp?.novelText ? firstEp.novelText.slice(0, 100) : null
      return [np.projectId, {
        episodes: np._count.episodes,
        images: imageCount,
        videos: videoCount,
        panels: panelCount,
        firstEpisodePreview: preview}]
    })
  )

  // 合并项目、费用、统计、目前使用者進度與權限 view-model。
  // Access-only relation projections are intentionally not exposed.
  const projectsWithStats = projects.map(project => {
    const effectiveRole = resolveEffectiveProjectRole(
      project,
      session.user.id,
      requesterIsAdmin,
    )
    const canWrite = effectiveRole !== UserRole.VIEWER
    const { collaborators, workspace, user, ...projectFields } = project
    void collaborators
    void workspace
    void user

    return {
      ...projectFields,
      lastStep: lastStepMap.get(project.id) ?? null,
      effectiveRole,
      canEdit: canWrite,
      // DELETE /api/projects/:id uses the same write-access cascade.
      canDelete: canWrite,
      totalCost: costMap.get(project.id) ?? 0,
      stats: statsMap.get(project.id) ?? {
        episodes: 0,
        images: 0,
        videos: 0,
        panels: 0,
        firstEpisodePreview: null,
      },
    }
  })

  return NextResponse.json({
    projects: projectsWithStats,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  })
})

// POST - 创建新项目
export const POST = apiHandler(async (request: NextRequest) => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const {
    name,
    description,
    workspaceId: rawWorkspaceId,
    generationMode: rawGenerationMode,
    openingPacing: rawOpeningPacing,
    originSkillId: rawOriginSkillId,
  } = await request.json()
  // New projects default to R2V-narrative (no T2I). normalize* falls back to
  // 'r2v-narrative' / 'hook' for any missing/invalid value, so even non-UI
  // create paths get the modern flow. (2026-05-29)
  const generationMode = normalizeGenerationMode(rawGenerationMode)
  const openingPacing = normalizeOpeningPacing(rawOpeningPacing)

  if (!name || name.trim().length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (name.length > 100) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (description && description.length > 500) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Phase 12.5+ — optional workspace assignment at create time.
  // null / undefined / "" → 個人專案 (personal scope, status quo).
  // Real workspace id → caller must be a member (or admin / ws owner).
  // Doing the membership check at create time avoids a moments-later
  // 403 on the PATCH path users would otherwise hit.
  let workspaceId: string | null = null
  if (rawWorkspaceId && typeof rawWorkspaceId === 'string' && rawWorkspaceId.trim()) {
    const candidate = rawWorkspaceId.trim()
    const [requester, ws] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { role: true },
      }),
      prisma.workspace.findUnique({
        where: { id: candidate },
        select: { id: true, ownerEditorId: true },
      }),
    ])
    if (!ws) {
      throw new ApiError('NOT_FOUND', {
        code: 'WORKSPACE_NOT_FOUND',
        details: { reason: '工作區不存在' },
      })
    }
    const isAdminUser = roleAtLeast(requester?.role, 'admin')
    const isWsOwner = ws.ownerEditorId === session.user.id
    if (!isAdminUser && !isWsOwner) {
      const membership = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: candidate, userId: session.user.id } },
        select: { workspaceId: true },
      })
      if (!membership) {
        throw new ApiError('FORBIDDEN', {
          code: 'NOT_WORKSPACE_MEMBER',
          details: { reason: '你不是該工作區的成員，無法在裡面建立專案' },
        })
      }
    }
    workspaceId = candidate
  }

  // Phase 2.5 (2026-06-10) — Skill primitive selection at create time.
  // null / undefined / "" → 個人創作 (generic, status quo). Real Skill
  // id → must exist + be published + accessible to user (global, or
  // workspace-private with caller as member). Worker reads project.
  // originSkill.config at submit time to drive pipeline + defaults +
  // prompts. See IMPL_PREP/R-skill-primitive.md §5-6.
  let originSkillId: string | null = null
  if (rawOriginSkillId && typeof rawOriginSkillId === 'string' && rawOriginSkillId.trim()) {
    const skillCandidate = rawOriginSkillId.trim()
    const skill = await prisma.skill.findUnique({
      where: { id: skillCandidate },
      select: { id: true, status: true, workspaceId: true },
    })
    if (!skill) {
      throw new ApiError('NOT_FOUND', {
        code: 'SKILL_NOT_FOUND',
        details: { reason: 'Skill 不存在或已下架' },
      })
    }
    if (skill.status !== 'published') {
      throw new ApiError('FORBIDDEN', {
        code: 'SKILL_NOT_PUBLISHED',
        details: { reason: '此 Skill 尚未發佈，無法用於建立專案' },
      })
    }
    if (skill.workspaceId && skill.workspaceId !== workspaceId) {
      // Workspace-private Skill being used in a different (or no)
      // workspace context — reject. The user might be admin elsewhere
      // but the Skill is scoped to its owning workspace by design.
      const membership = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: skill.workspaceId, userId: session.user.id } },
        select: { workspaceId: true },
      }).catch(() => null)
      if (!membership) {
        throw new ApiError('FORBIDDEN', {
          code: 'SKILL_WORKSPACE_PRIVATE',
          details: { reason: '此 Skill 屬於另一個工作區的私有設定' },
        })
      }
    }
    originSkillId = skill.id
  }

  // 获取用户偏好配置 + admin 偏好（multi-user 繼承用）。
  // 新建專案時複製預設模型欄位:
  //   1. 優先用 user 自己 preference 的值
  //   2. user 沒設(member 帳號預設全 null) → 退到 admin pref
  //   3. 都沒設 → null,worker 端再用 resolve-analysis-model 等 helper 兜底
  // 沒這個 fallback 新建帳號的所有專案 model 欄位都會是 null,
  // 然後 character_profile_confirm / shot_ai_persist 等 task 跑出來
  // throw "请先在项目设置中配置分析模型"。
  const [userPreference, adminUser] = await Promise.all([
    prisma.userPreference.findUnique({ where: { userId: session.user.id } }),
    prisma.user.findFirst({
      where: { role: UserRole.ADMIN },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    }),
  ])
  const adminPreference =
    adminUser && adminUser.id !== session.user.id
      ? await prisma.userPreference.findUnique({ where: { userId: adminUser.id } })
      : null

  function pick<K extends keyof NonNullable<typeof userPreference>>(
    field: K,
  ): NonNullable<typeof userPreference>[K] | null | undefined {
    return userPreference?.[field] ?? adminPreference?.[field]
  }

  // 创建基础项目（mode 固定为 novel-promotion）
  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      mode: 'novel-promotion',
      userId: session.user.id,
      workspaceId, // null = personal; validated above when set
      originSkillId, // Phase 2.5; null = 自由創作; validated above when set
    }
  })

  // Phase 2.5 — bump Skill.lastUsedAt installation timestamp when this
  // project was created via a Skill. Surfaces a "recently used" sort
  // signal in the picker. Best-effort: failure here doesn't block the
  // project creation since the row already committed above.
  if (originSkillId) {
    await prisma.skillInstallation
      .updateMany({
        where: { userId: session.user.id, skillId: originSkillId },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {})
  }

  // 创建 novel-promotion 数据表，使用用户偏好作为默认值
  // 注意：不再自动创建默认剧集，由用户在选择界面决定：
  // - 手动创作 → 创建第一个空白剧集
  // - 智能导入 → AI 分析后批量创建剧集
  // 🔥 artStylePrompt 通过实时查询获取，不再存储到数据库
  //
  // 2026-05-04 — Default style profile = "realistic" (寫實風格).
  // Without this, new projects had NULL style anchors → loadStyleProfile()
  // returned null → image generator used the neutral "与参考图风格一致"
  // fallback → Tencent VOD GEM-3.1 freestyled into painterly / anime-ish
  // outputs (reported by iangyc 2026-05-03 — kneeling figures rendered
  // in stylized Genshin-Impact-like 3D instead of TikTok 短劇 photo-real).
  // Locking the default to 'realistic' anchors NEW projects to cinematic
  // photorealism out of the gate. Users can still flip to any other
  // preset (anime / chinese-ink / cyberpunk / etc.) in V2ProjectSettingsPanel
  // → Style Profile. Existing NULL projects are intentionally left alone
  // so the loader's null-fallback behavior stays observable + recoverable.
  const realisticPreset = STYLE_PROFILE_PRESETS.realistic
  await prisma.novelPromotionProject.create({
    data: {
      projectId: project.id,
      analysisModel: pick('analysisModel'),
      characterModel: pick('characterModel'),
      locationModel: pick('locationModel'),
      storyboardModel: pick('storyboardModel'),
      editModel: pick('editModel'),
      videoModel: pick('videoModel'),
      videoRatio: pick('videoRatio') ?? undefined,
      generationMode,
      openingPacing,
      artStyle: pick('artStyle') || 'american-comic',
      ttsRate: pick('ttsRate') ?? undefined,
      stylePresetKey: 'realistic',
      stylePositivePrompt: realisticPreset.positivePrompt,
      styleNegativePrompt: realisticPreset.negativePrompt,
    }
  })

  return NextResponse.json({ project }, { status: 201 })
})
