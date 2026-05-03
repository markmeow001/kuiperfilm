'use client'

/**
 * /[locale]/workspaces — workspace management hub
 *
 * Single page that renders 3 different views based on session role:
 *   - admin : all orgs + workspaces, can do anything
 *   - editor: own + memberships, can create workspaces, manage members
 *             of workspaces they own
 *   - member: workspaces I'm a member of, read-only
 *
 * Uses /api/organizations + /api/workspaces (which already filter by
 * role server-side) — UI layer only adds visibility/affordance gating.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'

interface Org {
  id: string
  name: string
  description: string | null
  ownerUserId: string
  createdAt: string
  _count?: { workspaces: number }
}

interface Workspace {
  id: string
  name: string
  description: string | null
  organizationId: string
  ownerEditorId: string
  createdAt: string
  organization?: { id: string; name: string }
  _count?: { members: number }
}

interface MemberRow {
  userId: string
  userName: string
  displayName: string | null
  role: string
  addedBy: string
  joinedAt: string
}

interface WorkspaceProject {
  id: string
  name: string
  description: string | null
  ownerUserId: string
  ownerName: string
  ownerDisplayName: string | null
  updatedAt: string
}

type Role = 'admin' | 'editor' | 'member'

function rolePill(role: string) {
  const color =
    role === 'admin' ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
    : role === 'editor' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
    : 'bg-stone-500/15 text-stone-300 border-stone-500/30'
  return (
    <span className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${color}`}>
      {role}
    </span>
  )
}

export default function WorkspacesPage() {
  const { data: session } = useSession()
  const role = ((session?.user as { role?: string } | undefined)?.role || 'member') as Role
  const myUserId = (session?.user as { id?: string } | undefined)?.id || ''
  const params = useParams()
  const locale = (params?.locale as string) || 'zh'

  const [orgs, setOrgs] = useState<Org[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [memberships, setMemberships] = useState<Workspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showOrgModal, setShowOrgModal] = useState(false)
  const [showWsModal, setShowWsModal] = useState(false)
  const [selectedWs, setSelectedWs] = useState<Workspace | null>(null)

  async function reload() {
    setLoading(true)
    setError(null)
    try {
      const [oRes, wRes] = await Promise.all([
        fetch('/api/organizations'),
        fetch('/api/workspaces'),
      ])
      if (!oRes.ok) throw new Error(`orgs ${oRes.status}`)
      if (!wRes.ok) throw new Error(`workspaces ${wRes.status}`)
      const oData = await oRes.json()
      const wData = await wRes.json()
      setOrgs(oData.organizations || [])
      setWorkspaces(wData.workspaces || [])
      setMemberships(wData.workspaceMemberships || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed')
    }
    setLoading(false)
  }

  useEffect(() => { reload() }, [])

  const canCreateOrg = role === 'admin' || role === 'editor'
  const canCreateWs = (role === 'admin' || role === 'editor') && orgs.length > 0
  const allWs = useMemo(() => {
    const seen = new Set<string>()
    const out: Workspace[] = []
    for (const w of [...workspaces, ...memberships]) {
      if (seen.has(w.id)) continue
      seen.add(w.id)
      out.push(w)
    }
    return out
  }, [workspaces, memberships])

  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <Navbar />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.2em] text-amber-500">
              WORKSPACES
            </div>
            <h1 className="font-fraunces text-3xl italic">工作區管理</h1>
            <p className="mt-1 font-serif-cn text-sm text-stone-400">
              {role === 'admin' ? '管理員視圖：看見全平台所有 org / workspace。'
                : role === 'editor' ? '編輯者視圖：管理你建立的工作區、加 / 踢成員、看組員專案。'
                : '成員視圖：你被加入的工作區清單。'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {rolePill(role)}
            <Link href={`/${locale}`} className="rounded-sm border border-stone-700 px-3 py-1.5 font-mono text-xs hover:border-amber-500/50">
              ← 主頁
            </Link>
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-xs text-rose-300">
            錯誤：{error}
          </div>
        )}

        {/* Organizations section */}
        <section className="mb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-fraunces text-xl italic">
              組織 <span className="font-mono text-sm tracking-wider text-stone-500">({orgs.length})</span>
            </h2>
            {canCreateOrg && (
              <button
                onClick={() => setShowOrgModal(true)}
                className="rounded-sm bg-amber-500 px-3 py-1.5 font-serif-cn text-sm font-medium text-stone-950 hover:bg-amber-400"
              >
                + 新增組織
              </button>
            )}
          </div>
          {loading ? (
            <div className="font-mono text-xs text-stone-500">載入中...</div>
          ) : orgs.length === 0 ? (
            <div className="rounded-sm border border-stone-800 bg-stone-900/50 px-4 py-6 font-serif-cn text-sm text-stone-400">
              {canCreateOrg ? '還沒有組織。先建一個組織才能下面建工作區。' : '你目前不在任何組織內。'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {orgs.map((o) => (
                <div key={o.id} className="rounded-sm border border-stone-800 bg-stone-900/50 p-4">
                  <div className="font-fraunces text-base italic">{o.name}</div>
                  {o.description && <div className="mt-1 font-serif-cn text-xs text-stone-400">{o.description}</div>}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="font-mono text-[10px] tracking-wider text-stone-500">
                      {o._count?.workspaces ?? 0} workspace{(o._count?.workspaces ?? 0) !== 1 ? 's' : ''}
                    </span>
                    {(role === 'admin' || o.ownerUserId === myUserId) && (
                      <span className="font-mono text-[10px] uppercase tracking-wider text-amber-500/80">owner</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Workspaces section */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-fraunces text-xl italic">
              工作區 <span className="font-mono text-sm tracking-wider text-stone-500">({allWs.length})</span>
            </h2>
            {canCreateWs && (
              <button
                onClick={() => setShowWsModal(true)}
                className="rounded-sm bg-amber-500 px-3 py-1.5 font-serif-cn text-sm font-medium text-stone-950 hover:bg-amber-400"
              >
                + 新增工作區
              </button>
            )}
          </div>
          {loading ? (
            <div className="font-mono text-xs text-stone-500">載入中...</div>
          ) : allWs.length === 0 ? (
            <div className="rounded-sm border border-stone-800 bg-stone-900/50 px-4 py-6 font-serif-cn text-sm text-stone-400">
              {canCreateWs
                ? '還沒有工作區。點上方「新增工作區」建一個。'
                : role === 'editor' && orgs.length === 0
                  ? '請先新增組織才能建工作區。'
                  : '你還沒被加入任何工作區。'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {allWs.map((w) => {
                const isOwner = w.ownerEditorId === myUserId
                const canManage = role === 'admin' || isOwner
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setSelectedWs(w)}
                    className="rounded-sm border border-stone-800 bg-stone-900/50 p-4 text-left transition-colors hover:border-amber-500/50 hover:bg-stone-900"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-fraunces text-base italic">{w.name}</div>
                        {w.organization && (
                          <div className="mt-0.5 font-mono text-[10px] tracking-wider text-stone-500">
                            org · {w.organization.name}
                          </div>
                        )}
                        {w.description && (
                          <div className="mt-2 font-serif-cn text-xs text-stone-400">{w.description}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {canManage && (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-amber-500/80">
                            {isOwner ? 'owner' : 'admin'}
                          </span>
                        )}
                        <span className="font-mono text-[10px] tracking-wider text-stone-500">
                          {w._count?.members ?? 0} 成員
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      </div>

      {showOrgModal && (
        <CreateOrgModal
          onClose={() => setShowOrgModal(false)}
          onCreated={() => { setShowOrgModal(false); reload() }}
        />
      )}
      {showWsModal && (
        <CreateWorkspaceModal
          orgs={orgs}
          onClose={() => setShowWsModal(false)}
          onCreated={() => { setShowWsModal(false); reload() }}
        />
      )}
      {selectedWs && (
        <WorkspaceDetailDrawer
          workspace={selectedWs}
          role={role}
          myUserId={myUserId}
          onClose={() => setSelectedWs(null)}
          onChanged={reload}
        />
      )}
    </div>
  )
}

// ─── Create Org modal ─────────────────────────────────────────────

function CreateOrgModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) return
    setSubmitting(true)
    setErr(null)
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error?.message || j?.message || `HTTP ${res.status}`)
      }
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-6">
      <div className="w-full max-w-md rounded-sm border border-stone-800 bg-stone-900 p-6">
        <h3 className="mb-4 font-fraunces text-lg italic">新增組織</h3>
        <div className="space-y-3">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-500">名稱 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例:水墨工作室"
              className="mt-1 w-full rounded-sm border border-stone-700 bg-stone-950 px-2 py-1.5 font-serif-cn text-sm text-stone-200 focus:border-amber-500 focus:outline-none"
              maxLength={100}
              autoFocus
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-500">描述（選填）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句話說明這個組織做什麼"
              className="mt-1 w-full rounded-sm border border-stone-700 bg-stone-950 px-2 py-1.5 font-serif-cn text-sm text-stone-200 focus:border-amber-500 focus:outline-none"
              rows={3}
              maxLength={2000}
            />
          </div>
          {err && <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 font-mono text-[11px] text-rose-300">{err}</div>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-sm border border-stone-700 px-3 py-1.5 font-mono text-xs hover:border-stone-500">取消</button>
          <button
            onClick={submit}
            disabled={!name.trim() || submitting}
            className="rounded-sm bg-amber-500 px-4 py-1.5 font-serif-cn text-sm text-stone-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {submitting ? '建立中…' : '建立'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Create Workspace modal ──────────────────────────────────────────

function CreateWorkspaceModal({ orgs, onClose, onCreated }: {
  orgs: Org[]; onClose: () => void; onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [organizationId, setOrganizationId] = useState(orgs[0]?.id || '')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!name.trim() || !organizationId) return
    setSubmitting(true)
    setErr(null)
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          organizationId,
          description: description.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error?.message || j?.message || `HTTP ${res.status}`)
      }
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-6">
      <div className="w-full max-w-md rounded-sm border border-stone-800 bg-stone-900 p-6">
        <h3 className="mb-4 font-fraunces text-lg italic">新增工作區</h3>
        <div className="space-y-3">
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-500">所屬組織 *</label>
            <select
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              className="mt-1 w-full rounded-sm border border-stone-700 bg-stone-950 px-2 py-1.5 font-serif-cn text-sm text-stone-200 focus:border-amber-500 focus:outline-none"
            >
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-500">名稱 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例:Team A / 武俠專案組"
              className="mt-1 w-full rounded-sm border border-stone-700 bg-stone-950 px-2 py-1.5 font-serif-cn text-sm text-stone-200 focus:border-amber-500 focus:outline-none"
              maxLength={100}
              autoFocus
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-wider text-stone-500">描述（選填）</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-sm border border-stone-700 bg-stone-950 px-2 py-1.5 font-serif-cn text-sm text-stone-200 focus:border-amber-500 focus:outline-none"
              rows={3}
              maxLength={2000}
            />
          </div>
          {err && <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 font-mono text-[11px] text-rose-300">{err}</div>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-sm border border-stone-700 px-3 py-1.5 font-mono text-xs hover:border-stone-500">取消</button>
          <button
            onClick={submit}
            disabled={!name.trim() || !organizationId || submitting}
            className="rounded-sm bg-amber-500 px-4 py-1.5 font-serif-cn text-sm text-stone-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {submitting ? '建立中…' : '建立'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Workspace detail drawer ───────────────────────────────────────

function WorkspaceDetailDrawer({
  workspace, role, myUserId, onClose, onChanged,
}: {
  workspace: Workspace
  role: Role
  myUserId: string
  onClose: () => void
  onChanged: () => void
}) {
  const isOwner = workspace.ownerEditorId === myUserId
  const canManage = role === 'admin' || isOwner

  const [members, setMembers] = useState<MemberRow[]>([])
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [tab, setTab] = useState<'members' | 'projects'>('members')
  const [loadingM, setLoadingM] = useState(true)
  const [loadingP, setLoadingP] = useState(false)

  // Add-member form state
  const [addUserName, setAddUserName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)
  // Click-to-add picker — list of users not yet in this workspace.
  // Replaces the type-username flow when canManage. Owner clicks an
  // entry → POSTs `{userId}` → row drops out, member list refreshes.
  type AddableUser = {
    userId: string
    userName: string | null
    displayName: string | null
    email: string | null
    role: string | null
  }
  const [addable, setAddable] = useState<AddableUser[]>([])
  const [loadingAddable, setLoadingAddable] = useState(false)
  const [addingUserId, setAddingUserId] = useState<string | null>(null)
  const [addableFilter, setAddableFilter] = useState('')

  async function loadMembers() {
    setLoadingM(true)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members`)
      if (res.ok) {
        const j = await res.json()
        setMembers(j.members || [])
      }
    } catch {}
    setLoadingM(false)
  }
  async function loadProjects() {
    if (!canManage) return
    setLoadingP(true)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/projects`)
      if (res.ok) {
        const j = await res.json()
        setProjects(j.projects || [])
      }
    } catch {}
    setLoadingP(false)
  }
  async function loadAddable() {
    if (!canManage) return
    setLoadingAddable(true)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/addable-users`)
      if (res.ok) {
        const j = await res.json()
        setAddable(j.addable || [])
      }
    } catch {}
    setLoadingAddable(false)
  }

  useEffect(() => {
    loadMembers()
    if (canManage) {
      loadProjects()
      loadAddable()
    }
  }, [workspace.id])

  async function addMember() {
    if (!addUserName.trim()) return
    setAdding(true)
    setAddErr(null)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: addUserName.trim() }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error?.details?.message || j?.error?.code || `HTTP ${res.status}`)
      }
      setAddUserName('')
      await Promise.all([loadMembers(), loadAddable()])
      onChanged()
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : 'failed')
    }
    setAdding(false)
  }

  async function addMemberById(userId: string) {
    setAddingUserId(userId)
    setAddErr(null)
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j?.error?.details?.message || j?.error?.code || `HTTP ${res.status}`)
      }
      await Promise.all([loadMembers(), loadAddable()])
      onChanged()
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : 'failed')
    }
    setAddingUserId(null)
  }

  async function removeMember(userId: string) {
    if (!confirm('確定踢出這個成員？')) return
    try {
      const res = await fetch(`/api/workspaces/${workspace.id}/members/${userId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j?.error?.code || `HTTP ${res.status}`)
        return
      }
      await loadMembers()
      onChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'failed')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-stone-950/80">
      <div className="flex w-full max-w-2xl flex-col border-l border-stone-800 bg-stone-900">
        <header className="flex items-start justify-between border-b border-stone-800 p-5">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-stone-500">
              workspace · {workspace.organization?.name || workspace.organizationId.slice(0, 8)}
            </div>
            <h3 className="mt-1 font-fraunces text-2xl italic">{workspace.name}</h3>
            {workspace.description && (
              <p className="mt-1 font-serif-cn text-sm text-stone-400">{workspace.description}</p>
            )}
            <div className="mt-2 flex items-center gap-2">
              {canManage && (
                <span className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-300">
                  {isOwner ? 'OWNER' : 'ADMIN ACCESS'}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="rounded-sm border border-stone-700 px-2 py-1 font-mono text-xs hover:border-stone-500">✕</button>
        </header>

        <nav className="flex border-b border-stone-800">
          <button
            onClick={() => setTab('members')}
            className={`px-4 py-2 font-mono text-xs uppercase tracking-wider ${tab === 'members' ? 'border-b-2 border-amber-500 text-amber-300' : 'text-stone-500'}`}
          >
            成員 ({members.length})
          </button>
          {canManage && (
            <button
              onClick={() => setTab('projects')}
              className={`px-4 py-2 font-mono text-xs uppercase tracking-wider ${tab === 'projects' ? 'border-b-2 border-amber-500 text-amber-300' : 'text-stone-500'}`}
            >
              組員專案 ({projects.length})
            </button>
          )}
        </nav>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'members' && (
            <>
              {canManage && (
                <>
                  {/*
                    Click-to-add picker. Lists every active user that
                    isn't already a member or the owner. User asked for
                    this UX 2026-05-02 — typing a username for every
                    add was friction when the team is small (~10-20
                    invite-only members) and they all sit in the same
                    list. Filter input collapses the list for larger
                    rosters. Each row has a `+` button that fires
                    addMemberById(userId).
                  */}
                  <div className="mb-3 rounded-sm border border-stone-800 bg-stone-950 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="font-mono text-[12px] uppercase tracking-wider text-stone-500">
                        可加入的用戶 ({addable.length})
                      </div>
                      <input
                        type="text"
                        value={addableFilter}
                        onChange={(e) => setAddableFilter(e.target.value)}
                        placeholder="搜尋 username / 顯示名稱…"
                        className="w-48 rounded-sm border border-stone-700 bg-stone-900 px-2 py-1 font-serif-cn text-xs focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                    {loadingAddable ? (
                      <div className="font-mono text-xs text-stone-500">載入用戶清單中…</div>
                    ) : addable.length === 0 ? (
                      <div className="font-serif-cn text-sm text-stone-500">
                        所有已註冊用戶都已是成員(或是這個工作區的 owner)。
                      </div>
                    ) : (
                      <ul className="max-h-72 space-y-1 overflow-y-auto">
                        {addable
                          .filter((u) => {
                            const q = addableFilter.trim().toLowerCase()
                            if (!q) return true
                            return (
                              (u.userName ?? '').toLowerCase().includes(q)
                              || (u.displayName ?? '').toLowerCase().includes(q)
                              || (u.email ?? '').toLowerCase().includes(q)
                            )
                          })
                          .map((u) => (
                            <li
                              key={u.userId}
                              className="flex items-center justify-between rounded-sm border border-stone-800 bg-stone-950/60 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="truncate font-serif-cn text-sm text-stone-100">
                                  {u.displayName || u.userName || '(未命名)'}
                                </div>
                                <div className="mt-0.5 truncate font-mono text-[12px] tracking-wider text-stone-500">
                                  @{u.userName ?? '—'}
                                  {u.email ? ` · ${u.email}` : ''}
                                  {u.role && u.role !== 'member' ? ` · ${u.role}` : ''}
                                </div>
                              </div>
                              <button
                                onClick={() => addMemberById(u.userId)}
                                disabled={addingUserId === u.userId}
                                className="ml-3 flex flex-shrink-0 items-center gap-1 rounded-sm bg-amber-500/15 px-2 py-1 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/25 disabled:opacity-50"
                              >
                                {addingUserId === u.userId ? '加入中…' : '+ 加入'}
                              </button>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>

                  <div className="mb-4 rounded-sm border border-stone-800 bg-stone-950 p-3">
                    <div className="mb-2 font-mono text-[12px] uppercase tracking-wider text-stone-500">或用 username 直接加入</div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={addUserName}
                        onChange={(e) => setAddUserName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addMember()}
                        placeholder="例:test02"
                        className="flex-1 rounded-sm border border-stone-700 bg-stone-900 px-2 py-1.5 font-serif-cn text-sm focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        onClick={addMember}
                        disabled={!addUserName.trim() || adding}
                        className="rounded-sm bg-amber-500 px-3 py-1.5 font-serif-cn text-sm text-stone-950 hover:bg-amber-400 disabled:opacity-40"
                      >
                        {adding ? '加入中…' : '加入'}
                      </button>
                    </div>
                    {addErr && <div className="mt-2 font-mono text-[12px] text-rose-300">{addErr}</div>}
                  </div>
                </>
              )}
              {loadingM ? (
                <div className="font-mono text-xs text-stone-500">載入中...</div>
              ) : members.length === 0 ? (
                <div className="font-serif-cn text-sm text-stone-400">這個工作區還沒成員。</div>
              ) : (
                <ul className="space-y-2">
                  {members.map((m) => (
                    <li key={m.userId} className="flex items-center justify-between rounded-sm border border-stone-800 bg-stone-950 px-3 py-2">
                      <div className="flex items-center gap-3">
                        {rolePill(m.role)}
                        <div>
                          <div className="font-serif-cn text-sm">{m.displayName || m.userName}</div>
                          <div className="font-mono text-[10px] tracking-wider text-stone-500">@{m.userName}</div>
                        </div>
                      </div>
                      {canManage && (
                        <button
                          onClick={() => removeMember(m.userId)}
                          className="rounded-sm border border-rose-500/30 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-rose-300 hover:border-rose-400 hover:text-rose-200"
                        >
                          踢出
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'projects' && canManage && (
            <>
              {loadingP ? (
                <div className="font-mono text-xs text-stone-500">載入中...</div>
              ) : projects.length === 0 ? (
                <div className="font-serif-cn text-sm text-stone-400">組員還沒建任何專案。</div>
              ) : (
                <ul className="space-y-2">
                  {projects.map((p) => (
                    <li key={p.id} className="rounded-sm border border-stone-800 bg-stone-950 px-3 py-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <Link
                            href={`/zh/v2/workspace/${p.id}`}
                            className="font-fraunces text-base italic hover:text-amber-300"
                          >
                            {p.name || '未命名專案'}
                          </Link>
                          <div className="mt-0.5 font-mono text-[10px] tracking-wider text-stone-500">
                            擁有者 @{p.ownerName} · 更新於 {new Date(p.updatedAt).toLocaleString('zh-TW')}
                          </div>
                          {p.description && <div className="mt-1 font-serif-cn text-xs text-stone-400">{p.description}</div>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
