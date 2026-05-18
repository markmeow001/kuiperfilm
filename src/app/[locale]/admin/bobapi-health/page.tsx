'use client'

/**
 * Admin: video provider health dashboard — BobAPI / Seedance focus.
 *
 * Server-side gating via /admin/layout.tsx (admin-only). The API route
 * also enforces requireAdminAuth defence-in-depth.
 *
 * Surfaces three things the admin needs when a Seedance run breaks:
 *   1. Seedance summary — total / completed / failed / failure rate
 *      over the chosen window.
 *   2. Provider comparison — same buckets for Kling (tencent-vod) /
 *      fal-ai / others so you can spot a Seedance-specific outage
 *      versus a global infra problem.
 *   3. Error breakdown — by Task.errorCode plus the provider-internal
 *      code parsed out of errorMessage (`get_channel_failed`,
 *      `TAIJIAI_AUTH_FAILED`, etc.). Each row carries a 600-char
 *      sample so the on-call can copy-paste into a BobAPI ticket.
 *   4. Recent failures — last 20 failed Seedance/Kling rows for
 *      deeper diagnosis without leaving the page.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import Navbar from '@/components/Navbar'

interface ProviderBucket {
  provider: string
  modelId: string | null
  total: number
  completed: number
  failed: number
  running: number
  failureRate: number | null
}

interface ErrorBucket {
  errorCode: string
  providerInternalCode: string | null
  count: number
  lastSeen: string
  sampleMessage: string
}

interface DailyBucket {
  day: string
  completed: number
  failed: number
}

interface RecentFailure {
  taskId: string
  createdAt: string
  finishedAt: string | null
  provider: string
  modelId: string | null
  errorCode: string | null
  providerInternalCode: string | null
  errorMessage: string | null
}

interface BobapiHealthResponse {
  success: boolean
  generatedAt: string
  window: { from: string; to: string; days: number }
  seedance: ProviderBucket
  providers: ProviderBucket[]
  errorBreakdown: ErrorBucket[]
  dailySeedance: DailyBucket[]
  recentFailures: RecentFailure[]
}

const DAY_OPTIONS = [7, 14, 30]

function fmtPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}

function fmtRelTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}

function failureRateClass(rate: number | null): string {
  if (rate === null) return 'text-stone-400'
  if (rate >= 0.25) return 'text-rose-400'
  if (rate >= 0.1) return 'text-amber-400'
  return 'text-emerald-400'
}

export default function BobapiHealthPage() {
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'

  const [days, setDays] = useState<number>(7)
  const [data, setData] = useState<BobapiHealthResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/bobapi-health?days=${days}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as BobapiHealthResponse
      setData(json)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown error'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  const seedance = data?.seedance

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <Navbar />
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <Link
              href={`/${locale}/admin`}
              className="font-mono text-[10px] tracking-[0.3em] text-amber-600 hover:text-amber-400"
            >
              ← 返回管理台
            </Link>
            <h1 className="mt-2 font-serif-cn text-3xl text-stone-100">影片供應商健康度</h1>
            <p className="mt-1 font-fraunces text-sm italic text-stone-400">
              BobAPI / Seedance 故障率 + 各供應商使用量 + 錯誤碼分布
            </p>
          </div>
          <div className="flex items-center gap-2">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-sm border px-3 py-1.5 font-mono text-xs tracking-wider transition-all ${
                  d === days
                    ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                    : 'border-stone-800 bg-stone-900/40 text-stone-400 hover:border-stone-700 hover:text-stone-200'
                }`}
              >
                {d}天
              </button>
            ))}
            <button
              onClick={() => void fetchData()}
              disabled={loading}
              className="rounded-sm border border-stone-800 bg-stone-900/40 px-3 py-1.5 font-mono text-xs tracking-wider text-stone-300 transition-all hover:border-stone-700 hover:text-stone-100 disabled:opacity-50"
            >
              {loading ? '更新中…' : '重新整理'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-6 rounded-sm border border-rose-500/40 bg-rose-500/5 px-4 py-3 font-mono text-sm text-rose-300">
            載入失敗: {error}
          </div>
        ) : null}

        {/* Seedance summary card */}
        <section className="mb-8">
          <div className="mb-3 font-mono text-[10px] tracking-[0.3em] text-amber-600">
            01 · SEEDANCE / BOBAPI 摘要
          </div>
          <div className="rounded-sm border border-amber-900/30 bg-stone-900/40 p-6">
            {seedance && seedance.total > 0 ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                <Stat label="總提交" value={seedance.total} />
                <Stat label="完成" value={seedance.completed} tone="success" />
                <Stat label="失敗" value={seedance.failed} tone={seedance.failed > 0 ? 'danger' : 'muted'} />
                <Stat label="進行中" value={seedance.running} tone="muted" />
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-wider text-stone-500">失敗率</div>
                  <div className={`mt-0.5 font-display text-2xl font-semibold ${failureRateClass(seedance.failureRate)}`}>
                    {fmtPct(seedance.failureRate)}
                  </div>
                </div>
              </div>
            ) : (
              <div className="font-fraunces text-sm italic text-stone-500">
                {loading ? '載入中…' : '近期沒有 Seedance / BobAPI 任務記錄'}
              </div>
            )}
          </div>
        </section>

        {/* Provider comparison */}
        <section className="mb-8">
          <div className="mb-3 font-mono text-[10px] tracking-[0.3em] text-amber-600">
            02 · 各供應商使用量
          </div>
          <div className="overflow-hidden rounded-sm border border-stone-800 bg-stone-900/30">
            <table className="w-full text-sm">
              <thead className="bg-stone-900/60 text-left font-mono text-[10px] uppercase tracking-wider text-stone-500">
                <tr>
                  <th className="px-4 py-2.5">供應商</th>
                  <th className="px-4 py-2.5">模型</th>
                  <th className="px-4 py-2.5 text-right">總提交</th>
                  <th className="px-4 py-2.5 text-right">完成</th>
                  <th className="px-4 py-2.5 text-right">失敗</th>
                  <th className="px-4 py-2.5 text-right">進行中</th>
                  <th className="px-4 py-2.5 text-right">失敗率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/50 font-serif-cn text-stone-300">
                {(data?.providers ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center font-fraunces italic text-stone-500">
                      {loading ? '載入中…' : '無資料'}
                    </td>
                  </tr>
                ) : (
                  (data?.providers ?? []).map((p) => (
                    <tr key={`${p.provider}::${p.modelId ?? ''}`} className="hover:bg-stone-900/40">
                      <td className="px-4 py-2.5 font-mono text-xs">{p.provider}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-stone-400">{p.modelId ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right">{p.total}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-400">{p.completed}</td>
                      <td className={`px-4 py-2.5 text-right ${p.failed > 0 ? 'text-rose-400' : 'text-stone-500'}`}>
                        {p.failed}
                      </td>
                      <td className="px-4 py-2.5 text-right text-stone-500">{p.running}</td>
                      <td className={`px-4 py-2.5 text-right font-display font-semibold ${failureRateClass(p.failureRate)}`}>
                        {fmtPct(p.failureRate)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Error breakdown */}
        <section className="mb-8">
          <div className="mb-3 font-mono text-[10px] tracking-[0.3em] text-amber-600">
            03 · 錯誤碼分布
          </div>
          {(data?.errorBreakdown ?? []).length === 0 ? (
            <div className="rounded-sm border border-emerald-900/40 bg-emerald-500/5 px-4 py-3 font-fraunces text-sm italic text-emerald-300">
              ✓ {loading ? '載入中…' : `近 ${days} 天沒有任何失敗紀錄`}
            </div>
          ) : (
            <div className="space-y-2">
              {(data?.errorBreakdown ?? []).map((eb) => (
                <div
                  key={`${eb.errorCode}::${eb.providerInternalCode ?? ''}`}
                  className="rounded-sm border border-rose-900/40 bg-stone-900/40 p-4"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-xs tracking-wider text-rose-300">{eb.errorCode}</span>
                      {eb.providerInternalCode ? (
                        <span className="rounded-sm border border-amber-900/40 bg-amber-500/5 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
                          {eb.providerInternalCode}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-baseline gap-4 font-mono text-[10px] text-stone-500">
                      <span className="text-rose-400 font-display text-base font-semibold">{eb.count}</span>
                      <span>{fmtRelTime(eb.lastSeen)}</span>
                    </div>
                  </div>
                  <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-sm bg-stone-950/60 p-2 font-mono text-[11px] leading-relaxed text-stone-400">
                    {eb.sampleMessage}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Daily Seedance breakdown */}
        {(data?.dailySeedance ?? []).length > 0 ? (
          <section className="mb-8">
            <div className="mb-3 font-mono text-[10px] tracking-[0.3em] text-amber-600">
              04 · SEEDANCE 每日趨勢
            </div>
            <div className="overflow-hidden rounded-sm border border-stone-800 bg-stone-900/30">
              <table className="w-full text-sm">
                <thead className="bg-stone-900/60 text-left font-mono text-[10px] uppercase tracking-wider text-stone-500">
                  <tr>
                    <th className="px-4 py-2.5">日期</th>
                    <th className="px-4 py-2.5 text-right">完成</th>
                    <th className="px-4 py-2.5 text-right">失敗</th>
                    <th className="px-4 py-2.5 text-right">失敗率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/50 font-mono text-xs text-stone-300">
                  {(data?.dailySeedance ?? []).slice().reverse().map((d) => {
                    const settled = d.completed + d.failed
                    const rate = settled > 0 ? d.failed / settled : null
                    return (
                      <tr key={d.day} className="hover:bg-stone-900/40">
                        <td className="px-4 py-2">{d.day}</td>
                        <td className="px-4 py-2 text-right text-emerald-400">{d.completed}</td>
                        <td className={`px-4 py-2 text-right ${d.failed > 0 ? 'text-rose-400' : 'text-stone-500'}`}>{d.failed}</td>
                        <td className={`px-4 py-2 text-right font-display font-semibold ${failureRateClass(rate)}`}>
                          {fmtPct(rate)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* Recent failures */}
        {(data?.recentFailures ?? []).length > 0 ? (
          <section className="mb-8">
            <div className="mb-3 font-mono text-[10px] tracking-[0.3em] text-amber-600">
              05 · 最近失敗紀錄（最多 20 筆）
            </div>
            <div className="space-y-2">
              {(data?.recentFailures ?? []).map((rf) => (
                <div key={rf.taskId} className="rounded-sm border border-stone-800 bg-stone-900/40 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-amber-400">{rf.provider}</span>
                      {rf.modelId ? (
                        <span className="font-mono text-stone-500">{rf.modelId}</span>
                      ) : null}
                      <span className="rounded-sm border border-rose-900/40 bg-rose-500/5 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
                        {rf.errorCode ?? 'UNKNOWN'}
                      </span>
                      {rf.providerInternalCode ? (
                        <span className="rounded-sm border border-amber-900/40 bg-amber-500/5 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
                          {rf.providerInternalCode}
                        </span>
                      ) : null}
                    </div>
                    <span className="font-mono text-[10px] text-stone-500">{fmtRelTime(rf.createdAt)}</span>
                  </div>
                  {rf.errorMessage ? (
                    <pre className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-all rounded-sm bg-stone-950/60 p-2 font-mono text-[11px] leading-relaxed text-stone-400">
                      {rf.errorMessage}
                    </pre>
                  ) : null}
                  <div className="mt-1.5 font-mono text-[10px] text-stone-600">task: {rf.taskId}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mt-12 rounded-sm border border-stone-800/60 bg-stone-900/20 p-4 font-mono text-[10px] tracking-wider text-stone-500">
          window: {data?.window?.from?.slice(0, 16) ?? '—'} → {data?.window?.to?.slice(0, 16) ?? '—'}
          {data?.generatedAt ? ` · 生成於 ${data.generatedAt.slice(0, 19)}` : ''}
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'success' | 'danger' | 'muted'
}) {
  const colorClass =
    tone === 'success'
      ? 'text-emerald-400'
      : tone === 'danger'
        ? 'text-rose-400'
        : tone === 'muted'
          ? 'text-stone-400'
          : 'text-stone-100'
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-stone-500">{label}</div>
      <div className={`mt-0.5 font-display text-2xl font-semibold ${colorClass}`}>{value.toLocaleString()}</div>
    </div>
  )
}
