'use client'

import { AppIcon } from '@/components/ui/icons'
import type { AutoGroupUiStatus } from '@/lib/query/mutations/auto-group-multi-shot-mutation'

interface AutoGroupTaskBannerProps {
  label: string | null
  status: AutoGroupUiStatus
  isError: boolean
  isPending: boolean
  progress: number
  canEdit: boolean
  canCancel: boolean
  isCancelling: boolean
  cancelLabel: string
  cancellingLabel: string
  onCancel: () => void
}

export function AutoGroupTaskBanner({
  label,
  status,
  isError,
  isPending,
  progress,
  canEdit,
  canCancel,
  isCancelling,
  cancelLabel,
  cancellingLabel,
  onCancel,
}: AutoGroupTaskBannerProps) {
  if (!label) return null

  return (
    <div
      className={`mt-3 flex flex-wrap items-center gap-3 rounded-sm border px-3 py-2 text-sm ${
        isError
          ? 'border-rose-500/35 bg-rose-500/10 text-rose-200'
          : status === 'completed'
            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
            : status === 'cancelled'
              ? 'border-border-strong bg-raised/50 text-text-secondary'
              : 'border-[var(--production-blue)]/45 bg-[var(--production-blue-soft)] text-[var(--process-cyan-strong)]'
      }`}
      role={isError ? 'alert' : 'status'}
      aria-live="polite"
    >
      <AppIcon
        name={
          isError
            ? 'alert'
            : status === 'completed'
              ? 'check'
              : status === 'cancelled'
                ? 'close'
                : 'sparklesAlt'
        }
        className={`h-4 w-4 shrink-0 ${isPending ? 'animate-pulse' : ''}`}
      />
      <span>{label}</span>
      {status === 'running' ? (
        <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-raised/60 sm:max-w-40">
          <div
            className="h-full bg-[var(--production-blue)] transition-all duration-500"
            style={{ width: `${Math.max(2, Math.min(100, progress))}%` }}
          />
        </div>
      ) : null}
      {canEdit && canCancel ? (
        <button
          type="button"
          className="ml-auto min-h-11 rounded-sm border border-current/30 px-3 py-1.5 font-mono text-xs uppercase tracking-wider transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isCancelling}
          onClick={() => {
            if (!canEdit || !canCancel) return
            onCancel()
          }}
        >
          {isCancelling ? cancellingLabel : cancelLabel}
        </button>
      ) : null}
    </div>
  )
}
