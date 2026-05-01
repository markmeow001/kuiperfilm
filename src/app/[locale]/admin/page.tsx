'use client'

/**
 * Admin landing — single hub linking to Users / Invites / Projects /
 * Runs with live counts + a queue-health row at the top so a stuck
 * Tencent SubAppId or piled-up image queue is visible at a glance.
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

interface ProjectsResponse {
  projects?: Array<{ id: string; videoCount?: number }>
}

interface RunsResponse {
  runs?: Array<{ id: string }>
}

interface QueueSnapshot {
  name: string
  waiting: number
  active: number
  completed: number
  failed: number
  delayed: number
  paused: boolean
  concurrency: number | null
}

interface QueueStatsResponse {
  queues?: QueueSnapshot[]
}

interface StorageResponse {
  totalBytes?: string
  totalObjectCount?: number
  perUser?: Array<{ userId: string; bytes: string }>
}

interface Stats {
  totalUsers: number
  activeUsers: number
  admins: number
  editors: number
  members: number
  totalInvites: number
  usableInvites: number
  usedInvites: number
  totalProjects: number
  totalVideos: number
  failedRuns: number
  totalStorageGB: string
  storageUsers: number
}

function formatBytes(b: bigint): string {
  const gb = Number(b) / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = Number(b) / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${(Number(b) / 1024).toFixed(0)} KB`
}

export default function AdminLandingPage() {
  const params = useParams<{ locale: string }>()
  const locale = params?.locale ?? 'zh'

  const [stats, setStats] = useState<Stats | null>(null)
  const [queues, setQueues] = useState<QueueSnapshot[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [uRes, iRes, pRes, rRes, qRes, sRes] = await Promise.all([
          fetch('/api/admin/users', { credentials: 'include' }),
          fetch('/api/admin/invites', { credentials: 'include' }),
          fetch('/api/admin/projects?limit=500', { credentials: 'include' }),
          fetch('/api/admin/runs?status=failed&limit=50', { credentials: 'include' }),
          fetch('/api/admin/queue-stats', { credentials: 'include' }),
          fetch('/api/admin/storage-stats', { credentials: 'include' }),
        ])
        const u = (uRes.ok ? ((await uRes.json()) as UsersResponse) : {}) as UsersResponse
        const i = (iRes.ok ? ((await iRes.json()) as InvitesResponse) : {}) as InvitesResponse
        const p = (pRes.ok ? ((await pRes.json()) as ProjectsResponse) : {}) as ProjectsResponse
        const r = (rRes.ok ? ((await rRes.json()) as RunsResponse) : {}) as RunsResponse
        const q = (qRes.ok ? ((await qRes.json()) as QueueStatsResponse) : {}) as QueueStatsResponse
        const s = (sRes.ok ? ((await sRes.json()) as StorageResponse) : {}) as StorageResponse
        if (cancelled) return

        const users = u.users ?? []
        const invites = i.invites ?? []
        const projects = p.projects ?? []
        const runs = r.runs ?? []

        setQueues(q.queues ?? [])
        setStats({
          totalUsers: users.length,
          activeUsers: users.filter((x) => x.isActive).length,
          admins: users.filter((x) => x.role === 'admin').length,
          editors: users.filter((x) => x.role === 'editor').length,
          members: users.filter((x) => x.role === 'member').length,
          totalInvites: invites.length,
          usableInvites: invites.filter((x) => !x.usedBy && !x.revokedAt).length,
          usedInvites: invites.filter((x) => Boolean(x.usedBy)).length,
          totalProjects: projects.length,
          totalVideos: projects.reduce((acc, x) => acc + (x.videoCount ?? 0), 0),
          failedRuns: runs.length,
          totalStorageGB: s.totalBytes ? formatBytes(BigInt(s.totalBytes)) : '0 KB',
          storageUsers: (s.perUser ?? []).length,
        })
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }
    void load()
    const t = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100">
      <Navbar />
      <div className="mx-auto max-w-6xl px-8 py-10">
        <h1 className="font-serif-cn text-3xl font-medium tracking-wide text-stone-100">
          管理員後台
        </h1>
        <p className="mt-2 font-fraunces text-base italic text-amber-500/80">Admin Console</p>

        {error ? (
          <div className="mt-6 rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            載入失敗:{error}
          </div>
        ) : null}

        {/* Queue health strip */}
        <div className="mt-8 rounded-sm border border-amber-900/30 bg-stone-900/40 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-fraunces text-sm italic text-amber-500/80">佇列健康 · QUEUES</div>
            <div className="font-mono text-[10px] tracking-wider text-stone-500">每 30 秒自動刷新</div>
          </div>
          {queues ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {queues.map((q) => {
                const stuck = q.failed > 0 || q.waiting > 5
                return (
                  <div
                    key={q.name}
                    className={`rounded-sm border px-4 py-3 ${
                      stuck
                        ? 'border-rose-500/40 bg-rose-500/5'
                        : q.active > 0
                          ? 'border-amber-500/40 bg-amber-500/5'
                          : 'border-stone-800/60 bg-stone-900/30'
                    }`}
                  >
                    <div className="font-mono text-[10px] tracking-[0.2em] text-stone-500">
                      {q.name.toUpperCase()}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-display text-2xl font-semibold text-stone-100">
                        {q.active}
                      </span>
                      <span className="font-mono text-[10px] text-stone-500">active</span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1 font-mono text-[10px] text-stone-500">
                      <span>{q.waiting} wait</span>
                      <span className={q.failed > 0 ? 'text-rose-400' : ''}>{q.failed} fail</span>
                      <span>cc:{q.concurrency ?? '—'}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="font-mono text-[10px] tracking-wider text-stone-600">載入中…</div>
          )}
        </div>

        {/* Cards */}
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Link
            href={`/${locale}/admin/users`}
            className="group rounded-sm border border-amber-900/30 bg-stone-900/40 p-6 transition-all hover:-translate-y-0.5 hover:border-amber-500/40"
          >
            <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600">01 · USERS</div>
            <div className="mt-2 font-serif-cn text-xl text-stone-100">使用者管理</div>
            <p className="mt-2 font-fraunces text-sm italic text-stone-400">
              新增成員 / 改角色 / 停用啟用 / 補值 — 註冊成員自動出現
            </p>
            {stats ? (
              <div className="mt-5 grid grid-cols-4 gap-3">
                <Stat label="總數" value={stats.totalUsers} />
                <Stat label="啟用" value={stats.activeUsers} />
                <Stat label="Admin" value={stats.admins} />
                <Stat label="Editor" value={stats.editors} />
              </div>
            ) : (
              <div className="mt-5 font-mono text-[10px] tracking-wider text-stone-600">載入中…</div>
            )}
          </Link>

          <Link
            href={`/${locale}/admin/invites`}
            className="group rounded-sm border border-amber-900/30 bg-stone-900/40 p-6 transition-all hover:-translate-y-0.5 hover:border-amber-500/40"
          >
            <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600">02 · INVITES</div>
            <div className="mt-2 font-serif-cn text-xl text-stone-100">邀請碼管理</div>
            <p className="mt-2 font-fraunces text-sm italic text-stone-400">
              建立 / 撤銷邀請碼 — 把 share-link 傳給新成員
            </p>
            {stats ? (
              <div className="mt-5 grid grid-cols-3 gap-3">
                <Stat label="總邀請" value={stats.totalInvites} />
                <Stat label="可用" value={stats.usableInvites} highlight />
                <Stat label="已使用" value={stats.usedInvites} />
              </div>
            ) : (
              <div className="mt-5 font-mono text-[10px] tracking-wider text-stone-600">載入中…</div>
            )}
          </Link>

          <Link
            href={`/${locale}/admin/projects`}
            className="group rounded-sm border border-amber-900/30 bg-stone-900/40 p-6 transition-all hover:-translate-y-0.5 hover:border-amber-500/40"
          >
            <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600">03 · PROJECTS</div>
            <div className="mt-2 font-serif-cn text-xl text-stone-100">所有專案</div>
            <p className="mt-2 font-fraunces text-sm italic text-stone-400">
              跨使用者列出每一個 project,看誰在做什麼
            </p>
            {stats ? (
              <div className="mt-5 grid grid-cols-3 gap-3">
                <Stat label="總專案" value={stats.totalProjects} />
                <Stat label="已生視頻" value={stats.totalVideos} />
                <StatString label="儲存" value={stats.totalStorageGB} />
              </div>
            ) : (
              <div className="mt-5 font-mono text-[10px] tracking-wider text-stone-600">載入中…</div>
            )}
          </Link>

          <Link
            href={`/${locale}/admin/runs`}
            className="group rounded-sm border border-amber-900/30 bg-stone-900/40 p-6 transition-all hover:-translate-y-0.5 hover:border-amber-500/40"
          >
            <div className="font-mono text-[10px] tracking-[0.3em] text-amber-600">04 · RUNS</div>
            <div className="mt-2 font-serif-cn text-xl text-stone-100">失敗任務</div>
            <p className="mt-2 font-fraunces text-sm italic text-stone-400">
              最近失敗的 task / run 紀錄,看 errorMessage 一眼定位 bug
            </p>
            {stats ? (
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Stat label="近期失敗" value={stats.failedRuns} highlight={stats.failedRuns > 0} />
                <StatString label="儲存使用者" value={`${stats.storageUsers} 人`} />
              </div>
            ) : (
              <div className="mt-5 font-mono text-[10px] tracking-wider text-stone-600">載入中…</div>
            )}
          </Link>
        </div>

        <div className="mt-12 rounded-sm border border-stone-800/60 bg-stone-900/20 p-5">
          <div className="mb-2 font-fraunces text-sm italic text-amber-500/80">流程</div>
          <ol className="space-y-2 font-serif-cn text-sm text-stone-300">
            <li>1. 邀請碼管理 → 點「新建邀請碼」選擇角色</li>
            <li>2. 把連結 <span className="font-mono text-xs text-amber-400">/auth/signup?invite=&lt;code&gt;</span> 給新成員</li>
            <li>3. 新成員註冊後自動出現在使用者管理,可改角色 / 停用 / 補值</li>
            <li>4. 任務跑爆時看「失敗任務」面板找 errorMessage</li>
            <li>5. 佇列堆積時看頂部佇列健康卡 — failed / waiting 異常會變紅</li>
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

function StatString({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9px] uppercase tracking-wider text-stone-500">{label}</div>
      <div className="mt-0.5 font-display text-lg font-semibold text-stone-200">{value}</div>
    </div>
  )
}
