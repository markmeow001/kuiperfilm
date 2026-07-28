'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import type { AppIconName } from '@/components/ui/icons/registry'

interface V2WorkflowLauncherProps {
  locale: string
}

interface WorkflowItem {
  href: string
  icon: AppIconName
  title: string
  description: string
  meta: string
  accentClass: string
}

export function V2WorkflowLauncher({ locale }: V2WorkflowLauncherProps) {
  const t = useTranslations('v2Home.workflows')
  const items: WorkflowItem[] = [
    {
      href: `/${locale}/v2/new`,
      icon: 'clapperboard',
      title: t('storyboard.title'),
      description: t('storyboard.description'),
      meta: t('storyboard.meta'),
      accentClass: 'bg-primary-500 text-black',
    },
    {
      href: `/${locale}/canvas`,
      icon: 'film',
      title: t('director.title'),
      description: t('director.description'),
      meta: t('director.meta'),
      accentClass: 'bg-info text-white',
    },
    {
      href: `/${locale}/live-composite`,
      icon: 'scanLine',
      title: t('composite.title'),
      description: t('composite.description'),
      meta: t('composite.meta'),
      accentClass: 'bg-editorial-500 text-black',
    },
    {
      href: `/${locale}/playground`,
      icon: 'sparklesAlt',
      title: t('playground.title'),
      description: t('playground.description'),
      meta: t('playground.meta'),
      accentClass: 'bg-accent-500 text-white',
    },
    {
      href: `/${locale}/visual-development`,
      icon: 'brain',
      title: t('visualDevelopment.title'),
      description: t('visualDevelopment.description'),
      meta: t('visualDevelopment.meta'),
      accentClass: 'bg-primary-500 text-black',
    },
  ]

  return (
    <section aria-labelledby="workflow-launcher-title" className="mb-10">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[9px] tracking-[0.22em] text-primary-400">
            {t('kicker')}
          </div>
          <h2
            id="workflow-launcher-title"
            className="mt-1 font-serif-cn text-xl font-semibold text-text-primary"
          >
            {t('heading')}
          </h2>
        </div>
        <p className="hidden max-w-md text-right font-serif-cn text-xs leading-5 text-text-tertiary md:block">
          {t('hint')}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group relative min-h-48 overflow-hidden rounded-2xl border border-white/[0.08] bg-raised p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-overlay"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.accentClass}`}>
              <AppIcon name={item.icon} className="h-[18px] w-[18px]" />
            </div>
            <h3 className="mt-5 font-serif-cn text-base font-semibold text-white">
              {item.title}
            </h3>
            <p className="mt-2 font-serif-cn text-xs leading-5 text-text-secondary">
              {item.description}
            </p>
            <div className="absolute inset-x-5 bottom-4 flex items-center justify-between">
              <span className="font-mono text-[9px] tracking-[0.14em] text-text-tertiary">
                {item.meta}
              </span>
              <AppIcon
                name="arrowRight"
                className="h-4 w-4 text-text-tertiary transition-transform group-hover:translate-x-1 group-hover:text-primary-400"
              />
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
