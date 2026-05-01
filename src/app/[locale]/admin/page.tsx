'use client'

/**
 * Admin landing — single hub linking to Users + Invites with live counts.
 *
 * Server-side gating happens in the parent layout (/admin/layout.tsx);
 * non-admin sessions are redirected before this page renders.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Navbar from '@/components/Navbar'

interface UsersResponse {
  users?: Array<{ id: string; role: string; isActive: boolean }>
}

interface InvitesResponse {
  invites?: Array<{ id: string; usedBy: string | null; revokedAt: string | null }>
}

export default function AdminLandingPage() {
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'

  const [stats, setStats] = useState<{
    totalUsers: number
    activeUsers: number
    admins: number
    editors: number
    members: number
    totalInvites: number
    usableInvites: number
    usedInvites: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [uRes, iRes] = await Promise.all([
          fetch('/api/admin/users', { credentials: 'include' }),
          fetch('/api/admin/invites', { credentials: 'include' }),
        ])
        if (!uRes.ok) throw new Error(`users: HTTP ${uRes.status}`)
        if (!iRes.ok) throw new Error(`invites: HTTP ${iRes.status}`)
        const u = (await uRes.json()) as UsersResponse
        const i = (await iRes.json()) as InvitesResponse
        if (cancelled) return
        const users = u.users ?? []
        const invites = i.invites ?? []
        setStats({
          totalUsers: users.length,
          activeUsers: users.filter((x) => x.isActive).length,
          admins: users.filter((x) => x.role === 'admin').length,
          editors: users.filter((x) => x.role === 'editor').length,
          members: users.filter((x) => x.role === 'member').length,
          totalInvites: invites.length,
          usableInvites: invites.filter((x) => !x.usedBy && !x.revokedAt).length,
          usedInvites: invites.filter((x) => Boolean(x.usedBy)).length,
        })
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <Navbar />
      <div className="mx-auto max-w-5xl px-8 py-10">
        <h1 className="font-serif-cn text-3xl font-medium tracking-wide text-stone-100">
          管理員後台
        </h1>
        <p className="mt-2 font-fraunces text-base italic text-amber-500/80">Admin Console</p>

        {error ? (
          <div className="mt-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            載入失敗:{error}
          </div>
        ) : null}

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Link
            href={`/${locale}/admin/users`}
            className="group rounded-sm border border-amber-900/30 bg-stone-900/40 p-6 transition-all hover:-translate-y-0.5 hover:border-amber-500/40"
          >
            <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600">01 · USERS</div>
            <div className="mt-2 font-serif-cn text-xl text-stone-100">使用者管理</div>
            <p className="mt-2 font-fraunces text-sm italic text-stone-400">
              新增成員 / 改角色 / 停用啟用 — 所有註冊成員都會自動出現在這裡
            </p>
            {stats ? (
              <div className="mt-5 grid grid-cols-4 gap-3">
                <Stat label="總數" value={stats.totalUsers} />
                <Stat label="啟用" value={stats.activeUsers} />
                <Stat label="Admin" value={stats.admins} />
                <Stat label="Editor" value={stats.editors} />
              </div>
            ) : (
              <div className="mt-5 font-mono text-[10px] tracking-wider text-stone-600">
                載入中…
              </div>
            )}
          </Link>

          <Link
            href={`/${locale}/admin/invites`}
            className="group rounded-sm border border-amber-900/30 bg-stone-900/40 p-6 transition-all hover:-translate-y-0.5 hover:border-amber-500/40"
          >
            <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600">02 · INVITES</div>
            <div className="mt-2 font-serif-cn text-xl text-stone-100">邀請碼管理</div>
            <p className="mt-2 font-fraunces text-sm italic text-stone-400">
              建立 / 撤銷邀請碼 — 把 share-link 傳給新成員,他註冊後會出現在使用者管理
            </p>
            {stats ? (
              <div className="mt-5 grid grid-cols-3 gap-3">
                <Stat label="總邀請" value={stats.totalInvites} />
                <Stat label="可用" value={stats.usableInvites} highlight />
                <Stat label="已使用" value={stats.usedInvites} />
              </div>
            ) : (
              <div className="mt-5 font-mono text-[10px] tracking-wider text-stone-600">
                載入中…
              </div>
            )}
          </Link>
        </div>

        <div className="mt-12 rounded-sm border border-stone-800/60 bg-stone-900/20 p-5">
          <div className="mb-2 font-fraunces text-sm italic text-amber-500/80">流程</div>
          <ol className="space-y-2 font-serif-cn text-sm text-stone-300">
            <li>
              1. <Link href={`/${locale}/admin/invites`} className="text-amber-400 hover:underline">邀請碼管理</Link>
              {' '}→ 點「新建邀請碼」選擇角色(member / editor / admin)
            </li>
            <li>
              2. 把連結 <span className="font-mono text-xs text-amber-400">/auth/signup?invite=&lt;code&gt;</span> 複製給新成員
            </li>
            <li>
              3. 新成員透過連結註冊登入,會自動出現在
              {' '}<Link href={`/${locale}/admin/users`} className="text-amber-400 hover:underline">使用者管理</Link>
            </li>
            <li>
              4. 你隨時可以在使用者管理改他的角色或停用他
            </li>
          </ol>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-stone-500">{label}</div>
      <div className={`mt-0.5 font-display text-2xl font-semibold ${highlight ? 'text-amber-400' : 'text-stone-200'}`}>
        {value}
      </div>
    </div>
  )
}
