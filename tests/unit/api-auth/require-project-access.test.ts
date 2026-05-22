// Phase 12.5 (2026-05-22) — 8-tier project access cascade tests.
//
// Covers all 8 cascade steps plus the critical regression gate:
// existing workspace-editor → member-project access must keep working
// after the migration (Project.workspaceId IS NULL for all legacy data).
//
// Cascade ordering (see docs/plans/workspace-collaboration-spec.md §4):
//   1. owner            2. admin             3. ws_owner (new path)
//   3.5 ws_owner_legacy (LEGACY, the regression gate)
//   4. ProjectCollaborator   5. WorkspaceMember   6. NO_ACCESS

import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  workspace: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  projectCollaborator: { findUnique: vi.fn() },
  workspaceMember: { findUnique: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/logging/context', () => ({
  getLogContext: () => ({}),
  setLogContext: vi.fn(),
}))

import { requireProjectAccess } from '@/lib/api-auth'

// ─── Test fixtures ───────────────────────────────────────────────

const PROJECT_ID = 'proj-1'
const OWNER_ID = 'owner-1'
const ADMIN_ID = 'admin-1'
const EDITOR_ID = 'editor-1'
const MEMBER_ID = 'member-1'
const STRANGER_ID = 'stranger-1'
const WS_ID = 'ws-1'

interface ProjectFixture {
  id: string
  userId: string
  workspaceId: string | null
  deletedAt: Date | null
}

function mockProject(overrides: Partial<ProjectFixture> = {}): ProjectFixture {
  return {
    id: PROJECT_ID,
    userId: OWNER_ID,
    workspaceId: null,
    deletedAt: null,
    ...overrides,
  }
}

function setupBaselineMocks(project: ProjectFixture, requesterRole: 'admin' | 'editor' | 'member') {
  prismaMock.project.findUnique.mockResolvedValue(project)
  prismaMock.user.findUnique.mockResolvedValue({ role: requesterRole })
  // Defaults to "no membership / no collaborator" — tests can override.
  prismaMock.workspace.findFirst.mockResolvedValue(null) // legacy editor check
  prismaMock.workspace.findUnique.mockResolvedValue(null)
  prismaMock.projectCollaborator.findUnique.mockResolvedValue(null)
  prismaMock.workspaceMember.findUnique.mockResolvedValue(null)
}

// ─── Step 1: owner ───────────────────────────────────────────────

describe('requireProjectAccess — Step 1: owner', () => {
  beforeEach(() => vi.clearAllMocks())

  it('owner can read', async () => {
    setupBaselineMocks(mockProject(), 'member') // role doesn't matter
    const result = await requireProjectAccess(PROJECT_ID, OWNER_ID, 'read')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('owner')
  })

  it('owner can write', async () => {
    setupBaselineMocks(mockProject(), 'member')
    const result = await requireProjectAccess(PROJECT_ID, OWNER_ID, 'write')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('owner')
  })

  it('owner check short-circuits — no admin role query needed', async () => {
    setupBaselineMocks(mockProject(), 'member')
    await requireProjectAccess(PROJECT_ID, OWNER_ID, 'write')
    // user.findUnique never called because step 1 already returned
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled()
  })
})

// ─── Step 2: admin ───────────────────────────────────────────────

describe('requireProjectAccess — Step 2: admin', () => {
  beforeEach(() => vi.clearAllMocks())

  it('admin reads any project', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'admin')
    const result = await requireProjectAccess(PROJECT_ID, ADMIN_ID, 'read')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('admin')
  })

  it('admin writes any project', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'admin')
    const result = await requireProjectAccess(PROJECT_ID, ADMIN_ID, 'write')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('admin')
  })
})

// ─── Step 3: workspace owner via P.workspaceId (NEW path) ────────

describe('requireProjectAccess — Step 3: ws_owner (new path)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('workspace owner editor can write project in their workspace', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'editor')
    prismaMock.workspace.findUnique.mockResolvedValue({ ownerEditorId: EDITOR_ID })
    const result = await requireProjectAccess(PROJECT_ID, EDITOR_ID, 'write')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('ws_owner')
  })

  it('skips step 3 when project has no workspaceId', async () => {
    setupBaselineMocks(mockProject({ workspaceId: null }), 'editor')
    await requireProjectAccess(PROJECT_ID, EDITOR_ID, 'read')
    // workspace.findUnique never called when workspaceId is null
    expect(prismaMock.workspace.findUnique).not.toHaveBeenCalled()
  })
})

// ─── Step 3.5: LEGACY editorCanAccessProject (REGRESSION GATE) ────

describe('requireProjectAccess — Step 3.5: LEGACY ws_owner_legacy (CRITICAL REGRESSION GATE)', () => {
  beforeEach(() => vi.clearAllMocks())

  /**
   * 🚨 The regression test that MUST pass before deploy.
   *
   * Pre-migration: editor E owns workspace W, member M is in W, M creates
   * project P. P.workspaceId IS NULL (backfill default).
   *
   * Without step 3.5: step 3 fails (no workspaceId), step 5 fails (no
   * workspaceId), so E loses access to P → REGRESSION.
   *
   * With step 3.5: editorCanAccessProject(E, P.owner=M) finds workspace W
   * matching ownerEditorId=E AND members.userId=M → access granted as
   * ws_owner_legacy.
   */
  it('🚨 REGRESSION GATE: editor accesses member project via legacy workspace membership when P.workspaceId IS NULL', async () => {
    setupBaselineMocks(mockProject({ workspaceId: null }), 'editor')
    // The editorCanAccessProject query finds a workspace where the
    // requester is owner AND the project owner is a member.
    prismaMock.workspace.findFirst.mockResolvedValue({ id: WS_ID })
    const result = await requireProjectAccess(PROJECT_ID, EDITOR_ID, 'write')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('ws_owner_legacy')
  })

  it('legacy fallback also grants read', async () => {
    setupBaselineMocks(mockProject({ workspaceId: null }), 'editor')
    prismaMock.workspace.findFirst.mockResolvedValue({ id: WS_ID })
    const result = await requireProjectAccess(PROJECT_ID, EDITOR_ID, 'read')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('ws_owner_legacy')
  })

  it('does NOT grant access when editor is not owner of any workspace containing project owner', async () => {
    setupBaselineMocks(mockProject({ workspaceId: null }), 'editor')
    prismaMock.workspace.findFirst.mockResolvedValue(null) // no matching ws
    const result = await requireProjectAccess(PROJECT_ID, EDITOR_ID, 'write')
    expect(result.allowed).toBe(false)
  })
})

// ─── Step 4: per-project collaborator ────────────────────────────

describe('requireProjectAccess — Step 4: ProjectCollaborator', () => {
  beforeEach(() => vi.clearAllMocks())

  it('collaborator with editor role can write', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'member')
    prismaMock.projectCollaborator.findUnique.mockResolvedValue({ role: 'editor' })
    const result = await requireProjectAccess(PROJECT_ID, MEMBER_ID, 'write')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('editor')
  })

  it('collaborator with editor role can read', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'member')
    prismaMock.projectCollaborator.findUnique.mockResolvedValue({ role: 'editor' })
    const result = await requireProjectAccess(PROJECT_ID, MEMBER_ID, 'read')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('editor')
  })

  it('collaborator with viewer role can read but NOT write', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'member')
    prismaMock.projectCollaborator.findUnique.mockResolvedValue({ role: 'viewer' })

    const readResult = await requireProjectAccess(PROJECT_ID, MEMBER_ID, 'read')
    expect(readResult.allowed).toBe(true)
    if (readResult.allowed) expect(readResult.effectiveRole).toBe('viewer')

    const writeResult = await requireProjectAccess(PROJECT_ID, MEMBER_ID, 'write')
    expect(writeResult.allowed).toBe(false)
    if (!writeResult.allowed) expect(writeResult.reason).toBe('VIEWER_CANNOT_WRITE')
  })

  it('explicit collaborator grant overrides workspace member default (editor collab beats viewer ws)', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'member')
    prismaMock.projectCollaborator.findUnique.mockResolvedValue({ role: 'editor' })
    // Even if workspace member would be viewer, step 4 wins
    prismaMock.workspaceMember.findUnique.mockResolvedValue({ role: 'viewer' })
    const result = await requireProjectAccess(PROJECT_ID, MEMBER_ID, 'write')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('editor')
  })

  it('explicit collaborator grant overrides workspace member default (viewer collab beats editor ws)', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'member')
    prismaMock.projectCollaborator.findUnique.mockResolvedValue({ role: 'viewer' })
    prismaMock.workspaceMember.findUnique.mockResolvedValue({ role: 'editor' })
    // Step 4 (viewer collab) wins — explicit downgrade
    const writeResult = await requireProjectAccess(PROJECT_ID, MEMBER_ID, 'write')
    expect(writeResult.allowed).toBe(false)
  })
})

// ─── Step 5: workspace member default ────────────────────────────

describe('requireProjectAccess — Step 5: WorkspaceMember default', () => {
  beforeEach(() => vi.clearAllMocks())

  it('workspace member with editor role can write', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'member')
    prismaMock.workspaceMember.findUnique.mockResolvedValue({ role: 'editor' })
    const result = await requireProjectAccess(PROJECT_ID, MEMBER_ID, 'write')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('editor')
  })

  it('workspace member with viewer role can read but NOT write', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'member')
    prismaMock.workspaceMember.findUnique.mockResolvedValue({ role: 'viewer' })

    const readResult = await requireProjectAccess(PROJECT_ID, MEMBER_ID, 'read')
    expect(readResult.allowed).toBe(true)
    if (readResult.allowed) expect(readResult.effectiveRole).toBe('viewer')

    const writeResult = await requireProjectAccess(PROJECT_ID, MEMBER_ID, 'write')
    expect(writeResult.allowed).toBe(false)
    if (!writeResult.allowed) expect(writeResult.reason).toBe('VIEWER_CANNOT_WRITE')
  })

  it('skips step 5 when project has no workspaceId', async () => {
    setupBaselineMocks(mockProject({ workspaceId: null }), 'member')
    await requireProjectAccess(PROJECT_ID, MEMBER_ID, 'read')
    expect(prismaMock.workspaceMember.findUnique).not.toHaveBeenCalled()
  })
})

// ─── Step 6: stranger gets 403 ───────────────────────────────────

describe('requireProjectAccess — Step 6: NO_ACCESS', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stranger gets NO_ACCESS for project with workspace', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'member')
    const result = await requireProjectAccess(PROJECT_ID, STRANGER_ID, 'read')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('NO_ACCESS')
  })

  it('stranger gets NO_ACCESS for project without workspace', async () => {
    setupBaselineMocks(mockProject({ workspaceId: null }), 'member')
    const result = await requireProjectAccess(PROJECT_ID, STRANGER_ID, 'read')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('NO_ACCESS')
  })

  it('stranger gets NO_ACCESS for write too', async () => {
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'member')
    const result = await requireProjectAccess(PROJECT_ID, STRANGER_ID, 'write')
    expect(result.allowed).toBe(false)
  })
})

// ─── Edge cases ──────────────────────────────────────────────────

describe('requireProjectAccess — edge cases', () => {
  beforeEach(() => vi.clearAllMocks())

  it('empty requesterId returns NOT_AUTHENTICATED', async () => {
    const result = await requireProjectAccess(PROJECT_ID, '', 'read')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('NOT_AUTHENTICATED')
  })

  it('non-existent project returns NOT_FOUND', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null)
    const result = await requireProjectAccess(PROJECT_ID, OWNER_ID, 'read')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('NOT_FOUND')
  })

  it('soft-deleted project returns NOT_FOUND', async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      userId: OWNER_ID,
      workspaceId: null,
      deletedAt: new Date(),
    })
    const result = await requireProjectAccess(PROJECT_ID, OWNER_ID, 'read')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('NOT_FOUND')
  })

  it('accepts pre-fetched project to skip DB query', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'admin' })
    const result = await requireProjectAccess(
      { project: { id: PROJECT_ID, userId: OWNER_ID, workspaceId: null } },
      ADMIN_ID,
      'write',
    )
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('admin')
    // project.findUnique never called because caller provided it
    expect(prismaMock.project.findUnique).not.toHaveBeenCalled()
  })
})

// ─── Cascade ordering verification ───────────────────────────────

describe('requireProjectAccess — cascade ordering', () => {
  beforeEach(() => vi.clearAllMocks())

  it('owner always wins over admin (cheap short-circuit)', async () => {
    setupBaselineMocks(mockProject(), 'admin')
    const result = await requireProjectAccess(PROJECT_ID, OWNER_ID, 'write')
    expect(result.allowed).toBe(true)
    // effectiveRole=owner (not admin) — step 1 fired first
    if (result.allowed) expect(result.effectiveRole).toBe('owner')
  })

  it('admin beats ws_owner', async () => {
    // Edge case: an admin who is also workspace owner of project's ws
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'admin')
    prismaMock.workspace.findUnique.mockResolvedValue({ ownerEditorId: ADMIN_ID })
    const result = await requireProjectAccess(PROJECT_ID, ADMIN_ID, 'write')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('admin')
  })

  it('step 3 wins over step 3.5 when both could match', async () => {
    // Project has explicit workspaceId, and the requester is also owner
    // of a legacy workspace containing project owner. Step 3 should fire
    // first; step 3.5 never queried.
    setupBaselineMocks(mockProject({ workspaceId: WS_ID }), 'editor')
    prismaMock.workspace.findUnique.mockResolvedValue({ ownerEditorId: EDITOR_ID })
    // If step 3.5 were queried it would also match, but it shouldn't fire.
    prismaMock.workspace.findFirst.mockResolvedValue({ id: 'legacy-ws' })

    const result = await requireProjectAccess(PROJECT_ID, EDITOR_ID, 'write')
    expect(result.allowed).toBe(true)
    if (result.allowed) expect(result.effectiveRole).toBe('ws_owner')
    // Legacy fallback not consulted
    expect(prismaMock.workspace.findFirst).not.toHaveBeenCalled()
  })
})
