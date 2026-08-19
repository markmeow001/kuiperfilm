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
      accentClass: 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
    },
    {
      href: `/${locale}/canvas`,
      icon: 'film',
      title: t('director.title'),
      description: t('director.description'),
      meta: t('director.meta'),
      accentClass: 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
    },
    {
      href: `/${locale}/live-composite`,
      icon: 'scanLine',
      title: t('composite.title'),
      description: t('composite.description'),
      meta: t('composite.meta'),
      accentClass: 'bg-[rgba(154,170,178,0.12)] text-[var(--darkroom-muted)]',
    },
    {
      href: `/${locale}/playground`,
      icon: 'sparklesAlt',
      title: t('playground.title'),
      description: t('playground.description'),
      meta: t('playground.meta'),
      accentClass: 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
    },
    {
      href: `/${locale}/visual-development`,
      icon: 'brain',
      title: t('visualDevelopment.title'),
      description: t('visualDevelopment.description'),
      meta: t('visualDevelopment.meta'),
      accentClass: 'bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]',
    },
  ]

  return (
    <section aria-labelledby="workflow-launcher-title" className="mb-10">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="kuiper-dashboard-kicker">
            {t('kicker')}
          </div>
          <h2
            id="workflow-launcher-title"
            className="mt-1 text-[21px] font-semibold tracking-[-0.02em] text-[var(--production-ink)]"
          >
            {t('heading')}
          </h2>
        </div>
        <p className="hidden max-w-md text-right text-[13px] leading-5 text-[var(--production-ink-muted)] md:block">
          {t('hint')}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item, index) => (
          <Link
            key={item.href}
            href={item.href}
            className={`kuiper-dashboard-card group relative min-h-48 overflow-hidden p-5 focus-visible:outline-none ${index === 0 ? 'md:col-span-2 xl:col-span-1' : ''}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${item.accentClass}`}>
                <AppIcon name={item.icon} className="h-[18px] w-[18px]" />
              </div>
              <AppIcon
                name="arrowRight"
                className="h-4 w-4 text-[var(--darkroom-muted)] transition-transform group-hover:translate-x-1 group-hover:text-[var(--process-cyan-strong)]"
              />
            </div>
            <h3 className="mt-5 text-[16px] font-semibold text-[var(--production-ink)]">
              {item.title}
            </h3>
            <p className="mt-2 text-[13px] leading-5 text-[var(--production-ink-muted)]">
              {item.description}
            </p>
            <div className="absolute inset-x-5 bottom-4 flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.12em] text-[var(--darkroom-muted)]">
                {item.meta}
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--process-cyan)]/55" aria-hidden="true" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
