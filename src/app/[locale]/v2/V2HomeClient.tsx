'use client'

/**
 * Phase 12.x.x — v2 root page (project list + entry to new project flow).
 *
 * Replaces /[locale]/workspace as the canonical entry point. Stays in
 * the v2 cinematic palette (stone-950 / amber accent / font-serif-cn)
 * so users never see the Phase-11 frosted-blue dashboard.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'

interface ProjectStats {
  episodes: number
  images: number
  videos: number
  panels: number
  firstEpisodePreview: string | null
}

interface ProjectRow {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
  stats?: ProjectStats
}

interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

const PAGE_SIZE = 11 // 12 grid cells minus the "+ new" card

interface V2HomeClientProps {
  locale: string
}

export function V2HomeClient({ locale }: V2HomeClientProps) {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0,
  })
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Auth gate.
  useEffect(() => {
    if (status === 'loading') return
    if (!session) router.push(`/${locale}/auth/signin`)
  }, [session, status, router, locale])

  const fetchProjects = useCallback(
    async (page: number, search: string) => {
      try {
        setLoading(true)
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })
        if (search.trim()) params.set('search', search.trim())
        const res = await fetch(`/api/projects?${params}`)
        if (!res.ok) return
        const data = (await res.json()) as { projects: ProjectRow[]; pagination: Pagination }
        setProjects(data.projects)
        setPagination(data.pagination)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (session) void fetchProjects(pagination.page, searchQuery)
  }, [session, pagination.page, searchQuery, fetchProjects])

  function handleSearch() {
    setSearchQuery(searchInput)
    setPagination((prev) => ({ ...prev, page: 1 }))
  }

  function clearSearch() {
    setSearchInput('')
    setSearchQuery('')
    setPagination((prev) => ({ ...prev, page: 1 }))
  }

  async function handleDelete(project: ProjectRow, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const ok = confirm(`刪除專案「${project.name}」?此操作無法復原。`)
    if (!ok) return
    setDeletingId(project.id)
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (!res.ok) {
        alert('刪除失敗')
        return
      }
      void fetchProjects(pagination.page, searchQuery)
    } finally {
      setDeletingId(null)
    }
  }

  const formatted = useMemo(() => {
    return projects.map((p) => ({
      ...p,
      updated: new Date(p.updatedAt).toLocaleString('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }),
    }))
  }, [projects])

  if (status === 'loading' || !session) {
    return (
      <div className="grain flex min-h-screen items-center justify-center bg-stone-950 font-mono text-xs tracking-wider text-stone-500">
        載入中…
      </div>
    )
  }

  return (
    <div className="grain min-h-screen bg-stone-950 text-stone-200">
      {/* Top header */}
      <header className="border-b border-stone-700 px-12 py-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-fraunces text-2xl italic tracking-tight text-amber-400">
              Kuiper <span className="not-italic font-serif-cn">影界</span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] tracking-[0.2em] text-stone-400">
              AI · MANHUA · STUDIO
            </div>
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px] tracking-wider">
            <span className="text-stone-200">{session.user?.name ?? session.user?.email ?? ''}</span>
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: `/${locale}/auth/signin` })}
              className="rounded-sm border border-stone-600 bg-stone-900/80 px-3 py-1.5 text-stone-200 transition-colors hover:border-amber-500 hover:text-amber-300"
            >
              登出
            </button>
          </div>
        </div>
      </header>

      <main className="px-12 py-10">
        {/* Title row */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-[11px] tracking-[0.25em] text-amber-400">
              MY PROJECTS
            </div>
            <h1 className="mt-2 font-serif-cn text-3xl font-light text-white">
              我的專案
            </h1>
            <p className="mt-1 font-fraunces text-sm italic text-stone-300">
              Manage your AI cinematic projects
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
              placeholder="搜尋專案名稱或描述…"
              className="w-64 rounded-sm border border-stone-700 bg-stone-900/80 px-3 py-2 font-serif-cn text-sm text-stone-100 placeholder:text-stone-500 focus:border-amber-500 focus:outline-none"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={clearSearch}
                className="rounded-sm border border-stone-700 bg-stone-900/80 px-3 py-2 font-mono text-xs text-stone-300 transition-colors hover:border-stone-600 hover:text-white"
              >
                清除
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleSearch}
              className="rounded-sm border border-amber-500/60 bg-amber-500/20 px-4 py-2 font-mono text-xs text-amber-300 transition-colors hover:border-amber-500 hover:bg-amber-500/30"
            >
              搜尋
            </button>
          </div>
        </div>

        {/* Project grid */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {/* + New project card */}
          <Link
            href={`/${locale}/v2/new`}
            className="group flex h-44 items-center justify-center rounded-sm border border-amber-500/60 bg-amber-500/10 transition-all hover:border-amber-400 hover:bg-amber-500/20"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-amber-500 bg-amber-500/30 transition-all group-hover:scale-110">
                <AppIcon name="plus" className="h-5 w-5 text-amber-300" />
              </div>
              <span className="font-serif-cn text-base font-medium text-amber-300">新建專案</span>
            </div>
          </Link>

          {/* Loading skeletons */}
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-sm border border-stone-700 bg-stone-900/70" />
              ))
            : formatted.map((project) => (
                <Link
                  key={project.id}
                  href={`/${locale}/v2/workspace/${project.id}`}
                  className="group relative flex h-44 flex-col rounded-sm border border-stone-700 bg-stone-900/70 p-5 transition-all hover:border-amber-500 hover:bg-stone-900/90"
                >
                  <button
                    type="button"
                    onClick={(e) => void handleDelete(project, e)}
                    disabled={deletingId === project.id}
                    className="absolute right-3 top-3 hidden h-7 w-7 items-center justify-center rounded-sm border border-stone-600 bg-stone-900 text-stone-300 transition-colors hover:border-rose-500 hover:bg-rose-500/20 hover:text-rose-200 group-hover:flex disabled:opacity-50"
                    title="刪除專案"
                  >
                    <AppIcon name="trash" className="h-3.5 w-3.5" />
                  </button>

                  <div className="font-serif-cn text-lg font-medium text-white group-hover:text-amber-300">
                    {project.name}
                  </div>

                  {project.description || project.stats?.firstEpisodePreview ? (
                    <p className="mt-2 line-clamp-2 font-serif-cn text-xs leading-relaxed text-stone-300">
                      {project.description || project.stats?.firstEpisodePreview}
                    </p>
                  ) : (
                    <p className="mt-2 font-fraunces text-xs italic text-stone-500">
                      Untitled draft
                    </p>
                  )}

                  <div className="mt-auto flex items-center justify-between font-mono text-[10px] text-stone-400">
                    <div className="flex items-center gap-3">
                      {project.stats?.episodes ? (
                        <span className="flex items-center gap-1">
                          <AppIcon name="bookOpen" className="h-3 w-3 text-amber-400/80" />
                          {project.stats.episodes}
                        </span>
                      ) : null}
                      {project.stats?.images ? (
                        <span className="flex items-center gap-1">
                          <AppIcon name="image" className="h-3 w-3 text-amber-400/80" />
                          {project.stats.images}
                        </span>
                      ) : null}
                      {project.stats?.videos ? (
                        <span className="flex items-center gap-1">
                          <AppIcon name="film" className="h-3 w-3 text-amber-400/80" />
                          {project.stats.videos}
                        </span>
                      ) : null}
                    </div>
                    <span>{project.updated}</span>
                  </div>
                </Link>
              ))}
        </div>

        {!loading && projects.length === 0 ? (
          <div className="mt-16 text-center font-serif-cn text-stone-500">
            <p className="font-fraunces italic">
              {searchQuery ? '沒有符合的專案' : '還沒有專案,點上方「新建專案」開始'}
            </p>
          </div>
        ) : null}

        {/* Pagination */}
        {!loading && pagination.totalPages > 1 ? (
          <div className="mt-10 flex items-center justify-center gap-2 font-mono text-xs">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
              className="rounded-sm border border-stone-800 px-3 py-1.5 text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ←
            </button>
            <span className="px-3 text-stone-500">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
              className="rounded-sm border border-stone-800 px-3 py-1.5 text-stone-400 transition-colors hover:border-amber-500/40 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              →
            </button>
          </div>
        ) : null}
      </main>
    </div>
  )
}
