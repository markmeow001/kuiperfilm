'use client'

/**
 * Phase 12 — v2 workspace sidebar.
 *
 * Ported from ~/Downloads/kino_mockup.jsx Sidebar() but parameterised:
 *   - currentStep        which step is highlighted
 *   - onSelect(stepId)   click handler (router.push at the call site)
 *
 * The user block in the footer auto-pulls from NextAuth session.
 * Phase 12 fix: previously rendered nothing because no caller passed
 * the `user` prop — making the page look like there was no auth.
 */

import Link from 'next/link'
import { signOut, useSession } from 'next-auth/react'
import { AppIcon } from '@/components/ui/icons'
import { V2_STEPS, type V2StepId, v2StepIndex } from './v2-types'

interface SidebarProps {
  currentStep: V2StepId
  onSelect: (stepId: V2StepId) => void
  /** Locale for the "回專案列表" link. Optional for back-compat; defaults to zh. */
  locale?: string
}

export function Sidebar({ currentStep, onSelect, locale = 'zh' }: SidebarProps) {
  const currentIdx = v2StepIndex(currentStep)
  const projectsHref = `/${locale}/v2`

  return (
    <aside className="flex w-52 flex-col border-r border-amber-900/20 bg-stone-950 text-stone-200">
      {/*
        2026-05-02: shrunk from w-64 → w-52 (256 → 208 px, ≈ 48px
        clawed back for the workspace col on the right). User reported
        the storyboard timeline was getting pinched at w-64 once the
        workspace went 3-col (image / text / inspector). The labels
        in this sidebar are short enough ("首頁" / "劇本" / etc.) that
        the narrower width still doesn't wrap them; padding tightened
        too so the hit-target stays the same proportion. Logo block
        keeps `AI · MANHUA · STUDIO` in tracking-[0.2em] which is the
        only thing that ever risks wrapping at this width — matched to
        the new column with `whitespace-nowrap`.
      */}
      {/* Logo — clicking returns to /v2 entry (project list) */}
      <Link
        href={projectsHref}
        className="block border-b border-amber-900/15 px-5 pt-7 pb-4 transition-colors hover:bg-stone-900/40"
        title="回到專案列表"
      >
        <div className="flex items-baseline gap-1.5">
          <div className="font-display text-2xl font-semibold italic tracking-tight text-amber-400">
            Kuiper
          </div>
          <div className="font-serif-cn text-lg font-medium text-stone-100">影界</div>
        </div>
        <div className="mt-1 whitespace-nowrap font-mono text-[13px] tracking-[0.18em] text-stone-500">
          AI · MANHUA · STUDIO
        </div>
      </Link>

      {/* Explicit "switch project" affordance — easier to spot than the
          subtle "click the logo" pattern. */}
      <Link
        href={projectsHref}
        className="group flex items-center gap-2 border-b border-amber-900/10 px-5 py-3 font-mono text-[13px] tracking-wider text-stone-500 transition-colors hover:bg-stone-900/40 hover:text-amber-400"
      >
        <AppIcon name="chevronLeft" className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
        <span>所有專案 · 切換</span>
      </Link>

      {/* Steps */}
      <nav className="flex-1 space-y-1 px-3 py-5">
        {V2_STEPS.map((step, idx) => {
          const active = step.id === currentStep
          const completed = currentIdx > idx
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onSelect(step.id)}
              className={`group flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-all ${
                active
                  ? 'border-amber-500/30 bg-amber-500/10'
                  : 'border-transparent hover:bg-stone-900/60'
              }`}
            >
              <div
                className={`w-5 font-mono text-[13px] tracking-wider ${
                  active ? 'text-amber-400' : completed ? 'text-amber-700' : 'text-stone-600'
                }`}
              >
                {step.num}
              </div>
              <AppIcon
                name={step.icon}
                className={`h-4 w-4 flex-shrink-0 ${
                  active ? 'text-amber-400' : completed ? 'text-amber-700' : 'text-stone-500'
                }`}
              />
              <div className="min-w-0 flex-1">
                {/*
                  Whitespace-nowrap on both rows: at w-52 the chinese
                  step labels ("首頁/劇本/主體/分鏡/配音/成片") plus
                  the english subtitle would otherwise break onto two
                  lines on a 14" laptop with the OS scrollbar visible.
                  Truncate ellipsis when the user crank-zooms the
                  browser to >150% — this is the graceful degradation
                  rather than an awkward two-line label.
                */}
                <div
                  className={`whitespace-nowrap font-serif-cn text-sm leading-none ${
                    active ? 'text-amber-100' : 'text-stone-300'
                  }`}
                >
                  {step.label}
                </div>
                <div className="mt-0.5 truncate font-fraunces text-[13px] italic text-stone-600">
                  {step.subtitle}
                </div>
              </div>
              {completed ? <AppIcon name="check" className="h-3 w-3 text-amber-700" /> : null}
            </button>
          )
        })}
      </nav>

      {/* User block — auto from NextAuth session */}
      <SidebarUser />
    </aside>
  )
}

function SidebarUser() {
  const { data: session, status } = useSession()
  if (status === 'loading') {
    return (
      <div className="border-t border-amber-900/15 px-5 py-5">
        <div className="font-mono text-[14px] tracking-wider text-stone-600">載入帳號中…</div>
      </div>
    )
  }
  if (!session?.user) {
    return (
      <div className="border-t border-amber-900/15 px-5 py-5">
        <a
          href="/auth/signin"
          className="block rounded-md border border-amber-500/30 px-3 py-2 text-center font-serif-cn text-sm text-amber-400 transition-all hover:bg-amber-500/10"
        >
          登入帳號
        </a>
      </div>
    )
  }
  const name = session.user.name ?? session.user.email ?? '使用者'
  const role = (session.user as { role?: string } | undefined)?.role ?? null
  const initial = name.charAt(0).toUpperCase()
  const isAdmin = role === 'admin'
  // Locale lives in the URL; signOut callbackUrl uses the base since the
  // root middleware redirects to the right locale.
  const adminHref = '/zh/admin'
  return (
    <div className="border-t border-amber-900/15 px-5 py-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-rose-700 font-display text-sm text-stone-100">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-body text-sm text-stone-200">{name}</div>
          <div className="mt-0.5 font-mono text-[14px] text-amber-600/70">
            {role ? role.toUpperCase() : 'MEMBER'}
          </div>
        </div>
        {/* Workspaces / 團隊 — visible to every signed-in role; the
            target page hides creation/management affordances when the
            requester isn't authorised. */}
        <a
          href="/zh/workspaces"
          className="rounded text-stone-500 transition-all hover:text-amber-400"
          title="工作區 / 團隊管理"
        >
          <AppIcon name="userAlt" className="h-4 w-4" />
        </a>
        {isAdmin ? (
          <>
            <a
              href="/zh/profile"
              className="rounded text-stone-500 transition-all hover:text-amber-400"
              title="設定中心(provider keys / 預設模型)"
            >
              <AppIcon name="userRoundCog" className="h-4 w-4" />
            </a>
            <a
              href={adminHref}
              className="rounded text-amber-500/70 transition-all hover:text-amber-300"
              title="管理員後台"
            >
              <AppIcon name="settingsHex" className="h-4 w-4" />
            </a>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => void signOut({ callbackUrl: '/' })}
          className="rounded text-stone-600 transition-all hover:text-amber-400"
          title="登出"
        >
          <AppIcon name="logout" className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
