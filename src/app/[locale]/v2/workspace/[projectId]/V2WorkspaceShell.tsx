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

interface V2WorkspaceShellProps {
  projectId: string
  locale: string
  currentStep: V2StepId
  projectName?: string
  draftNumber?: number
  children: React.ReactNode
}

export function V2WorkspaceShell({
  projectId,
  locale,
  currentStep,
  projectName,
  draftNumber,
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
    router.push(buildHref(basePath))
  }

  return (
    <div className="font-body grain flex min-h-screen bg-stone-950 text-stone-200">
      <Sidebar currentStep={currentStep} onSelect={handleSelect} locale={locale} />
      <main className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          currentStep={currentStep}
          projectId={projectId}
          projectName={projectName}
          draftNumber={draftNumber}
        />
        {currentStep !== 'home' ? (
          <V2EpisodeTabBar projectId={projectId} locale={locale} projectName={projectName} />
        ) : null}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  )
}
