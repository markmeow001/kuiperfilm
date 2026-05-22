import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== Mocks =====

const prismaMock = vi.hoisted(() => ({
  workspaceMember: {
    count: vi.fn<(args?: { where?: { role?: string } }) => Promise<number>>(),
    updateMany: vi.fn<(args: unknown) => Promise<{ count: number }>>(),
  },
  project: {
    count: vi.fn<(args?: { where?: { workspaceId?: { not: null } } }) => Promise<number>>(),
  },
  $disconnect: vi.fn(),
}))

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn((...args: unknown[]) => loggerMock.info(...args)),
  logWarn: vi.fn((...args: unknown[]) => loggerMock.warn(...args)),
}))

import { backfillWorkspaceCollab } from '../../../scripts/migrations/backfill-workspace-collab'

// Helper: configure the count() mock to return values based on the
// `where.role` filter so we can simulate "5 viewer rows + 3 editor rows".
function setupMemberCounts({ viewers, editors }: { viewers: number; editors: number }) {
  prismaMock.workspaceMember.count.mockImplementation(async (args?: { where?: { role?: string } }) => {
    if (!args?.where?.role) return viewers + editors
    if (args.where.role === 'viewer') return viewers
    if (args.where.role === 'editor') return editors
    return 0
  })
}

describe('backfillWorkspaceCollab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.project.count.mockResolvedValue(0)
  })

  describe('dry-run mode (apply=false)', () => {
    it('returns expected counts without writing', async () => {
      setupMemberCounts({ viewers: 5, editors: 3 })

      const stats = await backfillWorkspaceCollab({ apply: false })

      expect(stats.workspaceMembersTotal).toBe(8)
      expect(stats.workspaceMembersToUpgrade).toBe(5)
      expect(stats.workspaceMembersAlreadyEditor).toBe(3)
      expect(stats.workspaceMembersUpgraded).toBe(0) // dry-run never writes
      expect(prismaMock.workspaceMember.updateMany).not.toHaveBeenCalled()
    })

    it('handles zero existing members', async () => {
      setupMemberCounts({ viewers: 0, editors: 0 })

      const stats = await backfillWorkspaceCollab({ apply: false })

      expect(stats.workspaceMembersTotal).toBe(0)
      expect(stats.workspaceMembersToUpgrade).toBe(0)
      expect(prismaMock.workspaceMember.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('apply mode (apply=true)', () => {
    it('upgrades all viewer rows to editor', async () => {
      setupMemberCounts({ viewers: 5, editors: 3 })
      prismaMock.workspaceMember.updateMany.mockResolvedValue({ count: 5 })

      const stats = await backfillWorkspaceCollab({ apply: true })

      expect(prismaMock.workspaceMember.updateMany).toHaveBeenCalledWith({
        where: { role: 'viewer' },
        data: { role: 'editor' },
      })
      expect(stats.workspaceMembersUpgraded).toBe(5)
    })

    it('is a no-op when no viewer rows exist (idempotent re-run)', async () => {
      // Simulates running the script twice on a healthy prod — second run
      // should find 0 viewers, write 0 rows.
      setupMemberCounts({ viewers: 0, editors: 8 })

      const stats = await backfillWorkspaceCollab({ apply: true })

      expect(prismaMock.workspaceMember.updateMany).not.toHaveBeenCalled()
      expect(stats.workspaceMembersUpgraded).toBe(0)
    })

    it('only touches viewer rows even when mixed with editor rows', async () => {
      // Mid-deploy edge case: after backfill, ops invite new user → row
      // inserted with default viewer → script run again must upgrade
      // only that new row, not touch the editor rows.
      setupMemberCounts({ viewers: 1, editors: 7 })
      prismaMock.workspaceMember.updateMany.mockResolvedValue({ count: 1 })

      const stats = await backfillWorkspaceCollab({ apply: true })

      expect(prismaMock.workspaceMember.updateMany).toHaveBeenCalledWith({
        where: { role: 'viewer' },
        data: { role: 'editor' },
      })
      expect(stats.workspaceMembersUpgraded).toBe(1)
    })

    it('warns when update count diverges from expected (data race detection)', async () => {
      // Simulates a row deletion happening between count and updateMany —
      // script should log a warning but not crash.
      setupMemberCounts({ viewers: 5, editors: 3 })
      prismaMock.workspaceMember.updateMany.mockResolvedValue({ count: 4 })

      await backfillWorkspaceCollab({ apply: true })

      expect(loggerMock.warn).toHaveBeenCalledWith(
        '[backfill-workspace-collab] upgrade count != expected',
        expect.objectContaining({ upgraded: 4, expected: 5 }),
      )
    })
  })

  describe('Project.workspaceId sanity check', () => {
    it('reports projects with non-null workspaceId (should be 0 on first run)', async () => {
      setupMemberCounts({ viewers: 0, editors: 0 })
      prismaMock.project.count.mockImplementation(async (args?: { where?: { workspaceId?: { not: null } } }) => {
        // No filter → total project count
        if (!args?.where) return 42
        // Filter for workspaceId not null → expected 0 on first run
        return 0
      })

      const stats = await backfillWorkspaceCollab({ apply: false })

      expect(stats.projectsTotal).toBe(42)
      expect(stats.projectsWithWorkspace).toBe(0)
    })
  })
})
