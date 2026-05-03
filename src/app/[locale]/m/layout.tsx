/**
 * Mobile review portal layout (`/[locale]/m/*`).
 *
 * Purpose: lightweight read-only review surface for team leads to
 * check on team members' work from a phone while away from a desktop.
 * Desktop UI (V2 workspace) stays untouched — this is a parallel
 * surface that reuses the same hooks / APIs.
 *
 * Scope: project list → episode list → per-panel review (image +
 * video + dialogue). NO creation / NO editing / NO generation. If a
 * mobile user ever needs to author content, they fall back to /v2/*
 * on a real screen.
 *
 * The route is intentionally not wired into the desktop nav. Users
 * type the URL or bookmark it. We may add a UA-detect redirect later
 * once the surface is proven.
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
