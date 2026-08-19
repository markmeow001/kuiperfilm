'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import type { V2StepId } from './v2-types'
import { ProductionBrand } from './ProductionBrand'
import { ProductionProgress } from './ProductionProgress'
import { getV2WorkspacePresentation } from './v2-workspace-presentation'

interface SidebarProps {
  currentStep: V2StepId
  onSelect: (stepId: V2StepId) => void
  locale?: string
}

interface UtilityLink {
  href: string
  icon: 'image' | 'sparklesAlt' | 'brain' | 'video'
  label: string
}

export function Sidebar({ currentStep, onSelect, locale = 'zh' }: SidebarProps) {
  const presentation = getV2WorkspacePresentation(locale)
  const currentIdx = presentation.steps.findIndex((step) => step.id === currentStep)
  const previousStep = currentIdx > 0 ? presentation.steps[currentIdx - 1] : null
  const nextStep =
    currentIdx < presentation.steps.length - 1
      ? presentation.steps[currentIdx + 1]
      : null
  const projectsHref =
    currentStep === 'home'
      ? `/${locale}/v2`
      : `/${locale}/v2?carryStep=${currentStep}`
  const utilityLinks: UtilityLink[] = [
    { href: `/${locale}/canvas`, icon: 'image', label: presentation.utility.canvas },
    {
      href: `/${locale}/playground`,
      icon: 'sparklesAlt',
      label: presentation.utility.playground,
    },
    {
      href: `/${locale}/visual-development`,
      icon: 'brain',
      label: presentation.utility.visualDevelopment,
    },
    {
      href: `/${locale}/live-composite`,
      icon: 'video',
      label: presentation.utility.liveComposite,
    },
  ]

  return (
    <>
      <aside className="kuiper-shell-rail sticky top-0 hidden h-screen w-[76px] shrink-0 flex-col border-r lg:flex xl:w-[284px]">
        <div className="kuiper-shell-divider flex h-[76px] shrink-0 items-center border-b px-[18px] xl:px-5">
          <span className="xl:hidden"><ProductionBrand locale={locale} compact href={projectsHref} tone="dark" /></span>
          <span className="hidden xl:block"><ProductionBrand locale={locale} href={projectsHref} tone="dark" /></span>
        </div>

        <div className="px-2 pt-3 xl:px-3">
          <Link
            href={projectsHref}
            title={presentation.allProjectsTitle}
            className="kuiper-shell-nav-item group flex min-h-11 items-center justify-center gap-3 rounded-xl px-2 text-[13px] font-medium xl:justify-start xl:px-3"
          >
            <AppIcon name="arrowLeft" className="h-[18px] w-[18px] shrink-0 group-hover:text-[var(--process-cyan-strong)]" />
            <span className="hidden xl:block">{presentation.backToProjects}</span>
          </Link>
        </div>

        <nav
          aria-label={presentation.flowTitle}
          className="min-h-0 flex-1 overflow-y-auto px-2 py-4 xl:px-3"
        >
          <div className="mb-3 hidden px-3 xl:block">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--process-cyan-strong)]">
              {presentation.flowTitle}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-[var(--darkroom-muted)]">
              {presentation.flowDescription}
            </p>
          </div>

          <div className="hidden xl:block">
            <ProductionProgress
              currentStep={currentStep}
              locale={locale}
              onSelect={onSelect}
              tone="dark"
            />
          </div>
          <div className="space-y-1 xl:hidden">
            {presentation.steps.map((step, idx) => {
              const active = step.id === currentStep
              const completed = currentIdx > idx
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => onSelect(step.id)}
                  aria-current={active ? 'step' : undefined}
                  aria-label={`${step.num} ${step.label} ${step.subtitle}${active ? ` · ${presentation.currentStep}` : completed ? ` · ${presentation.completed}` : ''}`}
                  title={`${step.num} · ${step.label} / ${step.subtitle}`}
                  data-active={active}
                  className="kuiper-shell-nav-item group relative flex min-h-12 w-full items-center justify-center rounded-xl text-[10px]"
                >
                  <AppIcon
                    name={step.icon}
                    className={`h-[18px] w-[18px] ${
                      active
                        ? 'text-[var(--process-cyan-strong)]'
                        : completed
                          ? 'text-[var(--process-cyan)]'
                          : 'text-current'
                    }`}
                  />
                  {completed ? (
                    <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[var(--process-cyan)]" />
                  ) : null}
                </button>
              )
            })}
          </div>
        </nav>

        <div className="kuiper-shell-divider border-t px-2 py-3 xl:px-3">
          <div className="space-y-1">
            {utilityLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                className="kuiper-shell-nav-item group flex min-h-11 items-center justify-center gap-3 rounded-xl px-2 hover:text-[var(--process-cyan-strong)] xl:justify-start xl:px-3"
              >
                <AppIcon name={item.icon} className="h-[18px] w-[18px]" />
                <span className="hidden truncate text-[13px] font-medium xl:block">{item.label}</span>
              </Link>
            ))}
          </div>
          <SidebarSignedOutCTA locale={locale} />
        </div>
      </aside>

      <nav
        aria-label={presentation.mobileFlowLabel}
        className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl border border-[var(--darkroom-border)] bg-[var(--studio-chrome)]/95 p-2 shadow-2xl backdrop-blur-xl lg:hidden"
      >
        <button
          type="button"
          disabled={!previousStep}
          onClick={() => previousStep && onSelect(previousStep.id)}
          aria-label={
            previousStep
              ? presentation.previousStage(previousStep.label)
              : presentation.firstStage
          }
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 text-text-secondary disabled:opacity-30"
        >
          <AppIcon name="chevronLeft" className="h-5 w-5" />
        </button>
        <label className="relative min-w-0">
          <span className="sr-only">{presentation.switchStage}</span>
          <select
            value={currentStep}
            onChange={(event) => onSelect(event.target.value as V2StepId)}
            className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-white/[0.06] px-3 pr-9 text-[13px] font-semibold text-white outline-none focus:border-[var(--process-cyan)]"
          >
            {presentation.steps.map((step) => (
              <option key={step.id} value={step.id} className="bg-[var(--darkroom-surface)]">
                {step.num} · {step.label}
              </option>
            ))}
          </select>
          <AppIcon name="chevronDown" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
        </label>
        <button
          type="button"
          disabled={!nextStep}
          onClick={() => nextStep && onSelect(nextStep.id)}
          className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--process-cyan)] px-3 text-[13px] font-semibold text-[#071014] disabled:bg-white/10 disabled:text-text-tertiary"
        >
          <span>{nextStep ? nextStep.label : presentation.complete}</span>
          <AppIcon name="chevronRight" className="h-4 w-4" />
        </button>
      </nav>
    </>
  )
}

function SidebarSignedOutCTA({ locale }: { locale: string }) {
  const { data: session, status } = useSession()
  const presentation = getV2WorkspacePresentation(locale)
  if (status === 'loading' || session?.user) return null
  return (
    <Link
      href={`/${locale}/auth/signin`}
      aria-label={presentation.signIn}
      title={presentation.signIn}
      className="mt-2 flex h-11 items-center justify-center rounded-xl border border-[var(--process-cyan)]/40 text-[var(--process-cyan-strong)] transition-colors hover:bg-[var(--process-cyan-soft)]"
    >
      <AppIcon name="user" className="h-4 w-4" />
    </Link>
  )
}
