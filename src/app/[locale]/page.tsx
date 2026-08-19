'use client'

import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useParams } from 'next/navigation'

import { LandingProductionRail } from './LandingProductionRail'
import { ProductionBrand } from '@/components/v2/ProductionBrand'

export default function Home() {
  const t = useTranslations('landing')
  const { data: session } = useSession()
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'
  const workspaceHref = `/${locale}/v2`
  const signInHref = `/${locale}/auth/signin`
  const signUpHref = `/${locale}/auth/signup`

  const railLabels: [string, string, string, string, string, string] = [
    t('projectLabel'),
    t('episodeLabel'),
    t('sceneLabel'),
    t('shotLabel'),
    t('takeLabel'),
    t('deliveryLabel'),
  ]

  return (
    <div
      data-testid="landing-root"
      className="min-h-screen overflow-x-hidden bg-[#070B0F] text-[#F2F6F7] [--primary-400:#55AFC0]"
    >
      <header className="relative z-20 border-b border-[#263642] bg-[#0D141B]/94 px-4 py-4 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <ProductionBrand locale={locale} href={`/${locale}`} tone="dark" />

          <nav aria-label="Account" className="flex items-center gap-2 sm:gap-3">
            {session ? (
              <Link href={workspaceHref} className="inline-flex min-h-11 items-center rounded-lg bg-[#3E73B9] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B82C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0]">
                {t('enterWorkspace')}
              </Link>
            ) : (
              <>
                <Link href={signInHref} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-[#A7B3BC] transition-colors hover:text-[#F2F6F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0]">
                  {t('signIn')}
                </Link>
                <Link href={signUpHref} className="hidden min-h-11 items-center rounded-lg border border-[#31505D] bg-[#13262F] px-4 text-sm font-medium text-[#79C7D4] transition-colors hover:bg-[#18333E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0] sm:inline-flex">
                  {t('invitationOnly')}
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[680px] bg-[radial-gradient(900px_520px_at_78%_5%,rgba(85,175,192,0.12),transparent_70%)]" />
        <section className="relative mx-auto grid max-w-[1440px] items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[0.82fr_1.18fr] lg:gap-16 lg:py-28">
          <div>
            <div className="font-mono text-[10px] tracking-[0.28em] text-[#79C7D4]">{t('eyebrow')}</div>
            <h1 className="mt-5 max-w-2xl font-serif-cn text-4xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-5xl lg:text-6xl">
              {t('heroTitle')}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-[#A7B3BC] sm:text-lg">{t('heroBody')}</p>

            <div className="mt-9 flex flex-wrap gap-3">
              {session ? (
                <Link href={workspaceHref} className="inline-flex min-h-12 items-center rounded-lg bg-[#3E73B9] px-6 font-semibold text-white transition-colors hover:bg-[#4B82C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B0F]">
                  {t('enterWorkspace')} <span className="ml-2">→</span>
                </Link>
              ) : (
                <>
                  <Link href={signUpHref} className="inline-flex min-h-12 items-center rounded-lg bg-[#3E73B9] px-6 font-semibold text-white transition-colors hover:bg-[#4B82C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0] focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B0F]">
                    {t('getStarted')} <span className="ml-2">→</span>
                  </Link>
                  <Link href={signInHref} className="inline-flex min-h-12 items-center rounded-lg border border-[#263642] bg-[#111B24] px-6 font-medium text-[#DDE6E9] transition-colors hover:border-[#3D5664] hover:bg-[#17232D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0]">
                    {t('signIn')}
                  </Link>
                </>
              )}
            </div>

            <div className="mt-10 flex items-center gap-3 border-l-2 border-[#55AFC0] pl-4">
              <div>
                <div className="font-mono text-[9px] tracking-[0.22em] text-[#7F909C]">{t('statusLabel')}</div>
                <div className="mt-1 text-sm text-[#DDE6E9]">{t('statusValue')}</div>
              </div>
            </div>
          </div>

          <LandingProductionRail
            title={t('pipelineTitle')}
            description={t('pipelineDescription')}
            labels={railLabels}
          />
        </section>

        <section className="relative border-y border-[#263642] bg-[#0D141B]">
          <div className="mx-auto grid max-w-[1440px] gap-px bg-[#263642] sm:grid-cols-3">
            {[
              [t('capabilityScript'), t('capabilityScriptBody'), '01'],
              [t('capabilityVisual'), t('capabilityVisualBody'), '02'],
              [t('capabilityFinish'), t('capabilityFinishBody'), '03'],
            ].map(([title, body, index]) => (
              <article key={index} className="min-h-48 bg-[#0D141B] p-7 sm:p-8">
                <div className="font-mono text-[10px] tracking-[0.2em] text-[#79C7D4]">{index}</div>
                <h2 className="mt-7 font-serif-cn text-xl font-semibold">{title}</h2>
                <p className="mt-3 max-w-sm text-sm leading-7 text-[#A7B3BC]">{body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-[#263642] bg-[#070B0F] px-5 py-7 sm:px-8">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-3 font-mono text-[10px] tracking-[0.16em] text-[#7F909C] sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 KUIPER 影界</span>
          <span>{t('footerLine')}</span>
        </div>
      </footer>
    </div>
  )
}
