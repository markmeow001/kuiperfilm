// Editor workspace access — auth helper for `requireProjectAuth*`.
// The fn is module-private; we test the indirect contract via prisma
// query expectations instead (matches the patterns in
// resolve-analysis-model + admin-fallback test suites).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  workspace: { findFirst: vi.fn(), findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  project: { findUnique: vi.fn() },
  // Phase 12.5 (2026-05-22) — requireProjectAccess (called internally
  // by requireProjectAuthLight) consults these tables for cascade
  // steps 4-5. Existing tests don't exercise those paths, so mocks
  // just need to resolve to "not found" / "no row".
  projectCollaborator: { findUnique: vi.fn().mockResolvedValue(null) },
  workspaceMember: { findUnique: vi.fn().mockResolvedValue(null) },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/prisma-retry', () => ({ withPrismaRetry: <T>(fn: () => T) => fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(async () => ({
    user: { id: 'editor-1' },
  })),
}))
vi.mock('next/headers', () => ({
  headers: async () => ({ get: () => null }),
}))
vi.mock('@/lib/logging/context', () => ({
  getLogContext: () => ({}),
  setLogContext: vi.fn(),
}))

import { requireProjectAuthLight } from '@/lib/api-auth'

describe('requireProjectAuthLight — editor cross-user access via workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // baseline: requester is non-admin
    prismaMock.user.findUnique.mockResolvedValue({ role: 'editor', isActive: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows when requester is the project owner (no workspace lookup needed)', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({
      id: 'proj-1',
      userId: 'editor-1',
      name: 'mine',
    })

    const result = await requireProjectAuthLight('proj-1')
    expect('project' in (result as object)).toBe(true)
    // Editor-access lookup must NOT have been triggered for owner-match.
    expect(prismaMock.workspace.findFirst).not.toHaveBeenCalled()
  })

  it('allows when requester is editor of a workspace where projectOwner is a member', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({
      id: 'proj-2',
      userId: 'member-x',
      name: 'team project',
    })
    prismaMock.workspace.findFirst.mockResolvedValueOnce({ id: 'ws-1' })

    const result = await requireProjectAuthLight('proj-2')
    expect('project' in (result as object)).toBe(true)
    expect(prismaMock.workspace.findFirst).toHaveBeenCalledWith({
      where: {
        ownerEditorId: 'editor-1',
        members: { some: { userId: 'member-x' } },
      },
      select: { id: true },
    })
  })

  it('returns 403 when requester is neither admin, owner, nor editor-with-membership', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce({
      id: 'proj-3',
      userId: 'someone-else',
      name: 'not yours',
    })
    prismaMock.workspace.findFirst.mockResolvedValueOnce(null) // no workspace match

    const result = await requireProjectAuthLight('proj-3')
    // requireProjectAuthLight returns NextResponse on forbidden — assert
    // by absence of `project` key. (In a fully wired test we'd assert
    // status === 403 but mocking NextResponse adds noise without value.)
    expect('project' in (result as object)).toBe(false)
  })

  it('admin path still wins even when no workspace membership exists', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ role: 'admin', isActive: true })
    prismaMock.project.findUnique.mockResolvedValueOnce({
      id: 'proj-4',
      userId: 'someone-else',
      name: 'admin debug view',
    })

    const result = await requireProjectAuthLight('proj-4')
    expect('project' in (result as object)).toBe(true)
    // workspace.findFirst should NOT have been consulted — admin shortcut
    // beats the editor-workspace path.
    expect(prismaMock.workspace.findFirst).not.toHaveBeenCalled()
  })
})
