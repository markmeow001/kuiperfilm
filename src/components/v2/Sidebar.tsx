'use client'

/**
 * Phase 12 — v2 workspace sidebar.
 *
 * Ported from ~/Downloads/kino_mockup.jsx Sidebar() but parameterised:
 *   - currentStep        which step is highlighted
 *   - onSelect(stepId)   click handler (router.push at the call site)
 *   - userName / credits user block in the footer
 *
 * Visual: 264px wide (w-64), stone-950 background, amber accents, tracking
 * the design tokens from docs/ui-redesign/03-design-system.md as best as we
 * can while reusing existing glass tokens for dark/light parity.
 */

import { AppIcon } from '@/components/ui/icons'
import { V2_STEPS, type V2StepId, v2StepIndex } from './v2-types'

interface SidebarProps {
  currentStep: V2StepId
  onSelect: (stepId: V2StepId) => void
  /** Optional user / credits block in the footer; pass null to hide. */
  user?: {
    initial: string
    name: string
    credits?: string
  } | null
}

export function Sidebar({ currentStep, onSelect, user }: SidebarProps) {
  const currentIdx = v2StepIndex(currentStep)

  return (
    <aside className="flex w-64 flex-col border-r border-amber-900/20 bg-stone-950 text-stone-200">
      {/* Logo */}
      <div className="border-b border-amber-900/15 px-7 pt-8 pb-10">
        <div className="flex items-baseline gap-1.5">
          <div className="font-display text-3xl font-semibold italic tracking-tight text-amber-400">
            Kuiper
          </div>
          <div className="font-serif-cn text-xl font-medium text-stone-100">影界</div>
        </div>
        <div className="mt-1 font-mono text-[10px] tracking-[0.2em] text-stone-500">
          AI · MANHUA · STUDIO
        </div>
      </div>

      {/* Steps */}
      <nav className="flex-1 space-y-1 px-4 py-6">
        {V2_STEPS.map((step, idx) => {
          const active = step.id === currentStep
          const completed = currentIdx > idx
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onSelect(step.id)}
              className={`group flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-all ${
                active
                  ? 'border-amber-500/30 bg-amber-500/10'
                  : 'border-transparent hover:bg-stone-900/60'
              }`}
            >
              <div
                className={`w-6 font-mono text-[10px] tracking-wider ${
                  active ? 'text-amber-400' : completed ? 'text-amber-700' : 'text-stone-600'
                }`}
              >
                {step.num}
              </div>
              <AppIcon
                name={step.icon}
                className={`h-4 w-4 ${
                  active ? 'text-amber-400' : completed ? 'text-amber-700' : 'text-stone-500'
                }`}
              />
              <div className="flex-1">
                <div
                  className={`font-serif-cn text-sm leading-none ${
                    active ? 'text-amber-100' : 'text-stone-300'
                  }`}
                >
                  {step.label}
                </div>
                <div className="mt-0.5 font-fraunces text-[10px] italic text-stone-600">
                  {step.subtitle}
                </div>
              </div>
              {completed ? <AppIcon name="check" className="h-3 w-3 text-amber-700" /> : null}
            </button>
          )
        })}
      </nav>

      {/* User block */}
      {user ? (
        <div className="border-t border-amber-900/15 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-rose-700 font-display text-sm text-stone-100">
              {user.initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-body text-sm text-stone-200">{user.name}</div>
              {user.credits ? (
                <div className="mt-0.5 font-mono text-[10px] text-amber-600/70">{user.credits}</div>
              ) : null}
            </div>
            <AppIcon name="settingsHex" className="h-4 w-4 text-stone-600" />
          </div>
        </div>
      ) : null}
    </aside>
  )
}
