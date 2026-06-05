'use client'

/**
 * Phase 1 redesign — sign-in page migrated to v2 component library.
 *
 * Reference: REDESIGN_PLAN.md §5 Phase 2 (公開 funnel) — auth modal,
 * Google OAuth, password show/hide, clear errors. This first
 * migration covers the basic credentials form; Google OAuth +
 * password show/hide are follow-ups.
 *
 * Behavior is byte-for-byte unchanged from the legacy version:
 *   - same signIn('credentials', { username, password, redirect: false })
 *   - same routing.push('/') + router.refresh() on success
 *   - same error tone for credential failure vs unexpected exception
 *   - same Navbar at top
 *
 * The only deltas are visual:
 *   - bg-canvas / bg-raised / text-text-* token utilities replace the
 *     legacy `--glass-*` CSS variables
 *   - <Input /> v2 replaces hand-rolled <label>+<input>
 *   - <Button /> v2 replaces <button className="glass-btn-*">
 *   - <Card variant="raised" /> replaces glass-surface-modal
 *   - Error message rendered via Input's error prop or a dedicated
 *     inline pattern using semantic --error token
 */

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useTranslations } from 'next-intl'
import Navbar from "@/components/Navbar"
import { Button } from "@/components/v2/Button"
import { Input } from "@/components/v2/Input"
import { Card } from "@/components/v2/Card"

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
    <div className="min-h-screen bg-canvas text-text-primary">
      <Navbar />
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <Card variant="raised" padding="lg" elevation={2}>
            <div className="mb-8 text-center">
              <h1 className="mb-2 text-[28px] font-medium leading-[1.2] tracking-[-0.02em] text-text-primary">
                {t('welcomeBack')}
              </h1>
              <p className="text-[14px] text-text-secondary">{t('loginTo')}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <Input
                id="username"
                type="text"
                label={t('phoneNumber')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder={t('phoneNumberPlaceholder')}
                size="lg"
                autoComplete="username"
              />

              <Input
                id="password"
                type="password"
                label={t('password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder={t('passwordPlaceholder')}
                size="lg"
                autoComplete="current-password"
                error={error || undefined}
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
                disabled={loading}
              >
                {loading ? t('loginButtonLoading') : t('loginButton')}
              </Button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-[14px] text-text-secondary">
                {t('noAccount')}{" "}
                <Link
                  href="/auth/signup"
                  className="font-medium text-accent-500 transition-colors duration-[120ms] ease-out hover:text-primary-500"
                >
                  {t('signupNow')}
                </Link>
              </p>
            </div>

            <div className="mt-4 text-center">
              <Link
                href="/"
                className="text-[13px] text-text-tertiary transition-colors duration-[120ms] ease-out hover:text-text-secondary"
              >
                {t('backToHome')}
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
