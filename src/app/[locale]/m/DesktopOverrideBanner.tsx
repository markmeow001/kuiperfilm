'use client'

/**
 * Sticky banner shown on every /m/* page so a phone user who actually
 * needed the V2 workflow (rare — most mobile use is review-only) can
 * escape back to desktop with one tap.
 *
 * Mechanism:
 *   - Sets the `kuiper_desktop_override` cookie to `1` (1-year max-age).
 *   - Redirects to the V2 equivalent of the current /m/* page.
 *   - Cookie is read by the middleware on the next request, which
 *     skips the V2 → /m/* redirect.
 *
 * Cookie scope is path=/ so it persists across navigation. To re-enable
 * the redirect the user clears site data (or we add a UI toggle later).
 *
 * Banner is dismissable client-side via `localStorage.banner_dismissed`
 * — clicking the × hides it for 24h. We don't dismiss on Esc to avoid
 * keyboard-only mobile users accidentally dismissing.
 */

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { mobilePathToV2, DESKTOP_OVERRIDE_COOKIE } from '@/lib/mobile-detection'

const DISMISS_KEY = 'kuiper_mobile_banner_dismissed_until'
const DISMISS_HOURS = 24

export function DesktopOverrideBanner() {
  const pathname = usePathname() ?? ''
  const [hidden, setHidden] = useState(true)

  // Resolve dismissal state from localStorage on first render so SSR
  // doesn't render the banner only for it to flash off.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY)
      if (raw) {
        const until = Number.parseInt(raw, 10)
        if (Number.isFinite(until) && until > Date.now()) {
          return
        }
      }
    } catch {
      /* localStorage might be blocked — show banner anyway */
    }
    setHidden(false)
  }, [])

  function handleSwitchToDesktop() {
    // Set the bypass cookie at root path so the next middleware run
    // skips the redirect. 1-year persistence so users don't get re-
    // bounced after closing the tab.
    document.cookie = `${DESKTOP_OVERRIDE_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`
    const target = mobilePathToV2(pathname)
    window.location.href = target
  }

  function handleDismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_HOURS * 60 * 60 * 1000))
    } catch {
      /* ignore */
    }
    setHidden(true)
  }

  if (hidden) return null

  return (
    <div className="sticky top-0 z-40 flex items-center gap-2 border-b border-amber-900/30 bg-stone-950/95 px-3 py-2 backdrop-blur-sm">
      <div className="flex-1 font-mono text-[11px] leading-tight tracking-wider text-stone-400">
        手機版只支援預覽 + 輕量編輯
      </div>
      <button
        type="button"
        onClick={handleSwitchToDesktop}
        className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-serif-cn text-xs text-amber-300 transition-colors hover:bg-amber-500/20"
      >
        切到桌面版
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="關閉提示"
        className="rounded-sm px-2 py-1 font-mono text-[14px] leading-none text-stone-500 transition-colors hover:text-stone-300"
      >
        ×
      </button>
    </div>
  )
}
