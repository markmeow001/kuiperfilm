'use client'

/**
 * /m/projects — mobile project list.
 *
 * Lists all projects the current user can see (own + shared via
 * workspace). Each card links to /m/projects/:id for episode review.
 *
 * Reuses the existing /api/projects?page=1&pageSize=N endpoint —
 * no new server work needed. We pull pageSize=50 since this surface
 * is for quick review, not browsing; if a team has more than 50
 * active projects they're scrolling past the bottom anyway.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useParams } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'

interface ProjectListItem {
  id: string
  name: string
  description: string | null
  updatedAt: string
  lastAccessedAt: string | null
  createdAt: string
}

interface ProjectsResponse {
  projects: ProjectListItem[]
  total: number
}

export default function MobileProjectsPage() {
  const { status } = useSession()
  const router = useRouter()
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'

  const [data, setData] = useState<ProjectsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Auth gate: NextAuth pages.signIn points at the desktop /auth/signin;
  // we want mobile users to land on /m/auth/signin instead. Detect
  // unauth client-side and redirect.
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/${locale}/m/auth/signin`)
    }
  }, [status, router, locale])

  useEffect(() => {
    if (status !== 'authenticated') return
    let alive = true
    async function load() {
      try {
        setLoading(true)
        setError(null)
        const res = await fetch('/api/projects?page=1&pageSize=50')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as ProjectsResponse
        if (alive) setData(json)
      } catch (err) {
        if (alive) setError((err as Error).message)
      } finally {
        if (alive) setLoading(false)
      }
    }
    load()
    return () => {
      alive = false
    }
  }, [status])

  if (status === 'loading' || (status === 'authenticated' && loading)) {
    return <LoadingScreen />
  }
  if (status === 'unauthenticated') {
    return null // redirecting via effect
  }

  return (
    <main className="px-4 pb-20 pt-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600/80">
            REVIEW · PROJECTS
          </div>
          <h1 className="mt-1 font-serif-cn text-2xl font-medium text-stone-100">
            專案列表
          </h1>
          {data ? (
            <div className="mt-1 font-fraunces text-xs italic text-stone-500">
              {data.total} project{data.total === 1 ? '' : 's'}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/${locale}/m/playground`}
            className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2 font-mono text-[10px] tracking-wider text-amber-400"
          >
            ✦ 生圖對話
          </Link>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: `/${locale}/m/auth/signin` })}
            className="rounded-sm border border-stone-800 bg-stone-900/40 px-3 py-2 font-mono text-[10px] tracking-wider text-stone-400 transition-all hover:border-amber-500/40 hover:text-amber-400"
          >
            登出
          </button>
        </div>
      </header>

      {error ? (
        <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-3 font-serif-cn text-sm text-rose-300">
          載入失敗：{error}
        </div>
      ) : null}

      {data && data.projects.length === 0 ? (
        <div className="rounded-sm border border-stone-800/60 bg-stone-900/30 px-4 py-8 text-center">
          <div className="font-fraunces text-base italic text-stone-500">
            還沒有專案
          </div>
          <div className="mt-2 font-mono text-[10px] tracking-wider text-stone-600">
            到 desktop /v2 建立第一個專案
          </div>
        </div>
      ) : null}

      <ul className="space-y-3">
        {(data?.projects ?? []).map((p) => (
          <li key={p.id}>
            <Link
              href={`/${locale}/m/projects/${p.id}`}
              className="block rounded-sm border border-amber-900/20 bg-stone-900/50 px-4 py-4 active:bg-stone-900/80"
            >
              <div className="font-serif-cn text-base font-medium text-stone-100">
                {p.name}
              </div>
              {p.description ? (
                <div className="mt-1 line-clamp-2 font-fraunces text-xs italic text-stone-400">
                  {p.description}
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-[10px] tracking-wider text-stone-500">
                  {formatRelative(p.lastAccessedAt ?? p.updatedAt)}
                </span>
                <span className="font-mono text-[10px] tracking-wider text-amber-500/80">
                  →
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}

function LoadingScreen() {
  return (
    <main className="flex min-h-[100svh] items-center justify-center">
      <div className="font-fraunces text-sm italic text-stone-500">載入中…</div>
    </main>
  )
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime()
  const now = Date.now()
  const diffMin = Math.floor((now - ts) / 60_000)
  if (diffMin < 1) return '剛剛'
  if (diffMin < 60) return `${diffMin} 分鐘前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小時前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7) return `${diffDay} 天前`
  return new Date(iso).toLocaleDateString('zh-TW')
}
