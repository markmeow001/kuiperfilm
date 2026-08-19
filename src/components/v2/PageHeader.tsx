import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  context?: ReactNode
  className?: string
  tone?: 'light' | 'dark'
}

/** Predictable title hierarchy used by dashboard and project pages. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  context,
  className,
  tone = 'light',
}: PageHeaderProps) {
  const dark = tone === 'dark'

  return (
    <header
      className={[
        'flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="min-w-0 max-w-3xl">
        {context ? (
          <div
            className={`mb-4 flex flex-wrap items-center gap-2 text-[13px] ${dark ? 'text-text-tertiary' : 'text-[var(--production-ink-muted)]'}`}
          >
            {context}
          </div>
        ) : null}
        {eyebrow ? (
          <div
            className={
              dark
                ? 'font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--process-cyan-strong)]'
                : 'kuiper-dashboard-kicker'
            }
          >
            {eyebrow}
          </div>
        ) : null}
        <h1
          className={`${dark ? 'font-heading font-semibold tracking-tight text-text-primary' : 'kuiper-dashboard-heading'} mt-2 text-[30px] leading-[1.18] sm:text-[36px]`}
        >
          {title}
        </h1>
        {description ? (
          <p
            className={`mt-2 max-w-2xl text-[15px] leading-6 ${dark ? 'text-text-secondary' : 'text-[var(--production-ink-muted)]'}`}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
