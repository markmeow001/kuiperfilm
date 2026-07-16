'use client'

/**
 * Phase 12 — v2 workspace top bar.
 *
 * Ported from ~/Downloads/kino_mockup.jsx TopBar(): renders STEP NN —
 * SUBTITLE caption on the left, project title + DRAFT NN/06 on the
 * right, and a 6-segment progress strip below.
 *
 * If projectId is supplied the project name is fetched live (via
 * useProjectData) so callers don't have to thread it through.
 *
 * The project title in the right rail is now a clickable dropdown that
 * lists the user's other projects so they can switch directly without
 * going back to /v2.
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { UserRole } from '@/lib/auth/user-role'
import { useProjectAccess, type ProjectAccessRole } from '@/lib/query/hooks/useProjectAccess'
import { AppIcon } from '@/components/ui/icons'
import { UserMenu } from './UserMenu'
import { NotificationBell } from './NotificationBell'
import { RequestEditAccessModal } from './RequestEditAccessModal'
import { findV2Step, V2_STEPS, v2StepIndex, type V2StepId } from './v2-types'

interface TopBarProps {
  currentStep: V2StepId
  projectId?: string
  /** Override the live project name lookup. */
  projectName?: string
  /** Optional draft number (default 01). Matched by the DRAFT NN/06 caption. */
  draftNumber?: number
}

interface ProjectShape {
  name?: string | null
}

interface ProjectListRow {
  id: string
  name: string
  updatedAt: string
}

export function TopBar({ currentStep, projectId, projectName, draftNumber }: TopBarProps) {
  const params = useParams<{ locale?: string }>()
  const locale = params?.locale ?? 'zh'
  const tTopbar = useTranslations('collab.topbar')
  const projectQuery = useProjectData(projectId ?? null)
  const liveName = (projectQuery.data as ProjectShape | undefined)?.name ?? null
  const resolvedName = projectName ?? liveName ?? tTopbar('untitledProject')
  const step = findV2Step(currentStep)
  const stepIdx = v2StepIndex(currentStep)
  const totalSteps = V2_STEPS.length
  const draftLabel = String(draftNumber ?? 1).padStart(2, '0')

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#050506]/88 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-h-[72px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <div className="shrink-0">
            <div className="font-mono text-[9px] tracking-[0.22em] text-primary-500">
              STEP {step.num}
            </div>
            <h1 className="mt-1 flex items-baseline gap-2 font-serif-cn text-lg font-semibold text-text-primary">
              {step.label}
              <span className="hidden font-display text-sm font-normal italic text-text-tertiary sm:inline">
                {step.subtitle}
              </span>
            </h1>
          </div>
          <div className="hidden h-8 w-px bg-white/[0.08] sm:block" />
          <ProjectSwitcher
            currentProjectId={projectId}
            currentProjectName={resolvedName}
            locale={locale}
            draftLabel={draftLabel}
            totalSteps={totalSteps}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* Phase 12.5 (2026-05-22) — role badge.
              Only renders when projectId is supplied (i.e. inside a
              project, not on /v2 home). Tells the user at a glance
              whether they own / admin / edit / view this project. */}
          {projectId ? (
            <RoleBadgeWithRequest projectId={projectId} projectName={resolvedName} />
          ) : null}
          {/* Phase 12.5 — notification bell. Mounted on every page so
              owners get incoming requests anywhere they navigate. */}
          <NotificationBell locale={locale} />
          <UserMenu locale={locale} />
        </div>
      </div>

      <div className="flex items-center gap-1 pb-2">
        {V2_STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`h-0.5 flex-1 rounded-full transition-all ${
              i <= stepIdx ? 'bg-primary-500' : 'bg-stone-800'
            }`}
          />
        ))}
      </div>
    </header>
  )
}

interface ProjectSwitcherProps {
  currentProjectId?: string
  currentProjectName: string
  locale: string
  draftLabel: string
  totalSteps: number
}

function ProjectSwitcher({
  currentProjectId,
  currentProjectName,
  locale,
  draftLabel,
  totalSteps,
}: ProjectSwitcherProps) {
  const t = useTranslations('collab.topbar')
  const [open, setOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectListRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  // Infer the current step from the URL so switching projects keeps the
  // user in the same step instead of dumping them to project home.
  // Pathname is /<locale>/v2/workspace/<projectId>(/<step>)?(?tab=...)?
  // — we only honour known step segments to avoid forwarding garbage.
  const currentStepSegment = (() => {
    if (!pathname) return ''
    const parts = pathname.split('/').filter(Boolean)
    const wsIdx = parts.findIndex((p) => p === 'workspace')
    if (wsIdx === -1 || wsIdx + 2 >= parts.length) return ''
    const step = parts[wsIdx + 2]
    const known = ['script', 'subjects', 'storyboard', 'voice', 'final']
    return known.includes(step) ? step : ''
  })()

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Lazy fetch the project list the first time the dropdown opens
  useEffect(() => {
    if (!open || projects !== null) return
    let cancelled = false
    setLoading(true)
    fetch('/api/projects?pageSize=50', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { projects?: ProjectListRow[] }) => {
        if (cancelled) return
        setProjects(data.projects ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setProjects([])
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, projects])

  const otherProjects = (projects ?? []).filter((p) => p.id !== currentProjectId)

  return (
    <div ref={ref} className="relative text-right">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 transition-colors hover:border-primary-500/35 hover:bg-white/[0.06]"
        title={t('switchProject')}
      >
        <AppIcon name="folderOpen" className="hidden h-4 w-4 shrink-0 text-text-tertiary sm:block" />
        <div className="min-w-0 text-left">
          <div className="max-w-28 truncate font-serif-cn text-xs text-text-secondary group-hover:text-primary-300 sm:max-w-48">
            {currentProjectName}
          </div>
          <div className="mt-0.5 hidden font-mono text-[9px] tracking-[0.14em] text-text-tertiary sm:block">
            {t('draftFormat', { current: draftLabel, total: String(totalSteps).padStart(2, '0') })}
          </div>
        </div>
        <AppIcon
          name="chevronDown"
          className={`h-3 w-3 text-stone-500 transition-transform group-hover:text-primary-400 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-2xl border border-white/[0.09] bg-overlay shadow-2xl">
          <div className="border-b border-white/[0.07] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.2em] text-primary-400">
            {t('switchProject')}
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {loading ? (
              <div className="px-4 py-3 font-mono text-[11px] tracking-wider text-text-tertiary">
                {t('loading')}
              </div>
            ) : otherProjects.length === 0 ? (
              <div className="px-4 py-3 font-fraunces text-xs italic text-text-tertiary">
                {projects === null ? t('loading') : t('noOtherProjects')}
              </div>
            ) : (
              otherProjects.map((p) => (
                <Link
                  key={p.id}
                  href={`/${locale}/v2/workspace/${p.id}${currentStepSegment ? `/${currentStepSegment}` : ''}`}
                  className="block px-4 py-2.5 font-serif-cn text-sm text-text-secondary transition-colors hover:bg-primary-500/10 hover:text-primary-300"
                  onClick={() => setOpen(false)}
                >
                  {p.name || t('untitledProject')}
                </Link>
              ))
            )}
          </div>

          <div className="border-t border-white/[0.07]">
            <Link
              href={`/${locale}/v2`}
              className="block px-4 py-2.5 font-serif-cn text-sm text-primary-400 transition-colors hover:bg-primary-500/10"
              onClick={() => setOpen(false)}
            >
              {t('newOrAllProjects')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Phase 12.5 (2026-05-22) — role badge.
 *
 * Tells the user at a glance what role they hold on the current project.
 * Drives a few user behaviours:
 *   - OWNER / ADMIN see all editing buttons enabled (matches their role)
 *   - EDITOR sees the same as owner — they can edit anything in the
 *     workspace they share with the owner
 *   - VIEWER sees disabled buttons + "請求編輯權限" tooltip; the badge
 *     confirms WHY their buttons are greyed out (otherwise users blame
 *     the app for being broken)
 *
 * Color palette intentionally mirrors role authority:
 *   - ADMIN: rose (different from anything else — sys admin is special)
 *   - OWNER: amber filled (you own this)
 *   - EDITOR: amber outline (workspace-granted RW)
 *   - VIEWER: stone (read-only, low contrast on purpose)
 *
 * Renders nothing while loading or on 403 — better than flashing
 * the wrong role for a beat.
 */
function RoleBadge({ projectId }: { projectId: string }) {
  const access = useProjectAccess(projectId)
  const t = useTranslations('collab.roleBadge')
  if (access.isLoading || !access.allowed || !access.role) return null

  const { label, className, title } = roleBadgeStyle(access.role, access.canEdit, t)
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.2em] ${className}`}
    >
      {label}
    </span>
  )
}

/**
 * Phase 12.5 — role badge + viewer's "請求編輯權限" CTA in one cluster.
 *
 * Why combined: putting the request button next to the role pill is the
 * most discoverable place for viewers. Inline-tooltip on every disabled
 * edit button (the original spec) would be more contextual but requires
 * threading state through every page — and viewers can find this once,
 * remember it, click it from anywhere.
 *
 * Re-fetches access on modal close so a freshly-approved request flips
 * the page to editable without a manual reload.
 */
function RoleBadgeWithRequest({
  projectId,
  projectName,
}: {
  projectId: string
  projectName: string
}) {
  const access = useProjectAccess(projectId)
  const t = useTranslations('collab.roleBadge')
  const [requestOpen, setRequestOpen] = useState(false)

  if (access.isLoading || !access.allowed || !access.role) return null

  const isViewer = access.role === UserRole.VIEWER

  return (
    <>
      <RoleBadge projectId={projectId} />
      {isViewer ? (
        <button
          type="button"
          onClick={() => setRequestOpen(true)}
          className="rounded-sm border border-primary-500/40 bg-primary-500/5 px-2 py-0.5 font-mono text-[11px] tracking-wider text-primary-300 transition-colors hover:bg-primary-500/15"
          title={t('requestEditTitle')}
        >
          {t('requestEdit')}
        </button>
      ) : null}
      {requestOpen ? (
        <RequestEditAccessModal
          projectId={projectId}
          projectName={projectName}
          onClose={() => {
            setRequestOpen(false)
            // If user just got approved, refetch so UI flips editable.
            access.refetch()
          }}
        />
      ) : null}
    </>
  )
}

type RoleBadgeT = ReturnType<typeof useTranslations>

function roleBadgeStyle(role: ProjectAccessRole, canEdit: boolean, t: RoleBadgeT): {
  label: string
  className: string
  title: string
} {
  if (role === UserRole.ADMIN) {
    return {
      label: t('admin'),
      className: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
      title: t('adminTitle'),
    }
  }
  if (role === UserRole.OWNER) {
    return {
      label: t('owner'),
      className: 'border-primary-500/60 bg-primary-500/15 text-primary-200',
      title: t('ownerTitle'),
    }
  }
  if (role === 'ws_owner' || role === 'ws_owner_legacy') {
    return {
      label: t('editor'),
      className: 'border-primary-500/40 bg-primary-500/5 text-primary-300',
      title: t('wsOwnerTitle'),
    }
  }
  if (role === UserRole.EDITOR || canEdit) {
    return {
      label: t('editor'),
      className: 'border-primary-500/40 bg-primary-500/5 text-primary-300',
      title: t('editorTitle'),
    }
  }
  // viewer
  return {
    label: t('viewer'),
    className: 'border-stone-700 bg-stone-900/40 text-stone-400',
    title: t('viewerTitle'),
  }
}
