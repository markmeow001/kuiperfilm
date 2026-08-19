'use client'

import { useId, type ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'

export type GenerationComposerCost =
  | {
      status: 'available'
      value: ReactNode
      note?: ReactNode
    }
  | {
      status: 'calculating'
      label: ReactNode
    }
  | {
      status: 'unavailable'
      reason: ReactNode
    }

type GenerationComposerReadiness =
  | {
      ready: true
      disabledReason?: never
    }
  | {
      ready: false
      /** Explain exactly what must change before generation is available. */
      disabledReason: string
    }

export interface GenerationComposerLabels {
  title: string
  prompt: string
  references: string
  controls: string
  style: string
  model: string
  ratio: string
  count: string
  advanced: string
  cost: string
  ready: string
  costCalculating: string
  generate: string
  generating: string
}

export interface GenerationComposerBaseProps {
  /** Named slots keep every generation form in the same reading order. */
  prompt: ReactNode
  references: ReactNode
  style: ReactNode
  model: ReactNode
  ratio: ReactNode
  count: ReactNode
  advanced: ReactNode
  cost: GenerationComposerCost
  onGenerate: () => void
  generating?: boolean
  labels?: Partial<GenerationComposerLabels>
  className?: string
}

export type GenerationComposerProps = GenerationComposerBaseProps & GenerationComposerReadiness

const DEFAULT_LABELS: GenerationComposerLabels = {
  title: '生成設定',
  prompt: '提示詞',
  references: '參考素材',
  controls: '輸出設定',
  style: '風格',
  model: '模型',
  ratio: '比例',
  count: '數量',
  advanced: '進階設定',
  cost: '預估費用',
  ready: '設定已完成，可以送出生成。',
  costCalculating: '費用計算中，完成後才能生成。',
  generate: '開始生成',
  generating: '正在建立任務…',
}

/**
 * Shared, API-agnostic generation form frame.
 *
 * Callers own every field and its data. This component only enforces the
 * decision order: Prompt → References → Style / Model / Ratio / Count →
 * Advanced → Cost → Generate.
 */
export function GenerationComposer({
  prompt,
  references,
  style,
  model,
  ratio,
  count,
  advanced,
  cost,
  ready,
  disabledReason,
  onGenerate,
  generating = false,
  labels: labelOverrides,
  className,
}: GenerationComposerProps) {
  const titleId = useId()
  const stateId = useId()
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const costReady = cost.status === 'available'
  const canGenerate = ready && costReady && !generating

  const stateMessage: ReactNode = !ready
    ? disabledReason
    : cost.status === 'calculating'
      ? labels.costCalculating
      : cost.status === 'unavailable'
        ? cost.reason
        : labels.ready

  return (
    <section
      aria-labelledby={titleId}
      className={[
        'kuiper-dashboard-card overflow-hidden',
        className ?? '',
      ].filter(Boolean).join(' ')}
      data-ready={ready ? 'true' : 'false'}
    >
      <header className="border-b border-[var(--production-border)] px-4 py-4 sm:px-6">
        <p className="kuiper-dashboard-kicker">Composer</p>
        <h2
          id={titleId}
          className="kuiper-dashboard-heading mt-1 text-[22px] leading-7"
        >
          {labels.title}
        </h2>
      </header>

      <div className="space-y-6 px-4 py-5 sm:px-6 sm:py-6">
        <ComposerSection label={labels.prompt} slotName="prompt">
          {prompt}
        </ComposerSection>

        <ComposerSection label={labels.references} slotName="references">
          {references}
        </ComposerSection>

        <section aria-label={labels.controls} data-composer-slot="controls">
          <p className="mb-3 text-[13px] font-semibold text-[var(--production-ink-muted)]">
            {labels.controls}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <ControlSlot label={labels.style} slotName="style">{style}</ControlSlot>
            <ControlSlot label={labels.model} slotName="model">{model}</ControlSlot>
            <ControlSlot label={labels.ratio} slotName="ratio">{ratio}</ControlSlot>
            <ControlSlot label={labels.count} slotName="count">{count}</ControlSlot>
          </div>
        </section>

        <ComposerSection label={labels.advanced} slotName="advanced">
          {advanced}
        </ComposerSection>

        <section
          aria-label={labels.cost}
          className="rounded-[12px] border border-[var(--production-border)] bg-[var(--production-muted)] p-4"
          data-composer-slot="cost"
          data-cost-status={cost.status}
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--production-surface)] text-[var(--process-cyan-strong)]"
            >
              <AppIcon name={cost.status === 'unavailable' ? 'alert' : 'coins'} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-[var(--production-ink-muted)]">
                {labels.cost}
              </p>
              {cost.status === 'available' ? (
                <>
                  <div className="mt-1 text-[20px] font-semibold leading-7 text-[var(--production-ink)]">
                    {cost.value}
                  </div>
                  {cost.note ? (
                    <div className="mt-1 text-[13px] leading-5 text-[var(--production-ink-muted)]">
                      {cost.note}
                    </div>
                  ) : null}
                </>
              ) : cost.status === 'calculating' ? (
                <div className="mt-1 text-[14px] leading-5 text-[var(--production-ink-muted)]">
                  {cost.label}
                </div>
              ) : (
                <div className="mt-1 text-[14px] leading-5 text-[var(--production-danger)]">
                  {cost.reason}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <footer className="border-t border-[var(--production-border)] bg-[var(--production-surface)] px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            id={stateId}
            role="status"
            className={[
              'flex min-w-0 items-start gap-2 text-[13px] leading-5',
              canGenerate
                ? 'text-[#2f7654]'
                : 'text-[var(--production-ink-muted)]',
            ].join(' ')}
          >
            <AppIcon
              aria-hidden="true"
              name={canGenerate ? 'circleCheck' : 'info'}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>{stateMessage}</span>
          </p>
          <button
            type="button"
            className="kuiper-dashboard-primary inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 px-5 text-[14px] disabled:cursor-not-allowed disabled:border-[var(--production-border)] disabled:bg-[var(--production-muted)] disabled:text-[var(--production-ink-muted)] motion-reduce:transition-none sm:w-auto"
            disabled={!canGenerate}
            aria-describedby={stateId}
            aria-busy={generating || undefined}
            onClick={onGenerate}
          >
            <AppIcon aria-hidden="true" name="sparklesAlt" className="h-4 w-4" />
            {generating ? labels.generating : labels.generate}
          </button>
        </div>
      </footer>
    </section>
  )
}

function ComposerSection({
  label,
  slotName,
  children,
}: {
  label: string
  slotName: string
  children: ReactNode
}) {
  return (
    <section aria-label={label} data-composer-slot={slotName}>
      <p className="mb-3 text-[13px] font-semibold text-[var(--production-ink-muted)]">
        {label}
      </p>
      {children}
    </section>
  )
}

function ControlSlot({
  label,
  slotName,
  children,
}: {
  label: string
  slotName: string
  children: ReactNode
}) {
  return (
    <div data-composer-slot={slotName}>
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--production-ink-muted)]">
        {label}
      </p>
      {children}
    </div>
  )
}
