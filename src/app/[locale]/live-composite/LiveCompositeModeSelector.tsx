'use client'

import { AppIcon } from '@/components/ui/icons'

export type LiveCompositeMode = 'depth-rebuild' | 'mask-composite'

interface LiveCompositeModeSelectorProps {
  value: LiveCompositeMode
  onChange: (mode: LiveCompositeMode) => void
  disabled?: boolean
}

const MODES: ReadonlyArray<{
  value: LiveCompositeMode
  label: string
  description: string
  badge: string
  icon: 'sparklesAlt' | 'brush'
}> = [
  {
    value: 'depth-rebuild',
    label: 'AI 深度重建',
    description: '換演員、服裝與場景，不必先畫人物遮罩。',
    badge: '推薦',
    icon: 'sparklesAlt',
  },
  {
    value: 'mask-composite',
    label: '精修遮罩合成',
    description: '保留原演員像素，逐段檢查頭髮、手指與遮擋。',
    badge: '進階',
    icon: 'brush',
  },
]

export function LiveCompositeModeSelector({ value, onChange, disabled = false }: LiveCompositeModeSelectorProps) {
  return (
    <section className="border-b border-white/10 bg-[#090c10] px-4 py-4" aria-labelledby="live-composite-mode-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="live-composite-mode-heading" className="text-sm font-semibold text-stone-100">
          先選擇要保留什麼
        </h2>
        <span className="font-mono text-xs tracking-wide text-stone-600">WORKFLOW</span>
      </div>

      <div className="grid gap-2" role="radiogroup" aria-label="實拍處理方式">
        {MODES.map((mode) => {
          const selected = value === mode.value
          return (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(mode.value)}
              className={`group relative overflow-hidden rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-not-allowed disabled:opacity-50 ${
                selected
                  ? mode.value === 'depth-rebuild'
                    ? 'border-cyan-300/60 bg-cyan-300/[0.09]'
                    : 'border-violet-300/50 bg-violet-300/[0.08]'
                  : 'border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.05]'
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 w-0.5 ${
                  selected ? (mode.value === 'depth-rebuild' ? 'bg-cyan-300' : 'bg-violet-300') : 'bg-transparent'
                }`}
              />
              <span className="flex items-start gap-3">
                <span
                  className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border ${
                    selected
                      ? mode.value === 'depth-rebuild'
                        ? 'border-cyan-300/40 bg-cyan-300/10 text-cyan-200'
                        : 'border-violet-300/40 bg-violet-300/10 text-violet-200'
                      : 'border-white/10 bg-black/20 text-stone-500'
                  }`}
                >
                  <AppIcon name={mode.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-stone-100">{mode.label}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        selected
                          ? mode.value === 'depth-rebuild'
                            ? 'border-cyan-300/30 text-cyan-200'
                            : 'border-violet-300/30 text-violet-200'
                          : 'border-white/10 text-stone-500'
                      }`}
                    >
                      {mode.badge}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-stone-400">{mode.description}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
