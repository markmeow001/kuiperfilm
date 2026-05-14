'use client'

/**
 * Admin: per-user weekly image/video task usage.
 *
 * Server-side gating via /admin/layout.tsx (admin-only). API route also
 * enforces requireAdminAuth as defense-in-depth.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Navbar from '@/components/Navbar'

interface Bucket {
  completed: number
  failed: number
}

interface WeeklyEntry {
  weekStart: string
  image: Bucket
  video: Bucket
}

interface UserUsage {
  userId: string
  email: string | null
  name: string | null
  displayName: string | null
  role: string
  totals: { image: Bucket; video: Bucket }
  weekly: WeeklyEntry[]
  totalRuns: number
}

interface WeekHeader {
  weekStart: string
  weekEnd: string
}

interface UsageResponse {
  success: boolean
  generatedAt: string
  weeks: WeekHeader[]
  users: UserUsage[]
}

const WEEK_OPTIONS = [4, 8, 12]

function fmtMD(iso: string): string {
  return iso.slice(5)
}

function bucketToCell(image: Bucket, video: Bucket): React.ReactNode {
  const imgTotal = image.completed + image.failed
  const vidTotal = video.completed + video.failed
  if (imgTotal === 0 && vidTotal === 0) {
    return <span className="text-stone-700">—</span>
  }
  return (
    <div className="flex flex-col gap-0.5 text-[12px] leading-tight">
      <div>
        <span className="text-amber-400">🖼 {image.completed}</span>
        {image.failed > 0 ? (
          <span className="ml-1 text-rose-500/80">✗{image.failed}</span>
        ) : null}
      </div>
      <div>
        <span className="text-cyan-400">🎬 {video.completed}</span>
        {video.failed > 0 ? (
          <span className="ml-1 text-rose-500/80">✗{video.failed}</span>
        ) : null}
      </div>
    </div>
  )
}

export default function AdminUsagePage() {
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'
  const [weeks, setWeeks] = useState(4)
  const [data, setData] = useState<UsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/per-user-task-usage?weeks=${weeks}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as UsageResponse
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [weeks])

  useEffect(() => { load() }, [load])

  const grandTotals = useMemo(() => {
    if (!data) return null
    return data.users.reduce(
      (acc, u) => ({
        image: {
          completed: acc.image.completed + u.totals.image.completed,
          failed: acc.image.failed + u.totals.image.failed,
        },
        video: {
          completed: acc.video.completed + u.totals.video.completed,
          failed: acc.video.failed + u.totals.video.failed,
        },
      }),
      { image: { completed: 0, failed: 0 }, video: { completed: 0, failed: 0 } },
    )
  }, [data])

  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <Navbar />
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link
            href={`/${locale}/admin`}
            className="font-mono text-[10px] tracking-wider text-stone-500 hover:text-amber-400"
          >
            ← 後台首頁
          </Link>
          <div className="flex items-center gap-1 rounded-md border border-stone-800/60 bg-stone-900/40 p-1">
            <Link href={`/${locale}/admin/users`} className="rounded-sm px-3 py-1.5 font-medium text-xs text-stone-400 hover:text-stone-200">使用者</Link>
            <Link href={`/${locale}/admin/invites`} className="rounded-sm px-3 py-1.5 font-medium text-xs text-stone-400 hover:text-stone-200">邀請碼</Link>
            <Link href={`/${locale}/admin/projects`} className="rounded-sm px-3 py-1.5 font-medium text-xs text-stone-400 hover:text-stone-200">所有專案</Link>
            <Link href={`/${locale}/admin/runs`} className="rounded-sm px-3 py-1.5 font-medium text-xs text-stone-400 hover:text-stone-200">失敗任務</Link>
            <span className="rounded-sm bg-amber-500/15 px-3 py-1.5 font-medium text-xs text-amber-400">使用量</span>
          </div>
        </div>

        <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-fraunces text-2xl italic text-amber-500/90">
              Per-User Usage
            </h1>
            <p className="mt-1 font-serif-cn text-sm text-stone-500">
              每個使用者每週的圖片 / 視頻生成統計（admin only）
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-stone-500">
              WINDOW
            </span>
            {WEEK_OPTIONS.map((w) => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                disabled={loading}
                className={`rounded-sm border px-3 py-1.5 font-mono text-xs transition-all disabled:opacity-50 ${
                  weeks === w
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                    : 'border-stone-800 text-stone-500 hover:border-stone-700'
                }`}
              >
                {w}w
              </button>
            ))}
            <button
              onClick={load}
              disabled={loading}
              className="rounded-sm border border-stone-800 px-3 py-1.5 font-mono text-xs text-stone-400 hover:border-stone-700 disabled:opacity-50"
            >
              {loading ? '…' : '↻ 刷新'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-sm border border-rose-500/30 bg-rose-500/5 p-3 font-mono text-xs text-rose-400">
            {error}
          </div>
        ) : null}

        {data && grandTotals ? (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-sm border border-stone-800/60 bg-stone-900/30 p-3">
              <div className="font-mono text-[11px] uppercase tracking-wider text-stone-500">
                Active Users
              </div>
              <div className="mt-1 font-fraunces text-xl text-amber-400">
                {data.users.length}
              </div>
            </div>
            <div className="rounded-sm border border-stone-800/60 bg-stone-900/30 p-3">
              <div className="font-mono text-[11px] uppercase tracking-wider text-stone-500">
                Image Total
              </div>
              <div className="mt-1 font-fraunces text-xl text-amber-400">
                {grandTotals.image.completed}
                <span className="ml-2 font-mono text-xs text-rose-500/70">
                  ✗{grandTotals.image.failed}
                </span>
              </div>
            </div>
            <div className="rounded-sm border border-stone-800/60 bg-stone-900/30 p-3">
              <div className="font-mono text-[11px] uppercase tracking-wider text-stone-500">
                Video Total
              </div>
              <div className="mt-1 font-fraunces text-xl text-cyan-400">
                {grandTotals.video.completed}
                <span className="ml-2 font-mono text-xs text-rose-500/70">
                  ✗{grandTotals.video.failed}
                </span>
              </div>
            </div>
            <div className="rounded-sm border border-stone-800/60 bg-stone-900/30 p-3">
              <div className="font-mono text-[11px] uppercase tracking-wider text-stone-500">
                Weeks Shown
              </div>
              <div className="mt-1 font-fraunces text-xl text-stone-300">
                {data.weeks.length}
              </div>
            </div>
          </div>
        ) : null}

        {loading && !data ? (
          <div className="rounded-sm border border-stone-800/60 bg-stone-900/30 p-8 text-center font-mono text-sm text-stone-500">
            Loading…
          </div>
        ) : data ? (
          <div className="overflow-x-auto rounded-sm border border-stone-800/60 bg-stone-900/30">
            <table className="min-w-full divide-y divide-stone-800/60">
              <thead className="bg-stone-900/60">
                <tr>
                  <th className="sticky left-0 z-10 bg-stone-900/80 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-stone-500">
                    User
                  </th>
                  {data.weeks.map((w) => (
                    <th
                      key={w.weekStart}
                      className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-stone-500"
                    >
                      {fmtMD(w.weekStart)}–{fmtMD(w.weekEnd)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-amber-500/80">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/40">
                {data.users.length === 0 ? (
                  <tr>
                    <td
                      colSpan={data.weeks.length + 2}
                      className="px-3 py-8 text-center font-serif-cn text-sm text-stone-600"
                    >
                      此區間內無使用者活動
                    </td>
                  </tr>
                ) : (
                  data.users.map((u) => (
                    <tr key={u.userId} className="hover:bg-stone-900/40">
                      <td className="sticky left-0 z-10 bg-stone-900/80 px-3 py-2 align-top">
                        <div className="font-serif-cn text-sm text-stone-200">
                          {u.displayName || u.name || '—'}
                        </div>
                        <div className="font-mono text-[11px] text-stone-500">
                          {u.email ?? '—'}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-stone-600">
                          {u.role}
                        </div>
                      </td>
                      {u.weekly.map((w) => (
                        <td key={w.weekStart} className="px-3 py-2 align-top">
                          {bucketToCell(w.image, w.video)}
                        </td>
                      ))}
                      <td className="px-3 py-2 align-top">
                        {bucketToCell(u.totals.image, u.totals.video)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}

        {data ? (
          <div className="mt-3 font-mono text-[11px] text-stone-600">
            Generated at {new Date(data.generatedAt).toLocaleString()}
          </div>
        ) : null}
      </div>
    </div>
  )
}
