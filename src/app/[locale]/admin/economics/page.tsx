'use client'

/**
 * Admin: production economics dashboard.
 *
 * 10 unit-economics metrics across a rolling window.
 *
 * Server-side gating via /admin/layout.tsx (admin-only). API route also
 * enforces requireAdminAuth as defense-in-depth.
 *
 * See docs/plans/2026-05-17-admin-production-economics.md
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Navbar from '@/components/Navbar'

interface Metrics {
  generatedSeconds: number
  deliveredSeconds: number
  deliveredRatio: number | null
  wasteRatio: number | null
  totalTokens: number
  totalCost: number
  tokensPerGenSecond: number | null
  tokensPerFinalSecond: number | null
  realCostPerMinute: number | null
  deliveryPricePerMinute: number | null
  grossMargin: number | null
  currency: string
}

interface Meta {
  deliveredSource: 'proxy' | 'manual_flag'
  pricingSource: 'unset' | 'global_benchmark'
  snapshotAt: string
}

interface GlobalResponse {
  windowStart: string
  windowEnd: string
  metrics: Metrics
  meta: Meta
}

interface UserRow extends Metrics {
  userId: string
  name: string | null
  email: string | null
  displayName: string | null
}

interface UserResponse {
  windowStart: string
  windowEnd: string
  meta: Meta
  users: UserRow[]
}

interface WeekRow extends Metrics {
  weekStart: string
  weekEnd: string
}

interface WeekResponse {
  windowStart: string
  windowEnd: string
  meta: Meta
  weeks: WeekRow[]
}

type AnyResponse = GlobalResponse | UserResponse | WeekResponse
type GroupBy = 'global' | 'user' | 'week'

const WEEK_OPTIONS = [4, 8, 12]
const GROUP_OPTIONS: Array<{ value: GroupBy; label: string }> = [
  { value: 'global', label: '整體' },
  { value: 'user', label: '依用戶' },
  { value: 'week', label: '依週' },
]

function fmtSeconds(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '0 s'
  if (s >= 3600) return `${(s / 3600).toFixed(1)} h`
  if (s >= 60) return `${(s / 60).toFixed(1)} min`
  return `${s.toFixed(1)} s`
}

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}

function fmtNum(v: number | null, decimals = 2): string {
  if (v === null || !Number.isFinite(v)) return 'N/A'
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtTokens(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '0'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return Math.round(v).toString()
}

function fmtCost(v: number | null, currency: string, decimals = 4): string {
  if (v === null || !Number.isFinite(v)) return 'N/A'
  return `${currency === 'RMB' ? '¥' : currency === 'USD' ? '$' : ''}${v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`
}

interface MetricCardProps {
  label: string
  value: string
  hint?: string
  estimated?: boolean
}

function MetricCard({ label, value, hint, estimated }: MetricCardProps) {
  return (
    <div className="rounded-md border border-stone-800 bg-stone-900/40 p-4">
      <div className="flex items-center gap-1.5">
        <div className="font-mono text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
        {estimated ? (
          <span className="font-mono text-[9px] text-amber-500/70" title={hint}>(估)</span>
        ) : null}
      </div>
      <div className="mt-1 font-fraunces text-2xl text-stone-100">{value}</div>
      {hint && !estimated ? (
        <div className="mt-1 font-serif-cn text-[11px] text-stone-600">{hint}</div>
      ) : null}
    </div>
  )
}

function MetricsGrid({ m, meta }: { m: Metrics; meta: Meta }) {
  const isProxy = meta.deliveredSource === 'proxy'
  const noPrice = meta.pricingSource === 'unset'
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <MetricCard label="总生成秒数" value={fmtSeconds(m.generatedSeconds)} />
      <MetricCard
        label="最终成片秒数"
        value={fmtSeconds(m.deliveredSeconds)}
        estimated={isProxy}
        hint={isProxy ? '目前使用 proxy:已串接 episode 的 panel。Phase 2 將改為手動標記。' : undefined}
      />
      <MetricCard
        label="成片率"
        value={fmtPct(m.deliveredRatio)}
        estimated={isProxy}
        hint={isProxy ? '同上 proxy 估算' : undefined}
      />
      <MetricCard
        label="废片率"
        value={fmtPct(m.wasteRatio)}
        estimated={isProxy}
      />
      <MetricCard label="总token消耗" value={fmtTokens(m.totalTokens)} />
      <MetricCard label="token/生成秒" value={fmtNum(m.tokensPerGenSecond, 1)} />
      <MetricCard
        label="token/成片秒"
        value={fmtNum(m.tokensPerFinalSecond, 1)}
        estimated={isProxy}
      />
      <MetricCard
        label="每分钟真实成本"
        value={fmtCost(m.realCostPerMinute, m.currency)}
        hint={`provider 真實付款 / ${m.currency}`}
      />
      <MetricCard
        label="每分钟交付价格"
        value={fmtCost(m.deliveryPricePerMinute, m.currency, 2)}
        hint={noPrice ? '請於 .env 設定 DELIVERY_PRICE_PER_MINUTE' : undefined}
      />
      <MetricCard
        label="毛利率"
        value={fmtPct(m.grossMargin)}
        hint={noPrice ? '需先設定交付價格' : undefined}
      />
    </div>
  )
}

function UserTable({ users, meta }: { users: UserRow[]; meta: Meta }) {
  if (users.length === 0) {
    return <div className="rounded-md border border-stone-800 bg-stone-900/40 p-6 text-center text-sm text-stone-500">沒有資料</div>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-stone-800">
      <table className="w-full min-w-[1100px] text-[12px]">
        <thead className="bg-stone-900/60 font-mono text-[10px] uppercase tracking-wider text-stone-500">
          <tr>
            <th className="px-3 py-2 text-left">用戶</th>
            <th className="px-3 py-2 text-right">生成秒</th>
            <th className="px-3 py-2 text-right">成片秒</th>
            <th className="px-3 py-2 text-right">成片率</th>
            <th className="px-3 py-2 text-right">token</th>
            <th className="px-3 py-2 text-right">token/生成秒</th>
            <th className="px-3 py-2 text-right">token/成片秒</th>
            <th className="px-3 py-2 text-right">成本/分鐘</th>
            <th className="px-3 py-2 text-right">毛利率</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-900">
          {users.map((u) => (
            <tr key={u.userId} className="hover:bg-stone-900/40">
              <td className="px-3 py-2">
                <div className="text-stone-200">{u.displayName ?? u.name ?? u.userId.slice(0, 8)}</div>
                <div className="font-mono text-[10px] text-stone-600">{u.email ?? ''}</div>
              </td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtSeconds(u.generatedSeconds)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtSeconds(u.deliveredSeconds)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtPct(u.deliveredRatio)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtTokens(u.totalTokens)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtNum(u.tokensPerGenSecond, 1)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtNum(u.tokensPerFinalSecond, 1)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtCost(u.realCostPerMinute, u.currency)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtPct(u.grossMargin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {meta.deliveredSource === 'proxy' ? (
        <div className="px-3 py-2 font-serif-cn text-[11px] text-amber-500/60">「成片」欄位目前使用 proxy(已串接 episode 的 panel),Phase 2 將改用手動標記。</div>
      ) : null}
    </div>
  )
}

function WeekTable({ weeks, meta }: { weeks: WeekRow[]; meta: Meta }) {
  if (weeks.length === 0) {
    return <div className="rounded-md border border-stone-800 bg-stone-900/40 p-6 text-center text-sm text-stone-500">沒有資料</div>
  }
  return (
    <div className="overflow-x-auto rounded-md border border-stone-800">
      <table className="w-full min-w-[1100px] text-[12px]">
        <thead className="bg-stone-900/60 font-mono text-[10px] uppercase tracking-wider text-stone-500">
          <tr>
            <th className="px-3 py-2 text-left">週</th>
            <th className="px-3 py-2 text-right">生成秒</th>
            <th className="px-3 py-2 text-right">成片秒</th>
            <th className="px-3 py-2 text-right">成片率</th>
            <th className="px-3 py-2 text-right">token</th>
            <th className="px-3 py-2 text-right">token/生成秒</th>
            <th className="px-3 py-2 text-right">成本</th>
            <th className="px-3 py-2 text-right">成本/分鐘</th>
            <th className="px-3 py-2 text-right">毛利率</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-900">
          {weeks.map((w) => (
            <tr key={w.weekStart} className="hover:bg-stone-900/40">
              <td className="px-3 py-2 font-mono text-stone-300">{w.weekStart.slice(5)} ~ {w.weekEnd.slice(5)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtSeconds(w.generatedSeconds)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtSeconds(w.deliveredSeconds)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtPct(w.deliveredRatio)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtTokens(w.totalTokens)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtNum(w.tokensPerGenSecond, 1)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtCost(w.totalCost, w.currency)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtCost(w.realCostPerMinute, w.currency)}</td>
              <td className="px-3 py-2 text-right font-mono text-stone-300">{fmtPct(w.grossMargin)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {meta.deliveredSource === 'proxy' ? (
        <div className="px-3 py-2 font-serif-cn text-[11px] text-amber-500/60">「成片」相關欄位目前使用 proxy。</div>
      ) : null}
    </div>
  )
}

export default function AdminEconomicsPage() {
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'
  const [weeks, setWeeks] = useState(4)
  const [groupBy, setGroupBy] = useState<GroupBy>('global')
  const [data, setData] = useState<AnyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/production-economics?weeks=${weeks}&groupBy=${groupBy}`, {
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as AnyResponse
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [weeks, groupBy])

  useEffect(() => { load() }, [load])

  const csvHref = `/api/admin/production-economics?weeks=${weeks}&groupBy=${groupBy}&format=csv`

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
            <Link href={`/${locale}/admin/usage`} className="rounded-sm px-3 py-1.5 font-medium text-xs text-stone-400 hover:text-stone-200">使用量</Link>
            <span className="rounded-sm bg-amber-500/15 px-3 py-1.5 font-medium text-xs text-amber-400">經濟</span>
          </div>
        </div>

        <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-fraunces text-2xl italic text-amber-500/90">
              Production Economics
            </h1>
            <p className="mt-1 font-serif-cn text-sm text-stone-500">
              生產單位經濟指標 — 生成秒數 / token / 成本 / 毛利(admin only)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-stone-500">GROUP</span>
              {GROUP_OPTIONS.map((g) => (
                <button
                  key={g.value}
                  onClick={() => setGroupBy(g.value)}
                  disabled={loading}
                  className={`rounded-sm border px-3 py-1.5 font-mono text-xs transition-all disabled:opacity-50 ${
                    groupBy === g.value
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                      : 'border-stone-800 text-stone-500 hover:border-stone-700'
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-stone-500">WINDOW</span>
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
            </div>
            <a
              href={csvHref}
              className="rounded-sm border border-stone-700 px-3 py-1.5 font-mono text-xs text-stone-300 hover:border-amber-500/50 hover:text-amber-400"
            >
              下載 CSV
            </a>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            載入失敗:{error}
          </div>
        ) : null}

        {data ? (
          <>
            <div className="mb-4 font-mono text-[11px] text-stone-500">
              {data.windowStart} → {data.windowEnd} · snapshot {data.meta.snapshotAt.slice(0, 19)}Z
            </div>
            {'metrics' in data ? <MetricsGrid m={data.metrics} meta={data.meta} /> : null}
            {'users' in data ? <UserTable users={data.users} meta={data.meta} /> : null}
            {'weeks' in data ? <WeekTable weeks={data.weeks} meta={data.meta} /> : null}
          </>
        ) : loading ? (
          <div className="rounded-md border border-stone-800 bg-stone-900/40 p-6 text-center text-sm text-stone-500">載入中…</div>
        ) : null}
      </div>
    </div>
  )
}
