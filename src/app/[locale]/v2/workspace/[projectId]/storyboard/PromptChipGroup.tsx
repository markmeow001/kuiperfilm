/**
 * Single-select chip grid used by the storyboard prompt builder (camera
 * angle / shot size / movement / quality words). Extracted verbatim from
 * V2StoryboardClient.tsx (2026-06-13 — Phase 1 monolith decomposition).
 * Pure presentational component: props in, JSX out, no closure deps.
 */

export function PromptChipGroup({
  label,
  options,
  cols,
  active,
  onChange,
  disabled,
}: {
  label: string
  options: string[]
  cols: number
  active: string | null
  onChange?: (value: string | null) => void
  disabled?: boolean
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[14px] tracking-wider text-text-tertiary">{label}</div>
      <div className={`grid gap-1.5 ${cols === 1 ? '' : cols === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
        {options.map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled || !onChange}
            onClick={() => {
              if (!onChange) return
              // Toggle off if user re-clicks the active chip — lets
              // them clear a setting rather than being locked into
              // one of the options forever.
              onChange(active === v ? null : v)
            }}
            className={`rounded-sm border px-2 py-1.5 text-left font-serif-cn text-xs transition-all ${
              active === v
                ? 'border-primary-500/50 bg-primary-500/5 text-primary-400'
                : disabled || !onChange
                  ? 'border-border-soft text-text-tertiary'
                  : 'border-border-soft text-text-secondary hover:border-primary-500/40 hover:text-primary-300'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  )
}
