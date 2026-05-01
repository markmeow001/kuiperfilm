'use client'

/**
 * /auth/signin — restyled to match V2 cinematic palette.
 * Functional behaviour identical to the previous glass version.
 */

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useTranslations } from 'next-intl'

export default function SignIn() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()
  const t = useTranslations('auth')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError(t('loginFailed'))
      } else {
        router.push("/")
        router.refresh()
      }
    } catch {
      setError(t('loginError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="font-body grain min-h-screen bg-stone-950 text-stone-200">
      {/* Brand bar — minimal version of the landing header */}
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

      {/* Backdrop accent */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_50%_-10%,rgba(245,158,11,0.07),transparent)]" />
      </div>

      <main className="relative z-10 flex min-h-[calc(100vh-89px)] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="rounded-sm border border-amber-900/30 bg-stone-900/60 p-8 shadow-2xl backdrop-blur-sm">
            <div className="mb-8 text-center">
              <div className="mb-2 font-mono text-[10px] tracking-[0.3em] text-amber-600/80">
                CHAPTER · SIGN IN
              </div>
              <h1 className="font-serif-cn text-3xl font-medium tracking-wide text-stone-100">
                {t('welcomeBack')}
              </h1>
              <p className="mt-2 font-fraunces text-sm italic text-stone-500">
                {t('loginTo')}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
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
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
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
                  placeholder={t('passwordPlaceholder')}
                />
              </div>

              {error ? (
                <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-serif-cn text-sm text-rose-300">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-sm bg-amber-500 py-3 font-serif-cn text-base font-medium text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? t('loginButtonLoading') : t('loginButton')}
              </button>
            </form>

            <div className="mt-6 text-center font-fraunces text-sm italic text-stone-500">
              {t('noAccount')}{" "}
              <Link
                href="/auth/signup"
                className="font-medium text-amber-400 transition-colors hover:text-amber-300"
              >
                {t('signupNow')}
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
