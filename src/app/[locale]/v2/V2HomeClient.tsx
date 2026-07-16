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
import { V2HomeRail } from './V2HomeRail'
import { V2WorkflowLauncher } from './V2WorkflowLauncher'
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
      <div className="kuiper-stage flex min-h-screen items-center justify-center font-mono text-xs tracking-wider text-text-tertiary">
        {t('loading')}
      </div>
    )
  }

  return (
    <div className="kuiper-stage min-h-screen pb-24 text-text-primary lg:pb-0 lg:pl-[88px]">
      <V2HomeRail locale={locale} />

      {/* Top header */}
      <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#050506]/88 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-9">
        <div className="mx-auto flex max-w-[1540px] items-center justify-between gap-5">
          <Link href={`/${locale}/v2`} className="group min-w-0">
            <div className="flex items-baseline gap-2">
              <div className="font-display text-xl font-bold italic tracking-tight text-primary-400 transition-colors group-hover:text-primary-300 sm:text-2xl">
                {t('header.brand')}
              </div>
              <span className="font-serif-cn text-sm font-semibold text-text-primary sm:text-base">
                {t('header.brandSubtitle')}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[9px] tracking-[0.22em] text-text-tertiary sm:text-[10px]">
              {t('header.tagline')}
            </div>
          </Link>

          <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] tracking-wider">
            {/* Phase 12.5 — workspace switcher. URL-driven (?ws=). Mounted
                only on this page per spec §6.1 — project pages are
                inherently scoped to their project's workspace. */}
            <WorkspaceSwitcher activeWs={wsParam} locale={locale} />
            {/* Phase 12.5 — bell. Same component as project pages. */}
            <NotificationBell locale={locale} />
            <span className="hidden max-w-36 truncate text-text-secondary xl:inline">
              {session.user?.name ?? session.user?.email ?? ''}
            </span>
            <Link
              href={`/${locale}/workspaces`}
              className="hidden items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400 sm:flex"
              title={t('header.teamLinkTitle')}
            >
              <AppIcon name="userAlt" className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">{t('header.teamLink')}</span>
            </Link>
            {isAdmin ? (
              <>
                <Link
                  href={`/${locale}/profile`}
                  className="hidden h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400 md:flex"
                  title={t('header.profileLinkTitle')}
                >
                  <AppIcon name="userRoundCog" className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href={`/${locale}/admin`}
                  className="hidden h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400 md:flex"
                  title={t('header.adminLinkTitle')}
                >
                  <AppIcon name="badgeCheck" className="h-3.5 w-3.5" />
                </Link>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: `/${locale}/auth/signin` })}
              aria-label={t('header.logout')}
              title={t('header.logout')}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400"
            >
              <AppIcon name="logout" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1540px] px-4 py-8 sm:px-6 lg:px-9 lg:py-10">
        {/* Phase 12.5 — one-shot intro banner. Dismissible, persists
            via cookie for 1 year. Renders above title so it's the
            first thing returning users see (then never again). */}
        <WorkspaceCollabIntroBanner />

        {/* Title row */}
        <section className="mb-9 overflow-hidden rounded-[28px] border border-white/[0.08] bg-gradient-to-br from-[#171318] via-[#111113] to-[#0b0b0d] px-6 py-7 sm:px-8 sm:py-9">
          <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="font-mono text-[10px] tracking-[0.25em] text-primary-400">
                {t('title.kicker')}
              </div>
              <h1 className="mt-3 max-w-2xl font-serif-cn text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                {t('title.heading')}
              </h1>
              <p className="mt-2 max-w-2xl font-serif-cn text-sm leading-6 text-text-secondary">
                {t('title.subtitle')}
              </p>
            </div>

            <div className="flex w-full max-w-lg items-center gap-2 rounded-2xl border border-white/[0.09] bg-black/30 p-1.5">
              <AppIcon name="search" className="ml-2 h-4 w-4 shrink-0 text-text-tertiary" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
                placeholder={t('search.placeholder')}
                aria-label={t('search.placeholder')}
                className="min-w-0 flex-1 bg-transparent px-1 py-2 font-serif-cn text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="rounded-xl px-3 py-2 font-mono text-[10px] text-text-secondary transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  {t('search.clear')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleSearch}
                className="kuiper-primary-button rounded-xl px-4 py-2 font-mono text-[10px] font-semibold"
              >
                {t('search.search')}
              </button>
            </div>
          </div>
        </section>

        <V2WorkflowLauncher locale={locale} />

        {/* Project grid */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif-cn text-lg font-semibold text-text-primary">{t('grid.recentProjects')}</h2>
          <span className="font-mono text-[10px] tracking-[0.16em] text-text-tertiary">
            {pagination.total} PROJECTS
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {/* + New project card */}
          <Link
            href={`/${locale}/v2/new`}
            className="group flex min-h-52 items-center justify-center rounded-2xl border border-primary-500/70 bg-primary-500/[0.06] transition-all hover:-translate-y-0.5 hover:border-primary-400 hover:bg-primary-500/[0.11]"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-500 text-black transition-transform group-hover:scale-105">
                <AppIcon name="plus" className="h-5 w-5" />
              </div>
              <span className="font-serif-cn text-sm font-semibold text-primary-300">{t('grid.newProject')}</span>
            </div>
          </Link>

          {/* Loading skeletons */}
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="min-h-52 animate-pulse rounded-2xl border border-white/[0.07] bg-white/[0.04]" />
              ))
            : formatted.map((project) => (
                <Link
                  key={project.id}
                  href={
                    carryStep
                      ? `/${locale}/v2/workspace/${project.id}?startAt=${carryStep}`
                      : `/${locale}/v2/workspace/${project.id}`
                  }
                  className="kuiper-panel-interactive group relative flex min-h-52 flex-col overflow-hidden rounded-2xl p-5"
                >
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary-500/0 to-transparent transition-all group-hover:via-primary-500/80" />
                  <button
                    type="button"
                    onClick={(e) => void handleDelete(project, e)}
                    disabled={deletingId === project.id}
                    className="absolute right-3 top-3 hidden h-8 w-8 items-center justify-center rounded-xl border border-white/[0.08] bg-black/40 text-text-secondary transition-colors hover:border-rose-500/50 hover:bg-rose-500/15 hover:text-rose-200 group-hover:flex disabled:opacity-50"
                    title={t('grid.deleteTitle')}
                  >
                    <AppIcon name="trash" className="h-3.5 w-3.5" />
                  </button>

                  <div className="pr-9 font-serif-cn text-lg font-semibold text-white transition-colors group-hover:text-primary-300">
                    {project.name}
                  </div>

                  {project.description || project.stats?.firstEpisodePreview ? (
                    <p className="mt-3 line-clamp-3 font-serif-cn text-xs leading-5 text-text-secondary">
                      {project.description || project.stats?.firstEpisodePreview}
                    </p>
                  ) : (
                    <p className="mt-3 font-serif-cn text-xs text-text-tertiary">
                      {t('grid.untitledDraft')}
                    </p>
                  )}

                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-white/[0.06] pt-4 font-mono text-[10px] text-text-tertiary">
                    <div className="flex items-center gap-3">
                      {project.stats?.episodes ? (
                        <span className="flex items-center gap-1">
                          <AppIcon name="bookOpen" className="h-3 w-3 text-primary-400/80" />
                          {project.stats.episodes}
                        </span>
                      ) : null}
                      {project.stats?.images ? (
                        <span className="flex items-center gap-1">
                          <AppIcon name="image" className="h-3 w-3 text-primary-400/80" />
                          {project.stats.images}
                        </span>
                      ) : null}
                      {project.stats?.videos ? (
                        <span className="flex items-center gap-1">
                          <AppIcon name="film" className="h-3 w-3 text-primary-400/80" />
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
          <div className="mt-16 text-center font-serif-cn text-text-tertiary">
            <p>
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
              className="rounded-xl border border-white/[0.08] px-3 py-2 text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ←
            </button>
            <span className="px-3 text-text-tertiary">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
              className="rounded-xl border border-white/[0.08] px-3 py-2 text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400 disabled:cursor-not-allowed disabled:opacity-40"
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
        className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400"
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
        <div className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-2xl border border-white/[0.09] bg-[#111113] shadow-2xl">
          <div className="border-b border-white/[0.07] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-primary-400">
            {t('header')}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => switchTo(null)}
              className={`block w-full px-4 py-2.5 text-left font-serif-cn text-sm transition-colors hover:bg-primary-500/10 hover:text-primary-300 ${
                activeWs === null ? 'text-primary-300' : 'text-text-secondary'
              }`}
            >
              {t('personal')} {activeWs === null ? t('checked') : ''}
            </button>
            <div className="my-1 border-t border-white/[0.07]" />
            {loading ? (
              <div className="px-4 py-3 font-mono text-[10px] text-text-tertiary">{t('loading')}</div>
            ) : items && items.length > 0 ? (
              items.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => switchTo(w.id)}
                  className={`block w-full px-4 py-2.5 text-left font-serif-cn text-sm transition-colors hover:bg-primary-500/10 hover:text-primary-300 ${
                    activeWs === w.id ? 'text-primary-300' : 'text-text-secondary'
                  }`}
                >
                  <div>
                    {w.name} {activeWs === w.id ? t('checked') : ''}
                  </div>
                  {w.organizationName ? (
                    <div className="mt-0.5 font-mono text-[9px] text-text-tertiary">
                      {w.organizationName}
                      {w.projectCount ? ` · ${t('projectCount', { count: w.projectCount })}` : ''}
                    </div>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="px-4 py-3 font-serif-cn text-xs text-text-tertiary">
                {t('noJoinable')}
              </div>
            )}
          </div>
          <div className="border-t border-white/[0.07]">
            <Link
              href={`/${locale}/workspaces`}
              className="block px-4 py-3 font-mono text-[10px] tracking-wider text-primary-400 transition-colors hover:bg-primary-500/10 hover:text-primary-300"
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
