'use client'

/**
 * Phase 0 redesign — MediaReveal v2 (§3.7.2 signature moment).
 *
 * Reference: DESIGN.md §3.3 (signature moment "Result reveal").
 *
 * The spec:
 *   - Frame fades from black 600ms
 *   - Scale 0.96 → 1.0 spring
 *   - First frame holds 400ms
 *   - Then muted autoplay
 *   - Chrome around player dims to 40% opacity for 2 seconds
 *
 * Why so much choreography for "video appeared": this is the dopamine
 * hit moment. Protect it. The 600ms fade gives the brain time to
 * register "something just landed". The 400ms hold prevents the user
 * from missing the first frame (which often carries the storyboard
 * intent). The 2s chrome dim isolates the player visually — eye locks
 * to the video, then comes back.
 *
 * Usage pattern: pair with GenerationProgress. When the run completes,
 * the parent swaps from GenerationProgress to MediaReveal in the same
 * slot. MediaReveal owns the reveal animation; downstream the user
 * sees a normal <video> with native controls.
 *
 * Chrome dim: opt-in via `dimChromeOnReveal`. When true, sets
 * data-media-revealing="true" on document.body for 2 seconds. Pages
 * can hook this attribute in CSS to dim their nav / sidebar:
 *
 *   body[data-media-revealing="true"] .ws-chrome { opacity: 0.4; }
 *
 * Defaults: dim ON, autoplay ON (muted required by browser policy),
 * loop ON. All overridable.
 *
 * Respects prefers-reduced-motion: skips the reveal animation, jumps
 * straight to opacity 1 and playback.
 */

import { useEffect, useRef, useState } from 'react'

export interface MediaRevealV2Props {
  /** Video URL — http(s) or signed COS URL. */
  src: string
  /** Optional poster (first-frame image). Shows during the 400ms hold
   *  before playback starts. Recommended for the holistic reveal. */
  poster?: string
  /** Aspect ratio of the frame. Default '9:16'. */
  aspectRatio?: '9:16' | '16:9' | '1:1'
  /** Whether to dim the rest of the chrome via body[data-media-revealing]. Default true. */
  dimChromeOnReveal?: boolean
  /** Loop the video. Default true. */
  loop?: boolean
  /** Show native video controls. Default true. */
  controls?: boolean
  /** Optional className on the outer wrapper. */
  className?: string
  /** Called once the reveal animation completes (post-400ms hold).
   *  Useful for tracking moments. */
  onRevealComplete?: () => void
}

export function MediaReveal({
  src,
  poster,
  aspectRatio = '9:16',
  dimChromeOnReveal = true,
  loop = true,
  controls = true,
  className,
  onRevealComplete,
}: MediaRevealV2Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [phase, setPhase] = useState<'pre' | 'revealing' | 'holding' | 'playing'>(
    'pre',
  )

  // Reveal sequence — RAF-stepped so phases hand off cleanly.
  //   pre        → revealing (RAF 1 tick after mount; lets initial
  //                style apply before transition fires)
  //   revealing  → holding   (after 600ms fade + scale)
  //   holding    → playing   (after 400ms; .play() fires here)
  useEffect(() => {
    const prefersReduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (prefersReduce) {
      setPhase('playing')
      videoRef.current?.play().catch(() => {})
      onRevealComplete?.()
      return
    }

    const r1 = requestAnimationFrame(() => setPhase('revealing'))
    const t1 = setTimeout(() => setPhase('holding'), 600)
    const t2 = setTimeout(() => {
      setPhase('playing')
      videoRef.current?.play().catch(() => {})
      onRevealComplete?.()
    }, 1000)

    return () => {
      cancelAnimationFrame(r1)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [onRevealComplete, src])

  // Chrome dim — toggle a body data attribute so pages can opt in via
  // CSS rules of their own. Cleanup after 2s + on unmount.
  useEffect(() => {
    if (!dimChromeOnReveal || typeof document === 'undefined') return
    if (phase !== 'revealing' && phase !== 'holding' && phase !== 'playing') return
    document.body.setAttribute('data-media-revealing', 'true')
    const t = setTimeout(() => {
      document.body.removeAttribute('data-media-revealing')
    }, 2000)
    return () => {
      clearTimeout(t)
      document.body.removeAttribute('data-media-revealing')
    }
  }, [phase, dimChromeOnReveal])

  const [aw, ah] = aspectRatio.split(':').map(Number)
  const isPortrait = ah > aw
  const frameStyle: React.CSSProperties = {
    aspectRatio: `${aw} / ${ah}`,
    width: isPortrait ? 'auto' : '100%',
    height: isPortrait ? 'min(72vh, 720px)' : 'auto',
    maxWidth: '100%',
    maxHeight: 'min(72vh, 720px)',
  }

  // Reveal animation: opacity 0→1 + transform scale 0.96→1 across 600ms
  // with the ease-spring curve. Black backdrop visible during reveal so
  // the fade is from-black not from-transparent.
  const isRevealed = phase !== 'pre'
  const revealStyle: React.CSSProperties = {
    opacity: isRevealed ? 1 : 0,
    transform: isRevealed ? 'scale(1)' : 'scale(0.96)',
    transition:
      'opacity 600ms cubic-bezier(0.16, 1, 0.3, 1), transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1)',
  }

  const classes = [
    'relative flex w-full items-center justify-center bg-canvas py-10',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <div
        className="relative overflow-hidden rounded-card border border-border-soft bg-black"
        style={{ ...frameStyle, ...revealStyle }}
      >
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          muted
          loop={loop}
          controls={controls && phase === 'playing'}
          playsInline
          className="h-full w-full object-contain"
        />
      </div>
    </div>
  )
}
