'use client'

/**
 * Phase 0 redesign — GenerationProgress v2 (§3.7.1 signature moment).
 *
 * Reference: DESIGN.md §3.3 (signature moment "Generation in progress"),
 * REDESIGN_PLAN.md §3.8 anti-patterns #8 (no loading spinner for AI gen).
 *
 * The spec:
 *   - Full-bleed dark canvas
 *   - 9:16 frame centered
 *   - process-cyan border in a slow 2s breathing loop
 *   - One line of ghost-typing scene description
 *   - NO spinner
 *   - NO percentage
 *   - Estimated time in silent tertiary text below description
 *
 * Why no spinner: spinners imply "we're working on it" but say nothing
 * about WHAT. Ghost-typing the actual scene description does both —
 * communicates progress AND continues the cinematic frame. Spinners
 * also tell the user "this is a tool"; ghost-typing tells them "this
 * is a craft".
 *
 * Why no percentage: AI generation is non-linear (model warm-up vs.
 * inference vs. post-processing each take wildly different fractions
 * of total time). A percentage is either fake or jumpy; both erode
 * trust. Silent tertiary ETA in natural-language ("約 90 秒") gives
 * the user a frame without committing to false precision.
 *
 * Respects prefers-reduced-motion: breathing animation goes static.
 */

import { useEffect, useRef, useState } from 'react'

export interface GenerationProgressV2Props {
  /** Scene description that ghost-types into the frame. */
  description: string
  /** Human-readable ETA ("約 90 秒", "預計 2 分鐘"). Skip when unknown. */
  eta?: string
  /** Aspect ratio of the frame. Default '9:16' (short-drama vertical). */
  aspectRatio?: '9:16' | '16:9' | '1:1'
  /** Optional className on the outer wrapper. */
  className?: string
  /** Optional: pause the ghost-typing animation (e.g. when the run
   *  has actually completed and we're about to swap in MediaReveal). */
  paused?: boolean
}

export function GenerationProgress({
  description,
  eta,
  aspectRatio = '9:16',
  className,
  paused = false,
}: GenerationProgressV2Props) {
  const [typed, setTyped] = useState('')
  const iRef = useRef(0)

  // Ghost-typing — reveals one character per ~50ms, then pauses 2s,
  // then erases back to 0 and starts over. Creates the illusion that
  // an unseen director is dictating the scene as the model renders.
  useEffect(() => {
    if (paused) return
    iRef.current = 0
    setTyped('')
    let cancelled = false
    let direction: 'typing' | 'pausing' | 'erasing' = 'typing'
    let pauseUntil = 0
    const tick = () => {
      if (cancelled) return
      const now = performance.now()
      if (direction === 'pausing' && now < pauseUntil) {
        requestAnimationFrame(tick)
        return
      }
      if (direction === 'typing') {
        if (iRef.current >= description.length) {
          direction = 'pausing'
          pauseUntil = now + 2000
        } else {
          iRef.current += 1
          setTyped(description.slice(0, iRef.current))
        }
      } else if (direction === 'pausing') {
        direction = 'erasing'
      } else if (direction === 'erasing') {
        if (iRef.current <= 0) {
          direction = 'typing'
        } else {
          iRef.current -= 2
          setTyped(description.slice(0, Math.max(0, iRef.current)))
        }
      }
      setTimeout(() => requestAnimationFrame(tick), direction === 'erasing' ? 30 : 50)
    }
    const id = setTimeout(() => requestAnimationFrame(tick), 200)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [description, paused])

  const [aw, ah] = aspectRatio.split(':').map(Number)
  const frameStyle: React.CSSProperties = {
    aspectRatio: `${aw} / ${ah}`,
    width: ah > aw ? 'auto' : '100%',
    height: ah > aw ? 'min(72vh, 720px)' : 'auto',
    maxWidth: '100%',
    maxHeight: 'min(72vh, 720px)',
  }

  const classes = [
    'relative flex w-full flex-col items-center justify-center bg-canvas py-10',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} role="status" aria-live="polite">
      <div
        className="relative overflow-hidden rounded-card border-2"
        style={{
          ...frameStyle,
          borderColor: 'rgba(85, 175, 192, 0.4)',
          animation: paused ? 'none' : 'kvBreathe 2s ease-in-out infinite',
        }}
      >
        {/* Inner gradient hint — pure canvas + faint accent wash for depth */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 60%, rgba(85, 175, 192, 0.10), transparent 60%)',
          }}
        />
      </div>

      <div className="mt-6 w-full max-w-[480px] px-4 text-center">
        <p className="min-h-[42px] text-[14px] leading-[1.6] text-text-secondary">
          {typed}
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] bg-text-secondary"
            style={{ animation: paused ? 'none' : 'kvCaret 1.05s steps(2) infinite' }}
          />
        </p>
        {eta ? (
          <p className="mt-3 text-[12px] uppercase tracking-[0.04em] text-text-tertiary">
            {eta}
          </p>
        ) : null}
      </div>

      <style jsx>{`
        @keyframes kvBreathe {
          0%, 100% {
            border-color: rgba(85, 175, 192, 0.25);
            box-shadow:
              0 0 0 2px rgba(85, 175, 192, 0.0),
              0 0 48px rgba(85, 175, 192, 0.18);
          }
          50% {
            border-color: rgba(85, 175, 192, 0.65);
            box-shadow:
              0 0 0 2px rgba(85, 175, 192, 0.35),
              0 0 72px rgba(85, 175, 192, 0.45);
          }
        }
        @keyframes kvCaret {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          /* Kill both breath + caret animations per §3.5. */
          div, span { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
