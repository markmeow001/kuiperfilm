/**
 * Phase 2.5 (2026-06-10) — Skill list endpoint.
 *
 * GET /api/skills?installed=true|false&featured=true|false&workspaceId=...
 *
 * Returns published Skills with the calling user's installation state
 * stitched in (installed / enabled / installationId). Used by the Skill
 * picker UI to render 「我的 Skill」 + 「精選 Skill」 sections.
 *
 * Filters:
 *   - installed=true   → only Skills the user already installed
 *   - installed=false  → only Skills the user has NOT installed
 *   - (omitted)        → both, with installation state on each
 *   - featured=true    → only Skills with isFeatured=true
 *   - workspaceId=...  → include workspace-private Skills (only when
 *                        user is a member of that workspace)
 *
 * Always filters status='published'. Drafts + archived Skills don't
 * surface here — admin UI in Phase 3.5 will have a separate endpoint
 * to see those.
 *
 * Default sort: featured desc → popularityScore desc → createdAt desc.
 *
 * See IMPL_PREP/R-skill-primitive.md §7.3 for UI flow.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const installedParam = searchParams.get('installed')
  const featuredParam = searchParams.get('featured')
  const workspaceId = searchParams.get('workspaceId') || null

  // Workspace scope check — if the caller asks for workspace-private
  // Skills they must be a member of that workspace. Avoids leaking
  // internal Skills across workspaces.
  if (workspaceId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
      select: { workspaceId: true },
    })
    const owned = await prisma.workspace.findFirst({
      where: { id: workspaceId, ownerEditorId: userId },
      select: { id: true },
    })
    if (!member && !owned) {
      throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_MEMBER' })
    }
  }

  // Fetch in parallel: published Skills (matching filters) + this
  // user's installation rows. Then stitch in memory.
  const [skills, installations] = await Promise.all([
    prisma.skill.findMany({
      where: {
        status: 'published',
        ...(featuredParam === 'true' ? { isFeatured: true } : {}),
        // Workspace gate: when workspaceId is set, include both global
        // (null) and that workspace's private Skills. When omitted,
        // only global.
        OR: workspaceId
          ? [{ workspaceId: null }, { workspaceId }]
          : undefined,
        ...(workspaceId ? {} : { workspaceId: null }),
      },
      orderBy: [
        { isFeatured: 'desc' },
        { popularityScore: 'desc' },
        { createdAt: 'desc' },
      ],
    }),
    prisma.skillInstallation.findMany({
      where: { userId },
      select: { id: true, skillId: true, enabled: true, installedAt: true, lastUsedAt: true },
    }),
  ])

  const installationsBySkillId = new Map(installations.map((i) => [i.skillId, i]))

  let stitched = skills.map((s) => {
    const inst = installationsBySkillId.get(s.id) ?? null
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      nameEn: s.nameEn,
      description: s.description,
      descriptionEn: s.descriptionEn,
      thumbnailUrl: s.thumbnailUrl,
      authorType: s.authorType,
      authorDisplay: s.authorDisplay,
      isFeatured: s.isFeatured,
      popularityScore: s.popularityScore,
      installCount: s.installCount,
      installed: Boolean(inst),
      installationId: inst?.id ?? null,
      enabled: inst?.enabled ?? false,
      installedAt: inst?.installedAt ?? null,
    }
  })

  if (installedParam === 'true') {
    stitched = stitched.filter((s) => s.installed)
  } else if (installedParam === 'false') {
    stitched = stitched.filter((s) => !s.installed)
  }

  return NextResponse.json({ skills: stitched })
})
