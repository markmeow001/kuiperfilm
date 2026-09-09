import { NextResponse } from 'next/server'
import { vi } from 'vitest'

type SessionUser = {
  id: string
  name?: string | null
  email?: string | null
}

type SessionPayload = {
  user: SessionUser
}

type Role = 'admin' | 'editor' | 'member'

type MockAuthState = {
  session: SessionPayload | null
  projectAuthMode: 'allow' | 'forbidden' | 'not_found'
  // Multi-user: role drives requireAdminAuth / requireEditorAuth /
  // requireRoleAuth; isActive=false short-circuits to 403.
  role: Role
  isActive: boolean
}

const defaultSession: SessionPayload = {
  user: {
    id: 'test-user-id',
    name: 'test-user',
    email: 'test@example.com',
  },
}

function defaultState(): MockAuthState {
  return {
    session: defaultSession,
    projectAuthMode: 'allow',
    role: 'member',
    isActive: true,
  }
}

// The state lives on globalThis rather than in a module-level binding because
// callers pair this helper with `vi.resetModules()`. Resetting the registry
// re-instantiates this module, so a module-level `let` would give the mock
// factory and the test body two separate states: the test would call
// `mockAuthenticated()` on one instance while the factory read the other,
// which surfaced as intermittent 401/500s across the api suite (G-5).
const STATE_KEY = Symbol.for('kuiper.tests.auth-mock-state')

type GlobalWithAuthState = typeof globalThis & {
  [STATE_KEY]?: MockAuthState
}

function state(): MockAuthState {
  const globalScope = globalThis as GlobalWithAuthState
  let current = globalScope[STATE_KEY]
  if (!current) {
    current = defaultState()
    globalScope[STATE_KEY] = current
  }
  return current
}

function unauthorizedResponse() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      },
    },
    { status: 401 },
  )
}

function forbiddenResponse() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      },
    },
    { status: 403 },
  )
}

function notFoundResponse() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Project not found',
      },
    },
    { status: 404 },
  )
}

// The single definition of the api-auth test double. Exported so a file can
// install it from a hoisted `vi.mock('@/lib/api-auth', ...)` factory instead of
// the runtime `vi.doMock` below — the hoisted form has no window in which the
// module resolves to the real implementation, which is what made routes
// intermittently reach the real `requireUserAuth` and throw
// "`headers` was called outside a request scope" (G-5).
export function createAuthMockModule() {
  return {
    isErrorResponse: (value: unknown) => value instanceof NextResponse,
    requireUserAuth: async () => {
      const current = state()
      if (!current.session) return unauthorizedResponse()
      return { session: current.session }
    },
    requireProjectAuth: async (projectId: string) => {
      const current = state()
      if (!current.session) return unauthorizedResponse()
      if (current.projectAuthMode === 'forbidden') return forbiddenResponse()
      if (current.projectAuthMode === 'not_found') return notFoundResponse()
      return {
        session: current.session,
        project: { id: projectId, userId: current.session.user.id, name: 'project' },
        novelData: { id: 'novel-data-id' },
      }
    },
    requireProjectAuthLight: async (projectId: string) => {
      const current = state()
      if (!current.session) return unauthorizedResponse()
      if (current.projectAuthMode === 'forbidden') return forbiddenResponse()
      if (current.projectAuthMode === 'not_found') return notFoundResponse()
      return {
        session: current.session,
        project: { id: projectId, userId: current.session.user.id, name: 'project' },
      }
    },
    requireProjectAccess: async () => {
      const current = state()
      if (!current.session) {
        return { allowed: false, reason: 'NOT_AUTHENTICATED' as const }
      }
      if (current.projectAuthMode === 'not_found') {
        return { allowed: false, reason: 'NOT_FOUND' as const }
      }
      if (current.projectAuthMode === 'forbidden') {
        return { allowed: false, reason: 'NO_ACCESS' as const }
      }
      return { allowed: true, effectiveRole: 'owner' as const }
    },
    requireAdminAuth: async () => {
      const current = state()
      if (!current.session) return unauthorizedResponse()
      if (!current.isActive) return forbiddenResponse()
      if (current.role !== 'admin') return forbiddenResponse()
      return { session: current.session }
    },
    requireEditorAuth: async () => {
      const current = state()
      if (!current.session) return unauthorizedResponse()
      if (!current.isActive) return forbiddenResponse()
      if (current.role !== 'admin' && current.role !== 'editor') {
        return forbiddenResponse()
      }
      return { session: current.session, role: current.role }
    },
    requireRoleAuth: async (allowed: Role[]) => {
      const current = state()
      if (!current.session) return unauthorizedResponse()
      if (!current.isActive) return forbiddenResponse()
      if (current.role !== 'admin' && !allowed.includes(current.role)) {
        return forbiddenResponse()
      }
      return { session: current.session, role: current.role }
    },
  }
}

export function installAuthMocks() {
  vi.doMock('@/lib/api-auth', () => createAuthMockModule())
}

export function mockAuthenticated(userId: string) {
  state().session = {
    user: {
      ...defaultSession.user,
      id: userId,
    },
  }
}

export function mockUnauthenticated() {
  state().session = null
}

export function mockProjectAuth(mode: 'allow' | 'forbidden' | 'not_found') {
  state().projectAuthMode = mode
}

export function mockRole(role: Role) {
  state().role = role
}

export function mockActive(isActive: boolean) {
  state().isActive = isActive
}

export function resetAuthMockState() {
  // State only: deliberately does not unregister the module mock. Unmocking
  // here left every caller with a window between this reset and the next
  // `installAuthMocks()` in which `@/lib/api-auth` resolved to the real
  // implementation, and it would tear down a hoisted `vi.mock` outright.
  // Callers that re-install per test are unaffected; the mock is idempotent.
  Object.assign(state(), defaultState())
}
