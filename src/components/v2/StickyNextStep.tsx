'use client'

import { useId, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'

export interface NextStepRequirement {
  id: string
  label: ReactNode
  met: boolean
}

export interface NextStepSecondaryAction {
  label: string
  onAction: () => void
  ariaLabel?: string
}

type NextStepReadiness =
  | {
      ready: true
      disabledReason?: never
    }
  | {
      ready: false
      /** User-facing reason and recovery hint for the blocked action. */
      disabledReason: string
    }

export interface StickyNextStepBaseProps {
  title: ReactNode
  description?: ReactNode
  primaryLabel: string
  onPrimaryAction: () => void
  prerequisites?: readonly NextStepRequirement[]
  secondaryAction?: NextStepSecondaryAction
  eyebrow?: string
  prerequisiteSummary?: ReactNode
  prerequisitesAriaLabel?: string
  metLabel?: string
  unmetLabel?: string
  mobileNavOffset?: boolean
  className?: string
}

export type StickyNextStepProps = StickyNextStepBaseProps & NextStepReadiness

/** Persistent production-flow handoff with visible prerequisites. */
export function StickyNextStep({
  title,
  description,
  primaryLabel,
  onPrimaryAction,
  prerequisites = [],
  secondaryAction,
  eyebrow = '下一步',
  prerequisiteSummary,
  prerequisitesAriaLabel = '前置條件',
  metLabel = '已完成',
  unmetLabel = '待完成',
  mobileNavOffset = false,
  ready,
  disabledReason,
  className,
}: StickyNextStepProps) {
  const titleId = useId()
  const stateId = useId()
  const unmetCount = prerequisites.filter((item) => !item.met).length

  return (
    <aside
      aria-labelledby={titleId}
      className={[
        'sticky z-30 border-t border-[var(--production-border)] bg-[color-mix(in_srgb,var(--production-surface)_96%,transparent)] px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:px-5 sm:pb-4 sm:pt-4',
        mobileNavOffset ? 'bottom-[76px] lg:bottom-0' : 'bottom-0',
        className ?? '',
      ].filter(Boolean).join(' ')}
      data-ready={ready ? 'true' : 'false'}
    >
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="kuiper-dashboard-kicker">{eyebrow}</span>
            {prerequisites.length > 0 ? (
              <span className="text-[12px] font-medium text-[var(--production-ink-muted)]">
                {prerequisiteSummary ?? (unmetCount === 0
                  ? `${prerequisites.length} 項前置條件已完成`
                  : `尚有 ${unmetCount} 項前置條件`)}
              </span>
            ) : null}
          </div>
          <h2
            id={titleId}
            className="kuiper-dashboard-heading mt-1 text-[18px] leading-6 sm:text-[20px]"
          >
            {title}
          </h2>
          {description ? (
            <div className="mt-1 text-[13px] leading-5 text-[var(--production-ink-muted)]">
              {description}
            </div>
          ) : null}

          {prerequisites.length > 0 ? (
            <ul aria-label={prerequisitesAriaLabel} className="mt-3 flex flex-wrap gap-2">
              {prerequisites.map((item) => (
                <li
                  key={item.id}
                  className={[
                    'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium',
                    item.met
                      ? 'border-emerald-400/35 bg-emerald-400/10 text-emerald-200'
                      : 'border-[var(--production-border)] bg-[var(--production-muted)] text-[var(--production-ink-muted)]',
                  ].join(' ')}
                >
                  <AppIcon
                    aria-hidden="true"
                    name={item.met ? 'check' : 'lock'}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span>{item.label}</span>
                  <span className="sr-only">，{item.met ? metLabel : unmetLabel}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {!ready ? (
            <p
              id={stateId}
              role="status"
              className="mt-3 flex items-start gap-2 text-[13px] leading-5 text-[var(--production-danger)]"
            >
              <AppIcon aria-hidden="true" name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{disabledReason}</span>
            </p>
          ) : null}
        </div>

        <div className="flex w-full shrink-0 flex-col-reverse gap-2 sm:flex-row lg:w-auto">
          {secondaryAction ? (
            <button
              type="button"
              className="kuiper-dashboard-secondary inline-flex min-h-11 w-full items-center justify-center px-4 text-[14px] font-semibold motion-reduce:transition-none sm:w-auto"
              aria-label={secondaryAction.ariaLabel}
              onClick={secondaryAction.onAction}
            >
              {secondaryAction.label}
            </button>
          ) : null}
          <button
            type="button"
            className="kuiper-dashboard-primary inline-flex min-h-11 w-full items-center justify-center gap-2 px-5 text-[14px] disabled:cursor-not-allowed disabled:border-[var(--production-border)] disabled:bg-[var(--production-muted)] disabled:text-[var(--production-ink-muted)] motion-reduce:transition-none sm:w-auto"
            disabled={!ready}
            aria-describedby={!ready ? stateId : undefined}
            onClick={onPrimaryAction}
          >
            {primaryLabel}
            <AppIcon aria-hidden="true" name="arrowRight" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  )
}
