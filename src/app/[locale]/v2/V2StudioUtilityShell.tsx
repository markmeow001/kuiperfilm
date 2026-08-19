import type { ReactNode } from 'react'
import { NotificationBell } from '@/components/v2/NotificationBell'
import { UserMenu } from '@/components/v2/UserMenu'
import { V2HomeRail } from './V2HomeRail'
import studioStyles from './StudioShell.module.css'

interface V2StudioUtilityShellProps {
  locale: string
  title: ReactNode
  tagline: ReactNode
  children: ReactNode
}

/**
 * Shared frame for project-adjacent studio utilities such as the Job Center.
 * These pages belong to the global studio rail, but are not a numbered
 * production step inside a single project.
 */
export function V2StudioUtilityShell({
  locale,
  title,
  tagline,
  children,
}: V2StudioUtilityShellProps) {
  return (
    <div
      className={`${studioStyles.studioRoot} ${studioStyles.canvasAtmosphere} kuiper-dashboard min-h-screen pb-24 lg:pb-0 lg:pl-[76px] xl:pl-[272px]`}
      data-studio-theme="dark"
    >
      <V2HomeRail locale={locale} />

      <header className="kuiper-dashboard-topbar sticky top-0 z-30 border-b px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[52px] max-w-[1540px] items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-[var(--darkroom-text)]">
              {title}
            </div>
            <div className="mt-0.5 hidden truncate font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--darkroom-muted)] sm:block">
              {tagline}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <NotificationBell locale={locale} />
            <UserMenu locale={locale} />
          </div>
        </div>
      </header>

      {children}
    </div>
  )
}
