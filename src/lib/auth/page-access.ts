import 'server-only'

import { getServerSession } from 'next-auth/next'
import type { Session } from 'next-auth'
import { notFound, redirect } from 'next/navigation'

import { authOptions } from '@/lib/auth'
import {
  requireProjectAccess,
  type ProjectAccessRole,
} from '@/lib/api-auth'
import { resolvePostAuthPath, withCallbackUrl } from '@/lib/auth/post-auth-url'

export type PageSearchParams = Readonly<Record<string, string | string[] | undefined>>

interface PageAccessInput {
  locale: string
  pathname: string
  searchParams?: PageSearchParams
}

interface ProjectPageAccessInput extends PageAccessInput {
  projectId: string
}

export type AuthenticatedPageSession = Session & {
  user: NonNullable<Session['user']> & { id: string }
}

export type ProjectPageReadAccess =
  | {
      kind: 'allowed'
      session: AuthenticatedPageSession
      effectiveRole: ProjectAccessRole
    }
  | { kind: 'forbidden' }

function buildCallbackPath(pathname: string, searchParams?: PageSearchParams): string {
  const query = new URLSearchParams()

  for (const [key, rawValue] of Object.entries(searchParams ?? {})) {
    if (typeof rawValue === 'string') {
      query.append(key, rawValue)
      continue
    }

    for (const value of rawValue ?? []) {
      query.append(key, value)
    }
  }

  const queryString = query.toString()
  const requestedPath = queryString ? `${pathname}?${queryString}` : pathname

  return resolvePostAuthPath(requestedPath, pathname)
}

/**
 * Protect a server-rendered page before its client component is returned.
 * Session-store failures deliberately propagate so an outage cannot appear
 * to be a logged-out state.
 */
export async function requireAuthenticatedPageAccess({
  locale,
  pathname,
  searchParams,
}: PageAccessInput): Promise<AuthenticatedPageSession> {
  const session = await getServerSession(authOptions) as Session | null

  if (!session?.user?.id) {
    const callbackPath = buildCallbackPath(pathname, searchParams)
    redirect(withCallbackUrl(`/${locale}/auth/signin`, callbackPath))
  }

  return session as AuthenticatedPageSession
}

/**
 * Enforce project read access for server-rendered pages.
 *
 * A viewer is a valid reader. Missing projects use Next's not-found boundary,
 * while an authenticated user without access receives an opaque forbidden
 * state so no project metadata is exposed. Infrastructure failures propagate.
 */
export async function requireProjectPageReadAccess({
  projectId,
  ...pageAccess
}: ProjectPageAccessInput): Promise<ProjectPageReadAccess> {
  const session = await requireAuthenticatedPageAccess(pageAccess)
  const access = await requireProjectAccess(projectId, session.user.id, 'read')

  if (access.allowed) {
    return {
      kind: 'allowed',
      session,
      effectiveRole: access.effectiveRole,
    }
  }

  if (access.reason === 'NO_ACCESS') {
    return { kind: 'forbidden' }
  }

  if (access.reason === 'NOT_FOUND') {
    notFound()
  }

  throw new Error(`UNEXPECTED_PROJECT_PAGE_ACCESS_DENIAL:${access.reason}`)
}
