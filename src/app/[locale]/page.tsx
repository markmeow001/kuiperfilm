'use client'

/**
 * Public landing — restyled to match the V2 cinematic palette.
 *
 * Replaces the legacy blue/glass theme with the stone-950 + amber-500
 * + fraunces-italic / serif-cn / mono-tracked stack used by the
 * /v2/workspace shell so the brand reads consistently before login.
 */

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { UserRole } from '@/lib/auth/user-role'

export default function Home() {
  const t = useTranslations('landing')
  const { data: session } = useSession()
  const userName = session?.user?.name ?? null
  const userRole = (session?.user as { role?: string } | undefined)?.role ?? null

  return (
    <div className="font-body grain min-h-screen bg-stone-950 text-stone-200">
      {/* Top brand bar — matches v2 sidebar / shell typography */}
      <header className="border-b border-amber-900/15 px-8 py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/" className="flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-semibold italic tracking-tight text-amber-400">
              Kuiper
            </span>
            <span className="font-serif-cn text-base font-medium text-stone-100">影界</span>
            <span className="ml-3 font-mono text-[10px] tracking-[0.3em] text-stone-500">
              AI · MANHUA · STUDIO
            </span>
          </Link>

          <nav className="flex items-center gap-6 font-mono text-[11px] tracking-wider text-stone-400">
            {session ? (
              <>
                <span className="text-stone-500">
                  {userName} · {(userRole ?? UserRole.MEMBER).toUpperCase()}
                </span>
                <Link
                  href="/zh/v2"
                  className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-1.5 font-serif-cn text-sm font-medium text-amber-400 transition-all hover:bg-amber-500/20"
                >
                  進入工作區
                </Link>
              </>
            ) : (
              <>
                <Link href="/zh/auth/signin" className="hover:text-amber-400">
                  登入
                </Link>
                <Link
                  href="/zh/auth/signup"
                  className="rounded-sm bg-amber-500 px-4 py-1.5 font-serif-cn text-sm font-medium text-stone-950 transition-all hover:bg-amber-400"
                >
                  註冊 / 取得邀請碼
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Backdrop — amber/rose radial like the v2 sidebar accent area */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(1100px_540px_at_85%_-10%,rgba(245,158,11,0.08),transparent),radial-gradient(900px_500px_at_-5%_110%,rgba(190,18,60,0.10),transparent)]" />
      </div>

      <main className="relative z-10 mx-auto max-w-7xl px-8 pt-20 pb-24">
        <div className="grid items-center gap-20 lg:grid-cols-2">
          {/* Left — copy block */}
          <div className="space-y-8">
            <div className="font-mono text-[11px] tracking-[0.3em] text-amber-600/80">
              CHAPTER 01 — FROM SPARK TO SCREEN
            </div>

            <h1 className="font-serif-cn text-4xl font-medium leading-tight tracking-wide text-stone-100 md:text-6xl">
              {t('title')}
              <span className="mt-3 block font-display text-3xl font-normal italic text-amber-400 md:text-5xl">
                {t('subtitle')}
              </span>
            </h1>

            <p className="max-w-xl font-fraunces text-base italic leading-relaxed text-stone-400 md:text-lg">
              貼一段小說 → AI 拆解角色 / 場景 / 分鏡 → Kling 多鏡頭生成 → FFmpeg 串成完整短劇。
              整段創作鏈在一個畫面跑完。
            </p>

            <div className="flex flex-wrap items-center gap-4 pt-2">
              {session ? (
                <Link
                  href="/zh/v2"
                  className="inline-flex items-center gap-2 rounded-sm bg-amber-500 px-7 py-3 font-serif-cn text-base font-medium text-stone-950 transition-all hover:bg-amber-400"
                >
                  {t('enterWorkspace') ?? '進入工作區'}
                  <span className="font-mono text-xs">→</span>
                </Link>
              ) : (
                <>
                  <Link
                    href="/zh/auth/signup"
                    className="inline-flex items-center gap-2 rounded-sm bg-amber-500 px-7 py-3 font-serif-cn text-base font-medium text-stone-950 transition-all hover:bg-amber-400"
                  >
                    {t('getStarted') ?? '開始創作'}
                    <span className="font-mono text-xs">→</span>
                  </Link>
                  <Link
                    href="/zh/auth/signin"
                    className="inline-flex items-center gap-2 rounded-sm border border-amber-500/40 px-7 py-3 font-serif-cn text-base font-medium text-amber-400 transition-all hover:bg-amber-500/10"
                  >
                    已有帳號?登入
                  </Link>
                </>
              )}
            </div>

            {/* Pipeline preview chips */}
            <div className="flex flex-wrap items-center gap-2 pt-6">
              {['劇本', '主體', '分鏡', '配音', '成片'].map((label, i) => (
                <span
                  key={label}
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-stone-500"
                >
                  {String(i + 1).padStart(2, '0')} · {label}
                  {i < 4 ? <span className="ml-2 text-amber-700">→</span> : null}
                </span>
              ))}
            </div>
          </div>

          {/* Right — animated frame stack mimicking the storyboard preview */}
          <div className="relative hidden h-[520px] items-center justify-center lg:flex">
            <div className="relative h-full w-full max-w-md">
              {/* Halo */}
              <div className="absolute left-1/2 top-1/2 h-[110%] w-[110%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(245,158,11,0.18),transparent_60%)] blur-3xl" />

              {/* Back card */}
              <div className="absolute right-4 top-6 h-72 w-56 rotate-6 rounded-sm border border-amber-900/30 bg-stone-900/40">
                <div className="m-4 h-32 rounded-sm bg-gradient-to-br from-stone-800 to-stone-900" />
                <div className="mx-4 h-2 w-3/4 rounded-full bg-stone-800" />
                <div className="mx-4 mt-2 h-2 w-1/2 rounded-full bg-stone-800" />
              </div>

              {/* Mid card */}
              <div className="absolute bottom-10 left-6 h-72 w-56 -rotate-3 rounded-sm border border-rose-900/30 bg-stone-900/50">
                <div className="m-4 h-32 rounded-sm bg-gradient-to-br from-rose-900/30 to-stone-900" />
                <div className="mx-4 h-2 w-3/4 rounded-full bg-stone-800" />
                <div className="mx-4 mt-2 h-2 w-1/2 rounded-full bg-stone-800" />
              </div>

              {/* Front feature card */}
              <div className="absolute left-1/2 top-1/2 h-80 w-72 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm border border-amber-500/30 bg-stone-900/80 shadow-2xl">
                <div className="p-5">
                  <div className="font-mono text-[10px] tracking-[0.3em] text-amber-500/80">
                    EP 01 · OPENING SEQUENCE
                  </div>
                  <div className="mt-3 aspect-video rounded-sm bg-gradient-to-br from-amber-500/10 via-stone-900 to-rose-900/20" />
                  <div className="mt-4 space-y-2">
                    <div className="font-fraunces text-sm italic text-stone-300">
                      Storyboard Strip
                    </div>
                    <div className="flex gap-1">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={`h-10 flex-1 rounded-sm ${
                            i === 2 ? 'bg-amber-500/30' : 'bg-stone-800/60'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="font-mono text-[9px] tracking-wider text-stone-500">
                      05 SHOTS · DRAFT 03
                    </div>
                    <div className="rounded-sm bg-amber-500 px-3 py-1.5 font-serif-cn text-xs font-medium text-stone-950">
                      匯出 MP4
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-amber-900/15 px-8 py-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between font-mono text-[10px] tracking-wider text-stone-600">
          <span>© KuiperAI · Beta v0.2</span>
          <span>FROM SPARK TO SCREEN</span>
        </div>
      </footer>
    </div>
  )
}
