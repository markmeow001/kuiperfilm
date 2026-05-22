/**
 * Admin: list every project across all users.
 *
 * GET /api/admin/projects?limit=100
 *
 * Returns each project with owner, mode, character/location/storyboard/
 * panel/video counts, and last activity timestamp. Used by the admin
 * "/admin/projects" overview to triage what users are doing.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const limitParam = Number.parseInt(searchParams.get('limit') || '100', 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 500) : 100
  // Phase 12.5 (2026-05-22) — admin opt-in to see soft-deleted projects
  // for restore workflow. Defaults to excluding so the main list stays
  // clean. Pass ?includeDeleted=true for the admin restore queue view.
  const includeDeleted = searchParams.get('includeDeleted') === 'true'

  const projects = await prisma.project.findMany({
    where: includeDeleted ? {} : { deletedAt: null },
    orderBy: [{ lastAccessedAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
    select: {
      id: true,
      name: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
      lastAccessedAt: true,
      user: {
        select: { id: true, name: true, email: true },
      },
      novelPromotionData: {
        select: {
          id: true,
          _count: {
            select: { characters: true, locations: true, episodes: true },
          },
        },
      },
    },
  })

  // Per-project panel + video counts come from a side query — Prisma
  // doesn't aggregate through 3 levels with _count.
  const npProjectIds = projects
    .map((p) => p.novelPromotionData?.id)
    .filter((id): id is string => Boolean(id))

  const panelStats = npProjectIds.length
    ? await prisma.$queryRaw<Array<{ projectId: string; panelCount: bigint; videoCount: bigint }>>(
        Prisma.sql`
          SELECT npp.id AS projectId,
                 COUNT(p.id) AS panelCount,
                 COUNT(CASE WHEN p.videoUrl IS NOT NULL THEN 1 END) AS videoCount
            FROM novel_promotion_projects npp
            LEFT JOIN novel_promotion_episodes ep ON ep.novelPromotionProjectId = npp.id
            LEFT JOIN novel_promotion_storyboards sb ON sb.episodeId = ep.id
            LEFT JOIN novel_promotion_panels p ON p.storyboardId = sb.id
           WHERE npp.id IN (${Prisma.join(npProjectIds)})
           GROUP BY npp.id
        `,
      ).catch(() => [])
    : []

  // Map by novelPromotionProject.id
  const statsMap = new Map<string, { panelCount: number; videoCount: number }>()
  for (const row of panelStats) {
    statsMap.set(row.projectId, {
      panelCount: Number(row.panelCount),
      videoCount: Number(row.videoCount),
    })
  }

  return NextResponse.json({
    projects: projects.map((p) => {
      const npId = p.novelPromotionData?.id
      const stats = npId ? statsMap.get(npId) : undefined
      return {
        id: p.id,
        name: p.name,
        mode: p.mode,
        owner: p.user
          ? { id: p.user.id, name: p.user.name, email: p.user.email }
          : null,
        characterCount: p.novelPromotionData?._count.characters ?? 0,
        locationCount: p.novelPromotionData?._count.locations ?? 0,
        episodeCount: p.novelPromotionData?._count.episodes ?? 0,
        panelCount: stats?.panelCount ?? 0,
        videoCount: stats?.videoCount ?? 0,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        lastAccessedAt: p.lastAccessedAt,
      }
    }),
  })
})
