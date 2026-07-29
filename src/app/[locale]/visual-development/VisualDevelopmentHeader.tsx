'use client'

import Link from 'next/link'
import { AppIcon } from '@/components/ui/icons'
import type { ProjectOption } from './visual-development-types'

interface VisualDevelopmentHeaderProps {
  locale: string
  projectId: string
  projects: ProjectOption[]
  onProjectChange: (projectId: string) => void
  labels: {
    back: string
    eyebrow: string
    system: string
    title: string
    project: string
    noProject: string
    preview: string
  }
}

export function VisualDevelopmentHeader({ locale, projectId, projects, onProjectChange, labels }: VisualDevelopmentHeaderProps) {
  return (
    <header className="relative z-30 border-b border-white/[0.07] bg-[#060607]/95 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-h-[72px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-5">
          <Link href={`/${locale}/v2`} aria-label={labels.back} title={labels.back} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400">
            <AppIcon name="chevronLeft" className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.22em] text-primary-400">
              <span>{labels.eyebrow}</span>
              <span className="hidden h-px w-6 bg-primary-500/40 sm:block" />
              <span className="hidden text-text-tertiary sm:inline">{labels.system}</span>
            </div>
            <h1 className="mt-1 truncate font-serif-cn text-lg font-semibold text-white">{labels.title}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <select value={projectId} onChange={(event) => onProjectChange(event.target.value)} aria-label={labels.project} className="hidden h-9 max-w-56 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-text-secondary outline-none focus:border-primary-500/50 md:block">
            <option value="">{labels.noProject}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <span className="rounded-lg border border-primary-500/25 bg-primary-500/[0.08] px-2.5 py-1.5 font-mono text-[9px] tracking-[0.16em] text-primary-400">{labels.preview}</span>
        </div>
      </div>
    </header>
  )
}
