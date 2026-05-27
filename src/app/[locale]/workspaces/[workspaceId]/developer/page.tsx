'use client'

/**
 * /workspaces/[id]/developer — API key management for workspace
 * owners and global admins. Members see "access denied" via the
 * management API's 403.
 *
 * Built as a single client component because:
 *   - usage chart needs interactive state (day range selector)
 *   - reveal-once modal is ephemeral UI state, not URL-addressable
 *   - the list itself fits comfortably in one render tree
 *
 * If we later add MCP config UI, webhook registration, etc., split
 * each into a subroute. For now: one focused page.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Navbar from '@/components/Navbar'
// Import directly from the leaf 'scopes' module instead of the barrel
// '@/lib/api-keys' — the barrel re-exports validator/rate-limit which
// transitively pulls in ioredis (Node net/tls). Webpack sees those during
// client bundling and fails with "Module not found: Can't resolve 'net'".
// Leaf-import avoids dragging server-only code into the client bundle.
import { PUBLIC_API_SCOPES, SCOPE_LABELS, type PublicApiScope } from '@/lib/api-keys/scopes'

interface ApiKeyRow {
  id: string
  name: string
  keyPrefix: string
  keyLast4: string
  scopes: PublicApiScope[]
  reqPerMinute: number
  monthlyCredit: number | null
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
  createdBy?: { id: string; name: string | null; email: string | null }
}

interface UsageSnapshot {
  keyId: string
  window: { days: number; since: string }
  totals: {
    requests: number
    errors: number
    p50DurationMs: number
    p95DurationMs: number
  }
  dailyBuckets: { date: string; requests: number; errors: number; avgDurationMs: number }[]
  topEndpoints: { endpoint: string; requests: number; errors: number }[]
}

export default function DeveloperPage() {
  const params = useParams<{ workspaceId: string; locale: string }>()
  const workspaceId = params?.workspaceId ?? ''

  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [revealKey, setRevealKey] = useState<{ fullKey: string; name: string } | null>(null)
  const [usageFor, setUsageFor] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageSnapshot | null>(null)
  const [usageDays, setUsageDays] = useState(7)

  const fetchKeys = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/api-keys`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { keys: ApiKeyRow[] }
      setKeys(data.keys)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  const fetchUsage = useCallback(
    async (keyId: string, days: number) => {
      if (!workspaceId) return
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/api-keys/${keyId}/usage?days=${days}`,
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as UsageSnapshot
        setUsage(data)
      } catch (err) {
        // Surface inline — usage failure shouldn't block the page.
        setUsage(null)
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [workspaceId],
  )

  useEffect(() => {
    if (usageFor) fetchUsage(usageFor, usageDays)
  }, [usageFor, usageDays, fetchUsage])

  const handleRevoke = useCallback(
    async (keyId: string, name: string) => {
      if (!workspaceId) return
      if (!window.confirm(`Revoke key "${name}"? This cannot be undone.`)) return
      try {
        const res = await fetch(
          `/api/workspaces/${workspaceId}/api-keys/${keyId}`,
          { method: 'DELETE' },
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
        }
        await fetchKeys()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [workspaceId, fetchKeys],
  )

  const handleCreated = useCallback(
    (fullKey: string, name: string) => {
      setShowCreate(false)
      setRevealKey({ fullKey, name })
      void fetchKeys()
    },
    [fetchKeys],
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">开发者中心 / Developer</h1>
            <p className="mt-1 text-sm text-gray-600">
              管理此工作区的 API 密钥。每个密钥只在创建时显示一次,丢失需要重新生成。
            </p>
          </div>
          <button
            type="button"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            onClick={() => setShowCreate(true)}
          >
            + 新建 API 密钥
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded border border-gray-200 bg-white p-8 text-center text-gray-500">
            加载中...
          </div>
        ) : keys.length === 0 ? (
          <div className="rounded border border-dashed border-gray-300 bg-white p-12 text-center">
            <p className="text-gray-700">还没有 API 密钥</p>
            <p className="mt-2 text-sm text-gray-500">
              点击右上角「+ 新建 API 密钥」开始集成。
            </p>
          </div>
        ) : (
          <KeyTable
            keys={keys}
            onRevoke={handleRevoke}
            onShowUsage={(id) => setUsageFor(id)}
          />
        )}

        {showCreate && workspaceId && (
          <CreateKeyModal
            workspaceId={workspaceId}
            onClose={() => setShowCreate(false)}
            onCreated={handleCreated}
          />
        )}

        {revealKey && (
          <RevealOnceModal
            fullKey={revealKey.fullKey}
            name={revealKey.name}
            onClose={() => setRevealKey(null)}
          />
        )}

        {usageFor && usage && (
          <UsageModal
            usage={usage}
            days={usageDays}
            onDaysChange={setUsageDays}
            onClose={() => {
              setUsageFor(null)
              setUsage(null)
            }}
          />
        )}
      </main>
    </div>
  )
}

function KeyTable({
  keys,
  onRevoke,
  onShowUsage,
}: {
  keys: ApiKeyRow[]
  onRevoke: (id: string, name: string) => void
  onShowUsage: (id: string) => void
}) {
  return (
    <div className="overflow-hidden rounded border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">名称</th>
            <th className="px-4 py-2">前缀</th>
            <th className="px-4 py-2">权限</th>
            <th className="px-4 py-2">速率</th>
            <th className="px-4 py-2">最后使用</th>
            <th className="px-4 py-2">状态</th>
            <th className="px-4 py-2 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {keys.map((k) => {
            const isRevoked = !!k.revokedAt
            const isExpired = k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()
            return (
              <tr key={k.id} className={isRevoked ? 'opacity-60' : ''}>
                <td className="px-4 py-2 font-medium text-gray-900">{k.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-700">
                  {k.keyPrefix}…{k.keyLast4}
                </td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-2 text-gray-700">{k.reqPerMinute}/min</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '从未使用'}
                </td>
                <td className="px-4 py-2 text-xs">
                  {isRevoked ? (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">已撤销</span>
                  ) : isExpired ? (
                    <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-700">
                      已过期
                    </span>
                  ) : (
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                      有效
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {!isRevoked && (
                    <>
                      <button
                        type="button"
                        className="mr-2 text-indigo-600 hover:underline"
                        onClick={() => onShowUsage(k.id)}
                      >
                        用量
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => onRevoke(k.id, k.name)}
                      >
                        撤销
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CreateKeyModal({
  workspaceId,
  onClose,
  onCreated,
}: {
  workspaceId: string
  onClose: () => void
  onCreated: (fullKey: string, name: string) => void
}) {
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<Set<PublicApiScope>>(new Set(['read']))
  const [reqPerMinute, setReqPerMinute] = useState(60)
  const [expiresAt, setExpiresAt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const toggleScope = (s: PublicApiScope) => {
    setScopes((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const canSubmit = useMemo(
    () => name.trim().length > 0 && scopes.size > 0 && !submitting,
    [name, scopes, submitting],
  )

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setErr(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/api-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          scopes: Array.from(scopes),
          reqPerMinute,
          expiresAt: expiresAt || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`)
      onCreated(body.fullKey as string, body.key?.name as string)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal onClose={onClose} title="新建 API 密钥">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">名称</label>
          <input
            type="text"
            className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400"
            value={name}
            maxLength={64}
            placeholder="例如:Production CI"
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">权限范围</label>
          <div className="mt-2 space-y-2">
            {PUBLIC_API_SCOPES.map((s) => (
              <label key={s} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.has(s)}
                  onChange={() => toggleScope(s)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-mono text-xs text-gray-700">{s}</span>
                  <span className="ml-2 text-gray-500">{SCOPE_LABELS[s].description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              速率限制 (req/min)
            </label>
            <input
              type="number"
              min={1}
              max={600}
              className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900"
              value={reqPerMinute}
              onChange={(e) => setReqPerMinute(Number(e.target.value) || 60)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              过期日期 (可选)
            </label>
            <input
              type="date"
              className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>

        {err && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? '生成中...' : '生成密钥'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function RevealOnceModal({
  fullKey,
  name,
  onClose,
}: {
  fullKey: string
  name: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Some browsers / iframes block clipboard. User can select manually.
    }
  }
  return (
    <Modal onClose={onClose} title={`密钥 "${name}" 已生成`}>
      <div className="space-y-3">
        <div className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          ⚠️ 这是唯一一次能看到完整密钥的机会。关闭后将无法再次显示。
        </div>
        <div className="rounded border border-gray-300 bg-gray-50 p-3 font-mono text-xs text-gray-900 break-all">
          {fullKey}
        </div>
        <div className="flex justify-between">
          <button
            type="button"
            onClick={copy}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            {copied ? '已复制' : '复制到剪贴板'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            我已保存,关闭
          </button>
        </div>
      </div>
    </Modal>
  )
}

function UsageModal({
  usage,
  days,
  onDaysChange,
  onClose,
}: {
  usage: UsageSnapshot
  days: number
  onDaysChange: (d: number) => void
  onClose: () => void
}) {
  const maxRequests = Math.max(1, ...usage.dailyBuckets.map((b) => b.requests))
  return (
    <Modal onClose={onClose} title={`用量 (${days} 天)`}>
      <div className="mb-3 flex gap-2">
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDaysChange(d)}
            className={`rounded px-3 py-1 text-sm ${
              d === days
                ? 'bg-indigo-600 text-white'
                : 'border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {d} 天
          </button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2 text-center text-sm">
        <Stat label="请求" value={usage.totals.requests.toLocaleString()} />
        <Stat label="错误" value={usage.totals.errors.toLocaleString()} />
        <Stat label="P50" value={`${usage.totals.p50DurationMs}ms`} />
        <Stat label="P95" value={`${usage.totals.p95DurationMs}ms`} />
      </div>

      <div className="mb-4">
        <h3 className="mb-2 text-sm font-medium text-gray-700">每日请求</h3>
        <div className="flex h-32 items-end gap-1">
          {usage.dailyBuckets.map((b) => (
            <div
              key={b.date}
              className="flex flex-1 flex-col items-center"
              title={`${b.date}: ${b.requests} reqs, ${b.errors} errors`}
            >
              <div
                className="w-full bg-indigo-500"
                style={{ height: `${(b.requests / maxRequests) * 100}%` }}
              />
              <div className="mt-1 truncate text-[10px] text-gray-500">
                {b.date.slice(5)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-700">Top 端点</h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr>
              <th className="pb-1">端点</th>
              <th className="pb-1 text-right">请求</th>
              <th className="pb-1 text-right">错误</th>
            </tr>
          </thead>
          <tbody>
            {usage.topEndpoints.map((e) => (
              <tr key={e.endpoint} className="border-t border-gray-100">
                <td className="py-1 font-mono text-xs">{e.endpoint}</td>
                <td className="py-1 text-right">{e.requests}</td>
                <td className="py-1 text-right text-red-600">{e.errors}</td>
              </tr>
            ))}
            {usage.topEndpoints.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-gray-500">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 bg-white px-2 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
  )
}

function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode
  onClose: () => void
  title: string
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
