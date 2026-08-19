'use client'

/**
 * Phase 12.5 — project activity log modal.
 *
 * Reads /api/projects/[id]/audit with cursor pagination.
 * Any read access can open this — transparency by design.
 *
 * Renders newest-first. Each row shows actor, action (Chinese label),
 * entity, and a relative timestamp. Snapshot details collapsible to
 * avoid wall-of-JSON.
 */

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Modal } from '@/components/v2/Modal'

interface NamedUser {
  id: string
  name: string | null
  displayName: string | null
}

interface NamedWorkspace {
  id: string
  name: string | null
}

interface AuditEntry {
  id: string
  action: string
  entityType: string
  entityId: string
  snapshot: unknown
  createdAt: string
  actor: NamedUser | null
  targets?: {
    user: NamedUser | null
    previousWorkspace: NamedWorkspace | null
    newWorkspace: NamedWorkspace | null
    workspace: NamedWorkspace | null
    requester: NamedUser | null
  }
}

interface AuditResponse {
  entries: AuditEntry[]
  nextCursor: string | null
  hasMore: boolean
}

interface ProjectAuditLogModalProps {
  projectId: string
  onClose: () => void
}

export function ProjectAuditLogModal({ projectId, onClose }: ProjectAuditLogModalProps) {
  const t = useTranslations('collab.auditModal')
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function fetchPage(opts: { reset?: boolean; cursor?: string | null }) {
    setLoading(true)
    setError(null)
    try {
      const url = new URL(`/api/projects/${projectId}/audit`, window.location.origin)
      if (opts.cursor) url.searchParams.set('cursor', opts.cursor)
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body: AuditResponse = await res.json()
      setEntries((prev) => (opts.reset ? body.entries : [...prev, ...body.entries]))
      setCursor(body.nextCursor)
      setHasMore(body.hasMore)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPage({ reset: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      className="flex max-h-[min(80vh,720px)] flex-col overflow-hidden"
    >
      <Modal.Header
        heading={t('title')}
        onClose={onClose}
        closeAriaLabel={t('closeAria')}
      />

      <Modal.Body className="flex-1 overflow-y-auto px-4 py-3 sm:px-6">
          {error ? (
            <div className="rounded-[10px] border border-rose-500/35 bg-rose-500/10 px-3 py-2 font-fraunces text-sm text-rose-200" role="alert">
              {error}
            </div>
          ) : null}

          {entries.length === 0 && !loading ? (
            <div className="py-12 text-center font-fraunces text-sm italic text-[var(--production-ink-muted)]">
              {t('empty')}
            </div>
          ) : (
            <ul className="divide-y divide-[var(--production-border)]">
              {entries.map((entry) => (
                <li key={entry.id} className="py-3">
                  <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-baseline sm:gap-3">
                    <span className="shrink-0 font-mono text-[11px] tracking-wider text-[var(--production-ink-muted)] sm:w-36">
                      {formatTs(entry.createdAt)}
                    </span>
                    <span className="shrink-0 font-serif-cn text-xs text-[var(--process-cyan-strong)] sm:w-28">
                      @{entry.actor?.displayName || entry.actor?.name || t('actorUnknown')}
                    </span>
                    <span className="font-serif-cn text-sm leading-6 text-[var(--production-ink)]">
                      {friendlyDescription(entry, t)}
                    </span>
                    {entry.snapshot && Object.keys(entry.snapshot as object).length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
                        className="min-h-11 rounded-[9px] px-2 font-mono text-[11px] text-[var(--production-ink-muted)] transition-colors hover:bg-[var(--process-cyan-soft)] hover:text-[var(--process-cyan-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] sm:ml-auto"
                        aria-expanded={expandedId === entry.id}
                      >
                        {expandedId === entry.id ? t('rawToggleHide') : t('rawToggleShow')}
                      </button>
                    ) : null}
                  </div>
                  {expandedId === entry.id && entry.snapshot ? (
                    <pre className="mt-2 max-h-40 overflow-auto rounded-[10px] border border-[var(--production-border)] bg-[var(--production-muted)] p-3 font-mono text-[11px] text-[var(--production-ink-muted)] sm:ml-36">
                      {JSON.stringify(entry.snapshot, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
      </Modal.Body>

      <Modal.Footer className="justify-between px-4 sm:px-6">
          <span className="font-mono text-[11px] text-[var(--production-ink-muted)]">
            {entries.length} {t('countSuffix')}{hasMore ? '+' : ''}
          </span>
          {hasMore ? (
            <button
              type="button"
              onClick={() => fetchPage({ cursor })}
              disabled={loading}
              className="min-h-11 rounded-[10px] bg-[var(--production-blue)] px-4 py-2 font-mono text-[11px] font-semibold text-white transition-colors hover:bg-[var(--production-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] disabled:opacity-50"
            >
              {loading ? t('loading') : t('loadMore')}
            </button>
          ) : (
            <span className="font-fraunces text-[11px] italic text-[var(--production-ink-muted)]">{t('atBottom')}</span>
          )}
      </Modal.Footer>
    </Modal>
  )
}

function formatTs(iso: string): string {
  const d = new Date(iso)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

type AuditT = ReturnType<typeof useTranslations>

/**
 * Turn an audit entry into one sentence the user can read at a glance.
 * Falls back to action verb + truncated id when targets are missing
 * (entity deleted since the audit was written).
 *
 * Examples (zh):
 *   "把專案移到 Team A"
 *   "邀請 @userA 為 editor"
 * Examples (en):
 *   "Moved project from Personal to Team A"
 *   "Invited @userA as editor"
 */
function friendlyDescription(entry: AuditEntry, t: AuditT): string {
  const snap = (entry.snapshot ?? {}) as Record<string, unknown>
  const targets = entry.targets

  const userLabel = (u: { name: string | null; displayName: string | null } | null | undefined): string => {
    if (!u) return t('unknownUser')
    return `@${u.displayName || u.name || t('actorUnknown')}`
  }
  const wsLabel = (w: { name: string | null } | null | undefined, idHint?: string | null): string => {
    if (w?.name) return w.name
    if (idHint) return `${t('workspacePrefix')}${idHint.slice(0, 8)}`
    return t('workspaceFallback')
  }
  const roleLabel = (r: unknown): string => {
    if (r === 'editor') return 'editor'
    if (r === 'viewer') return 'viewer'
    return String(r ?? '?')
  }

  switch (entry.action) {
    case 'project.update': {
      // workspaceId move is the only project.update we audit (today).
      if (snap.field === 'workspaceId') {
        const newWs = targets?.newWorkspace
        const prevWs = targets?.previousWorkspace
        if (!snap.newWorkspaceId && snap.previousWorkspaceId) {
          return t('actions.projectMoveToPersonal', {
            from: wsLabel(prevWs, snap.previousWorkspaceId as string),
          })
        }
        if (snap.newWorkspaceId && !snap.previousWorkspaceId) {
          return t('actions.projectMoveFromPersonal', {
            to: wsLabel(newWs, snap.newWorkspaceId as string),
          })
        }
        if (snap.newWorkspaceId && snap.previousWorkspaceId) {
          return t('actions.projectMoveBetween', {
            from: wsLabel(prevWs, snap.previousWorkspaceId as string),
            to: wsLabel(newWs, snap.newWorkspaceId as string),
          })
        }
      }
      return t('actions.projectUpdateUnknownChange')
    }
    case 'project.soft_delete':
      return snap.phase === 'hard_delete'
        ? t('actions.projectHardDelete')
        : t('actions.projectSoftDelete')
    case 'project.restore':
      return t('actions.projectRestore')
    case 'collaborator.add':
      return t('actions.collaboratorAdd', {
        user: userLabel(targets?.user),
        role: roleLabel(snap.newRole) || 'collaborator',
      })
    case 'collaborator.role_change':
      return t('actions.collaboratorRoleChange', {
        user: userLabel(targets?.user),
        prev: roleLabel(snap.previousRole),
        next: roleLabel(snap.newRole),
      })
    case 'collaborator.remove':
      return t('actions.collaboratorRemove', { user: userLabel(targets?.user) })
    case 'edit_request.create':
      return t('actions.editRequestCreate', { user: userLabel(targets?.requester) })
    case 'edit_request.approve':
      return t('actions.editRequestApprove', { user: userLabel(targets?.requester) })
    case 'edit_request.deny':
      return t('actions.editRequestDeny', { user: userLabel(targets?.requester) })
    case 'edit_request.withdraw':
      return t('actions.editRequestWithdraw', { user: userLabel(targets?.requester) })
    case 'workspace_member.add':
      return t('actions.workspaceMemberAdd', {
        user: userLabel(targets?.user),
        workspace: wsLabel(targets?.workspace, snap.workspaceId as string | null),
      })
    case 'workspace_member.remove':
      return t('actions.workspaceMemberRemove', {
        user: userLabel(targets?.user),
        workspace: wsLabel(targets?.workspace, snap.workspaceId as string | null),
      })
    case 'workspace_member.role_change':
      return t('actions.workspaceMemberRoleChange', {
        user: userLabel(targets?.user),
        workspace: wsLabel(targets?.workspace, snap.workspaceId as string | null),
        prev: roleLabel(snap.previousRole),
        next: roleLabel(snap.newRole),
      })
    default:
      return entry.action
  }
}
