'use client'

/**
 * /m/auth/signin — mobile-first signin page.
 *
 * Functionally identical to /[locale]/auth/signin (same NextAuth
 * credentials flow, same i18n keys), but laid out for portrait
 * phone screens: full-width form, larger tap targets, no decorative
 * header bar, big inputs that fit comfortably above the iOS keyboard
 * when it pops up.
 *
 * On success, redirects to /m/projects (mobile review home) instead
 * of "/" (which is the desktop landing page). User can still type
 * the desktop URL after to switch to /v2 if they want.
 */
import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { resolvePostAuthPath } from '@/lib/auth/post-auth-url'
import { ProductionBrand } from '@/components/v2/ProductionBrand'

export default function MobileSignIn() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const params = useParams<{ locale: string }>()
  const searchParams = useSearchParams()
  const locale = params?.locale ?? 'zh'
  const t = useTranslations('auth')
  const postAuthPath = resolvePostAuthPath(
    searchParams?.get('callbackUrl'),
    `/${locale}/m/projects`,
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await signIn('credentials', {
        username,
        password,
        redirect: false,
      })
      if (result?.error) {
        setError(t('loginFailed'))
      } else {
        router.push(postAuthPath)
        router.refresh()
      }
    } catch {
      setError(t('loginError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-x-hidden bg-[#070B0F] px-5 py-10 text-[#F2F6F7] [--primary-400:#55AFC0]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(620px_420px_at_50%_-5%,rgba(85,175,192,0.14),transparent_68%)]" />
      <ProductionBrand
        locale={locale}
        href={`/${locale}`}
        tone="dark"
        className="relative mb-8"
      />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm space-y-5 rounded-xl border border-[#263642] bg-[#111B24]/95 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-sm"
      >
        <div className="pb-1 text-center">
          <div className="font-mono text-[11px] tracking-[0.28em] text-[#55AFC0]">
            MOBILE STUDIO ACCESS
          </div>
          <h1 className="mt-2 font-serif-cn text-2xl font-medium">{t('welcomeBack')}</h1>
        </div>
        <div>
          <label
            htmlFor="username"
            className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-[#A7B3BC]"
          >
            {t('phoneNumber')}
          </label>
          <input
            id="username"
            type="text"
            inputMode="text"
            autoCapitalize="off"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            className="min-h-12 w-full rounded-lg border border-[#263642] bg-[#0D141B] px-4 font-serif-cn text-base text-[#F2F6F7] transition-colors placeholder:text-[#657581] focus:border-[#55AFC0] focus:outline-none focus:ring-2 focus:ring-[#55AFC0]/25"
            placeholder={t('phoneNumberPlaceholder')}
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-[#A7B3BC]"
          >
            {t('password')}
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="min-h-12 w-full rounded-lg border border-[#263642] bg-[#0D141B] px-4 font-mono text-base text-[#F2F6F7] transition-colors placeholder:text-[#657581] focus:border-[#55AFC0] focus:outline-none focus:ring-2 focus:ring-[#55AFC0]/25"
            placeholder={t('passwordPlaceholder')}
          />
        </div>

        {error ? (
          <div role="alert" className="rounded-lg border border-[#7F3F4B] bg-[#2A171D] px-4 py-3 font-serif-cn text-sm text-[#FFB4BE]">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="min-h-12 w-full rounded-lg bg-[#3E73B9] px-4 font-serif-cn text-base font-medium text-white transition-colors hover:bg-[#4B82C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111B24] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? t('loginButtonLoading') : t('loginButton')}
        </button>
      </form>

      <div className="relative mt-8 text-center font-mono text-[10px] tracking-wider text-[#7F909C]">
        REVIEW · APPROVE · CONTINUE ON DESKTOP
      </div>
    </main>
  )
}
