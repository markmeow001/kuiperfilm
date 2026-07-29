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
  locale: string
  onSelect: (stageId: VisualDevelopmentStageId) => void
  stages: LocalizedDevelopmentStage[]
  title: string
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
  locale,
  onSelect,
  stages,
  title,
}: DevelopmentRailProps) {
  return (
    <aside className="border-b border-white/[0.07] bg-[#09090b] lg:min-h-0 lg:border-b-0 lg:border-r xl:h-full xl:overflow-hidden">
      <div className="hidden h-full min-h-0 flex-col lg:flex">
        <div className="border-b border-white/[0.07] px-5 py-5">
          <div className="font-mono text-[9px] tracking-[0.2em] text-text-tertiary">
            DEVELOPMENT SPINE
          </div>
          <h2 className="mt-1.5 font-serif-cn text-sm font-semibold text-white">{title}</h2>
        </div>

        <nav aria-label={title} className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-3 py-4">
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
                        className={`group relative flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                          active
                            ? 'border-primary-500/30 bg-primary-500/[0.08] text-white'
                            : 'border-transparent text-text-secondary hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-white'
                        }`}
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-[9px] ${
                            active
                              ? 'bg-primary-500 text-black'
                              : 'border border-white/[0.08] bg-white/[0.03] text-text-tertiary'
                          }`}
                        >
                          {stage.code}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-serif-cn text-[11px] font-medium">
                            {stage.shortTitle}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[8px] uppercase tracking-[0.12em] text-text-tertiary">
                            Phase {stage.code}
                          </span>
                        </span>
                        <AppIcon
                          name={stage.icon}
                          className={`h-3.5 w-3.5 shrink-0 ${
                            active ? 'text-primary-400' : 'text-text-tertiary'
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

        <div className="border-t border-white/[0.07] p-3">
          <Link
            href={`/${locale}/playground`}
            className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-[10px] text-text-secondary transition-colors hover:border-white/[0.14] hover:text-white"
          >
            <span className="flex items-center gap-2">
              <AppIcon name="sparklesAlt" className="h-3.5 w-3.5 text-primary-400" />
              Playground
            </span>
            <AppIcon name="externalLink" className="h-3 w-3 text-text-tertiary" />
          </Link>
        </div>
      </div>

      <nav
        aria-label={title}
        className="flex snap-x gap-2 overflow-x-auto px-4 py-3 lg:hidden"
      >
        {stages.map((stage) => {
          const active = stage.id === activeStageId
          return (
            <button
              key={stage.id}
              type="button"
              onClick={() => onSelect(stage.id)}
              aria-current={active ? 'step' : undefined}
              className={`flex shrink-0 snap-start items-center gap-2 rounded-xl border px-3 py-2 text-[10px] ${
                active
                  ? 'border-primary-500/30 bg-primary-500/[0.09] text-white'
                  : 'border-white/[0.07] bg-white/[0.025] text-text-tertiary'
              }`}
            >
              <span className="font-mono text-[9px] text-primary-400">{stage.code}</span>
              <span>{stage.shortTitle}</span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
