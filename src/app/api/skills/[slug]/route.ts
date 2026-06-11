/**
 * Phase 2.5 (2026-06-10) — Skill detail endpoint.
 *
 * GET /api/skills/[slug]
 *
 * Returns one published Skill by slug, including the full config JSON
 * (pipeline + defaults + prompts + constraints). Used by:
 *   - Skill detail page (/skills/[slug])
 *   - Skill picker preview pane on hover
 *   - Worker: when a Skill-driven run starts, the worker re-reads the
 *     config server-side instead of trusting client-passed config
 *
 * Auth: published Skills are visible to any authenticated user. Draft
 * Skills are author-only. Workspace-private Skills require workspace
 * membership.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const { slug } = await context.params

  const skill = await prisma.skill.findUnique({ where: { slug } })
  if (!skill) {
    throw new ApiError('NOT_FOUND')
  }

  // Visibility gate.
  if (skill.status !== 'published') {
    // Drafts / archived are author-only (and admin).
    if (skill.authorUserId !== userId) {
      throw new ApiError('NOT_FOUND')
    }
  }
  if (skill.workspaceId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: skill.workspaceId, userId },
      select: { workspaceId: true },
    })
    const owned = await prisma.workspace.findFirst({
      where: { id: skill.workspaceId, ownerEditorId: userId },
      select: { id: true },
    })
    if (!member && !owned) {
      throw new ApiError('NOT_FOUND')
    }
  }

  // Caller's installation row (may be null).
  const installation = await prisma.skillInstallation.findUnique({
    where: { userId_skillId: { userId, skillId: skill.id } },
    select: { id: true, enabled: true, installedAt: true, lastUsedAt: true },
  })

  return NextResponse.json({
    skill: {
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      nameEn: skill.nameEn,
      description: skill.description,
      descriptionEn: skill.descriptionEn,
      thumbnailUrl: skill.thumbnailUrl,
      authorType: skill.authorType,
      authorDisplay: skill.authorDisplay,
      status: skill.status,
      isFeatured: skill.isFeatured,
      popularityScore: skill.popularityScore,
      installCount: skill.installCount,
      config: skill.config,
      installed: Boolean(installation),
      installationId: installation?.id ?? null,
      enabled: installation?.enabled ?? false,
      installedAt: installation?.installedAt ?? null,
    },
  })
})
