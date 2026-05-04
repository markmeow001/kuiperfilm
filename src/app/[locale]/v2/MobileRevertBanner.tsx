'use client'

/**
 * Mirror of /m/*'s DesktopOverrideBanner — shown on V2 pages when:
 *   1. The viewer is on a phone-sized viewport, AND
 *   2. They have the `kuiper_desktop_override` cookie set (which is
 *      why they're seeing V2 desktop UI on a phone in the first place).
 *
 * One tap clears the cookie + redirects to the equivalent /m/* page.
 *
 * Without this, phone users who once tapped "切到桌面版" (intentionally
 * or accidentally) get stuck on cramped V2 forever — the override
 * cookie persists 1 year and there's no UI to clear it short of
 * dropping site data. This restores the symmetry.
 */

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { v2PathToMobile, DESKTOP_OVERRIDE_COOKIE } from '@/lib/mobile-detection'

const PHONE_VIEWPORT_PX = 768

export function MobileRevertBanner() {
  const pathname = usePathname() ?? ''
  const [shouldShow, setShouldShow] = useState(false)

  useEffect(() => {
    function evaluate() {
      // Phone viewport check — also accept narrow desktop windows the
      // user opened DevTools mobile-emulation against.
      const narrow = typeof window !== 'undefined' && window.innerWidth < PHONE_VIEWPORT_PX
      const hasOverride = document.cookie
        .split(';')
        .some((c) => c.trim().startsWith(`${DESKTOP_OVERRIDE_COOKIE}=1`))
      setShouldShow(narrow && hasOverride)
    }
    evaluate()
    // Re-check on resize (rotate, fold, devtools open) so a desktop
    // user who narrows the window doesn't stay seeing the banner if
    // the cookie isn't actually set.
    window.addEventListener('resize', evaluate)
    return () => window.removeEventListener('resize', evaluate)
  }, [])

  function handleSwitchToMobile() {
    // Expire the cookie immediately by setting max-age=0 at the same
    // path the original was set on. SameSite must match the original
    // for the delete to land.
    document.cookie = `${DESKTOP_OVERRIDE_COOKIE}=; path=/; max-age=0; SameSite=Lax`
    const target = v2PathToMobile(pathname) ?? `/${pathname.split('/').filter(Boolean)[0] === 'en' ? 'en' : 'zh'}/m/projects`
    window.location.href = target
  }

  if (!shouldShow) return null

  return (
    <div className="sticky top-0 z-[60] flex items-center gap-2 border-b border-amber-900/30 bg-stone-950/95 px-3 py-2 backdrop-blur-sm">
      <div className="flex-1 font-mono text-[11px] leading-tight tracking-wider text-stone-400">
        手機螢幕偵測 · 桌面版可能不易使用
      </div>
      <button
        type="button"
        onClick={handleSwitchToMobile}
        className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-serif-cn text-xs text-amber-300 transition-colors hover:bg-amber-500/20"
      >
        回到手機版
      </button>
    </div>
  )
}
