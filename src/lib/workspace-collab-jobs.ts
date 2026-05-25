/**
 * Phase 12.5 — workspace collab background-job logic.
 *
 * Pure functions called by scripts/workspace-collab-cron.ts.
 * Extracted so tests can call them without importing the script
 * (which would trigger setInterval at module load).
 *
 * Knobs (env-driven, with defaults that match production):
 *   COLLAB_CRON_REQUEST_TTL_DAYS    default 7
 *   COLLAB_CRON_DELETE_GRACE_DAYS   default 30
 */
import { prisma } from '@/lib/prisma'
import { hardDeleteProject } from '@/lib/project-cleanup'
import { recordAudit } from '@/lib/audit-log'

const REQUEST_TTL_DAYS = Number.parseInt(
  process.env.COLLAB_CRON_REQUEST_TTL_DAYS || '7',
  10,
) || 7
const DELETE_GRACE_DAYS = Number.parseInt(
  process.env.COLLAB_CRON_DELETE_GRACE_DAYS || '30',
  10,
) || 30
const HARD_DELETE_BATCH = 50

/**
 * Mark every pending EditRequest older than TTL as 'expired'.
 * Batch updateMany — single query regardless of N.
 */
export async function expireStaleRequests(now: Date = new Date()): Promise<{
  expired: number
}> {
  const cutoff = new Date(now.getTime() - REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000)
  const result = await prisma.editRequest.updateMany({
    where: {
      status: 'pending',
      createdAt: { lt: cutoff },
    },
    data: {
      status: 'expired',
      resolvedAt: now,
    },
  })
  return { expired: result.count }
}

/**
 * Hard-delete every project whose soft-delete window has elapsed.
 * Bounded batch — leftovers picked up by next tick.
 * Audits BEFORE the row drops so the trail survives.
 */
export async function hardDeleteExpiredProjects(now: Date = new Date()): Promise<{
  hardDeleted: number
  failed: number
  scanned: number
}> {
  const cutoff = new Date(now.getTime() - DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000)
  const stale = await prisma.project.findMany({
    where: {
      deletedAt: { not: null, lt: cutoff },
    },
    select: { id: true, name: true, userId: true, deletedAt: true, deletedBy: true },
    take: HARD_DELETE_BATCH,
    orderBy: { deletedAt: 'asc' },
  })

  let hardDeleted = 0
  let failed = 0
  for (const project of stale) {
    try {
      await recordAudit(prisma, {
        userId: project.deletedBy || project.userId,
        projectId: project.id,
        action: 'project.soft_delete',
        entityType: 'Project',
        entityId: project.id,
        snapshot: {
          phase: 'hard_delete',
          name: project.name,
          deletedAt: project.deletedAt?.toISOString() ?? null,
          deletedBy: project.deletedBy,
        },
      })
      const outcome = await hardDeleteProject(project.id)
      if (outcome.rowDropped) {
        hardDeleted += 1
      } else {
        failed += 1
      }
    } catch {
      failed += 1
    }
  }
  return { hardDeleted, failed, scanned: stale.length }
}
