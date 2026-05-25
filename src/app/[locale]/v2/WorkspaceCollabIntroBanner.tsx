'use client'

/**
 * Phase 12.5 — one-shot intro banner explaining workspace collab.
 *
 * Renders on /v2 home until user clicks "知道了" — sets a cookie that
 * persists 1 year. Cookie-flag dismissal (not localStorage) so the
 * dismissal carries across devices that share a session, and lines up
 * with the rest of KuiperAI's pattern (MobileRevertBanner / desktop
 * override).
 *
 * Banner intentionally lives ABOVE the project grid (not as a toast)
 * because users need to actually read the four bullet points — toasts
 * vanish in 3s and users assume they were ads.
 */

import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'

const DISMISS_COOKIE = 'kuiper_collab_intro_seen'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function WorkspaceCollabIntroBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const seen = document.cookie
      .split(';')
      .some((c) => c.trim().startsWith(`${DISMISS_COOKIE}=1`))
    setShow(!seen)
  }, [])

  function dismiss() {
    document.cookie = `${DISMISS_COOKIE}=1; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="mb-6 rounded-sm border border-amber-500/40 bg-amber-500/5 px-5 py-4">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="mb-1 font-mono text-[11px] tracking-[0.2em] text-amber-400">
            NEW · 工作區協作
          </div>
          <div className="font-serif-cn text-base font-medium text-stone-100">
            現在可以多人合作做一個專案
          </div>
          <ul className="mt-2 space-y-1 font-serif-cn text-sm text-stone-300">
            <li>
              <span className="text-amber-400">·</span>{' '}
              <strong>切換工作區</strong>：左上角下拉，看你加入的工作區內所有專案
            </li>
            <li>
              <span className="text-amber-400">·</span>{' '}
              <strong>請求編輯權限</strong>：看到別人的專案，按右上角「請求編輯」就好
            </li>
            <li>
              <span className="text-amber-400">·</span>{' '}
              <strong>通知中心 🔔</strong>：別人對你的專案有動作（請求 / 刪除）會即時收到
            </li>
            <li>
              <span className="text-amber-400">·</span>{' '}
              <strong>活動記錄 📜</strong>：每個專案首頁右上角，查誰做了什麼
            </li>
          </ul>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-1 font-mono text-[11px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20"
          title="知道了，不再顯示"
        >
          <AppIcon name="check" className="-mt-0.5 mr-1 inline h-3 w-3" />
          知道了
        </button>
      </div>
    </div>
  )
}
