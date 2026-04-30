'use client'

/**
 * Phase 12 — v2 workspace top bar.
 *
 * Ported from ~/Downloads/kino_mockup.jsx TopBar(): renders STEP NN —
 * SUBTITLE caption on the left, project title + DRAFT NN/06 on the
 * right, and a 6-segment progress strip below.
 */

import { findV2Step, V2_STEPS, v2StepIndex, type V2StepId } from './v2-types'

interface TopBarProps {
  currentStep: V2StepId
  /** Project name shown on the right. */
  projectName?: string
  /** Optional draft number (default 01). Matched by the DRAFT NN/06 caption. */
  draftNumber?: number
}

export function TopBar({ currentStep, projectName, draftNumber }: TopBarProps) {
  const step = findV2Step(currentStep)
  const stepIdx = v2StepIndex(currentStep)
  const totalSteps = V2_STEPS.length
  const draftLabel = String(draftNumber ?? 1).padStart(2, '0')

  return (
    <div className="border-b border-amber-900/15 px-12 pt-8 pb-6">
      <div className="flex items-end justify-between gap-6">
        <div>
          <div className="mb-2 font-mono text-[11px] tracking-[0.3em] text-amber-600/80">
            STEP {step.num} — {step.subtitle.toUpperCase()}
          </div>
          <h1 className="font-serif-cn text-4xl font-medium tracking-wide text-stone-100">
            {step.label}
            <span className="ml-3 font-display text-2xl font-normal italic text-amber-500/70">
              {step.subtitle}
            </span>
          </h1>
        </div>
        <div className="text-right">
          {projectName ? (
            <div className="font-fraunces text-sm italic text-stone-500">《{projectName}》</div>
          ) : null}
          <div className="mt-1 font-mono text-[10px] tracking-wider text-stone-600">
            DRAFT · {draftLabel}/{String(totalSteps).padStart(2, '0')}
          </div>
        </div>
      </div>

      {/* Progress strip */}
      <div className="mt-6 flex items-center gap-1">
        {V2_STEPS.map((s, i) => (
          <div
            key={s.id}
            className={`h-px flex-1 transition-all ${
              i <= stepIdx ? 'bg-amber-500' : 'bg-stone-800'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
