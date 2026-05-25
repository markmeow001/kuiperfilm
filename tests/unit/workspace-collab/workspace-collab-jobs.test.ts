// Phase 12.5 — workspace collab cron jobs.
//
// Two unit-tested behaviors:
//   1. expireStaleRequests: batch updateMany filters status='pending'
//      AND createdAt < cutoff. Cutoff = now - REQUEST_TTL_DAYS.
//   2. hardDeleteExpiredProjects: scans projects with deletedAt < cutoff,
//      audits + hard-deletes each, returns counts. Tolerates per-project
//      failure (doesn't abort whole sweep).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  editRequest: { updateMany: vi.fn() },
  project: { findMany: vi.fn() },
}))

const cleanupMock = vi.hoisted(() => ({
  hardDeleteProject: vi.fn(),
}))

// Mock the audit helper directly — bypasses the AUDIT_LOG_ENABLED env
// gate (which is captured at audit-log.ts module load and impossible to
// flip post-import in vitest because imports hoist).
const auditMock = vi.hoisted(() => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/project-cleanup', () => ({
  hardDeleteProject: cleanupMock.hardDeleteProject,
}))
vi.mock('@/lib/audit-log', () => ({
  recordAudit: auditMock.recordAudit,
}))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
  logInfo: vi.fn(),
  logError: vi.fn(),
}))

process.env.COLLAB_CRON_REQUEST_TTL_DAYS = '7'
process.env.COLLAB_CRON_DELETE_GRACE_DAYS = '30'

import {
  expireStaleRequests,
  hardDeleteExpiredProjects,
} from '@/lib/workspace-collab-jobs'

describe('expireStaleRequests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks pending requests older than 7 days as expired', async () => {
    prismaMock.editRequest.updateMany.mockResolvedValueOnce({ count: 3 })
    const now = new Date('2026-06-01T00:00:00Z')

    const result = await expireStaleRequests(now)

    expect(result.expired).toBe(3)
    const args = prismaMock.editRequest.updateMany.mock.calls[0]?.[0]
    expect(args?.where?.status).toBe('pending')
    // Cutoff should be exactly 7 days before "now"
    const expectedCutoff = new Date('2026-05-25T00:00:00Z')
    expect((args?.where?.createdAt?.lt as Date).getTime()).toBe(expectedCutoff.getTime())
    expect(args?.data?.status).toBe('expired')
    expect(args?.data?.resolvedAt).toEqual(now)
  })

  it('returns count=0 when nothing is stale', async () => {
    prismaMock.editRequest.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await expireStaleRequests()

    expect(result.expired).toBe(0)
  })
})

describe('hardDeleteExpiredProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hard-deletes each project past grace window + writes audit row first', async () => {
    const deletedAt = new Date('2026-04-01T00:00:00Z') // 60 days before "now"
    prismaMock.project.findMany.mockResolvedValueOnce([
      { id: 'p1', name: 'A', userId: 'owner-1', deletedAt, deletedBy: 'admin-1' },
      { id: 'p2', name: 'B', userId: 'owner-2', deletedAt, deletedBy: null },
    ])
    cleanupMock.hardDeleteProject.mockResolvedValue({
      cosSuccess: 5,
      cosFailed: 0,
      rowDropped: true,
    })
    const now = new Date('2026-06-01T00:00:00Z')

    const result = await hardDeleteExpiredProjects(now)

    expect(result.hardDeleted).toBe(2)
    expect(result.failed).toBe(0)
    expect(result.scanned).toBe(2)
    expect(cleanupMock.hardDeleteProject).toHaveBeenCalledTimes(2)
    // Audit must run BEFORE hard-delete (otherwise projectId is gone)
    expect(auditMock.recordAudit).toHaveBeenCalledTimes(2)
    const firstAuditArgs = auditMock.recordAudit.mock.calls[0]?.[1]
    expect(firstAuditArgs?.action).toBe('project.soft_delete')
    expect(firstAuditArgs?.entityType).toBe('Project')
    expect((firstAuditArgs?.snapshot as { phase: string })?.phase).toBe('hard_delete')
  })

  it('counts a project as failed when hardDeleteProject reports rowDropped=false', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        name: 'A',
        userId: 'owner-1',
        deletedAt: new Date('2026-04-01T00:00:00Z'),
        deletedBy: null,
      },
    ])
    cleanupMock.hardDeleteProject.mockResolvedValueOnce({
      cosSuccess: 0,
      cosFailed: 2,
      rowDropped: false,
    })

    const result = await hardDeleteExpiredProjects(new Date('2026-06-01T00:00:00Z'))

    expect(result.hardDeleted).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('continues sweep when one project throws (does not abort batch)', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([
      { id: 'p1', name: 'A', userId: 'o1', deletedAt: new Date('2026-04-01'), deletedBy: null },
      { id: 'p2', name: 'B', userId: 'o2', deletedAt: new Date('2026-04-01'), deletedBy: null },
    ])
    cleanupMock.hardDeleteProject
      .mockRejectedValueOnce(new Error('COS connection refused'))
      .mockResolvedValueOnce({ cosSuccess: 1, cosFailed: 0, rowDropped: true })

    const result = await hardDeleteExpiredProjects(new Date('2026-06-01T00:00:00Z'))

    expect(result.failed).toBe(1)
    expect(result.hardDeleted).toBe(1)
    expect(result.scanned).toBe(2)
  })

  it('uses deletedBy as audit actor when available; falls back to project owner', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([
      { id: 'p1', name: 'A', userId: 'owner-1', deletedAt: new Date('2026-04-01'), deletedBy: 'admin-1' },
      { id: 'p2', name: 'B', userId: 'owner-2', deletedAt: new Date('2026-04-01'), deletedBy: null },
    ])
    cleanupMock.hardDeleteProject.mockResolvedValue({
      cosSuccess: 0,
      cosFailed: 0,
      rowDropped: true,
    })

    await hardDeleteExpiredProjects(new Date('2026-06-01T00:00:00Z'))

    const args1 = auditMock.recordAudit.mock.calls[0]?.[1]
    const args2 = auditMock.recordAudit.mock.calls[1]?.[1]
    expect(args1?.userId).toBe('admin-1') // deletedBy when present
    expect(args2?.userId).toBe('owner-2') // owner fallback when deletedBy null
  })

  it('respects HARD_DELETE_BATCH=50 cap', async () => {
    prismaMock.project.findMany.mockResolvedValueOnce([])

    await hardDeleteExpiredProjects()

    expect(prismaMock.project.findMany.mock.calls[0]?.[0]?.take).toBe(50)
  })
})
