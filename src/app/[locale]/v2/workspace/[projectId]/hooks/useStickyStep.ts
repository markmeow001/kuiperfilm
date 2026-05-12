'use client'

import { useEffect, useRef } from 'react'

export type StickyStep = 'home' | 'script' | 'subjects' | 'storyboard' | 'voice' | 'final'

/**
 * Records the user's current step on a project so that returning to
 * /v2/workspace/[projectId] redirects back here.
 *
 * Fires once per mount (one POST per step navigation). Failures are
 * swallowed — sticky-step is best-effort UX, not a correctness path.
 */
export function useStickyStep(projectId: string, step: StickyStep) {
  const lastReported = useRef<string | null>(null)

  useEffect(() => {
    const key = `${projectId}:${step}`
    if (lastReported.current === key) return
    lastReported.current = key

    const controller = new AbortController()
    fetch(`/api/user/project-state/${encodeURIComponent(projectId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastStep: step }),
      signal: controller.signal,
    }).catch(() => {
      // Best-effort — ignore network/abort errors.
    })

    return () => controller.abort()
  }, [projectId, step])
}
