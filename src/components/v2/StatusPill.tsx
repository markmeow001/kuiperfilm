import type { ReactNode } from 'react'

type StatusTone =
  | 'neutral'
  | 'active'
  | 'success'
  | 'approval'
  | 'warning'
  | 'danger'
  | 'info'

interface StatusPillProps {
  label: ReactNode
  tone?: StatusTone
  detail?: ReactNode
  className?: string
}

const toneClasses: Record<StatusTone, string> = {
  neutral: 'border-white/10 bg-white/[0.05] text-[var(--production-ink-muted)] before:bg-[var(--production-ink-muted)]',
  active: 'border-[var(--production-blue)]/45 bg-[var(--production-blue-soft)] text-blue-200 before:bg-[var(--production-blue)]',
  success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200 before:bg-emerald-400',
  approval: 'border-[var(--production-gold)]/55 bg-[var(--production-gold)]/10 text-[var(--editorial-400)] before:bg-[var(--production-gold)]',
  warning: 'border-amber-400/25 bg-amber-400/10 text-amber-200 before:bg-amber-400',
  danger: 'border-red-400/25 bg-red-400/10 text-red-200 before:bg-red-400',
  info: 'border-[var(--process-cyan)]/30 bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)] before:bg-[var(--process-cyan)]',
}

/** Status always includes text; the dot is reinforcement, never the only cue. */
export function StatusPill({
  label,
  tone = 'neutral',
  detail,
  className,
}: StatusPillProps) {
  return (
    <span
      className={[
        'inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 py-1 text-[12px] font-semibold leading-4',
        'before:h-1.5 before:w-1.5 before:shrink-0 before:rounded-full before:content-[\'\']',
        toneClasses[tone],
        className,
      ].filter(Boolean).join(' ')}
    >
      <span>{label}</span>
      {detail ? <span className="font-normal opacity-75">{detail}</span> : null}
    </span>
  )
}
