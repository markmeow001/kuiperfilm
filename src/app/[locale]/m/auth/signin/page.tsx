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
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

export default function MobileSignIn() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'
  const t = useTranslations('auth')

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
        router.push(`/${locale}/m/projects`)
        router.refresh()
      }
    } catch {
      setError(t('loginError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-[100svh] flex-col items-center justify-center px-6 py-10">
      {/* Brand mark — minimal, no decorative chrome on mobile */}
      <div className="mb-8 text-center">
        <div className="font-mono text-[10px] tracking-[0.4em] text-amber-600/80">
          KUIPER · AI · MANHUA · STUDIO
        </div>
        <div className="mt-2 flex items-baseline justify-center gap-1.5">
          <span className="font-display text-3xl font-semibold italic tracking-tight text-amber-400">
            Kuiper
          </span>
          <span className="font-serif-cn text-lg font-medium text-stone-100">影界</span>
        </div>
        <div className="mt-3 font-fraunces text-xs italic text-stone-500">
          mobile review portal
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-sm border border-amber-900/30 bg-stone-900/60 p-6 shadow-2xl backdrop-blur-sm"
      >
        <div>
          <label
            htmlFor="username"
            className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-stone-500"
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
            className="h-12 w-full rounded-sm border border-stone-800 bg-stone-950 px-4 font-serif-cn text-base text-stone-100 transition-colors placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
            placeholder={t('phoneNumberPlaceholder')}
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-stone-500"
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
            className="h-12 w-full rounded-sm border border-stone-800 bg-stone-950 px-4 font-mono text-base text-stone-100 transition-colors placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
            placeholder={t('passwordPlaceholder')}
          />
        </div>

        {error ? (
          <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-serif-cn text-sm text-rose-300">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="h-12 w-full rounded-sm bg-amber-500 font-serif-cn text-base font-medium tracking-wide text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? t('loginLoading') : t('login')}
        </button>
      </form>

      <div className="mt-8 text-center font-mono text-[10px] tracking-wider text-stone-600">
        review-only · author on desktop
      </div>
    </main>
  )
}
