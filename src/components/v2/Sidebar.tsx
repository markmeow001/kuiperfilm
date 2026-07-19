'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { V2_STEPS, type V2StepId, v2StepIndex } from './v2-types'

interface SidebarProps {
  currentStep: V2StepId
  onSelect: (stepId: V2StepId) => void
  locale?: string
}

interface UtilityLink {
  href: string
  icon: 'image' | 'sparklesAlt' | 'video'
  label: string
}

export function Sidebar({ currentStep, onSelect, locale = 'zh' }: SidebarProps) {
  const currentIdx = v2StepIndex(currentStep)
  const projectsHref =
    currentStep === 'home'
      ? `/${locale}/v2`
      : `/${locale}/v2?carryStep=${currentStep}`
  const utilityLinks: UtilityLink[] = [
    { href: `/${locale}/canvas`, icon: 'image', label: '無限畫布' },
    { href: `/${locale}/playground`, icon: 'sparklesAlt', label: 'Playground' },
    { href: `/${locale}/live-composite`, icon: 'video', label: 'AI 實拍重製' },
  ]

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-[88px] shrink-0 flex-col border-r border-white/[0.07] bg-[#080809] text-text-secondary lg:flex">
        <Link
          href={projectsHref}
          aria-label="Kuiper 影界・回到專案列表"
          className="flex h-20 shrink-0 items-center justify-center border-b border-white/[0.07]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500 font-display text-xl font-black italic text-black transition-transform hover:scale-105">
            K
          </span>
        </Link>

        <Link
          href={projectsHref}
          title="所有專案・切換專案"
          className="group mx-2 mt-3 flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-[10px] text-text-tertiary transition-colors hover:bg-white/[0.05] hover:text-text-primary"
        >
          <AppIcon name="folderOpen" className="h-[18px] w-[18px] group-hover:text-primary-400" />
          <span>專案</span>
        </Link>

        <nav aria-label="製作流程" className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <div className="space-y-1.5">
            {V2_STEPS.map((step, idx) => {
              const active = step.id === currentStep
              const completed = currentIdx > idx
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => onSelect(step.id)}
                  aria-current={active ? 'step' : undefined}
                  aria-label={`${step.num} ${step.label} ${step.subtitle}${active ? '（目前步驟）' : completed ? '（已完成）' : ''}`}
                  title={`${step.num} · ${step.label} / ${step.subtitle}`}
                  className={`group relative flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-[10px] transition-colors ${
                    active
                      ? 'bg-white/[0.07] text-white'
                      : 'text-text-tertiary hover:bg-white/[0.04] hover:text-text-primary'
                  }`}
                >
                  <AppIcon
                    name={step.icon}
                    className={`h-[18px] w-[18px] ${
                      active
                        ? 'text-primary-400'
                        : completed
                          ? 'text-primary-700'
                          : 'text-current group-hover:text-primary-400'
                    }`}
                  />
                  <span className="max-w-full truncate">{step.label}</span>
                  {completed ? (
                    <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-primary-600" />
                  ) : null}
                </button>
              )
            })}
          </div>
        </nav>

        <div className="border-t border-white/[0.07] px-2 py-3">
          <div className="space-y-1">
            {utilityLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                className="group flex h-10 items-center justify-center rounded-xl text-text-tertiary transition-colors hover:bg-white/[0.05] hover:text-primary-400"
              >
                <AppIcon name={item.icon} className="h-[18px] w-[18px]" />
              </Link>
            ))}
          </div>
          <SidebarSignedOutCTA locale={locale} />
        </div>
      </aside>

      <nav
        aria-label="行動版製作流程"
        className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-6 rounded-2xl border border-white/10 bg-[#111113]/95 p-1.5 shadow-2xl backdrop-blur-xl lg:hidden"
      >
        {V2_STEPS.map((step) => {
          const active = step.id === currentStep
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onSelect(step.id)}
              aria-current={active ? 'step' : undefined}
              aria-label={`${step.num} ${step.label} ${step.subtitle}`}
              className={`flex min-w-0 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[9px] transition-colors ${
                active ? 'bg-white/[0.07] text-primary-400' : 'text-text-tertiary'
              }`}
            >
              <AppIcon name={step.icon} className="h-4 w-4" />
              <span className="max-w-full truncate">{step.label}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}

function SidebarSignedOutCTA({ locale }: { locale: string }) {
  const { data: session, status } = useSession()
  if (status === 'loading' || session?.user) return null
  return (
    <Link
      href={`/${locale}/auth/signin`}
      aria-label="登入帳號"
      title="登入帳號"
      className="mt-2 flex h-10 items-center justify-center rounded-xl border border-primary-500/30 text-primary-400 transition-colors hover:bg-primary-500/10"
    >
      <AppIcon name="user" className="h-4 w-4" />
    </Link>
  )
}
