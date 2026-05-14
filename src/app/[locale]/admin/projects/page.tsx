'use client'

/**
 * Admin: cross-user project overview.
 *
 * Lists every project on the platform (most-recently-accessed first)
 * with owner, mode, asset/panel/video counts, last activity. Used to
 * triage what users are doing and spot abandoned / heavy projects.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Navbar from '@/components/Navbar'

interface ProjectRow {
  id: string
  name: string
  mode: string
  owner: { id: string; name: string; email: string | null } | null
  characterCount: number
  locationCount: number
  episodeCount: number
  panelCount: number
  videoCount: number
  createdAt: string
  updatedAt: string
  lastAccessedAt: string | null
}

function fmtDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function AdminProjectsPage() {
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'

  const [projects, setProjects] = useState<ProjectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const load = async () => {
    setError(null)
    try {
      const res = await fetch('/api/admin/projects?limit=200', { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { projects: ProjectRow[] }
      setProjects(data.projects)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filtered = (projects ?? []).filter((p) => {
    if (!filter.trim()) return true
    const q = filter.toLowerCase()
    return (
      (p.name?.toLowerCase().includes(q) ?? false) ||
      (p.owner?.name?.toLowerCase().includes(q) ?? false) ||
      (p.owner?.email?.toLowerCase().includes(q) ?? false)
    )
  })

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <Navbar />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link
            href={`/${locale}/admin`}
            className="font-mono text-[10px] tracking-wider text-stone-500 hover:text-amber-400"
          >
            ← 後台首頁
          </Link>
          <div className="flex items-center gap-1 rounded-md border border-stone-800/60 bg-stone-900/40 p-1">
            <Link href={`/${locale}/admin/users`} className="rounded-sm px-3 py-1.5 font-medium text-xs text-stone-400 hover:text-stone-200">使用者</Link>
            <Link href={`/${locale}/admin/invites`} className="rounded-sm px-3 py-1.5 font-medium text-xs text-stone-400 hover:text-stone-200">邀請碼</Link>
            <span className="rounded-sm bg-amber-500/15 px-3 py-1.5 font-medium text-xs text-amber-400">所有專案</span>
            <Link href={`/${locale}/admin/runs`} className="rounded-sm px-3 py-1.5 font-medium text-xs text-stone-400 hover:text-stone-200">失敗任務</Link>
            <Link href={`/${locale}/admin/usage`} className="rounded-sm px-3 py-1.5 font-medium text-xs text-stone-400 hover:text-stone-200">使用量</Link>
          </div>
        </div>

        <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-serif-cn text-2xl font-semibold text-stone-100">所有專案</h1>
            <p className="mt-1 font-fraunces text-sm italic text-stone-400">
              {projects ? `共 ${projects.length} 個專案` : '載入中…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜尋專案 / 擁有者…"
              className="w-64 rounded-sm border border-stone-800 bg-stone-900/40 px-3 py-2 font-serif-cn text-sm text-stone-200 placeholder:text-stone-600 focus:border-amber-500/40 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-sm border border-stone-800 bg-stone-900/40 px-3 py-2 font-mono text-[10px] tracking-wider text-stone-300 transition-colors hover:border-amber-500/40 hover:text-amber-400"
            >
              ↻ 刷新
            </button>
          </div>
        </header>

        {error ? (
          <div className="mb-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-sm border border-stone-800/60 bg-stone-900/20">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-900/40 font-mono text-[10px] uppercase tracking-wider text-stone-500">
              <tr>
                <th className="px-4 py-3">專案名</th>
                <th className="px-4 py-3">擁有者</th>
                <th className="px-4 py-3">Mode</th>
                <th className="px-4 py-3 text-right">集</th>
                <th className="px-4 py-3 text-right">角色</th>
                <th className="px-4 py-3 text-right">場景</th>
                <th className="px-4 py-3 text-right">分鏡</th>
                <th className="px-4 py-3 text-right">已生視頻</th>
                <th className="px-4 py-3">最後活動</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/40 font-serif-cn text-stone-300">
              {filtered.map((p) => {
                const isVideoReady = p.videoCount > 0
                return (
                  <tr key={p.id} className="transition-colors hover:bg-stone-900/30">
                    <td className="px-4 py-3">
                      <div className="font-medium text-stone-100">{p.name || '未命名'}</div>
                      <div className="font-mono text-[10px] text-stone-600">{p.id.slice(0, 8)}…</div>
                    </td>
                    <td className="px-4 py-3">
                      {p.owner ? (
                        <div>
                          <div className="text-stone-200">{p.owner.name}</div>
                          <div className="font-mono text-[10px] text-stone-600">{p.owner.email ?? '—'}</div>
                        </div>
                      ) : (
                        <span className="text-stone-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] uppercase tracking-wider text-stone-500">
                      {p.mode}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{p.episodeCount}</td>
                    <td className="px-4 py-3 text-right font-mono">{p.characterCount}</td>
                    <td className="px-4 py-3 text-right font-mono">{p.locationCount}</td>
                    <td className="px-4 py-3 text-right font-mono">{p.panelCount}</td>
                    <td className={`px-4 py-3 text-right font-mono ${isVideoReady ? 'text-amber-400' : 'text-stone-500'}`}>
                      {p.videoCount}
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] tracking-wider text-stone-500">
                      {fmtDate(p.lastAccessedAt ?? p.updatedAt)}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && projects ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-stone-500">
                    {filter ? '沒有符合搜尋的專案' : '目前沒有任何專案'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
