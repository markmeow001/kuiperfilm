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
import { AppIcon } from '@/components/ui/icons'
import { isAdmin as checkIsAdmin } from '@/lib/auth/user-role'

export function UserMenu() {
  const { data: session, status } = useSession()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
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
      <div className="flex h-9 w-9 animate-pulse items-center justify-center rounded-full bg-stone-800" />
    )
  }
  if (!session?.user) {
    return (
      <Link
        href="/zh/auth/signin"
        className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-amber-400 hover:bg-amber-500/20"
      >
        登入
      </Link>
    )
  }

  const name = session.user.name ?? session.user.email ?? '使用者'
  const role = (session.user as { role?: string } | undefined)?.role ?? null
  const initial = name.charAt(0).toUpperCase()
  const isAdmin = checkIsAdmin(role)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-amber-900/30 bg-stone-900/50 py-1 pl-1 pr-3 transition-all hover:border-amber-500/40 hover:bg-stone-900"
        title={`${name} · ${role ?? 'member'}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-rose-700 font-display text-xs text-stone-100">
          {initial}
        </div>
        <span className="hidden font-mono text-[11px] uppercase tracking-wider text-stone-300 sm:inline">
          {role ? role.toUpperCase() : 'MEMBER'}
        </span>
        <AppIcon name="chevronDown" className={`h-3 w-3 text-stone-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-sm border border-amber-900/30 bg-stone-950 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        >
          <div className="border-b border-amber-900/15 px-4 py-3">
            <div className="font-serif-cn text-sm text-stone-100">{name}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-amber-600/80">
              {role ? role.toUpperCase() : 'MEMBER'}
            </div>
          </div>
          <nav className="py-1.5">
            <MenuItem
              href="/zh/workspaces"
              icon="userAlt"
              label="工作區 / 團隊"
              hint="管理組織與成員"
              onClose={() => setOpen(false)}
            />
            {isAdmin && (
              <>
                <MenuItem
                  href="/zh/profile"
                  icon="userRoundCog"
                  label="設定中心"
                  hint="provider keys / 預設模型"
                  onClose={() => setOpen(false)}
                />
                <MenuItem
                  href="/zh/admin"
                  icon="settingsHex"
                  label="管理員後台"
                  hint="使用者 / 任務 / 邀請碼"
                  highlight
                  onClose={() => setOpen(false)}
                />
              </>
            )}
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: '/zh/auth/signin' })}
              className="flex w-full items-center gap-3 border-t border-amber-900/15 px-4 py-2.5 text-left transition-colors hover:bg-stone-900"
              role="menuitem"
            >
              <AppIcon name="logout" className="h-4 w-4 text-stone-500" />
              <span className="font-serif-cn text-sm text-stone-200">登出</span>
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
      role="menuitem"
      className={`flex items-start gap-3 px-4 py-2.5 transition-colors ${highlight ? 'hover:bg-amber-500/10' : 'hover:bg-stone-900'}`}
    >
      <AppIcon name={icon} className={`mt-0.5 h-4 w-4 ${highlight ? 'text-amber-500/80' : 'text-stone-500'}`} />
      <div className="flex-1">
        <div className={`font-serif-cn text-sm ${highlight ? 'text-amber-300' : 'text-stone-200'}`}>{label}</div>
        {hint && <div className="mt-0.5 font-mono text-[10px] tracking-wider text-stone-500">{hint}</div>}
      </div>
    </Link>
  )
}
