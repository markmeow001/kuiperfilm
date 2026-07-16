'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons/registry'

interface V2HomeRailProps {
  locale: string
}

interface RailItem {
  href: string
  icon: AppIconName
  label: string
  shortLabel: string
}

export function V2HomeRail({ locale }: V2HomeRailProps) {
  const pathname = usePathname()
  const t = useTranslations('v2Home.rail')
  const items: RailItem[] = [
    {
      href: `/${locale}/v2`,
      icon: 'clapperboard',
      label: t('projectsLabel'),
      shortLabel: t('projects'),
    },
    {
      href: `/${locale}/v2/new`,
      icon: 'plus',
      label: t('newLabel'),
      shortLabel: t('new'),
    },
    {
      href: `/${locale}/canvas`,
      icon: 'image',
      label: t('canvasLabel'),
      shortLabel: t('canvas'),
    },
    {
      href: `/${locale}/playground`,
      icon: 'sparklesAlt',
      label: t('playgroundLabel'),
      shortLabel: t('playground'),
    },
    {
      href: `/${locale}/live-composite`,
      icon: 'video',
      label: t('compositeLabel'),
      shortLabel: t('composite'),
    },
    {
      href: `/${locale}/skills`,
      icon: 'diamond',
      label: t('skillsLabel'),
      shortLabel: t('skills'),
    },
  ]

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[88px] flex-col border-r border-white/[0.07] bg-[#080809] lg:flex">
        <Link
          href={`/${locale}/v2`}
          aria-label="Kuiper 影界首頁"
          className="flex h-20 items-center justify-center border-b border-white/[0.07]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500 font-display text-xl font-black italic text-black">
            K
          </span>
        </Link>

        <nav aria-label="主要工具" className="flex flex-1 flex-col items-center gap-2 px-2 py-5">
          {items.map((item) => {
            const active =
              item.href === `/${locale}/v2`
                ? pathname === item.href
                : pathname?.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`group flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-3 text-[11px] transition-colors ${
                  active
                    ? 'bg-white/[0.07] text-white'
                    : 'text-text-tertiary hover:bg-white/[0.04] hover:text-text-primary'
                }`}
              >
                <AppIcon
                  name={item.icon}
                  className={`h-[18px] w-[18px] ${
                    active ? 'text-primary-400' : 'text-current group-hover:text-primary-400'
                  }`}
                />
                <span>{item.shortLabel}</span>
              </Link>
            )
          })}
        </nav>

        <div className="pb-5 text-center font-mono text-[9px] tracking-[0.18em] text-text-tertiary">
          {t('studio')}
        </div>
      </aside>

      <nav
        aria-label="行動版主要工具"
        className="fixed inset-x-3 bottom-3 z-50 flex items-center justify-around rounded-2xl border border-white/10 bg-[#111113]/95 px-2 py-2 shadow-2xl backdrop-blur-xl lg:hidden"
      >
        {items.slice(0, 5).map((item) => {
          const active =
            item.href === `/${locale}/v2`
              ? pathname === item.href
              : pathname?.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`flex min-w-12 flex-col items-center gap-1 rounded-xl px-2 py-1.5 text-[10px] ${
                active ? 'bg-white/[0.07] text-primary-400' : 'text-text-tertiary'
              }`}
            >
              <AppIcon name={item.icon} className="h-4 w-4" />
              <span>{item.shortLabel}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
