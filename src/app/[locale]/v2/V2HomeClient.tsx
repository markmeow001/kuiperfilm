'use client'

/**
 * Phase 12.x.x — v2 root page (project list + entry to new project flow).
 *
 * Replaces /[locale]/workspace as the canonical entry point. Stays in
 * the shared studio-dark palette so project management and media work
 * read as one continuous production environment.
 * so users never see the Phase-11 frosted-blue dashboard.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { NotificationBell } from '@/components/v2/NotificationBell'
import { WorkspaceCollabIntroBanner } from './WorkspaceCollabIntroBanner'
import { V2HomeRail } from './V2HomeRail'
import { V2WorkflowLauncher } from './V2WorkflowLauncher'
import { ProjectCard } from './ProjectCard'
import { isAdmin as checkIsAdmin } from '@/lib/auth/user-role'
import { PageHeader } from '@/components/v2/PageHeader'
import { UiStatePanel } from '@/components/v2/UiStatePanel'
import studioStyles from './StudioShell.module.css'

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
  lastStep: string | null
  effectiveRole: 'owner' | 'admin' | 'ws_owner' | 'ws_owner_legacy' | 'editor' | 'viewer'
  canEdit: boolean
  canDelete: boolean
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
  const [projectsError, setProjectsError] = useState<Error | true | null>(null)
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0,
  })
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const projectRequestSequenceRef = useRef(0)

  // Auth gate.
  useEffect(() => {
    if (status === 'loading') return
    if (!session) router.push(`/${locale}/auth/signin`)
  }, [session, status, router, locale])

  const fetchProjects = useCallback(
    async (page: number, search: string, ws: string | null) => {
      const requestSequence = ++projectRequestSequenceRef.current
      try {
        setLoading(true)
        setProjectsError(null)
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })
        if (search.trim()) params.set('search', search.trim())
        if (ws) params.set('ws', ws)
        const res = await fetch(`/api/projects?${params}`)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data = (await res.json()) as { projects: ProjectRow[]; pagination: Pagination }
        if (requestSequence !== projectRequestSequenceRef.current) return
        setProjects(data.projects)
        setPagination(data.pagination)
      } catch (error) {
        if (requestSequence !== projectRequestSequenceRef.current) return
        setProjectsError(error instanceof Error ? error : true)
      } finally {
        if (requestSequence === projectRequestSequenceRef.current) {
          setLoading(false)
        }
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

  async function handleDelete(project: ProjectRow) {
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
      updated: new Date(p.updatedAt).toLocaleString(locale === 'en' ? 'en-US' : 'zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }),
    }))
  }, [locale, projects])

  function roleLabel(project: ProjectRow) {
    switch (project.effectiveRole) {
      case 'owner':
        return t('grid.roleOwner')
      case 'admin':
        return t('grid.roleAdmin')
      case 'ws_owner':
      case 'ws_owner_legacy':
        return t('grid.roleWorkspaceOwner')
      case 'editor':
        return t('grid.roleEditor')
      case 'viewer':
        return t('grid.roleViewer')
      default:
        return t('grid.roleUnknown')
    }
  }

  if (status === 'loading' || !session) {
    return (
      <div
        className={`${studioStyles.studioRoot} ${studioStyles.canvasAtmosphere} kuiper-dashboard flex min-h-screen items-center justify-center font-mono text-xs tracking-wider text-[var(--production-ink-muted)]`}
        data-studio-theme="dark"
      >
        {t('loading')}
      </div>
    )
  }

  return (
    <div
      className={`${studioStyles.studioRoot} ${studioStyles.canvasAtmosphere} kuiper-dashboard min-h-screen pb-24 lg:pb-0 lg:pl-[76px] xl:pl-[272px]`}
      data-studio-theme="dark"
    >
      <V2HomeRail locale={locale} />

      {/* Top header */}
      <header className="kuiper-dashboard-topbar sticky top-0 z-30 border-b px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[52px] max-w-[1540px] items-center justify-between gap-5">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-[var(--darkroom-text)]">
              {t('title.heading')}
            </div>
            <div className="mt-0.5 hidden truncate font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--darkroom-muted)] sm:block">
              {t('header.tagline')}
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] tracking-wider">
            {/* Phase 12.5 — workspace switcher. URL-driven (?ws=). Mounted
                only on this page per spec §6.1 — project pages are
                inherently scoped to their project's workspace. */}
            <WorkspaceSwitcher activeWs={wsParam} locale={locale} />
            {/* Phase 12.5 — bell. Same component as project pages. */}
            <NotificationBell locale={locale} />
            <span className="hidden max-w-36 truncate text-[var(--darkroom-muted)] xl:inline">
              {session.user?.name ?? session.user?.email ?? ''}
            </span>
            <Link
              href={`/${locale}/workspaces`}
              className="kuiper-shell-control hidden items-center gap-1.5 px-3 py-2 text-[13px] sm:flex"
              title={t('header.teamLinkTitle')}
            >
              <AppIcon name="userAlt" className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">{t('header.teamLink')}</span>
            </Link>
            {isAdmin ? (
              <>
                <Link
                  href={`/${locale}/profile`}
                  className="kuiper-shell-control hidden h-11 w-11 items-center justify-center md:flex"
                  title={t('header.profileLinkTitle')}
                >
                  <AppIcon name="userRoundCog" className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href={`/${locale}/admin`}
                  className="kuiper-shell-control hidden h-11 w-11 items-center justify-center md:flex"
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
              className="kuiper-shell-control flex h-11 w-11 items-center justify-center"
            >
              <AppIcon name="logout" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="kuiper-dashboard-main mx-auto max-w-[1540px] px-4 py-7 sm:px-6 lg:px-8 lg:py-9">
        {/* Phase 12.5 — one-shot intro banner. Dismissible, persists
            via cookie for 1 year. Renders above title so it's the
            first thing returning users see (then never again). */}
        <WorkspaceCollabIntroBanner />

        {/* Title and project actions */}
        <section className="mb-9 border-b border-[var(--production-border)] pb-8">
          <PageHeader
            eyebrow={t('title.kicker')}
            title={t('title.heading')}
            description={t('title.subtitle')}
            actions={(
              <Link
                href={`/${locale}/v2/new`}
                className="kuiper-dashboard-primary inline-flex min-h-11 items-center gap-2 px-4 text-[14px]"
              >
                <AppIcon name="plus" className="h-4 w-4" />
                {t('grid.newProject')}
              </Link>
            )}
          />

          <div className="mt-6 flex w-full max-w-2xl items-center gap-2 rounded-xl border border-[var(--production-border)] bg-[var(--production-surface)] p-1.5 focus-within:border-[var(--production-focus)] focus-within:ring-4 focus-within:ring-[rgba(85,175,192,0.12)]">
              <AppIcon name="search" className="ml-2 h-4 w-4 shrink-0 text-text-tertiary" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
                placeholder={t('search.placeholder')}
                aria-label={t('search.placeholder')}
                className="min-w-0 flex-1 bg-transparent px-1 py-2 text-[14px] text-[var(--production-ink)] placeholder:text-[var(--production-ink-muted)] focus:outline-none"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="min-h-11 rounded-lg px-3 py-2 text-[12px] text-[var(--production-ink-muted)] transition-colors hover:bg-[var(--production-muted)] hover:text-[var(--production-ink)]"
                >
                  {t('search.clear')}
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleSearch}
                className="kuiper-dashboard-primary px-4 py-2 text-[13px]"
              >
                {t('search.search')}
              </button>
          </div>
        </section>

        <V2WorkflowLauncher locale={locale} />

        {projectsError ? (
          <UiStatePanel
            state="error"
            locale={locale}
            compact
            className="mb-6"
            title={t('errors.loadTitle')}
            description={t('errors.loadDescription')}
            details={
              projectsError instanceof Error
                ? projectsError.message
                : t('errors.unknown')
            }
            primaryAction={
              <button
                type="button"
                className="kuiper-dashboard-primary px-4 text-[13px]"
                onClick={() => void fetchProjects(pagination.page, searchQuery, wsParam)}
              >
                {t('errors.retry')}
              </button>
            }
          />
        ) : null}

        {/* Project grid */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[19px] font-semibold text-[var(--production-ink)]">{t('grid.recentProjects')}</h2>
          <span className="font-mono text-[11px] tracking-[0.14em] text-[var(--production-ink-muted)]">
            {pagination.total} PROJECTS
          </span>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {/* + New project card */}
          <Link
            href={`/${locale}/v2/new`}
            className="group flex min-h-52 items-center justify-center rounded-[14px] border border-dashed border-[color-mix(in_srgb,var(--production-blue)_48%,transparent)] bg-[var(--production-blue-soft)] transition-all hover:-translate-y-0.5 hover:border-[var(--production-blue)] hover:bg-[color-mix(in_srgb,var(--production-blue-soft)_78%,var(--production-muted))]"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--production-blue)] text-white transition-transform group-hover:scale-105">
                <AppIcon name="plus" className="h-5 w-5" />
              </div>
              <span className="text-[14px] font-semibold text-[var(--production-ink)]">{t('grid.newProject')}</span>
            </div>
          </Link>

          {/* Loading skeletons */}
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="min-h-52 animate-pulse rounded-[14px] border border-[var(--production-border)] bg-[var(--production-surface)]" />
              ))
            : formatted.map((project) => {
                const rememberedStep = isCarryStep(project.lastStep) ? project.lastStep : null
                const continueStep = carryStep ?? rememberedStep ?? 'script'
                const overviewHref = `/${locale}/v2/workspace/${project.id}?stay=1`
                const continueHref = `/${locale}/v2/workspace/${project.id}?startAt=${continueStep}`

                return (
                  <ProjectCard
                    key={project.id}
                    project={{
                      ...project,
                      canDelete: project.canDelete === true,
                      roleLabel: roleLabel(project),
                    }}
                    overviewHref={overviewHref}
                    continueHref={continueHref}
                    overviewLabel={t('grid.openOverview')}
                    continueLabel={t('grid.continueProject')}
                    deleteLabel={t('grid.deleteTitle')}
                    untitledDraftLabel={t('grid.untitledDraft')}
                    deleting={deletingId === project.id}
                    onDelete={() => void handleDelete(project)}
                  />
                )
              })}
        </div>

        {!loading && !projectsError && projects.length === 0 ? (
          <div className="mt-16 text-center text-[var(--production-ink-muted)]">
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
              className="kuiper-dashboard-secondary min-h-11 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ←
            </button>
            <span className="px-3 text-[var(--production-ink-muted)]">
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
              className="kuiper-dashboard-secondary min-h-11 px-3 py-2 disabled:cursor-not-allowed disabled:opacity-40"
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
  const [loadError, setLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open || items !== null) return
    let cancelled = false
    setLoading(true)
    setLoadError(false)
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
        setLoadError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, items, loadAttempt])

  const activeItem = items?.find((w) => w.id === activeWs) ?? null
  const buttonLabel = activeWs ? (activeItem?.name ?? t('title')) : t('personal')

  function switchTo(wsId: string | null) {
    const params = new URLSearchParams()
    if (wsId) params.set('ws', wsId)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : window.location.pathname)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${t('title')}: ${buttonLabel}`}
        className="kuiper-shell-control flex items-center gap-1.5 px-3 py-2 text-[13px]"
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
        <div
          id={panelId}
          className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-[14px] border border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] shadow-[0_16px_40px_rgba(3,8,12,0.32)]"
        >
          <div className="border-b border-[var(--darkroom-border)] px-4 py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--process-cyan-strong)]">
            {t('header')}
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => switchTo(null)}
              className={`block min-h-11 w-full px-4 py-2.5 text-left text-[14px] transition-colors hover:bg-[var(--process-cyan-soft)] hover:text-[var(--darkroom-text)] ${
                activeWs === null ? 'font-semibold text-[var(--process-cyan-strong)]' : 'text-[var(--darkroom-muted)]'
              }`}
            >
              {t('personal')} {activeWs === null ? t('checked') : ''}
            </button>
            <div className="my-1 border-t border-[var(--darkroom-border)]" />
            {loading ? (
              <div className="px-4 py-3 font-mono text-[10px] text-[var(--darkroom-muted)]">{t('loading')}</div>
            ) : loadError ? (
              <div role="alert" className="px-4 py-3 text-[13px] text-[var(--darkroom-muted)]">
                <div>{t('loadError')}</div>
                <button
                  type="button"
                  onClick={() => setLoadAttempt((current) => current + 1)}
                  className="mt-2 min-h-11 rounded-xl border border-[var(--process-cyan)]/45 bg-[var(--process-cyan-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--process-cyan-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--process-cyan)]"
                >
                  {t('retry')}
                </button>
              </div>
            ) : items && items.length > 0 ? (
              items.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => switchTo(w.id)}
                  className={`block min-h-11 w-full px-4 py-2.5 text-left text-[14px] transition-colors hover:bg-[var(--process-cyan-soft)] hover:text-[var(--darkroom-text)] ${
                    activeWs === w.id ? 'font-semibold text-[var(--process-cyan-strong)]' : 'text-[var(--darkroom-muted)]'
                  }`}
                >
                  <div>
                    {w.name} {activeWs === w.id ? t('checked') : ''}
                  </div>
                  {w.organizationName ? (
                    <div className="mt-0.5 font-mono text-[10px] text-[var(--darkroom-muted)]">
                      {w.organizationName}
                      {w.projectCount ? ` · ${t('projectCount', { count: w.projectCount })}` : ''}
                    </div>
                  ) : null}
                </button>
              ))
            ) : (
              <div className="px-4 py-3 text-[13px] text-[var(--darkroom-muted)]">
                {t('noJoinable')}
              </div>
            )}
          </div>
          <div className="border-t border-[var(--darkroom-border)]">
            <Link
              href={`/${locale}/workspaces`}
              className="block min-h-11 px-4 py-3 font-mono text-[11px] font-semibold tracking-wider text-[var(--process-cyan-strong)] transition-colors hover:bg-[var(--process-cyan-soft)]"
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
