'use client'

/**
 * Phase 12.5 (2026-05-22) — ProjectCollaboratorsModal
 *
 * Owner / admin UI for managing per-project explicit role grants.
 * Overrides the workspace-default role on a per-user, per-project
 * basis (Figma "share with specific people" model).
 *
 * Layout:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ 協作者                              [✕]    │
 *   ├─────────────────────────────────────────────┤
 *   │ 此專案在 ABC 工作區                          │
 *   │ 工作區成員預設 Viewer 角色                  │
 *   │                                             │
 *   │ ━━━ 個別 grant ━━━                          │
 *   │ @userA  [Editor ▾]    [移除]                │
 *   │ @userB  [Viewer ▾]    [移除]                │
 *   │                                             │
 *   │ [+ 邀請成員 ▾]                              │
 *   │   (從 workspace member 列表選)              │
 *   └─────────────────────────────────────────────┘
 *
 * Data flow:
 *   - GET /api/projects/:id/collaborators       → load existing list
 *   - GET /api/workspaces/:wsId/members         → load potential invitees
 *   - POST /api/projects/:id/collaborators      → add / update role
 *   - DELETE /api/projects/:id/collaborators/:userId → revoke
 *
 * Only visible to owner / admin (callers should gate the trigger button).
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppIcon } from '@/components/ui/icons'

type CollabRole = 'editor' | 'viewer'

interface UserShape {
  id: string
  name: string | null
  displayName: string | null
  email: string | null
  role: string | null
}

interface CollaboratorRow {
  userId: string
  role: CollabRole
  grantedAt: string
  user: UserShape
  granter: UserShape
}

interface WorkspaceMemberRow {
  userId: string
  userName: string
  displayName: string | null
  role: string
}

interface ProjectCollaboratorsModalProps {
  projectId: string
  workspaceId: string | null
  workspaceName?: string | null
  onClose: () => void
}

const COLLAB_QUERY_KEY = (projectId: string) => ['project', projectId, 'collaborators'] as const
const WS_MEMBERS_QUERY_KEY = (wsId: string) => ['workspace', wsId, 'members'] as const

export function ProjectCollaboratorsModal({
  projectId,
  workspaceId,
  workspaceName,
  onClose,
}: ProjectCollaboratorsModalProps) {
  const queryClient = useQueryClient()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerFilter, setPickerFilter] = useState('')
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // ESC to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Load current collaborators
  const collabQuery = useQuery({
    queryKey: COLLAB_QUERY_KEY(projectId),
    queryFn: async (): Promise<{ collaborators: CollaboratorRow[] }> => {
      const res = await fetch(`/api/projects/${projectId}/collaborators`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
  })

  // Load workspace members (for the invite picker). When workspaceId
  // is null the project isn't bound to a workspace, so there's no
  // pool to pick from.
  const membersQuery = useQuery({
    queryKey: workspaceId ? WS_MEMBERS_QUERY_KEY(workspaceId) : ['workspace', 'none', 'members'],
    queryFn: async (): Promise<{ members: WorkspaceMemberRow[] }> => {
      if (!workspaceId) return { members: [] }
      const res = await fetch(`/api/workspaces/${workspaceId}/members`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    enabled: !!workspaceId,
  })

  const collaborators = collabQuery.data?.collaborators ?? []
  const wsMembers = membersQuery.data?.members ?? []
  const existingCollabIds = new Set(collaborators.map((c) => c.userId))

  // Members not yet added as project collaborators
  const addableMembers = useMemo(() => {
    const filter = pickerFilter.trim().toLowerCase()
    return wsMembers
      .filter((m) => !existingCollabIds.has(m.userId))
      .filter((m) => {
        if (!filter) return true
        const hay = `${m.userName} ${m.displayName ?? ''}`.toLowerCase()
        return hay.includes(filter)
      })
  }, [wsMembers, existingCollabIds, pickerFilter])

  // Add / update role mutation
  const upsertMutation = useMutation({
    mutationFn: async (params: { userId: string; role: CollabRole }) => {
      const res = await fetch(`/api/projects/${projectId}/collaborators`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error?.details?.reason || j?.error?.code || `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COLLAB_QUERY_KEY(projectId) })
      // Invalidate access endpoint too — if the inviting affects current
      // user's role (unlikely but safe), they should re-fetch.
      void queryClient.invalidateQueries({ queryKey: ['project', projectId, 'access'] })
      setErrMsg(null)
      setPickerOpen(false)
      setPickerFilter('')
    },
    onError: (err) => {
      setErrMsg(err instanceof Error ? err.message : 'failed')
    },
  })

  // Revoke mutation
  const revokeMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/projects/${projectId}/collaborators/${userId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error?.details?.reason || j?.error?.code || `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COLLAB_QUERY_KEY(projectId) })
      void queryClient.invalidateQueries({ queryKey: ['project', projectId, 'access'] })
      setErrMsg(null)
    },
    onError: (err) => {
      setErrMsg(err instanceof Error ? err.message : 'failed')
    },
  })

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg rounded-sm border border-amber-900/30 bg-stone-950 shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-amber-900/20 px-5 py-4">
          <div>
            <h2 className="font-fraunces text-lg italic text-amber-300">協作者</h2>
            <p className="mt-1 font-mono text-[12px] tracking-wider text-stone-500">
              {workspaceName
                ? `此專案在 ${workspaceName} 工作區 · 工作區成員預設 Viewer`
                : '此專案未歸屬任何工作區 — 只有擁有者 / admin 能編輯'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-stone-700 px-2 py-1 font-mono text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {collabQuery.isLoading ? (
            <div className="font-mono text-xs text-stone-500">載入中…</div>
          ) : (
            <>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-600/80">
                個別 grant ({collaborators.length})
              </div>

              {collaborators.length === 0 ? (
                <p className="rounded-sm border border-stone-800/60 bg-stone-900/40 px-3 py-3 font-fraunces text-xs italic text-stone-500">
                  尚無個別協作者。下方按鈕從工作區成員選擇邀請。
                </p>
              ) : (
                <ul className="space-y-2">
                  {collaborators.map((c) => (
                    <li
                      key={c.userId}
                      className="flex items-center justify-between gap-3 rounded-sm border border-stone-800/60 bg-stone-900/40 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-serif-cn text-sm text-stone-200">
                          @{c.user.name ?? '(未命名)'}
                          {c.user.displayName ? (
                            <span className="ml-2 font-mono text-[11px] text-stone-500">
                              {c.user.displayName}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] tracking-wider text-stone-600">
                          由 @{c.granter.name ?? '?'} 邀請 · {new Date(c.grantedAt).toLocaleString('zh-TW')}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={c.role}
                          onChange={(e) =>
                            upsertMutation.mutate({
                              userId: c.userId,
                              role: e.target.value as CollabRole,
                            })
                          }
                          disabled={upsertMutation.isPending || revokeMutation.isPending}
                          className="rounded-sm border border-stone-800 bg-stone-950 px-2 py-1 font-mono text-[12px] text-stone-200 disabled:opacity-50"
                        >
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => revokeMutation.mutate(c.userId)}
                          disabled={revokeMutation.isPending || upsertMutation.isPending}
                          className="rounded-sm border border-stone-800 px-2 py-1 font-mono text-[12px] tracking-wider text-stone-400 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-50"
                        >
                          移除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {errMsg ? (
                <div className="mt-3 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-serif-cn text-xs text-rose-300">
                  {errMsg}
                </div>
              ) : null}

              {/* Add picker */}
              {workspaceId ? (
                <div className="mt-4 border-t border-stone-800/60 pt-4">
                  {!pickerOpen ? (
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      disabled={addableMembers.length === 0 && wsMembers.length > 0}
                      className="w-full rounded-sm border border-amber-500/40 bg-amber-500/5 px-3 py-2 font-mono text-[12px] tracking-wider text-amber-300 transition-all hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                      title={
                        addableMembers.length === 0 && wsMembers.length > 0
                          ? '所有工作區成員已加為協作者'
                          : '從工作區成員選擇邀請'
                      }
                    >
                      + 邀請成員
                    </button>
                  ) : (
                    <div className="rounded-sm border border-amber-500/40 bg-amber-500/5 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-amber-400">
                          選擇邀請對象
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPickerOpen(false)
                            setPickerFilter('')
                          }}
                          className="font-mono text-[11px] text-stone-500 hover:text-stone-300"
                        >
                          取消
                        </button>
                      </div>
                      <input
                        type="text"
                        value={pickerFilter}
                        onChange={(e) => setPickerFilter(e.target.value)}
                        placeholder="搜尋名稱…"
                        className="mb-2 w-full rounded-sm border border-stone-800 bg-stone-950 px-2 py-1.5 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40"
                      />
                      {membersQuery.isLoading ? (
                        <div className="font-mono text-[12px] text-stone-500">載入成員…</div>
                      ) : addableMembers.length === 0 ? (
                        <p className="font-fraunces text-xs italic text-stone-500">
                          {wsMembers.length === 0
                            ? '工作區裡沒有其他成員可以邀請'
                            : '所有成員都已加進來了'}
                        </p>
                      ) : (
                        <ul className="max-h-40 space-y-1 overflow-y-auto">
                          {addableMembers.map((m) => (
                            <li
                              key={m.userId}
                              className="flex items-center justify-between gap-2 rounded-sm bg-stone-950/50 px-2 py-1.5"
                            >
                              <div className="min-w-0 flex-1 truncate font-serif-cn text-sm text-stone-300">
                                @{m.userName}
                                {m.displayName ? (
                                  <span className="ml-2 font-mono text-[11px] text-stone-500">
                                    {m.displayName}
                                  </span>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    upsertMutation.mutate({ userId: m.userId, role: 'editor' })
                                  }
                                  disabled={upsertMutation.isPending}
                                  className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] tracking-wider text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                                >
                                  + editor
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    upsertMutation.mutate({ userId: m.userId, role: 'viewer' })
                                  }
                                  disabled={upsertMutation.isPending}
                                  className="rounded-sm border border-stone-700 px-2 py-0.5 font-mono text-[11px] tracking-wider text-stone-400 hover:border-stone-500 hover:text-stone-200 disabled:opacity-50"
                                >
                                  + viewer
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-4 border-t border-stone-800/60 pt-4 font-serif-cn text-xs italic text-stone-500">
                  此專案未歸屬工作區 — 沒有可邀請的成員池。
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
