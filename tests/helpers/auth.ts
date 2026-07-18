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

let state: MockAuthState = {
  session: defaultSession,
  projectAuthMode: 'allow',
  role: 'member',
  isActive: true,
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

export function installAuthMocks() {
  vi.doMock('@/lib/api-auth', () => ({
    isErrorResponse: (value: unknown) => value instanceof NextResponse,
    requireUserAuth: async () => {
      if (!state.session) return unauthorizedResponse()
      return { session: state.session }
    },
    requireProjectAuth: async (projectId: string) => {
      if (!state.session) return unauthorizedResponse()
      if (state.projectAuthMode === 'forbidden') return forbiddenResponse()
      if (state.projectAuthMode === 'not_found') return notFoundResponse()
      return {
        session: state.session,
        project: { id: projectId, userId: state.session.user.id, name: 'project' },
        novelData: { id: 'novel-data-id' },
      }
    },
    requireProjectAuthLight: async (projectId: string) => {
      if (!state.session) return unauthorizedResponse()
      if (state.projectAuthMode === 'forbidden') return forbiddenResponse()
      if (state.projectAuthMode === 'not_found') return notFoundResponse()
      return {
        session: state.session,
        project: { id: projectId, userId: state.session.user.id, name: 'project' },
      }
    },
    requireProjectAccess: async () => {
      if (!state.session) {
        return { allowed: false, reason: 'NOT_AUTHENTICATED' as const }
      }
      if (state.projectAuthMode === 'not_found') {
        return { allowed: false, reason: 'NOT_FOUND' as const }
      }
      if (state.projectAuthMode === 'forbidden') {
        return { allowed: false, reason: 'NO_ACCESS' as const }
      }
      return { allowed: true, effectiveRole: 'owner' as const }
    },
    requireAdminAuth: async () => {
      if (!state.session) return unauthorizedResponse()
      if (!state.isActive) return forbiddenResponse()
      if (state.role !== 'admin') return forbiddenResponse()
      return { session: state.session }
    },
    requireEditorAuth: async () => {
      if (!state.session) return unauthorizedResponse()
      if (!state.isActive) return forbiddenResponse()
      if (state.role !== 'admin' && state.role !== 'editor') {
        return forbiddenResponse()
      }
      return { session: state.session, role: state.role }
    },
    requireRoleAuth: async (allowed: Role[]) => {
      if (!state.session) return unauthorizedResponse()
      if (!state.isActive) return forbiddenResponse()
      if (state.role !== 'admin' && !allowed.includes(state.role)) {
        return forbiddenResponse()
      }
      return { session: state.session, role: state.role }
    },
  }))
}

export function mockAuthenticated(userId: string) {
  state = {
    ...state,
    session: {
      user: {
        ...defaultSession.user,
        id: userId,
      },
    },
  }
}

export function mockUnauthenticated() {
  state = {
    ...state,
    session: null,
  }
}

export function mockProjectAuth(mode: 'allow' | 'forbidden' | 'not_found') {
  state = {
    ...state,
    projectAuthMode: mode,
  }
}

export function mockRole(role: Role) {
  state = { ...state, role }
}

export function mockActive(isActive: boolean) {
  state = { ...state, isActive }
}

export function resetAuthMockState() {
  state = {
    session: defaultSession,
    projectAuthMode: 'allow',
    role: 'member',
    isActive: true,
  }
  vi.doUnmock('@/lib/api-auth')
}
