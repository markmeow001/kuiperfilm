'use client'

/**
 * Phase 12.5 (2026-05-22) — useProjectAccess
 *
 * Frontend hook that tells the current page which role the user has on
 * the project + whether they can edit. Powers:
 *   - V2WorkspaceShell role badge (OWNER / ADMIN / EDITOR / VIEWER)
 *   - All V2 mutation buttons across script/subjects/storyboard/voice/final
 *     (disabled when !canEdit)
 *   - Edit request modal (shown when viewer tries to write)
 *
 * Behavior:
 *   - 5-minute staleTime: role rarely changes mid-session, no need to
 *     hammer the API on every page nav
 *   - Returns conservative loading state: { canEdit: false, canView: false }
 *     until first fetch resolves, so UI defaults to "locked" rather than
 *     flashing all buttons enabled then disabling them
 *   - On 404 (project soft-deleted or doesn't exist): returns
 *     { allowed: false } so the caller can redirect / show empty state
 *   - On 403: returns { allowed: false } too — caller should treat the
 *     project as inaccessible
 */

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../keys'

export type ProjectAccessRole =
  | 'owner'
  | 'admin'
  | 'ws_owner'
  | 'ws_owner_legacy'
  | 'editor'
  | 'viewer'

interface ProjectAccessResponse {
  allowed: true
  role: ProjectAccessRole
  canEdit: boolean
  canView: true
}

export interface ProjectAccessState {
  /** False while loading, on 403/404, or if the project doesn't exist. */
  allowed: boolean
  /** The user's effective role. Null while loading or when not allowed. */
  role: ProjectAccessRole | null
  /** True only for owner/admin/ws_owner/ws_owner_legacy/editor. */
  canEdit: boolean
  /** True whenever allowed (the cascade always grants read if anything matches). */
  canView: boolean
  /** Initial load state. Pages can use this to skip flashing button-disabled. */
  isLoading: boolean
  /** True only when the access request failed in transport/server handling.
   *  A 403/404 remains a resolved permission result and does not set this. */
  isError: boolean
  /** Transport/server error for an explicit retry state. */
  error: Error | null
  /** Refetch helper exposed for cases where role might have changed (e.g. after
   *  invite acceptance, request approval). */
  refetch: () => Promise<unknown>
}

export function useProjectAccess(projectId: string | null | undefined): ProjectAccessState {
  const query = useQuery({
    queryKey: projectId ? queryKeys.project.access(projectId) : ['project', 'no-id', 'access'],
    queryFn: async (): Promise<ProjectAccessResponse | null> => {
      if (!projectId) return null
      const res = await fetch(`/api/projects/${projectId}/access`)
      if (res.status === 404 || res.status === 403) {
        return null
      }
      if (!res.ok) {
        throw new Error(`Project access fetch failed: HTTP ${res.status}`)
      }
      return res.json()
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes — role rarely changes mid-session
    // Don't retry 403/404 — they're terminal "you can't see this" states
    retry: (failureCount, error) => {
      if (failureCount >= 2) return false
      const msg = error instanceof Error ? error.message : ''
      if (msg.includes('403') || msg.includes('404')) return false
      return true
    },
  })

  if (query.data && query.data.allowed) {
    return {
      allowed: true,
      role: query.data.role,
      canEdit: query.data.canEdit,
      canView: query.data.canView,
      isLoading: false,
      isError: query.isError,
      error: query.error,
      refetch: query.refetch,
    }
  }

  // Loading or not allowed — conservative defaults (locked).
  return {
    allowed: false,
    role: null,
    canEdit: false,
    canView: false,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}
