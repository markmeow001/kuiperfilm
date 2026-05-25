'use client'

/**
 * Phase 12.5 — useNotificationSummary
 *
 * Polls /api/notifications/summary every 30s for the bell badge dropdown.
 * One endpoint, one poll — three sections combined into a single payload
 * (see API route comment for rationale).
 *
 * 30s cadence chosen because the user-facing latency budget here is
 * "minutes, not seconds" — owners checking who asked for access don't
 * need real-time. Bumping to 60s would also be fine. SSE/WebSocket would
 * be over-engineering at our 10-20 internal user scale.
 *
 * Pauses polling when the document is hidden (React Query default for
 * refetchIntervalInBackground=false) so we don't burn DB on backgrounded
 * tabs.
 */

import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../keys'

export interface IncomingRequest {
  id: string
  projectId: string
  project: { id: string; name: string | null }
  requester: { id: string; name: string | null; displayName: string | null }
  message: string | null
  createdAt: string
}

export interface MyRequest {
  id: string
  projectId: string
  project: { id: string; name: string | null }
  status: 'pending' | 'approved' | 'denied' | 'expired'
  message: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface AdminDeletion {
  projectId: string
  projectName: string | null
  deletedAt: string | null
  deletedBy: string | null
}

export interface NotificationSummary {
  badgeCount: number
  incomingRequests: IncomingRequest[]
  myRequests: MyRequest[]
  adminDeletions: AdminDeletion[]
}

const POLL_INTERVAL_MS = 30_000

export function useNotificationSummary() {
  return useQuery({
    queryKey: queryKeys.notifications.summary(),
    queryFn: async (): Promise<NotificationSummary> => {
      const res = await fetch('/api/notifications/summary', { credentials: 'include' })
      if (!res.ok) {
        // 401 / 403 → not logged in or no access; return empty summary
        // rather than throwing, so the bell stays mounted without errors.
        if (res.status === 401 || res.status === 403) {
          return {
            badgeCount: 0,
            incomingRequests: [],
            myRequests: [],
            adminDeletions: [],
          }
        }
        throw new Error(`HTTP ${res.status}`)
      }
      return res.json()
    },
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: POLL_INTERVAL_MS / 2,
    retry: 1,
  })
}
