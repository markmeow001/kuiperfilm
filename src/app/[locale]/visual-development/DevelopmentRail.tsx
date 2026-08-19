'use client'

import Link from 'next/link'
import { AppIcon } from '@/components/ui/icons'
import type {
  VisualDevelopmentGroupId,
  VisualDevelopmentStageDefinition,
  VisualDevelopmentStageId,
} from './visual-development-config'

export interface LocalizedDevelopmentStage extends VisualDevelopmentStageDefinition {
  title: string
  shortTitle: string
  objective: string
  deliverables: string[]
  gate: string
}

interface DevelopmentRailProps {
  activeStageId: VisualDevelopmentStageId
  groups: Record<VisualDevelopmentGroupId, string>
  labels: {
    title: string
    kicker: string
    phase: string
    playground: string
  }
  locale: string
  onSelect: (stageId: VisualDevelopmentStageId) => void
  stages: LocalizedDevelopmentStage[]
}

const GROUP_ORDER: readonly VisualDevelopmentGroupId[] = [
  'foundation',
  'identity',
  'design',
  'production',
]

export function DevelopmentRail({
  activeStageId,
  groups,
  labels,
  locale,
  onSelect,
  stages,
}: DevelopmentRailProps) {
  return (
    <aside className="border-b border-[var(--darkroom-border)] bg-[var(--studio-chrome)] lg:min-h-0 lg:border-b-0 lg:border-r xl:h-full xl:overflow-hidden">
      <div className="hidden h-full min-h-0 flex-col lg:flex">
        <div className="border-b border-[var(--darkroom-border)] px-5 py-5">
          <div className="font-mono text-[9px] tracking-[0.2em] text-[var(--process-cyan-strong)]">
            {labels.kicker}
          </div>
          <h2 className="mt-1.5 font-serif-cn text-sm font-semibold text-[var(--darkroom-text)]">{labels.title}</h2>
        </div>

        <nav aria-label={labels.title} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-4">
          {GROUP_ORDER.map((groupId) => {
            const groupStages = stages.filter((stage) => stage.group === groupId)
            return (
              <section key={groupId} className="mb-5 last:mb-0">
                <h3 className="mb-2 px-2 font-mono text-[8px] tracking-[0.2em] text-text-tertiary">
                  {groups[groupId]}
                </h3>
                <div className="space-y-1">
                  {groupStages.map((stage) => {
                    const active = stage.id === activeStageId
                    return (
                      <button
                        key={stage.id}
                        type="button"
                        onClick={() => onSelect(stage.id)}
                        aria-current={active ? 'step' : undefined}
                        className={`group relative flex min-h-11 w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--process-cyan)] ${
                          active
                            ? 'border-[var(--process-cyan)]/35 bg-[var(--process-cyan-soft)] text-[var(--darkroom-text)]'
                            : 'border-transparent text-[var(--darkroom-muted)] hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-[var(--darkroom-text)]'
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-[9px] ${
                            active
                              ? 'bg-[var(--process-cyan)] text-[#071014]'
                              : 'border border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] text-[var(--darkroom-muted)]'
                          }`}
                        >
                          {stage.code}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-serif-cn text-[11px] font-medium">
                            {stage.shortTitle}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[8px] uppercase tracking-[0.12em] text-text-tertiary">
                            {labels.phase} {stage.code}
                          </span>
                        </span>
                        <AppIcon
                          name={stage.icon}
                          className={`h-3.5 w-3.5 shrink-0 ${
                            active ? 'text-[var(--process-cyan-strong)]' : 'text-[var(--darkroom-muted)]'
                          }`}
                        />
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </nav>

        <div className="border-t border-[var(--darkroom-border)] p-3">
          <Link
            href={`/${locale}/playground`}
            className="flex min-h-11 items-center justify-between rounded-xl border border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] px-3 py-2.5 text-[10px] text-[var(--darkroom-muted)] transition-colors hover:border-[var(--process-cyan)]/45 hover:text-[var(--darkroom-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--process-cyan)]"
          >
            <span className="flex items-center gap-2">
              <AppIcon name="sparklesAlt" className="h-3.5 w-3.5 text-[var(--process-cyan-strong)]" />
              {labels.playground}
            </span>
            <AppIcon name="externalLink" className="h-3 w-3 text-text-tertiary" />
          </Link>
        </div>
      </div>

      <nav
        aria-label={labels.title}
        className="flex max-w-full snap-x gap-2 overflow-x-auto px-4 py-3 lg:hidden"
      >
        {stages.map((stage) => {
          const active = stage.id === activeStageId
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => onSelect(stage.id)}
              aria-current={active ? 'step' : undefined}
              className={`flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-xl border px-3 py-2 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--process-cyan)] ${
                active
                  ? 'border-[var(--process-cyan)]/35 bg-[var(--process-cyan-soft)] text-[var(--darkroom-text)]'
                  : 'border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] text-[var(--darkroom-muted)]'
              }`}
            >
              <span className="font-mono text-[9px] text-[var(--process-cyan-strong)]">{stage.code}</span>
              <span>{stage.shortTitle}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
