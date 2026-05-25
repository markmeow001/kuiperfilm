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

interface AuditEntry {
  id: string
  action: string
  entityType: string
  entityId: string
  snapshot: unknown
  createdAt: string
  actor: {
    id: string
    name: string | null
    displayName: string | null
  } | null
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
                      {actionLabel(entry.action)}
                    </span>
                    <span className="font-mono text-[11px] tracking-wider text-stone-600">
                      {entry.entityType}#{entry.entityId.slice(0, 8)}
                    </span>
                    {entry.snapshot && Object.keys(entry.snapshot as object).length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId((id) => (id === entry.id ? null : entry.id))}
                        className="ml-auto font-mono text-[11px] text-stone-500 hover:text-amber-300"
                      >
                        {expandedId === entry.id ? '收起' : '詳情'}
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

function actionLabel(action: string): string {
  switch (action) {
    case 'project.soft_delete': return '刪除專案'
    case 'project.restore': return '恢復專案'
    case 'project.update': return '更新專案'
    case 'collaborator.add': return '新增協作者'
    case 'collaborator.remove': return '移除協作者'
    case 'collaborator.role_change': return '變更協作者角色'
    case 'edit_request.create': return '請求編輯權限'
    case 'edit_request.approve': return '批准請求'
    case 'edit_request.deny': return '拒絕請求'
    case 'edit_request.withdraw': return '撤回請求'
    case 'workspace_member.add': return '加入工作區成員'
    case 'workspace_member.remove': return '移除工作區成員'
    case 'workspace_member.role_change': return '變更工作區角色'
    default: return action
  }
}
