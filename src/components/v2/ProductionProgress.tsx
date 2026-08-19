import type { V2StepId } from './v2-types'
import { getV2WorkspacePresentation } from './v2-workspace-presentation'

interface ProductionProgressProps {
  currentStep: V2StepId
  onSelect?: (step: V2StepId) => void
  compact?: boolean
  tone?: 'light' | 'dark'
  locale?: string
}

/** The signature production rail: every screen shows where the film is now. */
export function ProductionProgress({
  currentStep,
  onSelect,
  compact = false,
  tone = 'dark',
  locale = 'zh',
}: ProductionProgressProps) {
  const presentation = getV2WorkspacePresentation(locale)
  const activeIndex = presentation.steps.findIndex((step) => step.id === currentStep)
  const dark = tone === 'dark'

  if (compact) {
    return (
      <div className="flex items-center gap-1" aria-label={presentation.progressLabel}>
        {presentation.steps.map((step, index) => (
          <span
            key={step.id}
            title={`${step.label} · ${step.subtitle}`}
            className={`h-1.5 flex-1 rounded-full ${
              index <= activeIndex
                ? dark
                  ? 'bg-[var(--process-cyan)]'
                  : 'bg-[var(--production-blue)]'
                : dark
                  ? 'bg-white/10'
                  : 'bg-[var(--production-border)]'
            }`}
          />
        ))}
      </div>
    )
  }

  return (
    <ol className="relative space-y-1" aria-label={presentation.progressLabel}>
      {presentation.steps.map((step, index) => {
        const active = step.id === currentStep
        const completed = index < activeIndex
        return (
          <li key={step.id} className="relative">
            <button
              type="button"
              onClick={() => onSelect?.(step.id)}
              aria-current={active ? 'step' : undefined}
              aria-label={`${step.label} · ${step.subtitle}${active ? ` · ${presentation.currentStage}` : completed ? ` · ${presentation.completed}` : ''}`}
              className={`group flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                dark
                  ? active
                    ? 'bg-[var(--process-cyan-soft)] text-[var(--darkroom-text)]'
                    : 'text-[var(--darkroom-muted)] hover:bg-white/[0.045] hover:text-[var(--darkroom-text)]'
                  : active
                    ? 'bg-white text-[var(--production-ink)] shadow-[0_1px_2px_rgba(20,24,21,0.08)]'
                    : 'text-[var(--production-ink-muted)] hover:bg-white/65 hover:text-[var(--production-ink)]'
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold ${
                  dark
                    ? active
                      ? 'border-[var(--process-cyan)] bg-[var(--process-cyan)] text-[#071014]'
                      : completed
                        ? 'border-[var(--process-cyan)]/60 bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
                        : 'border-white/15 bg-transparent text-[var(--darkroom-muted)]'
                    : active
                      ? 'border-[var(--production-blue)] bg-[var(--production-blue)] text-white'
                      : completed
                        ? 'border-[var(--process-cyan)]/60 bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
                        : 'border-[#d1cdc4] bg-transparent text-[#7c7f7a]'
                }`}
              >
                {completed ? '✓' : step.num}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold">{step.label}</span>
                <span
                  className={`mt-0.5 block truncate text-[11px] ${
                    dark ? 'text-[var(--darkroom-muted)]' : 'text-[#858883]'
                  }`}
                >
                  {step.subtitle}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
