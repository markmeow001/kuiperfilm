'use client'

/**
 * Compact user avatar + dropdown for the V2 TopBar.
 *
 * Replaces the legacy SidebarUser block (which used to live at the
 * bottom of the V2 sidebar). Putting it in the TopBar:
 *   - keeps the narrow w-52 sidebar focused on step navigation
 *   - matches Linear/Notion convention (user avatar top-right)
 *   - sits next to ProjectSwitcher so the two account-level dropdowns
 *     stay grouped
 *
 * Visible to every signed-in role. Menu items render conditionally:
 *   - 團隊 (workspaces): always visible
 *   - 設定中心 (/profile): admin only
 *   - 管理員後台 (/admin): admin only
 *   - 登出: always visible
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession, signOut } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { isAdmin as checkIsAdmin, UserRole } from '@/lib/auth/user-role'

interface UserMenuProps {
  locale?: string
}

export function UserMenu({ locale = 'zh' }: UserMenuProps) {
  const { data: session, status } = useSession()
  const t = useTranslations('v2Home.userMenu')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (status === 'loading') {
    return (
      <div className="flex h-11 w-11 animate-pulse items-center justify-center rounded-full bg-white/[0.07]" />
    )
  }
  if (!session?.user) {
    return (
      <Link
        href={`/${locale}/auth/signin`}
        className="flex min-h-11 items-center rounded-xl border border-[var(--process-cyan)]/40 bg-[var(--process-cyan-soft)] px-3 font-mono text-[11px] uppercase tracking-wider text-[var(--process-cyan-strong)] hover:border-[var(--process-cyan)]"
      >
        {t('signIn')}
      </Link>
    )
  }

  const name = session.user.name ?? session.user.email ?? t('fallbackUser')
  const role = (session.user as { role?: string } | undefined)?.role ?? null
  const initial = name.charAt(0).toUpperCase()
  const isAdmin = checkIsAdmin(role)

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.04] p-1 transition-all hover:border-[var(--process-cyan)]/45 hover:bg-white/[0.07] sm:justify-start sm:pr-2"
        title={`${name} · ${role ?? UserRole.MEMBER}`}
        aria-label={`${name} · ${role ?? UserRole.MEMBER}`}
        aria-expanded={open}
        aria-controls="kuiper-user-menu"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--process-cyan)] font-display text-xs font-bold text-[#071014]">
          {initial}
        </div>
        <span className="hidden font-mono text-[11px] uppercase tracking-wider text-[var(--darkroom-text)] sm:inline">
          {role ? role.toUpperCase() : 'MEMBER'}
        </span>
        <AppIcon name="chevronDown" className={`hidden h-3 w-3 text-[var(--darkroom-muted)] transition-transform sm:block ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          id="kuiper-user-menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-[var(--darkroom-border)] bg-[var(--darkroom-raised)] shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
        >
          <div className="border-b border-[var(--darkroom-border)] px-4 py-3">
            <div className="font-serif-cn text-sm text-[var(--darkroom-text)]">{name}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-[var(--process-cyan-strong)]">
              {role ? role.toUpperCase() : 'MEMBER'}
            </div>
          </div>
          <nav aria-label={t('accountMenu')} className="py-1.5">
            <MenuItem
              href={`/${locale}/workspaces`}
              icon="userAlt"
              label={t('workspaces')}
              hint={t('workspacesHint')}
              onClose={() => setOpen(false)}
            />
            {isAdmin && (
              <>
                <MenuItem
                  href={`/${locale}/profile`}
                  icon="userRoundCog"
                  label={t('settings')}
                  hint={t('settingsHint')}
                  onClose={() => setOpen(false)}
                />
                <MenuItem
                  href={`/${locale}/admin`}
                  icon="settingsHex"
                  label={t('admin')}
                  hint={t('adminHint')}
                  highlight
                  onClose={() => setOpen(false)}
                />
              </>
            )}
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: `/${locale}/auth/signin` })}
              className="flex min-h-11 w-full items-center gap-3 border-t border-[var(--darkroom-border)] px-4 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
              aria-label={t('signOut')}
            >
              <AppIcon name="logout" className="h-4 w-4 text-[var(--darkroom-muted)]" />
              <span className="font-serif-cn text-sm text-[var(--darkroom-text)]">{t('signOut')}</span>
            </button>
          </nav>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  href, icon, label, hint, highlight, onClose,
}: {
  href: string
  icon: 'userAlt' | 'userRoundCog' | 'settingsHex' | 'logout'
  label: string
  hint?: string
  highlight?: boolean
  onClose: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className={`flex min-h-11 items-start gap-3 px-4 py-2.5 transition-colors ${highlight ? 'hover:bg-[var(--process-cyan-soft)]' : 'hover:bg-white/[0.05]'}`}
    >
      <AppIcon name={icon} className={`mt-0.5 h-4 w-4 ${highlight ? 'text-[var(--process-cyan-strong)]' : 'text-[var(--darkroom-muted)]'}`} />
      <div className="flex-1">
        <div className={`font-serif-cn text-sm ${highlight ? 'text-[var(--process-cyan-strong)]' : 'text-[var(--darkroom-text)]'}`}>{label}</div>
        {hint && <div className="mt-0.5 font-mono text-[10px] tracking-wider text-[var(--darkroom-muted)]">{hint}</div>}
      </div>
    </Link>
  )
}
