'use client'

/**
 * /auth/signup — unified night-studio account entry point.
 * Authentication behaviour remains identical to the previous version.
 * Still supports the share-link prefill: ?invite=<code>
 */

import { useEffect, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useTranslations } from 'next-intl'
import { resolvePostAuthPath, withCallbackUrl } from '@/lib/auth/post-auth-url'
import { ProductionBrand } from '@/components/v2/ProductionBrand'

export default function SignUp() {
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const router = useRouter()
  const params = useParams<{ locale: string }>()
  const searchParams = useSearchParams()
  const t = useTranslations('auth')
  const locale = params?.locale ?? 'zh'
  const rawCallbackUrl = searchParams?.get('callbackUrl')
  const safeCallbackUrl = rawCallbackUrl
    ? resolvePostAuthPath(rawCallbackUrl, '') || null
    : null
  const signInHref = withCallbackUrl(`/${locale}/auth/signin`, safeCallbackUrl)

  // Allow share-link flow: /auth/signup?invite=ABC123 prefills the code.
  useEffect(() => {
    const fromQuery = searchParams?.get('invite')
    if (fromQuery) setInviteCode(fromQuery)
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setSuccess("")

    if (!inviteCode.trim()) {
      setError(t('inviteRequired'))
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError(t('passwordMismatch'))
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError(t('passwordTooShort'))
      setLoading(false)
      return
    }

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          password,
          invite_code: inviteCode.trim(),
        }),
      })

      const data = await response.json()

      if (response.ok) {
        setSuccess(t('signupSuccess'))
        setTimeout(() => {
          router.push(signInHref)
        }, 2000)
      } else {
        setError(data.message || t('signupFailed'))
      }
    } catch {
      setError(t('signupError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="font-body min-h-screen overflow-x-hidden bg-[#070B0F] text-[#F2F6F7] [--primary-400:#55AFC0]">
      <header className="relative z-20 border-b border-[#263642] bg-[#0D141B]/95 px-4 py-4 sm:px-8 sm:py-5">
        <ProductionBrand locale={locale} href={`/${locale}`} tone="dark" />
      </header>

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(850px_520px_at_50%_-10%,rgba(85,175,192,0.12),transparent_68%)]" />
        <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(85,175,192,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(85,175,192,0.045)_1px,transparent_1px)] [background-size:48px_48px]" />
      </div>

      <main className="relative z-10 flex min-h-[calc(100vh-77px)] items-center justify-center px-4 py-8 sm:min-h-[calc(100vh-85px)] sm:py-12">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-[#263642] bg-[#111B24]/95 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-sm sm:p-8">
            <div className="mb-8 text-center">
              <div className="mb-2 font-mono text-[11px] tracking-[0.28em] text-[#55AFC0]">
                STUDIO REGISTRATION
              </div>
              <h1 className="font-serif-cn text-3xl font-medium tracking-wide text-[#F2F6F7]">
                {t('createAccount')}
              </h1>
              <p className="mt-2 font-fraunces text-sm italic text-[#A7B3BC]">
                {t('joinPlatform')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="inviteCode"
                  className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-[#A7B3BC]"
                >
                  {t('inviteCode')}
                </label>
                <input
                  id="inviteCode"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  required
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="min-h-12 w-full rounded-lg border border-[#263642] bg-[#0D141B] px-4 py-3 font-mono text-base tracking-widest text-[#F2F6F7] transition-colors placeholder:text-[#657581] focus:border-[#55AFC0] focus:outline-none focus:ring-2 focus:ring-[#55AFC0]/25"
                  placeholder={t('inviteCodePlaceholder')}
                />
              </div>

              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-[#A7B3BC]"
                >
                  {t('phoneNumber')}
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="username"
                  inputMode="text"
                  autoCapitalize="off"
                  spellCheck={false}
                  className="min-h-12 w-full rounded-lg border border-[#263642] bg-[#0D141B] px-4 py-3 font-serif-cn text-base text-[#F2F6F7] transition-colors placeholder:text-[#657581] focus:border-[#55AFC0] focus:outline-none focus:ring-2 focus:ring-[#55AFC0]/25"
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
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="min-h-12 w-full rounded-lg border border-[#263642] bg-[#0D141B] px-4 py-3 font-mono text-base text-[#F2F6F7] transition-colors placeholder:text-[#657581] focus:border-[#55AFC0] focus:outline-none focus:ring-2 focus:ring-[#55AFC0]/25"
                  placeholder={t('passwordMinPlaceholder')}
                />
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-2 block font-mono text-[11px] uppercase tracking-wider text-[#A7B3BC]"
                >
                  {t('confirmPassword')}
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="min-h-12 w-full rounded-lg border border-[#263642] bg-[#0D141B] px-4 py-3 font-mono text-base text-[#F2F6F7] transition-colors placeholder:text-[#657581] focus:border-[#55AFC0] focus:outline-none focus:ring-2 focus:ring-[#55AFC0]/25"
                  placeholder={t('confirmPasswordPlaceholder')}
                />
              </div>

              {error ? (
                <div role="alert" aria-live="assertive" className="rounded-lg border border-[#7F3F4B] bg-[#2A171D] px-4 py-3 font-serif-cn text-sm text-[#FFB4BE]">
                  {error}
                </div>
              ) : null}

              {success ? (
                <div role="status" aria-live="polite" className="rounded-lg border border-[#35685A] bg-[#12271F] px-4 py-3 font-serif-cn text-sm text-[#A8E5CF]">
                  {success}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#3E73B9] px-4 py-3 font-serif-cn text-base font-medium text-white transition-colors hover:bg-[#4B82C8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0] focus-visible:ring-offset-2 focus-visible:ring-offset-[#111B24] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? t('signupButtonLoading') : t('signupButton')}
              </button>
            </form>

            <div className="mt-6 text-center font-fraunces text-sm italic text-[#A7B3BC]">
              {t('hasAccount')}{" "}
              <Link
                href={signInHref}
                className="inline-flex min-h-11 items-center rounded-md px-1 font-medium text-[#6FC7D5] transition-colors hover:text-[#8AD7E2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0]"
              >
                {t('signinNow')}
              </Link>
            </div>

            <div className="mt-3 text-center">
              <Link
                href={`/${locale}`}
                className="inline-flex min-h-11 items-center rounded-md px-2 font-mono text-[11px] tracking-wider text-[#7F909C] transition-colors hover:text-[#6FC7D5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#55AFC0]"
              >
                {t('backToHome')}
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
