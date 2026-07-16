'use client'

/**
 * Phase 12.x.x — v2 root page (project list + entry to new project flow).
 *
 * Replaces /[locale]/workspace as the canonical entry point. Stays in
 * the v2 cinematic palette (stone-950 / amber accent / font-serif-cn)
 * so users never see the Phase-11 frosted-blue dashboard.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { NotificationBell } from '@/components/v2/NotificationBell'
import { WorkspaceCollabIntroBanner } from './WorkspaceCollabIntroBanner'
import { isAdmin as checkIsAdmin } from '@/lib/auth/user-role'

const STICKY_STEP_VALUES = ['script', 'subjects', 'storyboard', 'voice', 'final'] as const
type CarryStep = (typeof STICKY_STEP_VALUES)[number]
function isCarryStep(v: string | null | undefined): v is CarryStep {
  return !!v && (STICKY_STEP_VALUES as readonly string[]).includes(v)
}

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
  const t = useTranslations('v2Home')
  const router = useRouter()
  const searchParams = useSearchParams()
  const carryStepRaw = searchParams?.get('carryStep')
  // Used by "切專案" button to keep the user on the same step in the
  // newly chosen project. Only carry valid step ids; "home" never needs
  // a ?startAt= (home is the natural redirect target).
  const carryStep = isCarryStep(carryStepRaw) ? carryStepRaw : null
  // Phase 12.5 (2026-05-24) — workspace scope.
  // Absent => "個人" (caller's own projects).
  // `?ws=<id>` => projects in that workspace (gated server-side).
  const wsParam = searchParams?.get('ws') ?? null
  const { data: session, status } = useSession()
  // Role gate — admin sees 設定中心 + 管理後台, members see only the
  // logout button. Mirrors the Navbar contract.
  const role = (session?.user as { role?: string } | undefined)?.role
  const isAdmin = checkIsAdmin(role)
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
    async (page: number, search: string, ws: string | null) => {
      try {
        setLoading(true)
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })
        if (search.trim()) params.set('search', search.trim())
        if (ws) params.set('ws', ws)
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
    if (session) void fetchProjects(pagination.page, searchQuery, wsParam)
    // Reset to page 1 when ws changes — separate concern from fetch.
  }, [session, pagination.page, searchQuery, wsParam, fetchProjects])

  // When workspace switches, always start at page 1 (otherwise we'd ask
  // for page 5 of a workspace that only has 1 page of projects).
  useEffect(() => {
    setPagination((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }))
  }, [wsParam])

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
    const ok = confirm(t('grid.deleteConfirm', { name: project.name }))
    if (!ok) return
    setDeletingId(project.id)
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (!res.ok) {
        alert(t('grid.deleteFailed'))
        return
      }
      void fetchProjects(pagination.page, searchQuery, wsParam)
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
        {t('loading')}
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
              {t('header.brand')} <span className="not-italic font-serif-cn">{t('header.brandSubtitle')}</span>
            </div>
            <div className="mt-0.5 font-mono text-[14px] tracking-[0.2em] text-stone-400">
              {t('header.tagline')}
            </div>
          </div>
          <div className="flex items-center gap-3 font-mono text-[11px] tracking-wider">
            {/* Phase 12.5 — workspace switcher. URL-driven (?ws=). Mounted
                only on this page per spec §6.1 — project pages are
                inherently scoped to their project's workspace. */}
            <WorkspaceSwitcher activeWs={wsParam} locale={locale} />
            {/* Phase 12.5 — bell. Same component as project pages. */}
            <NotificationBell locale={locale} />
            <span className="text-stone-200">{session.user?.name ?? session.user?.email ?? ''}</span>
            {/* Phase T-3 (2026-05-27) — Playground / Freedom Mode entry
                point. Project-independent tool so it lives in the global
                header, not the per-project sidebar. Violet accent to
                visually separate from amber project actions. */}
            {/* 无限画布 — node-based canvas studio. Project-independent like
                Playground; sits just before it. */}
            <Link
              href={`/${locale}/canvas`}
              className="flex items-center gap-1 rounded-sm border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-cyan-300 transition-colors hover:bg-cyan-500/20 hover:border-cyan-400"
              title="无限画布 · 节点式创作台,导演台 3D 站位、分镜串接、生图生视频"
            >
              <AppIcon name="image" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">无限画布</span>
            </Link>
            <Link
              href={`/${locale}/live-composite`}
              aria-label="AI 實拍合成"
              className="flex items-center gap-1 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-emerald-300 transition-colors hover:border-emerald-400 hover:bg-emerald-500/20"
              title="AI 實拍合成 · 自動人物遮罩、手動畫筆修補、替換背景並輸出合成影片"
            >
              <AppIcon name="video" className="h-3.5 w-3.5" />
              <span className="hidden 2xl:inline">AI 實拍合成</span>
            </Link>
            <Link
              href={`/${locale}/playground`}
              className="flex items-center gap-1 rounded-sm border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-violet-300 transition-colors hover:bg-violet-500/20 hover:border-violet-400"
              title="創作 Playground · 不綁專案,直接上傳素材生成單張圖片或單支影片"
            >
              <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">創作 Playground</span>
            </Link>
            {/* 團隊 / Workspaces — visible to every signed-in role. The
                target page (/[locale]/workspaces) hides creation /
                management affordances when the requester isn't
                authorised, so it's safe to surface here without a
                role check. */}
            <Link
              href={`/${locale}/workspaces`}
              className="flex items-center gap-1 rounded-sm border border-stone-700 bg-stone-900/80 px-3 py-1.5 text-stone-200 transition-colors hover:border-amber-500 hover:text-amber-300"
              title={t('header.teamLinkTitle')}
            >
              <AppIcon name="userAlt" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('header.teamLink')}</span>
            </Link>
            {/* Admin-only nav: profile (provider keys + default models)
                and the admin console. Members hide both — their config
                cascades from admin so they never need /profile, and
                they have no business in /admin. Logout always shows. */}
            {isAdmin ? (
              <>
                <Link
                  href={`/${locale}/profile`}
                  className="flex items-center gap-1 rounded-sm border border-stone-700 bg-stone-900/80 px-3 py-1.5 text-stone-200 transition-colors hover:border-amber-500 hover:text-amber-300"
                  title={t('header.profileLinkTitle')}
                >
                  <AppIcon name="userRoundCog" className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('header.profileLink')}</span>
                </Link>
                <Link
                  href={`/${locale}/admin`}
                  className="flex items-center gap-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-amber-300 transition-colors hover:bg-amber-500/20"
                  title={t('header.adminLinkTitle')}
                >
                  <AppIcon name="badgeCheck" className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('header.adminLink')}</span>
                </Link>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: `/${locale}/auth/signin` })}
              className="rounded-sm border border-stone-600 bg-stone-900/80 px-3 py-1.5 text-stone-200 transition-colors hover:border-amber-500 hover:text-amber-300"
            >
              {t('header.logout')}
            </button>
          </div>
        </div>
      </header>

      <main className="px-12 py-10">
        {/* Phase 12.5 — one-shot intro banner. Dismissible, persists
            via cookie for 1 year. Renders above title so it's the
            first thing returning users see (then never again). */}
        <WorkspaceCollabIntroBanner />

        {/* Title row */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="font-mono text-[11px] tracking-[0.25em] text-amber-400">
              {t('title.kicker')}
            </div>
            <h1 className="mt-2 font-serif-cn text-3xl font-light text-white">
              {t('title.heading')}
            </h1>
            <p className="mt-1 font-fraunces text-sm italic text-stone-300">
              {t('title.subtitle')}
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
              placeholder={t('search.placeholder')}
              className="w-64 rounded-sm border border-stone-700 bg-stone-900/80 px-3 py-2 font-serif-cn text-sm text-stone-100 placeholder:text-stone-500 focus:border-amber-500 focus:outline-none"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={clearSearch}
                className="rounded-sm border border-stone-700 bg-stone-900/80 px-3 py-2 font-mono text-xs text-stone-300 transition-colors hover:border-stone-600 hover:text-white"
              >
                {t('search.clear')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleSearch}
              className="rounded-sm border border-amber-500/60 bg-amber-500/20 px-4 py-2 font-mono text-xs text-amber-300 transition-colors hover:border-amber-500 hover:bg-amber-500/30"
            >
              {t('search.search')}
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
              <span className="font-serif-cn text-base font-medium text-amber-300">{t('grid.newProject')}</span>
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
                  href={
                    carryStep
                      ? `/${locale}/v2/workspace/${project.id}?startAt=${carryStep}`
                      : `/${locale}/v2/workspace/${project.id}`
                  }
                  className="group relative flex h-44 flex-col rounded-sm border border-stone-700 bg-stone-900/70 p-5 transition-all hover:border-amber-500 hover:bg-stone-900/90"
                >
                  <button
                    type="button"
                    onClick={(e) => void handleDelete(project, e)}
                    disabled={deletingId === project.id}
                    className="absolute right-3 top-3 hidden h-7 w-7 items-center justify-center rounded-sm border border-stone-600 bg-stone-900 text-stone-300 transition-colors hover:border-rose-500 hover:bg-rose-500/20 hover:text-rose-200 group-hover:flex disabled:opacity-50"
                    title={t('grid.deleteTitle')}
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
                      {t('grid.untitledDraft')}
                    </p>
                  )}

                  <div className="mt-auto flex items-center justify-between font-mono text-[14px] text-stone-400">
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
              {searchQuery ? t('empty.noMatch') : t('empty.noneYet')}
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

/**
 * Phase 12.5 — URL-driven workspace switcher.
 *
 * State = `?ws=<workspaceId>` (absent = personal). React Query keys
 * include the ws value so the project list automatically refetches on
 * switch. router.replace keeps history clean (no back-button hell when
 * users flip workspaces several times in a row).
 *
 * Lazy-loads workspace list on first open. Personal mode is always
 * available as the top option.
 */
interface WorkspaceListItem {
  id: string
  name: string
  organizationName?: string | null
  projectCount?: number
}

function WorkspaceSwitcher({ activeWs, locale }: { activeWs: string | null; locale: string }) {
  const t = useTranslations('v2Home.switcher')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<WorkspaceListItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open || items !== null) return
    let cancelled = false
    setLoading(true)
    // /api/workspaces returns either
    //   { workspaces: [...] }                               (admin)
    //   { workspaces: [...], workspaceMemberships: [...] }  (member)
    // Workspaces include { organization: { name } } and _count.members
    // — flatten into the switcher item shape.
    interface RawWs {
      id: string
      name: string
      organization?: { name?: string | null } | null
      _count?: { members?: number; projects?: number } | null
    }
    fetch('/api/workspaces', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { workspaces?: RawWs[]; workspaceMemberships?: RawWs[] }) => {
        if (cancelled) return
        const owned = data.workspaces ?? []
        const member = data.workspaceMemberships ?? []
        // De-dupe by id (admin payload only has `workspaces`; member
        // payload puts owned + member in two separate keys, and shouldn't
        // overlap by design — but defensive dedupe is cheap).
        const seen = new Set<string>()
        const merged: WorkspaceListItem[] = []
        for (const w of [...owned, ...member]) {
          if (seen.has(w.id)) continue
          seen.add(w.id)
          merged.push({
            id: w.id,
            name: w.name,
            organizationName: w.organization?.name ?? null,
            projectCount: w._count?.projects ?? 0,
          })
        }
        setItems(merged)
      })
      .catch(() => {
        if (cancelled) return
        setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, items])

  const activeItem = items?.find((w) => w.id === activeWs) ?? null
  const buttonLabel = activeWs ? (activeItem?.name ?? t('title')) : t('personal')

  function switchTo(wsId: string | null) {
    const params = new URLSearchParams()
    if (wsId) params.set('ws', wsId)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : window.location.pathname)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-sm border border-stone-700 bg-stone-900/80 px-3 py-1.5 text-stone-200 transition-colors hover:border-amber-500 hover:text-amber-300"
        title={t('title')}
      >
        <AppIcon name="folder" className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{buttonLabel}</span>
        <AppIcon
          name="chevronDown"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-sm border border-amber-900/30 bg-stone-950 shadow-2xl">
          <div className="border-b border-amber-900/20 px-4 py-2 font-mono text-[14px] uppercase tracking-[0.2em] text-amber-600">
            {t('header')}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => switchTo(null)}
              className={`block w-full px-4 py-2 text-left font-serif-cn text-sm transition-colors hover:bg-amber-500/10 hover:text-amber-300 ${
                activeWs === null ? 'text-amber-300' : 'text-stone-300'
              }`}
            >
              {t('personal')} {activeWs === null ? t('checked') : ''}
            </button>
            <div className="my-1 border-t border-stone-800" />
            {loading ? (
              <div className="px-4 py-3 font-mono text-[14px] text-stone-500">{t('loading')}</div>
            ) : items && items.length > 0 ? (
              items.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => switchTo(w.id)}
                  className={`block w-full px-4 py-2 text-left font-serif-cn text-sm transition-colors hover:bg-amber-500/10 hover:text-amber-300 ${
                    activeWs === w.id ? 'text-amber-300' : 'text-stone-300'
                  }`}
                >
                  <div>
                    {w.name} {activeWs === w.id ? t('checked') : ''}
                  </div>
                  {w.organizationName ? (
                    <div className="font-fraunces text-[11px] italic text-stone-500">
                      {w.organizationName}
                      {w.projectCount ? ` · ${t('projectCount', { count: w.projectCount })}` : ''}
                    </div>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="px-4 py-3 font-fraunces text-xs italic text-stone-500">
                {t('noJoinable')}
              </div>
            )}
          </div>
          <div className="border-t border-amber-900/20">
            <Link
              href={`/${locale}/workspaces`}
              className="block px-4 py-2 font-mono text-[11px] tracking-wider text-amber-500/70 transition-colors hover:bg-amber-500/10 hover:text-amber-300"
              onClick={() => setOpen(false)}
            >
              {t('manageLink')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}
