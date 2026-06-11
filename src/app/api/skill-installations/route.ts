/**
 * Phase 2.5 (2026-06-10) — Install a Skill for the calling user.
 *
 * POST /api/skill-installations
 *   body: { skillId: string }
 *   → creates SkillInstallation row + bumps Skill.installCount.
 *     Idempotent — re-installing returns the existing row.
 *
 * See also:
 *   - PATCH /api/skill-installations/[id] — enable/disable toggle
 *   - DELETE /api/skill-installations/[id] — uninstall
 *
 * Auth: any authenticated user. Workspace-private Skills require the
 * caller be a member of that workspace.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const body = await request.json().catch(() => ({}))
  const skillId = typeof body?.skillId === 'string' ? body.skillId : null
  if (!skillId) {
    throw new ApiError('INVALID_PARAMS', { message: 'skillId required' })
  }

  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    select: { id: true, status: true, workspaceId: true },
  })
  if (!skill) {
    throw new ApiError('NOT_FOUND', { code: 'SKILL_NOT_FOUND' })
  }
  if (skill.status !== 'published') {
    throw new ApiError('FORBIDDEN', { code: 'SKILL_NOT_PUBLISHED' })
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
      throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_MEMBER' })
    }
  }

  // Idempotent upsert. installCount only bumps on first install.
  const existing = await prisma.skillInstallation.findUnique({
    where: { userId_skillId: { userId, skillId } },
  })

  if (existing) {
    return NextResponse.json({
      installation: {
        id: existing.id,
        skillId: existing.skillId,
        enabled: existing.enabled,
        installedAt: existing.installedAt,
        alreadyInstalled: true,
      },
    })
  }

  const [installation] = await prisma.$transaction([
    prisma.skillInstallation.create({
      data: { userId, skillId, enabled: true },
    }),
    prisma.skill.update({
      where: { id: skillId },
      data: { installCount: { increment: 1 } },
    }),
  ])

  return NextResponse.json({
    installation: {
      id: installation.id,
      skillId: installation.skillId,
      enabled: installation.enabled,
      installedAt: installation.installedAt,
      alreadyInstalled: false,
    },
  })
})
