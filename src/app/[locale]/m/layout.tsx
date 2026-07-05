/**
 * Mobile review portal layout (`/[locale]/m/*`).
 *
 * Purpose: lightweight read-only review surface for team leads to
 * check on team members' work from a phone while away from a desktop.
 * Desktop UI (V2 workspace) stays untouched — this is a parallel
 * surface that reuses the same hooks / APIs.
 *
 * Scope (2026-07-04): the mobile HOME is /m/playground — conversational
 * image generation (chat thread over the playground run spine). Review
 * remains at /m/projects (project list → episode list → per-panel
 * review). Heavier authoring (storyboard/multi-shot) still lives on
 * /v2/* on a real screen.
 *
 * Phone UAs are auto-redirected here by the middleware (see
 * src/lib/mobile-detection.ts); the desktop-override banner opts out.
 */
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { DesktopOverrideBanner } from './DesktopOverrideBanner'

export const metadata: Metadata = {
  title: 'Kuiper · Mobile Review',
  // Tighter mobile viewport so iOS doesn't auto-scale forms.
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover',
}

export default function MobileLayout({ children }: { children: ReactNode }) {
  // One flex column exactly the viewport tall: the banner takes its row and
  // children get the REST (min-h-0 so inner scroll areas work). Stacking the
  // banner above a 100svh child pushed the page below the fold — the chat
  // top bar (model picker) slid underneath the sticky banner and "vanished".
  return (
    <div className="grain flex h-[100svh] flex-col bg-stone-950 text-stone-200">
      <DesktopOverrideBanner />
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
