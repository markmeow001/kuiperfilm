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
import { useLocale, useTranslations } from 'next-intl'
import { UserRole } from '@/lib/auth/user-role'

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

// /api/workspaces shape (owned + member, deduped).
interface UserWorkspaceRow {
  id: string
  name: string
  organization?: { name?: string | null } | null
}

interface ProjectCollaboratorsModalProps {
  projectId: string
  workspaceId: string | null
  onClose: () => void
}

const COLLAB_QUERY_KEY = (projectId: string) => ['project', projectId, 'collaborators'] as const
const WS_MEMBERS_QUERY_KEY = (wsId: string) => ['workspace', wsId, 'members'] as const

export function ProjectCollaboratorsModal({
  projectId,
  workspaceId,
  onClose,
}: ProjectCollaboratorsModalProps) {
  const t = useTranslations('collab.collaboratorsModal')
  const locale = useLocale()
  // Locale BCP-47 tag for date formatting (zh → zh-CN, en → en-US).
  const dateLocale = locale === 'en' ? 'en-US' : 'zh-CN'
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

  // Memoize the upstream `?? []` fallbacks so addableMembers' deps are
  // stable refs — re-creating empty arrays per render would trip the
  // react-hooks/exhaustive-deps rule.
  const collaborators = useMemo(
    () => collabQuery.data?.collaborators ?? [],
    [collabQuery.data?.collaborators],
  )
  const wsMembers = useMemo(
    () => membersQuery.data?.members ?? [],
    [membersQuery.data?.members],
  )

  const addableMembers = useMemo(() => {
    const filter = pickerFilter.trim().toLowerCase()
    const existingCollabIds = new Set(collaborators.map((c) => c.userId))
    return wsMembers
      .filter((m) => !existingCollabIds.has(m.userId))
      .filter((m) => {
        if (!filter) return true
        const hay = `${m.userName} ${m.displayName ?? ''}`.toLowerCase()
        return hay.includes(filter)
      })
  }, [wsMembers, collaborators, pickerFilter])

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

  // Phase 12.5+ — assign / move workspace.
  // Lists user's workspaces (owned + member). PATCH project.workspaceId.
  // Owner / admin only on the server side; modal is already gated to
  // owner/admin entry, so we don't add a second gate here.
  const workspacesQuery = useQuery({
    queryKey: ['user', 'workspaces', 'list'],
    queryFn: async (): Promise<UserWorkspaceRow[]> => {
      const res = await fetch('/api/workspaces')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as {
        workspaces?: UserWorkspaceRow[]
        workspaceMemberships?: UserWorkspaceRow[]
      }
      const owned = data.workspaces ?? []
      const member = data.workspaceMemberships ?? []
      const seen = new Set<string>()
      const merged: UserWorkspaceRow[] = []
      for (const w of [...owned, ...member]) {
        if (seen.has(w.id)) continue
        seen.add(w.id)
        merged.push(w)
      }
      return merged
    },
  })

  const assignMutation = useMutation({
    mutationFn: async (newWorkspaceId: string | null) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: newWorkspaceId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error?.details?.reason || j?.error?.code || `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: () => {
      // Multi-invalidate: project detail (workspaceId changed),
      // access (cascade might now resolve differently for other users),
      // project list (might appear/disappear in different ?ws= views),
      // and the workspaces list itself (so the dropdown shows accurate
      // current state).
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['project', projectId, 'access'] })
      void queryClient.invalidateQueries({ queryKey: ['project-data', projectId] })
      // The modal will receive a refreshed `workspaceId` via parent re-render
      // (parent reads from useProjectData); we don't try to mutate local state.
      setErrMsg(null)
    },
    onError: (err) => {
      setErrMsg(err instanceof Error ? err.message : t('savingChange'))
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
          <div className="flex-1">
            <h2 className="font-fraunces text-lg italic text-amber-300">{t('title')}</h2>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-[11px] tracking-wider text-stone-500">{t('workspaceLabel')}</span>
              <select
                value={workspaceId ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  assignMutation.mutate(v === '' ? null : v)
                }}
                disabled={assignMutation.isPending || workspacesQuery.isLoading}
                className="rounded-sm border border-stone-700 bg-stone-900 px-2 py-1 font-serif-cn text-xs text-stone-200 outline-none focus:border-amber-500/40 disabled:opacity-50"
              >
                <option value="">{t('personalOption')}</option>
                {(workspacesQuery.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}{w.organization?.name ? ` · ${w.organization.name}` : ''}
                  </option>
                ))}
              </select>
              {assignMutation.isPending ? (
                <span className="font-mono text-[10px] text-stone-500">{t('savingChange')}</span>
              ) : null}
            </div>
            <p className="mt-2 font-mono text-[11px] tracking-wider text-stone-500">
              {workspaceId ? t('explainWorkspaceMember') : t('explainPersonal')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-stone-700 px-2 py-1 font-mono text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200"
          >
            {t('closeIcon')}
          </button>
        </header>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {collabQuery.isLoading ? (
            <div className="font-mono text-xs text-stone-500">{t('loadingCollaborators')}</div>
          ) : (
            <>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-600/80">
                {t('grantsHeader', { count: collaborators.length })}
              </div>

              {collaborators.length === 0 ? (
                <p className="rounded-sm border border-stone-800/60 bg-stone-900/40 px-3 py-3 font-fraunces text-xs italic text-stone-500">
                  {t('grantsEmpty')}
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
                          @{c.user.name ?? t('userUnnamed')}
                          {c.user.displayName ? (
                            <span className="ml-2 font-mono text-[11px] text-stone-500">
                              {c.user.displayName}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] tracking-wider text-stone-600">
                          {t('grantedBy', {
                            by: c.granter.name ?? '?',
                            date: new Date(c.grantedAt).toLocaleString(dateLocale),
                          })}
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
                          {t('remove')}
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
                          ? t('addableEmpty')
                          : t('addableHint')
                      }
                    >
                      {t('invite')}
                    </button>
                  ) : (
                    <div className="rounded-sm border border-amber-500/40 bg-amber-500/5 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-amber-400">
                          {t('pickerTitle')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPickerOpen(false)
                            setPickerFilter('')
                          }}
                          className="font-mono text-[11px] text-stone-500 hover:text-stone-300"
                        >
                          {t('pickerCancel')}
                        </button>
                      </div>
                      <input
                        type="text"
                        value={pickerFilter}
                        onChange={(e) => setPickerFilter(e.target.value)}
                        placeholder={t('pickerSearchPlaceholder')}
                        className="mb-2 w-full rounded-sm border border-stone-800 bg-stone-950 px-2 py-1.5 font-mono text-[12px] text-stone-200 outline-none focus:border-amber-500/40"
                      />
                      {membersQuery.isLoading ? (
                        <div className="font-mono text-[12px] text-stone-500">{t('pickerLoading')}</div>
                      ) : addableMembers.length === 0 ? (
                        <p className="font-fraunces text-xs italic text-stone-500">
                          {wsMembers.length === 0
                            ? t('pickerEmptyNoOthers')
                            : t('pickerEmptyAllAdded')}
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
                                    upsertMutation.mutate({ userId: m.userId, role: UserRole.EDITOR })
                                  }
                                  disabled={upsertMutation.isPending}
                                  className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] tracking-wider text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
                                >
                                  {t('addEditor')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    upsertMutation.mutate({ userId: m.userId, role: UserRole.VIEWER })
                                  }
                                  disabled={upsertMutation.isPending}
                                  className="rounded-sm border border-stone-700 px-2 py-0.5 font-mono text-[11px] tracking-wider text-stone-400 hover:border-stone-500 hover:text-stone-200 disabled:opacity-50"
                                >
                                  {t('addViewer')}
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
                  {t('noWorkspaceNoPool')}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
