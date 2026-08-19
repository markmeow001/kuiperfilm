'use client'

import Link from 'next/link'
import { AppIcon } from '@/components/ui/icons'
import studioStyles from './StudioShell.module.css'

interface ProjectCardStats {
  episodes: number
  images: number
  videos: number
  firstEpisodePreview: string | null
}

export interface ProjectCardProject {
  id: string
  name: string
  description: string | null
  updated: string
  stats?: ProjectCardStats
  canDelete: boolean
  roleLabel: string
}

interface ProjectCardProps {
  project: ProjectCardProject
  overviewHref: string
  continueHref: string
  overviewLabel: string
  continueLabel: string
  deleteLabel: string
  untitledDraftLabel: string
  deleting: boolean
  onDelete: (project: ProjectCardProject) => void
}

function Metric({ icon, value }: { icon: 'bookOpen' | 'image' | 'film'; value: number }) {
  if (value <= 0) return null

  return (
    <span className="flex items-center gap-1">
      <AppIcon name={icon} className="h-3 w-3 text-[var(--process-cyan-strong)]" />
      {value}
    </span>
  )
}

export function ProjectCard({
  project,
  overviewHref,
  continueHref,
  overviewLabel,
  continueLabel,
  deleteLabel,
  untitledDraftLabel,
  deleting,
  onDelete,
}: ProjectCardProps) {
  const preview = project.description || project.stats?.firstEpisodePreview

  return (
    <article className="kuiper-dashboard-card group relative flex min-h-64 flex-col overflow-hidden p-5">
      <div className="absolute inset-y-0 left-0 w-1 bg-[var(--production-blue)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="line-clamp-2 text-[17px] font-semibold text-[var(--production-ink)]">
            {project.name}
          </div>
          <div className="mt-2 inline-flex min-h-7 items-center rounded-full border border-[var(--production-border)] bg-[var(--production-muted)] px-2.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--production-ink-muted)]">
            {project.roleLabel}
          </div>
        </div>

        {project.canDelete ? (
          <button
            type="button"
            onClick={() => onDelete(project)}
            disabled={deleting}
            aria-label={`${deleteLabel}: ${project.name}`}
            className={`${studioStyles.dangerControl} flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-50`}
            title={deleteLabel}
          >
            <AppIcon name="trash" className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <p className="mt-4 line-clamp-3 text-[13px] leading-5 text-[var(--production-ink-muted)]">
        {preview || untitledDraftLabel}
      </p>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-[var(--production-border)] pt-4 font-mono text-[11px] text-[var(--production-ink-muted)]">
        <div className="flex items-center gap-3">
          <Metric icon="bookOpen" value={project.stats?.episodes ?? 0} />
          <Metric icon="image" value={project.stats?.images ?? 0} />
          <Metric icon="film" value={project.stats?.videos ?? 0} />
        </div>
        <span>{project.updated}</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Link
          href={overviewHref}
          className="kuiper-dashboard-secondary inline-flex min-h-11 items-center justify-center px-3 text-[13px]"
        >
          {overviewLabel}
        </Link>
        <Link
          href={continueHref}
          className="kuiper-dashboard-primary inline-flex min-h-11 items-center justify-center gap-2 px-3 text-[13px]"
        >
          {continueLabel}
          <AppIcon name="arrowRight" className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  )
}
