'use client'

/**
 * Phase 12.5 — top-bar notification bell.
 *
 * Three sections in one dropdown (combined poll, see /api/notifications/summary):
 *
 *   1. 收到的編輯請求 — incoming requests on projects I own
 *      Each row: [批准] [拒絕] inline buttons.
 *   2. 你的請求 — status of edit requests I made
 *   3. ⚠️ 你的專案被 admin 操作 — projects of mine that admin
 *      soft-deleted (within 30d restore window)
 *
 * Badge shows incoming pending count only — admin notifications are
 * informational, not actionable.
 *
 * Polls every 30s via useNotificationSummary. Pauses when tab is hidden.
 *
 * Mutations (approve / deny / restore) trigger React Query invalidation
 * on the summary key so the badge updates immediately, not after the
 * next poll window.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useNotificationSummary } from '@/lib/query/hooks/useNotificationSummary'
import { queryKeys } from '@/lib/query/keys'

interface NotificationBellProps {
  locale: string
}

export function NotificationBell({ locale }: NotificationBellProps) {
  const t = useTranslations('collab.bell')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data, refetch } = useNotificationSummary()
  const queryClient = useQueryClient()

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const badge = data?.badgeCount ?? 0
  const displayBadge = badge > 99 ? '99+' : String(badge)

  async function resolveRequest(requestId: string, action: 'approve' | 'deny') {
    try {
      const res = await fetch(`/api/edit-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      // Surface a minimal failure path — don't crash the bell.
      console.error('[NotificationBell] resolveRequest failed', err)
      return
    }
    // Optimistic-ish: invalidate so polling refreshes immediately.
    await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.summary() })
    await refetch()
  }

  async function restoreProject(projectId: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/restore`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      console.error('[NotificationBell] restoreProject failed', err)
      return
    }
    await queryClient.invalidateQueries({ queryKey: queryKeys.notifications.summary() })
    await refetch()
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center rounded-sm border border-transparent p-1.5 transition-colors hover:border-amber-900/30 hover:bg-stone-900/40"
        title={badge > 0 ? t('titleWithCount', { count: badge }) : t('title')}
        aria-label={badge > 0 ? t('labelWithCount', { count: badge }) : t('labelDefault')}
      >
        <AppIcon name="bell" className="h-4 w-4 text-stone-400 group-hover:text-amber-300" />
        {badge > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[9px] font-bold text-stone-950">
            {displayBadge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-40 mt-2 w-96 overflow-hidden rounded-sm border border-amber-900/30 bg-stone-950 shadow-2xl">
          <div className="border-b border-amber-900/20 px-4 py-2 font-mono text-[14px] uppercase tracking-[0.2em] text-amber-600">
            {t('title')}
          </div>
          <div className="max-h-[28rem] overflow-y-auto">
            {/* Section 1 — incoming requests */}
            {data && data.incomingRequests.length > 0 ? (
              <div className="border-b border-amber-900/20">
                <div className="px-4 pb-1 pt-3 font-fraunces text-xs italic text-amber-500/80">
                  {t('sectionIncoming', { count: data.incomingRequests.length })}
                </div>
                {data.incomingRequests.map((r) => (
                  <div key={r.id} className="px-4 py-2">
                    <div className="font-serif-cn text-sm text-stone-200">
                      {t('incomingDescription', {
                        name: r.requester.displayName || r.requester.name || t('anonymousActor'),
                        project: r.project.name || t('untitledProject'),
                      })}
                    </div>
                    {r.message ? (
                      <div className="mt-1 font-fraunces text-[11px] italic text-stone-500">
                        {t('messagePrefix')} {r.message}
                      </div>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => resolveRequest(r.id, 'approve')}
                        className="rounded-sm border border-emerald-600/50 bg-emerald-600/10 px-2 py-0.5 font-mono text-[11px] text-emerald-300 transition-colors hover:bg-emerald-600/20"
                      >
                        {t('actionApprove')}
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveRequest(r.id, 'deny')}
                        className="rounded-sm border border-stone-700 bg-stone-900 px-2 py-0.5 font-mono text-[11px] text-stone-400 transition-colors hover:border-rose-500/50 hover:text-rose-300"
                      >
                        {t('actionDeny')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Section 2 — my requests */}
            {data && data.myRequests.length > 0 ? (
              <div className="border-b border-amber-900/20">
                <div className="px-4 pb-1 pt-3 font-fraunces text-xs italic text-amber-500/80">
                  {t('sectionMyRequests')}
                </div>
                {data.myRequests.map((r) => (
                  <div key={r.id} className="px-4 py-2">
                    <div className="font-serif-cn text-sm text-stone-300">
                      《{r.project.name || t('untitledProject')}》— {myRequestStatusLabel(r.status, t)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Section 3 — admin deletions on my projects */}
            {data && data.adminDeletions.length > 0 ? (
              <div>
                <div className="px-4 pb-1 pt-3 font-fraunces text-xs italic text-rose-400/80">
                  {t('sectionAdminDeletions')}
                </div>
                {data.adminDeletions.map((d) => (
                  <div key={d.projectId} className="px-4 py-2">
                    <div className="font-serif-cn text-sm text-stone-300">
                      《{d.projectName || t('untitledProject')}》
                    </div>
                    <div className="mt-1 font-fraunces text-[11px] italic text-stone-500">
                      {restoreCountdownLabel(d.deletedAt, t)}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => restoreProject(d.projectId)}
                        className="rounded-sm border border-amber-600/50 bg-amber-600/10 px-2 py-0.5 font-mono text-[11px] text-amber-300 transition-colors hover:bg-amber-600/20"
                      >
                        {t('actionRestore')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Empty state */}
            {data &&
            data.incomingRequests.length === 0 &&
            data.myRequests.length === 0 &&
            data.adminDeletions.length === 0 ? (
              <div className="px-4 py-6 text-center font-fraunces text-xs italic text-stone-500">
                {t('empty')}
              </div>
            ) : null}
          </div>

          <div className="border-t border-amber-900/20 px-4 py-2">
            <Link
              href={`/${locale}/v2`}
              className="block font-mono text-[11px] tracking-wider text-amber-500/70 hover:text-amber-300"
              onClick={() => setOpen(false)}
            >
              {t('viewAll')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// Helpers take the bell namespace's translator so they don't need their
// own `useTranslations` call (can't call hooks inside non-component fn).
type BellT = ReturnType<typeof useTranslations>

function myRequestStatusLabel(
  status: 'pending' | 'approved' | 'denied' | 'expired',
  t: BellT,
): string {
  if (status === 'approved') return t('statusApproved')
  if (status === 'denied') return t('statusDenied')
  if (status === 'expired') return t('statusExpired')
  return t('statusPending')
}

function restoreCountdownLabel(deletedAt: string | null, t: BellT): string {
  if (!deletedAt) return ''
  const deletedTime = new Date(deletedAt).getTime()
  const expiresAt = deletedTime + 30 * 24 * 60 * 60 * 1000
  const daysLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
  if (daysLeft <= 0) return t('deletedExpired')
  return t('deletedDaysLeft', { days: daysLeft })
}
