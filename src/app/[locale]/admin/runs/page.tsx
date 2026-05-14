'use client'

/**
 * Admin: failed-task triage dashboard.
 *
 * Lists recent graphRun rows with errorMessage, user, target. The
 * default filter is status=failed (the operationally useful subset),
 * but admins can switch to running / completed / queued to debug
 * stuck pipelines.
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Navbar from '@/components/Navbar'

type Status = 'failed' | 'running' | 'queued' | 'completed' | 'canceled' | 'all'

interface RunRow {
  id: string
  userId: string
  projectId: string
  episodeId: string | null
  workflowType: string
  taskType: string | null
  taskId: string | null
  targetType: string
  targetId: string
  status: string
  errorCode: string | null
  errorMessage: string | null
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  user: { id: string; name: string; email: string | null }
}

const STATUSES: Status[] = ['failed', 'running', 'queued', 'completed', 'canceled', 'all']

function fmtDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function durationMs(a: string | null, b: string | null): string {
  if (!a || !b) return '—'
  const ms = new Date(b).getTime() - new Date(a).getTime()
  if (ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

export default function AdminRunsPage() {
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'

  const [status, setStatus] = useState<Status>('failed')
  const [runs, setRuns] = useState<RunRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = async (s: Status) => {
    setError(null)
    try {
      const res = await fetch(`/api/admin/runs?status=${s}&limit=100`, { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { runs: RunRow[] }
      setRuns(data.runs)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    void load(status)
  }, [status])

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
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
            <span className="rounded-sm bg-amber-500/15 px-3 py-1.5 font-medium text-xs text-amber-400">失敗任務</span>
            <Link href={`/${locale}/admin/usage`} className="rounded-sm px-3 py-1.5 font-medium text-xs text-stone-400 hover:text-stone-200">使用量</Link>
          </div>
        </div>

        <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-serif-cn text-2xl font-semibold text-stone-100">失敗任務 / Run 紀錄</h1>
            <p className="mt-1 font-fraunces text-sm italic text-stone-400">
              {runs ? `${runs.length} 筆 · ${status}` : '載入中…'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`rounded-sm border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  status === s
                    ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
                    : 'border-stone-800 text-stone-400 hover:border-stone-700 hover:text-stone-200'
                }`}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void load(status)}
              className="rounded-sm border border-stone-800 bg-stone-900/40 px-3 py-1.5 font-mono text-[10px] tracking-wider text-stone-300 hover:border-amber-500/40 hover:text-amber-400"
            >
              ↻
            </button>
          </div>
        </header>

        {error ? (
          <div className="mb-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-sm border border-stone-800/60 bg-stone-900/20">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-900/40 font-mono text-[10px] uppercase tracking-wider text-stone-500">
              <tr>
                <th className="px-4 py-3">時間</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">錯誤訊息</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-800/40 font-serif-cn text-stone-300">
              {(runs ?? []).map((r) => {
                const isExpanded = expandedId === r.id
                const statusColor =
                  r.status === 'failed' ? 'text-rose-400'
                    : r.status === 'running' ? 'text-amber-400'
                      : r.status === 'completed' ? 'text-emerald-400'
                        : 'text-stone-400'
                return (
                  <tr
                    key={r.id}
                    className="cursor-pointer transition-colors hover:bg-stone-900/30"
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                  >
                    <td className="px-4 py-3 align-top font-mono text-[11px] tracking-wider text-stone-500">
                      {fmtDate(r.createdAt)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="text-stone-200">{r.user.name}</div>
                      <div className="font-mono text-[10px] text-stone-600">{r.user.email ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="font-mono text-xs text-stone-300">{r.taskType ?? r.workflowType}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-stone-600">
                        {r.targetType.replace('NovelPromotion', '')}
                      </div>
                    </td>
                    <td className={`px-4 py-3 align-top font-mono text-xs uppercase ${statusColor}`}>
                      {r.status}
                      {r.errorCode ? (
                        <div className="mt-0.5 font-mono text-[9px] tracking-wider text-rose-300/70">
                          {r.errorCode}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top font-mono text-xs text-stone-400">
                      {durationMs(r.startedAt, r.finishedAt)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {r.errorMessage ? (
                        <div className={`font-mono text-xs ${isExpanded ? 'whitespace-pre-wrap text-rose-200' : 'truncate text-rose-300/80'}`} style={isExpanded ? {} : { maxWidth: '50ch' }}>
                          {r.errorMessage}
                        </div>
                      ) : (
                        <span className="text-stone-600">—</span>
                      )}
                      {isExpanded ? (
                        <div className="mt-2 font-mono text-[10px] text-stone-500">
                          run {r.id.slice(0, 8)}… · project {r.projectId.slice(0, 8)}…{r.episodeId ? ` · episode ${r.episodeId.slice(0, 8)}…` : ''}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
              {runs && runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-stone-500">
                    {status === 'failed' ? '沒有失敗任務 — 系統健康' : `沒有 ${status} 狀態的 run`}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
