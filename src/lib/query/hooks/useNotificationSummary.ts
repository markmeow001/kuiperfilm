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

export class NotificationSummaryRequestError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Notification summary request failed with HTTP ${status}`)
    this.name = 'NotificationSummaryRequestError'
    this.status = status
  }
}

export async function fetchNotificationSummary(): Promise<NotificationSummary> {
  const res = await fetch('/api/notifications/summary', { credentials: 'include' })
  if (!res.ok) {
    throw new NotificationSummaryRequestError(res.status)
  }
  return res.json() as Promise<NotificationSummary>
}

export function useNotificationSummary() {
  return useQuery({
    queryKey: queryKeys.notifications.summary(),
    queryFn: fetchNotificationSummary,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: POLL_INTERVAL_MS / 2,
    retry: (failureCount, error) => {
      if (
        error instanceof NotificationSummaryRequestError
        && (error.status === 401 || error.status === 403)
      ) {
        return false
      }
      return failureCount < 1
    },
  })
}
