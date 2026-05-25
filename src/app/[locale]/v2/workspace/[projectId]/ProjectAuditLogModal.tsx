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
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPage({ reset: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-sm border border-amber-900/30 bg-stone-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-amber-900/20 px-6 py-3">
          <h3 className="font-serif-cn text-lg text-stone-100">活動記錄</h3>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-sm text-stone-500 transition-colors hover:text-stone-300"
            aria-label="關閉"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          {error ? (
            <div className="rounded-sm border border-rose-600/40 bg-rose-600/10 px-3 py-2 font-fraunces text-sm text-rose-300">
              {error}
            </div>
          ) : null}

          {entries.length === 0 && !loading ? (
            <div className="py-12 text-center font-fraunces text-sm italic text-stone-500">
              沒有活動記錄
            </div>
          ) : (
            <ul className="divide-y divide-stone-800/60">
              {entries.map((entry) => (
                <li key={entry.id} className="py-2">
                  <div className="flex items-baseline gap-3">
                    <span className="w-36 shrink-0 font-mono text-[11px] tracking-wider text-stone-500">
                      {formatTs(entry.createdAt)}
                    </span>
                    <span className="w-28 shrink-0 font-serif-cn text-xs text-amber-400">
                      @{entry.actor?.displayName || entry.actor?.name || '未知'}
                    </span>
                    <span className="font-serif-cn text-sm text-stone-200">
                      {friendlyDescription(entry)}
                    </span>
                    {entry.snapshot && Object.keys(entry.snapshot as object).length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
                        className="ml-auto font-mono text-[11px] text-stone-500 hover:text-amber-300"
                      >
                        {expandedId === entry.id ? '收起 raw' : 'raw'}
                      </button>
                    ) : null}
                  </div>
                  {expandedId === entry.id && entry.snapshot ? (
                    <pre className="mt-2 ml-36 max-h-40 overflow-auto rounded-sm border border-stone-800 bg-stone-900/60 p-2 font-mono text-[10px] text-stone-400">
                      {JSON.stringify(entry.snapshot, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-amber-900/20 px-6 py-2">
          <span className="font-mono text-[11px] text-stone-500">
            {entries.length} 筆{hasMore ? '+' : ''}
          </span>
          {hasMore ? (
            <button
              type="button"
              onClick={() => fetchPage({ cursor })}
              disabled={loading}
              className="rounded-sm border border-amber-500/40 bg-amber-500/5 px-3 py-1 font-mono text-[11px] text-amber-300 transition-colors hover:bg-amber-500/15 disabled:opacity-50"
            >
              {loading ? '載入中…' : '載入更多'}
            </button>
          ) : (
            <span className="font-fraunces text-[11px] italic text-stone-600">已到底</span>
          )}
        </div>
      </div>
    </div>
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

/**
 * Turn an audit entry into one Chinese sentence the user can read at a
 * glance. Falls back to action verb + truncated id when targets are
 * missing (entity deleted since the audit was written).
 *
 * Examples:
 *   "把專案移到 Team A"
 *   "把專案移回個人專案"
 *   "邀請 @userA 為 editor"
 *   "把 @userB 從 viewer 改成 editor"
 *   "刪除專案"
 *   "批准 @userC 的編輯請求"
 */
function friendlyDescription(entry: AuditEntry): string {
  const snap = (entry.snapshot ?? {}) as Record<string, unknown>
  const t = entry.targets

  const userLabel = (u: { name: string | null; displayName: string | null } | null | undefined): string => {
    if (!u) return '某人'
    return `@${u.displayName || u.name || '未知'}`
  }
  const wsLabel = (w: { name: string | null } | null | undefined, idHint?: string | null): string => {
    if (w?.name) return w.name
    if (idHint) return `工作區#${idHint.slice(0, 8)}`
    return '工作區'
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
        const newWs = t?.newWorkspace
        const prevWs = t?.previousWorkspace
        if (!snap.newWorkspaceId && snap.previousWorkspaceId) {
          return `把專案從 ${wsLabel(prevWs, snap.previousWorkspaceId as string)} 移回個人專案`
        }
        if (snap.newWorkspaceId && !snap.previousWorkspaceId) {
          return `把專案從個人專案移到 ${wsLabel(newWs, snap.newWorkspaceId as string)}`
        }
        if (snap.newWorkspaceId && snap.previousWorkspaceId) {
          return `把專案從 ${wsLabel(prevWs, snap.previousWorkspaceId as string)} 移到 ${wsLabel(newWs, snap.newWorkspaceId as string)}`
        }
      }
      return '更新專案'
    }
    case 'project.soft_delete':
      return snap.phase === 'hard_delete' ? '永久刪除專案（30 天寬限期到）' : '刪除專案'
    case 'project.restore':
      return '恢復已刪除的專案'
    case 'collaborator.add':
      return `邀請 ${userLabel(t?.user)} 為 ${roleLabel(snap.newRole) || 'collaborator'}`
    case 'collaborator.role_change':
      return `把 ${userLabel(t?.user)} 從 ${roleLabel(snap.previousRole)} 改成 ${roleLabel(snap.newRole)}`
    case 'collaborator.remove':
      return `移除 ${userLabel(t?.user)} 的協作權限`
    case 'edit_request.create':
      return `${userLabel(t?.requester)} 請求編輯權限`
    case 'edit_request.approve':
      return `批准 ${userLabel(t?.requester)} 的編輯請求`
    case 'edit_request.deny':
      return `拒絕 ${userLabel(t?.requester)} 的編輯請求`
    case 'edit_request.withdraw':
      return `${userLabel(t?.requester)} 撤回了編輯請求`
    case 'workspace_member.add':
      return `把 ${userLabel(t?.user)} 加進 ${wsLabel(t?.workspace, snap.workspaceId as string | null)}`
    case 'workspace_member.remove':
      return `把 ${userLabel(t?.user)} 從 ${wsLabel(t?.workspace, snap.workspaceId as string | null)} 移除`
    case 'workspace_member.role_change':
      return `把 ${userLabel(t?.user)} 在 ${wsLabel(t?.workspace, snap.workspaceId as string | null)} 的角色從 ${roleLabel(snap.previousRole)} 改成 ${roleLabel(snap.newRole)}`
    default:
      return entry.action
  }
}
