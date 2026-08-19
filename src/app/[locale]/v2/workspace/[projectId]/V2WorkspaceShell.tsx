'use client'

/**
 * Phase 12 — shared layout shell for every v2 workspace page.
 *
 * Renders the sidebar + top bar + main scrollable content area, and
 * lets each page just supply its body. Routing on sidebar click is
 * the page's responsibility (handled here via Next.js router).
 */

import { useRouter, usePathname } from 'next/navigation'
import { Sidebar } from '@/components/v2/Sidebar'
import { TopBar } from '@/components/v2/TopBar'
import type { V2StepId } from '@/components/v2/v2-types'
import { V2EpisodeTabBar } from './V2EpisodeTabBar'
import { useEpisodePreservingHref } from './hooks/useEpisodePreservingHref'
import { useStickyStep } from './hooks/useStickyStep'
import studioStyles from '../../StudioShell.module.css'

interface V2WorkspaceShellProps {
  projectId: string
  locale: string
  currentStep: V2StepId
  projectName?: string
  draftNumber?: number
  tone?: 'darkroom' | 'paper'
  children: React.ReactNode
}

export function V2WorkspaceShell({
  projectId,
  locale,
  currentStep,
  projectName,
  draftNumber,
  tone = 'darkroom',
  children,
}: V2WorkspaceShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const buildHref = useEpisodePreservingHref()

  // Record this step as the user's last position on the project so
  // returning to /v2/workspace/[id] (F5, sidebar logo, etc.) lands here.
  useStickyStep(projectId, currentStep)

  function handleSelect(stepId: V2StepId) {
    // Map "home" to no suffix so /v2/workspace/[id] is the home page.
    const tail = stepId === 'home' ? '' : `/${stepId}`
    const basePath = `/${locale}/v2/workspace/${projectId}${tail}`
    if (pathname === basePath) return
    // Carry ?episode=<id> across stage tabs so working on episode 4
    // and switching script→subjects→storyboard stays on episode 4.
    // Without this the destination falls back to "first episode in
    // project" via useCurrentEpisode's resolution order.
    //
    // 2026-05-13 — sidebar "首頁" click needs ?stay=1 to defeat the
    // server-side sticky-step redirect on page.tsx. Without this, the
    // sidebar 首頁 button is a dead button: route → page.tsx sees no
    // stay flag → reads UserProjectState.lastStep (which is the step
    // the user is leaving from) → redirects right back. Step pages
    // don't need the flag because their server pages don't redirect.
    const href = buildHref(basePath)
    const finalHref = stepId === 'home'
      ? (href.includes('?') ? `${href}&stay=1` : `${href}?stay=1`)
      : href
    router.push(finalHref)
  }

  const shellClassName = currentStep === 'home'
    ? 'kuiper-dashboard kuiper-workspace font-body flex min-h-screen text-text-primary'
    : 'kuiper-stage kuiper-workspace font-body flex min-h-screen text-text-primary'

  return (
    <div
      className={`${studioStyles.studioRoot} ${studioStyles.canvasAtmosphere} ${shellClassName}`}
      data-workspace-tone={tone}
      data-studio-theme="dark"
    >
      <Sidebar currentStep={currentStep} onSelect={handleSelect} locale={locale} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden pb-20 lg:pb-0">
        <TopBar
          currentStep={currentStep}
          projectId={projectId}
          projectName={projectName}
          draftNumber={draftNumber}
          locale={locale}
        />
        {currentStep !== 'home' ? (
          <V2EpisodeTabBar
            projectId={projectId}
            locale={locale}
            projectName={projectName}
            tone={tone}
          />
        ) : null}
        <div className="flex-1 overflow-y-auto bg-[var(--darkroom-canvas)]">
          {children}
        </div>
      </main>
    </div>
  )
}
