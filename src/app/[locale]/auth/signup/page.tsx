'use client'

/**
 * /auth/signup — restyled to match V2 cinematic palette.
 * Functional behaviour identical to the previous glass version.
 * Still supports the share-link prefill: ?invite=<code>
 */

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useTranslations } from 'next-intl'

export default function SignUp() {
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [inviteCode, setInviteCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useTranslations('auth')

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
          router.push("/auth/signin")
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
    <div className="font-body grain min-h-screen bg-stone-950 text-stone-200">
      <header className="border-b border-amber-900/15 px-8 py-5">
        <Link href="/" className="flex items-baseline gap-1.5">
          <span className="font-display text-2xl font-semibold italic tracking-tight text-amber-400">
            Kuiper
          </span>
          <span className="font-serif-cn text-base font-medium text-stone-100">影界</span>
          <span className="ml-3 font-mono text-[10px] tracking-[0.3em] text-stone-500">
            AI · MANHUA · STUDIO
          </span>
        </Link>
      </header>

      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_50%_-10%,rgba(245,158,11,0.07),transparent)]" />
      </div>

      <main className="relative z-10 flex min-h-[calc(100vh-89px)] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-sm border border-amber-900/30 bg-stone-900/60 p-8 shadow-2xl backdrop-blur-sm">
            <div className="mb-8 text-center">
              <div className="mb-2 font-mono text-[10px] tracking-[0.3em] text-amber-600/80">
                CHAPTER · SIGN UP
              </div>
              <h1 className="font-serif-cn text-3xl font-medium tracking-wide text-stone-100">
                {t('createAccount')}
              </h1>
              <p className="mt-2 font-fraunces text-sm italic text-stone-500">
                {t('joinPlatform')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="inviteCode"
                  className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-stone-500"
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
                  className="w-full rounded-sm border border-stone-800 bg-stone-950 px-4 py-3 font-mono text-base tracking-widest text-stone-100 transition-colors placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
                  placeholder={t('inviteCodePlaceholder')}
                />
              </div>

              <div>
                <label
                  htmlFor="name"
                  className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-stone-500"
                >
                  {t('phoneNumber')}
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded-sm border border-stone-800 bg-stone-950 px-4 py-3 font-serif-cn text-base text-stone-100 transition-colors placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
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
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full rounded-sm border border-stone-800 bg-stone-950 px-4 py-3 font-mono text-base text-stone-100 transition-colors placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
                  placeholder={t('passwordMinPlaceholder')}
                />
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-2 block font-mono text-[10px] uppercase tracking-wider text-stone-500"
                >
                  {t('confirmPassword')}
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full rounded-sm border border-stone-800 bg-stone-950 px-4 py-3 font-mono text-base text-stone-100 transition-colors placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
                  placeholder={t('confirmPasswordPlaceholder')}
                />
              </div>

              {error ? (
                <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-serif-cn text-sm text-rose-300">
                  {error}
                </div>
              ) : null}

              {success ? (
                <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 font-serif-cn text-sm text-emerald-300">
                  {success}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-sm bg-amber-500 py-3 font-serif-cn text-base font-medium text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? t('signupButtonLoading') : t('signupButton')}
              </button>
            </form>

            <div className="mt-6 text-center font-fraunces text-sm italic text-stone-500">
              {t('hasAccount')}{" "}
              <Link
                href="/auth/signin"
                className="font-medium text-amber-400 transition-colors hover:text-amber-300"
              >
                {t('signinNow')}
              </Link>
            </div>

            <div className="mt-3 text-center">
              <Link
                href="/"
                className="font-mono text-[10px] tracking-wider text-stone-600 transition-colors hover:text-amber-400"
              >
                ← {t('backToHome')}
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
