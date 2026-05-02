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
import { useProjectData } from '@/lib/query/hooks/useProjectData'
import { AppIcon } from '@/components/ui/icons'
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
  const projectQuery = useProjectData(projectId ?? null)
  const liveName = (projectQuery.data as ProjectShape | undefined)?.name ?? null
  const resolvedName = projectName ?? liveName ?? '未命名劇本'
  const step = findV2Step(currentStep)
  const stepIdx = v2StepIndex(currentStep)
  const totalSteps = V2_STEPS.length
  const draftLabel = String(draftNumber ?? 1).padStart(2, '0')

  return (
    <div className="border-b border-amber-900/15 px-12 pt-8 pb-6">
      <div className="flex items-end justify-between gap-6">
        <div>
          <div className="mb-2 font-mono text-[11px] tracking-[0.3em] text-amber-600/80">
            STEP {step.num} — {step.subtitle.toUpperCase()}
          </div>
          <h1 className="font-serif-cn text-4xl font-medium tracking-wide text-stone-100">
            {step.label}
            <span className="ml-3 font-display text-2xl font-normal italic text-amber-500/70">
              {step.subtitle}
            </span>
          </h1>
        </div>
        <ProjectSwitcher
          currentProjectId={projectId}
          currentProjectName={resolvedName}
          locale={locale}
          draftLabel={draftLabel}
          totalSteps={totalSteps}
        />
      </div>

      {/* Progress strip */}
      <div className="mt-6 flex items-center gap-1">
        {V2_STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`h-px flex-1 transition-all ${
              i <= stepIdx ? 'bg-amber-500' : 'bg-stone-800'
            }`}
          />
        ))}
      </div>
    </div>
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
        className="group flex items-center gap-2 rounded-sm border border-transparent bg-transparent px-2 py-1 transition-colors hover:border-amber-900/30 hover:bg-stone-900/40"
        title="切換專案"
      >
        <div className="text-right">
          <div className="font-fraunces text-sm italic text-stone-300 group-hover:text-amber-300">
            《{currentProjectName}》
          </div>
          <div className="mt-1 font-mono text-[14px] tracking-wider text-stone-600">
            DRAFT · {draftLabel}/{String(totalSteps).padStart(2, '0')}
          </div>
        </div>
        <AppIcon
          name="chevronDown"
          className={`h-3 w-3 text-stone-500 transition-transform group-hover:text-amber-400 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-sm border border-amber-900/30 bg-stone-950 shadow-2xl">
          <div className="border-b border-amber-900/20 px-4 py-2 font-mono text-[14px] uppercase tracking-[0.2em] text-amber-600">
            切換專案
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {loading ? (
              <div className="px-4 py-3 font-mono text-[14px] tracking-wider text-stone-500">
                載入中…
              </div>
            ) : otherProjects.length === 0 ? (
              <div className="px-4 py-3 font-fraunces text-xs italic text-stone-500">
                {projects === null ? '載入中…' : '沒有其他專案'}
              </div>
            ) : (
              otherProjects.map((p) => (
                <Link
                  key={p.id}
                  href={`/${locale}/v2/workspace/${p.id}${currentStepSegment ? `/${currentStepSegment}` : ''}`}
                  className="block px-4 py-2 font-serif-cn text-sm text-stone-300 transition-colors hover:bg-amber-500/10 hover:text-amber-300"
                  onClick={() => setOpen(false)}
                >
                  {p.name || '未命名劇本'}
                </Link>
              ))
            )}
          </div>

          <div className="border-t border-amber-900/20">
            <Link
              href={`/${locale}/v2`}
              className="block px-4 py-2.5 font-serif-cn text-sm text-amber-400 transition-colors hover:bg-amber-500/10"
              onClick={() => setOpen(false)}
            >
              + 新建 / 所有專案
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}
