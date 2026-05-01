'use client'

/**
 * Top navbar — restyled to match the V2 cinematic palette so /admin
 * pages no longer look like a different product. Same nav structure,
 * same i18n strings, same admin gating; only chrome changed.
 */

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import LanguageSwitcher from './LanguageSwitcher'
import ThemeToggle from './ThemeToggle'
import { AppIcon } from '@/components/ui/icons'

export default function Navbar() {
  const { data: session } = useSession()
  const t = useTranslations('nav')
  const tc = useTranslations('common')
  // session.user is loosely typed by next-auth — narrow to read role.
  const role = (session?.user as { role?: string } | undefined)?.role
  const isAdmin = role === 'admin'

  return (
    <nav className="sticky top-0 z-50 border-b border-amber-900/20 bg-stone-950/95 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Brand — Kuiper 影界 logo treatment matching the V2 sidebar */}
          <Link
            href={session ? '/zh/v2' : '/'}
            className="group flex items-baseline gap-1.5"
          >
            <span className="font-display text-2xl font-semibold italic tracking-tight text-amber-400 transition-colors group-hover:text-amber-300">
              Kuiper
            </span>
            <span className="font-serif-cn text-base font-medium text-stone-100">影界</span>
            <span className="ml-3 hidden font-mono text-[9px] uppercase tracking-[0.3em] text-stone-600 sm:inline">
              {tc('betaVersion')}
            </span>
          </Link>

          <div className="flex items-center gap-5">
            {session ? (
              <>
                <Link
                  href="/zh/v2"
                  className="font-mono text-xs uppercase tracking-wider text-stone-300 transition-colors hover:text-amber-400"
                >
                  {t('workspace')}
                </Link>
                {/* 資產中心 — admin only. K3b made this team-shared, but for
                    demo phase regular users get distracted by an empty hub
                    that duplicates project SubjectsPage. Curators (admin)
                    keep access; the URL still works for them when typed. */}
                {isAdmin ? (
                  <Link
                    href="/workspace/asset-hub"
                    className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-stone-300 transition-colors hover:text-amber-400"
                  >
                    <AppIcon name="folderHeart" className="h-4 w-4" />
                    {t('assetHub')}
                  </Link>
                ) : null}
                <Link
                  href="/profile"
                  className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider text-stone-300 transition-colors hover:text-amber-400"
                  title={t('profile')}
                >
                  <AppIcon name="userRoundCog" className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('profile')}</span>
                </Link>
                <ThemeToggle />
                {isAdmin ? (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-amber-400 transition-colors hover:bg-amber-500/20"
                    title={t('admin')}
                  >
                    <AppIcon name="badgeCheck" className="h-3.5 w-3.5" />
                    {t('admin')}
                  </Link>
                ) : null}
                <LanguageSwitcher />
              </>
            ) : (
              <>
                <ThemeToggle />
                <Link
                  href="/auth/signin"
                  className="font-mono text-[11px] uppercase tracking-wider text-stone-400 transition-colors hover:text-amber-400"
                >
                  {t('signin')}
                </Link>
                <Link
                  href="/auth/signup"
                  className="rounded-sm bg-amber-500 px-4 py-2 font-serif-cn text-sm font-medium text-stone-950 transition-all hover:bg-amber-400"
                >
                  {t('signup')}
                </Link>
                <LanguageSwitcher />
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
