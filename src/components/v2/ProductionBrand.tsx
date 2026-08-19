import Link from 'next/link'

interface ProductionBrandProps {
  locale: string
  compact?: boolean
  href?: string
  tone?: 'light' | 'dark'
  className?: string
}

/** The single public Kuiper 影界 wordmark used across entry and production shells. */
export function ProductionBrand({
  locale,
  compact = false,
  href,
  tone = 'light',
  className = '',
}: ProductionBrandProps) {
  const dark = tone === 'dark'
  const homeLabel = locale === 'en' ? 'Kuiper 影界 production home' : 'Kuiper 影界 製作首頁'

  return (
    <Link
      href={href ?? `/${locale}/v2`}
      aria-label={homeLabel}
      className={`group inline-flex min-h-11 min-w-0 items-center rounded-md px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--process-cyan)] focus-visible:ring-offset-2 ${
        dark
          ? 'focus-visible:ring-offset-[var(--darkroom-canvas)]'
          : 'focus-visible:ring-offset-[var(--production-paper)]'
      } ${className}`}
    >
      {compact ? (
        <span
          aria-hidden="true"
          className={`font-kuiper-wordmark flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border text-2xl font-semibold italic transition-colors ${
            dark
              ? 'border-white/10 bg-white/[0.055] text-[var(--process-cyan)] group-hover:border-[var(--process-cyan)]'
              : 'border-[var(--production-border)] bg-[var(--production-muted)] text-[var(--production-blue)] group-hover:border-[var(--production-blue)]'
          }`}
        >
          K
        </span>
      ) : (
        <span className="min-w-0 leading-none">
          <span className="flex items-baseline gap-1.5 whitespace-nowrap">
            <span
              className={`font-kuiper-wordmark text-[25px] font-semibold italic tracking-[-0.035em] transition-colors ${
                dark
                  ? 'text-[var(--process-cyan-strong)] group-hover:text-[var(--darkroom-text)]'
                  : 'text-[var(--production-blue)] group-hover:text-[var(--production-blue-hover)]'
              }`}
            >
              Kuiper
            </span>
            <span
              className={`font-sans text-[16px] font-medium tracking-[-0.02em] ${
                dark ? 'text-[var(--darkroom-text)]' : 'text-[var(--production-ink)]'
              }`}
            >
              影界
            </span>
          </span>
          <span
            className={`mt-1 block truncate font-sans text-[9px] font-medium uppercase tracking-[0.24em] ${
              dark
                ? 'text-[var(--darkroom-muted)]'
                : 'text-[var(--production-ink-muted)]'
            }`}
          >
            AI · MANHUA · STUDIO
          </span>
        </span>
      )}
    </Link>
  )
}
