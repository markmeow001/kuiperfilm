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

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { Modal } from '@/components/v2/Modal'
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
    <Modal
      open
      onClose={onClose}
      size="md"
      className="flex max-h-[min(86vh,760px)] flex-col overflow-hidden"
    >
      <Modal.Header
        heading={t('title')}
        onClose={onClose}
        closeAriaLabel={t('closeIcon')}
      >
            <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
              <span className="font-mono text-[11px] tracking-wider text-[var(--production-ink-muted)]">{t('workspaceLabel')}</span>
              <select
                value={workspaceId ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  assignMutation.mutate(v === '' ? null : v)
                }}
                disabled={assignMutation.isPending || workspacesQuery.isLoading}
                className="min-h-11 w-full rounded-[10px] border border-[var(--production-border)] bg-[var(--production-muted)] px-3 py-2 font-serif-cn text-xs text-[var(--production-ink)] outline-none hover:border-[var(--production-border-dark)] focus-visible:border-[var(--production-focus)] focus-visible:ring-2 focus-visible:ring-[rgba(85,175,192,0.24)] disabled:opacity-50 sm:w-auto"
              >
                <option value="">{t('personalOption')}</option>
                {(workspacesQuery.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}{w.organization?.name ? ` · ${w.organization.name}` : ''}
                  </option>
                ))}
              </select>
              {assignMutation.isPending ? (
                <span className="font-mono text-[11px] text-[var(--production-ink-muted)]">{t('savingChange')}</span>
              ) : null}
            </div>
            <p className="mt-2 font-mono text-[11px] tracking-wider text-[var(--production-ink-muted)]">
              {workspaceId ? t('explainWorkspaceMember') : t('explainPersonal')}
            </p>
      </Modal.Header>

      <Modal.Body className="overflow-y-auto px-4 py-4 sm:px-5">
          {collabQuery.isLoading ? (
            <div className="font-mono text-xs text-[var(--production-ink-muted)]">{t('loadingCollaborators')}</div>
          ) : (
            <>
              <div className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--process-cyan-strong)]">
                {t('grantsHeader', { count: collaborators.length })}
              </div>

              {collaborators.length === 0 ? (
                <p className="rounded-[10px] border border-[var(--production-border)] bg-[var(--production-muted)] px-3 py-3 font-fraunces text-xs italic text-[var(--production-ink-muted)]">
                  {t('grantsEmpty')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {collaborators.map((c) => (
                    <li
                      key={c.userId}
                      className="flex flex-col items-stretch gap-3 rounded-[10px] border border-[var(--production-border)] bg-[var(--production-muted)] px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-serif-cn text-sm text-[var(--production-ink)]">
                          @{c.user.name ?? t('userUnnamed')}
                          {c.user.displayName ? (
                            <span className="ml-2 font-mono text-[11px] text-[var(--production-ink-muted)]">
                              {c.user.displayName}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] tracking-wider text-[var(--production-ink-muted)]">
                          {t('grantedBy', {
                            by: c.granter.name ?? '?',
                            date: new Date(c.grantedAt).toLocaleString(dateLocale),
                          })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:shrink-0">
                        <select
                          value={c.role}
                          onChange={(e) =>
                            upsertMutation.mutate({
                              userId: c.userId,
                              role: e.target.value as CollabRole,
                            })
                          }
                          disabled={upsertMutation.isPending || revokeMutation.isPending}
                          className="min-h-11 flex-1 rounded-[9px] border border-[var(--production-border)] bg-[var(--production-paper)] px-3 py-2 font-mono text-[12px] text-[var(--production-ink)] outline-none hover:border-[var(--production-border-dark)] focus-visible:border-[var(--production-focus)] focus-visible:ring-2 focus-visible:ring-[rgba(85,175,192,0.24)] disabled:opacity-50"
                        >
                          <option value="editor">editor</option>
                          <option value="viewer">viewer</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => revokeMutation.mutate(c.userId)}
                          disabled={revokeMutation.isPending || upsertMutation.isPending}
                          className="min-h-11 rounded-[9px] border border-[var(--production-border)] px-3 py-2 font-mono text-[12px] tracking-wider text-[var(--production-ink-muted)] transition-colors hover:border-rose-500/55 hover:bg-rose-500/10 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] disabled:opacity-50"
                        >
                          {t('remove')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {errMsg ? (
                <div className="mt-3 rounded-[10px] border border-rose-500/35 bg-rose-500/10 px-3 py-2 font-serif-cn text-xs text-rose-200" role="alert">
                  {errMsg}
                </div>
              ) : null}

              {/* Add picker */}
              {workspaceId ? (
                <div className="mt-4 border-t border-[var(--production-border)] pt-4">
                  {!pickerOpen ? (
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      disabled={addableMembers.length === 0 && wsMembers.length > 0}
                      className="min-h-11 w-full rounded-[10px] bg-[var(--production-blue)] px-4 py-2 font-mono text-[12px] font-semibold tracking-wider text-white transition-colors hover:bg-[var(--production-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                      title={
                        addableMembers.length === 0 && wsMembers.length > 0
                          ? t('addableEmpty')
                          : t('addableHint')
                      }
                    >
                      {t('invite')}
                    </button>
                  ) : (
                    <div className="rounded-[10px] border border-[color-mix(in_srgb,var(--process-cyan)_48%,var(--production-border))] bg-[var(--process-cyan-soft)] p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--process-cyan-strong)]">
                          {t('pickerTitle')}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPickerOpen(false)
                            setPickerFilter('')
                          }}
                          className="min-h-11 rounded-[9px] px-3 font-mono text-[11px] text-[var(--production-ink-muted)] transition-colors hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)]"
                        >
                          {t('pickerCancel')}
                        </button>
                      </div>
                      <input
                        type="text"
                        value={pickerFilter}
                        onChange={(e) => setPickerFilter(e.target.value)}
                        placeholder={t('pickerSearchPlaceholder')}
                        className="mb-2 min-h-11 w-full rounded-[9px] border border-[var(--production-border)] bg-[var(--production-paper)] px-3 py-2 font-mono text-[12px] text-[var(--production-ink)] outline-none placeholder:text-[var(--production-ink-muted)] hover:border-[var(--production-border-dark)] focus-visible:border-[var(--production-focus)] focus-visible:ring-2 focus-visible:ring-[rgba(85,175,192,0.24)]"
                      />
                      {membersQuery.isLoading ? (
                        <div className="font-mono text-[12px] text-[var(--production-ink-muted)]">{t('pickerLoading')}</div>
                      ) : addableMembers.length === 0 ? (
                        <p className="font-fraunces text-xs italic text-[var(--production-ink-muted)]">
                          {wsMembers.length === 0
                            ? t('pickerEmptyNoOthers')
                            : t('pickerEmptyAllAdded')}
                        </p>
                      ) : (
                        <ul className="max-h-40 space-y-1 overflow-y-auto">
                          {addableMembers.map((m) => (
                            <li
                              key={m.userId}
                              className="flex flex-col items-stretch gap-2 rounded-[9px] bg-[var(--production-paper)] px-2 py-2 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="min-w-0 flex-1 truncate font-serif-cn text-sm text-[var(--production-ink)]">
                                @{m.userName}
                                {m.displayName ? (
                                  <span className="ml-2 font-mono text-[11px] text-[var(--production-ink-muted)]">
                                    {m.displayName}
                                  </span>
                                ) : null}
                              </div>
                              <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                                <button
                                  type="button"
                                  onClick={() =>
                                    upsertMutation.mutate({ userId: m.userId, role: UserRole.EDITOR })
                                  }
                                  disabled={upsertMutation.isPending}
                                  className="min-h-11 rounded-[9px] bg-[var(--production-blue)] px-3 py-2 font-mono text-[11px] font-semibold tracking-wider text-white transition-colors hover:bg-[var(--production-blue-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] disabled:opacity-50"
                                >
                                  {t('addEditor')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    upsertMutation.mutate({ userId: m.userId, role: UserRole.VIEWER })
                                  }
                                  disabled={upsertMutation.isPending}
                                  className="min-h-11 rounded-[9px] border border-[var(--production-border)] px-3 py-2 font-mono text-[11px] tracking-wider text-[var(--production-ink-muted)] transition-colors hover:border-[var(--production-border-dark)] hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--production-focus)] disabled:opacity-50"
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
                <p className="mt-4 border-t border-[var(--production-border)] pt-4 font-serif-cn text-xs italic text-[var(--production-ink-muted)]">
                  {t('noWorkspaceNoPool')}
                </p>
              )}
            </>
          )}
      </Modal.Body>
    </Modal>
  )
}
