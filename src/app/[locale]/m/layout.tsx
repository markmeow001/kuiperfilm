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
  return (
    <div className="grain min-h-[100svh] bg-stone-950 text-stone-200">
      <DesktopOverrideBanner />
      {children}
    </div>
  )
}
