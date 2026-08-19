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

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useNotificationSummary } from '@/lib/query/hooks/useNotificationSummary'
import { queryKeys } from '@/lib/query/keys'

interface NotificationBellProps {
  locale: string
  surface?: 'dark' | 'light'
}

type NotificationMutation =
  | { kind: 'request'; requestId: string; action: 'approve' | 'deny' }
  | { kind: 'restore'; projectId: string }

export function NotificationBell({ locale, surface = 'dark' }: NotificationBellProps) {
  const t = useTranslations('collab.bell')
  const [open, setOpen] = useState(false)
  const [pendingMutation, setPendingMutation] = useState<NotificationMutation | null>(null)
  const [failedMutation, setFailedMutation] = useState<NotificationMutation | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const mutationInFlightRef = useRef(false)
  const panelId = useId()
  const { data, isError, isFetching, isPending, refetch } = useNotificationSummary()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!open) return
    function closeAndRestoreFocus(deferFocus = false) {
      setOpen(false)
      if (deferFocus) {
        window.setTimeout(() => triggerRef.current?.focus(), 0)
        return
      }
      triggerRef.current?.focus()
    }
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        closeAndRestoreFocus(true)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeAndRestoreFocus()
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const badge = data?.badgeCount ?? 0
  const displayBadge = badge > 99 ? '99+' : String(badge)
  const light = surface === 'light'
  const dividerClass = light
    ? 'border-[var(--production-border)]'
    : 'border-[var(--darkroom-border)]'
  const panelClass = light
    ? 'border-[var(--production-border)] bg-[var(--production-surface)] text-[var(--production-ink)] shadow-[0_18px_48px_rgba(31,35,31,0.16)]'
    : 'border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] text-[var(--darkroom-text)] shadow-2xl'
  const bodyTextClass = light
    ? 'text-[var(--production-ink)]'
    : 'text-[var(--darkroom-text)]'
  const mutedTextClass = light
    ? 'text-[var(--production-ink-muted)]'
    : 'text-[var(--darkroom-muted)]'
  const accentTextClass = 'text-[var(--process-cyan-strong)]'
  const processActionTextClass = light
    ? 'text-[var(--process-cyan-deep)]'
    : 'text-[var(--process-cyan-strong)]'

  async function runMutation(mutation: NotificationMutation) {
    if (mutationInFlightRef.current) return
    mutationInFlightRef.current = true
    setPendingMutation(mutation)
    setFailedMutation(null)

    try {
      const res = mutation.kind === 'request'
        ? await fetch(`/api/edit-requests/${mutation.requestId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: mutation.action }),
          })
        : await fetch(`/api/projects/${mutation.projectId}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      await queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.summary(),
      })
    } catch {
      setFailedMutation(mutation)
      return
    } finally {
      mutationInFlightRef.current = false
      setPendingMutation(null)
    }
  }

  function resolveRequest(requestId: string, action: 'approve' | 'deny') {
    void runMutation({ kind: 'request', requestId, action })
  }

  function restoreProject(projectId: string) {
    void runMutation({ kind: 'restore', projectId })
  }

  const hasNotifications = Boolean(
    data
    && (
      data.incomingRequests.length > 0
      || data.myRequests.length > 0
      || data.adminDeletions.length > 0
    ),
  )

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        className={`group relative flex h-11 w-11 items-center justify-center rounded-xl border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--process-cyan)] ${
          surface === 'light'
            ? 'border-[var(--production-border)] bg-white hover:border-[var(--production-border-dark)] hover:bg-[var(--production-muted)]'
            : 'border-[var(--darkroom-border)] bg-white/[0.04] hover:border-[var(--process-cyan)]/50 hover:bg-white/[0.07]'
        }`}
        title={badge > 0 ? t('titleWithCount', { count: badge }) : t('title')}
        aria-label={badge > 0 ? t('labelWithCount', { count: badge }) : t('labelDefault')}
      >
        <AppIcon
          name="bell"
          className={`h-4 w-4 ${
            surface === 'light'
              ? 'text-[var(--production-ink-muted)] group-hover:text-[var(--process-cyan-strong)]'
              : 'text-[var(--darkroom-muted)] group-hover:text-[var(--process-cyan-strong)]'
          }`}
        />
        {badge > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--process-cyan)] px-1 font-mono text-[9px] font-bold text-[#071014]">
            {displayBadge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t('title')}
          className={`absolute right-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border ${panelClass}`}
        >
          <div className={`border-b px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${dividerClass} ${accentTextClass}`}>
            {t('title')}
          </div>
          <div className="max-h-[28rem] overflow-y-auto">
            {isPending && !data ? (
              <div
                role="status"
                className={`px-4 py-8 text-center text-sm ${mutedTextClass}`}
              >
                {t('loading')}
              </div>
            ) : null}

            {isError ? (
              <div
                role="alert"
                className={`border-b px-4 py-4 ${dividerClass}`}
              >
                <div className={`text-sm font-semibold ${bodyTextClass}`}>
                  {t('loadErrorTitle')}
                </div>
                <div className={`mt-1 text-xs leading-5 ${mutedTextClass}`}>
                  {t('loadErrorBody')}
                </div>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                  aria-busy={isFetching}
                  className={`mt-3 min-h-11 rounded-xl border border-[var(--process-cyan)]/45 bg-[var(--process-cyan-soft)] px-3 py-2 text-xs font-semibold transition-colors enabled:hover:border-[var(--process-cyan)] disabled:cursor-wait disabled:opacity-55 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--process-cyan)] ${processActionTextClass}`}
                >
                  {isFetching ? t('reloading') : t('retry')}
                </button>
              </div>
            ) : null}

            {failedMutation ? (
              <div
                role="alert"
                className={`border-b border-rose-500/30 bg-rose-500/[0.06] px-4 py-4 ${bodyTextClass}`}
              >
                <div className="text-sm font-semibold text-rose-300">
                  {failedMutation.kind === 'request'
                    ? t('mutationErrorRequest')
                    : t('mutationErrorRestore')}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void runMutation(failedMutation)}
                    disabled={pendingMutation !== null}
                    className={`min-h-11 rounded-xl border border-[var(--process-cyan)]/45 bg-[var(--process-cyan-soft)] px-3 py-2 text-xs font-semibold transition-colors enabled:hover:border-[var(--process-cyan)] disabled:cursor-wait disabled:opacity-55 ${processActionTextClass}`}
                  >
                    {t('retryAction')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFailedMutation(null)}
                    disabled={pendingMutation !== null}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-55 ${dividerClass} ${mutedTextClass}`}
                  >
                    {t('dismissError')}
                  </button>
                </div>
              </div>
            ) : null}

            {/* Section 1 — incoming requests */}
            {data && data.incomingRequests.length > 0 ? (
              <div className={`border-b ${dividerClass}`}>
                <div className={`px-4 pb-1 pt-3 text-xs font-semibold ${accentTextClass}`}>
                  {t('sectionIncoming', { count: data.incomingRequests.length })}
                </div>
                {data.incomingRequests.map((r) => (
                  <div key={r.id} className="px-4 py-2">
                    <Link
                      href={`/${locale}/v2/workspace/${encodeURIComponent(r.projectId)}`}
                      aria-label={t('openProject', {
                        project: r.project.name || t('untitledProject'),
                      })}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-11 items-center rounded-lg text-sm transition-colors hover:text-[var(--process-cyan-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--process-cyan)] ${bodyTextClass}`}
                    >
                      {t('incomingDescription', {
                        name: r.requester.displayName || r.requester.name || t('anonymousActor'),
                        project: r.project.name || t('untitledProject'),
                      })}
                    </Link>
                    {r.message ? (
                      <div className={`mt-1 text-[11px] ${mutedTextClass}`}>
                        {t('messagePrefix')} {r.message}
                      </div>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      {(() => {
                        const approving = pendingMutation?.kind === 'request'
                          && pendingMutation.requestId === r.id
                          && pendingMutation.action === 'approve'
                        const denying = pendingMutation?.kind === 'request'
                          && pendingMutation.requestId === r.id
                          && pendingMutation.action === 'deny'
                        return (
                          <>
                      <button
                        type="button"
                        onClick={() => resolveRequest(r.id, 'approve')}
                        disabled={pendingMutation !== null}
                        aria-busy={approving}
                        className={`min-h-11 rounded-xl border border-[var(--process-cyan)]/45 bg-[var(--process-cyan-soft)] px-3 py-2 text-[12px] font-semibold transition-colors enabled:hover:border-[var(--process-cyan)] disabled:cursor-wait disabled:opacity-55 ${processActionTextClass}`}
                      >
                        {approving ? t('actionApproving') : t('actionApprove')}
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveRequest(r.id, 'deny')}
                        disabled={pendingMutation !== null}
                        aria-busy={denying}
                        className={`min-h-11 rounded-xl border px-3 py-2 text-[12px] font-semibold transition-colors enabled:hover:border-rose-500/50 enabled:hover:text-rose-400 disabled:cursor-wait disabled:opacity-55 ${dividerClass} ${mutedTextClass}`}
                      >
                        {denying ? t('actionDenying') : t('actionDeny')}
                      </button>
                          </>
                        )
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Section 2 — my requests */}
            {data && data.myRequests.length > 0 ? (
              <div className={`border-b ${dividerClass}`}>
                <div className={`px-4 pb-1 pt-3 text-xs font-semibold ${accentTextClass}`}>
                  {t('sectionMyRequests')}
                </div>
                {data.myRequests.map((r) => (
                  <div key={r.id} className="px-4 py-2">
                    <Link
                      href={`/${locale}/v2/workspace/${encodeURIComponent(r.projectId)}`}
                      aria-label={t('openProject', {
                        project: r.project.name || t('untitledProject'),
                      })}
                      onClick={() => setOpen(false)}
                      className={`flex min-h-11 items-center rounded-lg text-sm transition-colors hover:text-[var(--process-cyan-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--process-cyan)] ${bodyTextClass}`}
                    >
                      《{r.project.name || t('untitledProject')}》— {myRequestStatusLabel(r.status, t)}
                    </Link>
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
                    <div className={`text-sm ${bodyTextClass}`}>
                      《{d.projectName || t('untitledProject')}》
                    </div>
                    <div className={`mt-1 text-[11px] ${mutedTextClass}`}>
                      {restoreCountdownLabel(d.deletedAt, t)}
                    </div>
                    <div className={`mt-1 text-[11px] ${mutedTextClass}`}>
                      {t('deletedProjectUnavailable')}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => restoreProject(d.projectId)}
                        disabled={pendingMutation !== null}
                        aria-busy={
                          pendingMutation?.kind === 'restore'
                          && pendingMutation.projectId === d.projectId
                        }
                        className={`min-h-11 rounded-xl border border-[var(--process-cyan)]/45 bg-[var(--process-cyan-soft)] px-3 py-2 text-[12px] font-semibold transition-colors enabled:hover:border-[var(--process-cyan)] disabled:cursor-wait disabled:opacity-55 ${processActionTextClass}`}
                      >
                        {pendingMutation?.kind === 'restore'
                        && pendingMutation.projectId === d.projectId
                          ? t('actionRestoring')
                          : t('actionRestore')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Empty state */}
            {data && !isPending && !isError && !hasNotifications ? (
              <div className={`px-4 py-6 text-center text-xs ${mutedTextClass}`}>
                {t('empty')}
              </div>
            ) : null}
          </div>

          <div className={`border-t px-4 py-2 ${dividerClass}`}>
            <Link
              href={`/${locale}/v2`}
              className={`flex min-h-11 items-center rounded-lg py-2 text-[12px] font-semibold tracking-wide focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--process-cyan)] ${accentTextClass}`}
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
