'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons/registry'
import { ProductionBrand } from '@/components/v2/ProductionBrand'

interface V2HomeRailProps {
  locale: string
}

interface RailItem {
  id: string
  href: string
  icon: AppIconName
  label: string
  shortLabel: string
}

export function V2HomeRail({ locale }: V2HomeRailProps) {
  const pathname = usePathname()
  const t = useTranslations('v2Home.rail')
  const [moreOpen, setMoreOpen] = useState(false)
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const morePanelRef = useRef<HTMLElement>(null)
  const productionItems: RailItem[] = [
    {
      id: 'projects',
      href: `/${locale}/v2`,
      icon: 'clapperboard',
      label: t('projectsLabel'),
      shortLabel: t('projects'),
    },
    {
      id: 'create',
      href: `/${locale}/v2/new`,
      icon: 'plus',
      label: t('newLabel'),
      shortLabel: t('new'),
    },
    {
      id: 'jobs',
      href: `/${locale}/v2/jobs`,
      icon: 'receipt',
      label: t('jobsLabel'),
      shortLabel: t('jobs'),
    },
    {
      id: 'assets',
      href: `/${locale}/workspace/asset-hub`,
      icon: 'package',
      label: t('assetsLabel'),
      shortLabel: t('assets'),
    },
  ]
  const creativeItems: RailItem[] = [
    {
      id: 'canvas',
      href: `/${locale}/canvas`,
      icon: 'image',
      label: t('canvasLabel'),
      shortLabel: t('canvas'),
    },
    {
      id: 'playground',
      href: `/${locale}/playground`,
      icon: 'sparklesAlt',
      label: t('playgroundLabel'),
      shortLabel: t('playground'),
    },
    {
      id: 'visual-development',
      href: `/${locale}/visual-development`,
      icon: 'brain',
      label: t('visualDevelopmentLabel'),
      shortLabel: t('visualDevelopment'),
    },
    {
      id: 'live-composite',
      href: `/${locale}/live-composite`,
      icon: 'video',
      label: t('compositeLabel'),
      shortLabel: t('composite'),
    },
    {
      id: 'skills',
      href: `/${locale}/skills`,
      icon: 'diamond',
      label: t('skillsLabel'),
      shortLabel: t('skills'),
    },
  ]
  const accountItems: RailItem[] = [
    {
      id: 'workspaces',
      href: `/${locale}/workspaces`,
      icon: 'userAlt',
      label: t('workspacesLabel'),
      shortLabel: t('workspaces'),
    },
    {
      id: 'settings',
      href: `/${locale}/profile`,
      icon: 'settingsHex',
      label: t('settingsLabel'),
      shortLabel: t('settings'),
    },
  ]
  const groups = [
    { id: 'production', label: t('productionGroup'), items: productionItems },
    { id: 'creative-lab', label: t('creativeLabGroup'), items: creativeItems },
    { id: 'account-team', label: t('accountTeamGroup'), items: accountItems },
  ]
  const mobileItems = productionItems
  const moreItems = [...creativeItems, ...accountItems]
  const moreActive = moreItems.some((item) => isRailItemActive(pathname, item))

  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!moreOpen) return

    morePanelRef.current?.querySelector<HTMLAnchorElement>('a[href]')?.focus()

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMoreOpen(false)
      moreButtonRef.current?.focus()
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [moreOpen])

  return (
    <>
      <aside className="kuiper-shell-rail fixed inset-y-0 left-0 z-40 hidden w-[76px] flex-col border-r lg:flex xl:w-[272px]">
        <div className="kuiper-shell-divider flex h-[76px] shrink-0 items-center border-b px-[18px] xl:px-5">
          <span className="xl:hidden"><ProductionBrand locale={locale} compact tone="dark" /></span>
          <span className="hidden xl:block"><ProductionBrand locale={locale} tone="dark" /></span>
        </div>

        <nav aria-label={t('primaryNav')} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-4 xl:px-3">
          {groups.map((group, index) => (
            <div
              key={group.id}
              role="group"
              aria-label={group.label}
              className={index === 0 ? '' : 'kuiper-shell-divider mt-4 border-t pt-4'}
            >
              <div className="mb-2 hidden px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--darkroom-muted)] xl:block">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <DesktopRailLink
                    key={item.id}
                    item={item}
                    active={isRailItemActive(pathname, item)}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {moreOpen ? (
        <nav
          ref={morePanelRef}
          id="kuiper-mobile-more-panel"
          aria-label={t('morePanel')}
          className="fixed inset-x-3 bottom-[84px] z-50 max-h-[calc(100dvh-112px)] overflow-y-auto rounded-2xl border border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] p-3 shadow-[0_16px_48px_rgba(0,0,0,0.48)] lg:hidden"
        >
          <div className="mb-2 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--process-cyan-strong)]">
            {t('creativeLabGroup')}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {creativeItems.map((item) => (
              <MobileMoreLink
                key={item.id}
                item={item}
                active={isRailItemActive(pathname, item)}
                onNavigate={() => setMoreOpen(false)}
              />
            ))}
          </div>
          <div className="kuiper-shell-divider my-3 border-t" />
          <div className="mb-2 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--darkroom-muted)]">
            {t('accountTeamGroup')}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {accountItems.map((item) => (
              <MobileMoreLink
                key={item.id}
                item={item}
                active={isRailItemActive(pathname, item)}
                onNavigate={() => setMoreOpen(false)}
              />
            ))}
          </div>
        </nav>
      ) : null}

      <nav aria-label={t('mobileNav')} className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-5 rounded-2xl border border-[var(--darkroom-border)] bg-[var(--studio-chrome)]/95 p-2 shadow-[0_12px_36px_rgba(3,8,12,0.28)] backdrop-blur-xl lg:hidden">
        {mobileItems.map((item) => {
          const active = isRailItemActive(pathname, item)
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-medium ${
                active
                  ? 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
                  : 'text-[var(--darkroom-muted)]'
              }`}
            >
              <AppIcon name={item.icon} className="h-4 w-4" />
              <span>{item.shortLabel}</span>
            </Link>
          )
        })}
        <button
          ref={moreButtonRef}
          type="button"
          aria-label={t('moreLabel')}
          aria-expanded={moreOpen}
          aria-controls="kuiper-mobile-more-panel"
          aria-current={moreActive ? 'page' : undefined}
          onClick={() => setMoreOpen((current) => !current)}
          className={`flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-medium ${
            moreOpen || moreActive
              ? 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
              : 'text-[var(--darkroom-muted)]'
          }`}
        >
          <AppIcon name="menu" className="h-4 w-4" />
          <span>{t('more')}</span>
        </button>
      </nav>
    </>
  )
}

function isRailItemActive(pathname: string | null, item: RailItem) {
  if (!pathname) return false
  if (item.id === 'projects') return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

function DesktopRailLink({ item, active }: { item: RailItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      data-active={active}
      className="kuiper-shell-nav-item group flex min-h-11 w-full items-center justify-center gap-3 rounded-xl px-2 py-2.5 text-[13px] font-medium xl:justify-start xl:px-3"
    >
      <AppIcon
        name={item.icon}
        className={`h-[18px] w-[18px] shrink-0 ${
          active
            ? 'text-[var(--process-cyan-strong)]'
            : 'text-current group-hover:text-[var(--process-cyan-strong)]'
        }`}
      />
      <span className="hidden min-w-0 flex-1 truncate xl:block">{item.label}</span>
      {active ? (
        <span className="hidden h-1.5 w-1.5 rounded-full bg-[var(--process-cyan)] xl:block" />
      ) : null}
    </Link>
  )
}

function MobileMoreLink({
  item,
  active,
  onNavigate,
}: {
  item: RailItem
  active: boolean
  onNavigate: () => void
}) {
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={`flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-medium ${
        active
          ? 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
          : 'text-[var(--darkroom-text)] hover:bg-white/[0.05]'
      }`}
    >
      <AppIcon name={item.icon} className="h-4 w-4 shrink-0" />
      <span>{item.shortLabel}</span>
    </Link>
  )
}
