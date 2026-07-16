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
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

const DISMISS_COOKIE = 'kuiper_collab_intro_seen'
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365

export function WorkspaceCollabIntroBanner() {
  const t = useTranslations('collab.introBanner')
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

  // <b> tags inside translated bullets — render via next-intl's rich-text
  // form so the keys can carry semantic emphasis without splitting strings.
  const richTags = { b: (chunks: React.ReactNode) => <strong>{chunks}</strong> }

  return (
    <div className="mb-6 rounded-2xl border border-primary-500/25 bg-primary-500/[0.05] px-5 py-4">
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="mb-1 font-mono text-[10px] tracking-[0.2em] text-primary-400">
            {t('tag')}
          </div>
          <div className="font-serif-cn text-base font-semibold text-text-primary">
            {t('title')}
          </div>
          <ul className="mt-2 space-y-1 font-serif-cn text-sm text-text-secondary">
            <li>
              <span className="text-primary-400">·</span>{' '}
              {t.rich('bullet1', richTags)}
            </li>
            <li>
              <span className="text-primary-400">·</span>{' '}
              {t.rich('bullet2', richTags)}
            </li>
            <li>
              <span className="text-primary-400">·</span>{' '}
              {t.rich('bullet3', richTags)}
            </li>
            <li>
              <span className="text-primary-400">·</span>{' '}
              {t.rich('bullet4', richTags)}
            </li>
          </ul>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-xl border border-primary-500/30 bg-primary-500/10 px-3 py-2 font-mono text-[10px] tracking-wider text-primary-300 transition-colors hover:bg-primary-500/20"
          title={t('dismissTitle')}
        >
          <AppIcon name="check" className="-mt-0.5 mr-1 inline h-3 w-3" />
          {t('dismiss')}
        </button>
      </div>
    </div>
  )
}
