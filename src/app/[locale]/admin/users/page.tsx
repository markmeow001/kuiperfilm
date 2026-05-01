'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'
import Navbar from '@/components/Navbar'

type Role = 'admin' | 'editor' | 'member'

interface BalanceShape {
  balance: string
  frozenAmount: string
  totalSpent: string
}

interface StorageShape {
  bytes: string
  objectCount: number
}

interface AdminUser {
  id: string
  name: string
  email: string | null
  displayName: string | null
  role: Role | string
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  balance: BalanceShape | null
  storage: StorageShape
}

function formatBytes(bytesStr: string): string {
  let n: number
  try {
    n = Number(BigInt(bytesStr))
  } catch {
    return '—'
  }
  if (n <= 0) return '0 B'
  const gb = n / 1024 / 1024 / 1024
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = n / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(1)} MB`
  return `${(n / 1024).toFixed(0)} KB`
}

function formatBalance(b: BalanceShape | null): string {
  if (!b) return '0'
  // Decimal column comes back as string; format to at most 2 fraction digits
  const n = Number(b.balance)
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : b.balance
}

interface AxiosLikeError {
  response?: { data?: { error?: { message?: string } } }
}

function isApiError(value: unknown): value is AxiosLikeError {
  return typeof value === 'object' && value !== null && 'response' in value
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (isApiError(error)) {
    const m = error.response?.data?.error?.message
    if (m) return m
  }
  return fallback
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function AdminUsersPage() {
  const t = useTranslations('admin')
  const { data: session } = useSession()
  const myId = (session?.user as { id?: string } | undefined)?.id

  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [creditModal, setCreditModal] = useState<{ user: AdminUser; delta: string; note: string; submitting: boolean; err: string | null } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setUsers(data.users ?? [])
    } catch (err) {
      setError(getErrorMessage(err, t('loadUsersFailed')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  async function changeRole(user: AdminUser, role: Role) {
    if (user.role === role || busyUserId) return
    setBusyUserId(user.id)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
      }
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role } : u)))
    } catch (err) {
      setError(getErrorMessage(err, t('changeRoleFailed')))
    } finally {
      setBusyUserId(null)
    }
  }

  async function toggleActive(user: AdminUser) {
    if (user.id === myId || busyUserId) return
    const verb = user.isActive ? t('disable') : t('enable')
    if (!confirm(t('confirmToggleActive', { name: user.name, action: verb }))) return
    setBusyUserId(user.id)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/active`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !user.isActive }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, isActive: !u.isActive } : u))
      )
    } catch (err) {
      setError(getErrorMessage(err, t('toggleActiveFailed')))
    } finally {
      setBusyUserId(null)
    }
  }

  async function submitCredit() {
    if (!creditModal || creditModal.submitting) return
    const delta = Number.parseFloat(creditModal.delta)
    if (!Number.isFinite(delta) || delta === 0) {
      setCreditModal({ ...creditModal, err: '請輸入非零金額' })
      return
    }
    setCreditModal({ ...creditModal, submitting: true, err: null })
    try {
      const res = await fetch(`/api/admin/users/${creditModal.user.id}/balance/credit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ delta, note: creditModal.note || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
      }
      const newBalance = data.balance as BalanceShape
      setUsers((prev) =>
        prev.map((u) => (u.id === creditModal.user.id ? { ...u, balance: newBalance } : u)),
      )
      setCreditModal(null)
    } catch (err) {
      setCreditModal({ ...creditModal, submitting: false, err: getErrorMessage(err, '補值失敗') })
    }
  }

  const sorted = useMemo(
    () => [...users].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [users]
  )

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <a href="../" className="font-mono text-[10px] tracking-wider text-[var(--glass-text-secondary)] hover:text-amber-400">
            ← 後台首頁
          </a>
          <div className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--glass-tone-info-bg)]/30 p-1">
            <span className="rounded-sm bg-[var(--glass-tone-info-fg)]/15 px-3 py-1.5 font-medium text-xs text-[var(--glass-tone-info-fg)]">
              使用者
            </span>
            <a href="../invites" className="rounded-sm px-3 py-1.5 font-medium text-xs text-[var(--glass-text-secondary)] transition-colors hover:bg-[var(--glass-tone-info-fg)]/10 hover:text-[var(--glass-text-primary)]">
              邀請碼
            </a>
            <a href="../projects" className="rounded-sm px-3 py-1.5 font-medium text-xs text-[var(--glass-text-secondary)] transition-colors hover:bg-[var(--glass-tone-info-fg)]/10 hover:text-[var(--glass-text-primary)]">
              所有專案
            </a>
            <a href="../runs" className="rounded-sm px-3 py-1.5 font-medium text-xs text-[var(--glass-text-secondary)] transition-colors hover:bg-[var(--glass-tone-info-fg)]/10 hover:text-[var(--glass-text-primary)]">
              失敗任務
            </a>
          </div>
        </div>
        <header className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[var(--glass-text-primary)]">
              {t('usersTitle')}
            </h1>
            <p className="text-sm text-[var(--glass-text-secondary)] mt-1">
              {t('usersSubtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm"
            disabled={loading}
          >
            {loading ? t('loading') : t('refresh')}
          </button>
        </header>

        {error && (
          <div className="glass-tone-danger rounded-lg px-4 py-3 mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="glass-surface rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-[var(--glass-text-secondary)] text-left">
              <tr className="border-b border-[var(--glass-border)]">
                <th className="px-4 py-3 font-medium">{t('username')}</th>
                <th className="px-4 py-3 font-medium">{t('displayName')}</th>
                <th className="px-4 py-3 font-medium">{t('email')}</th>
                <th className="px-4 py-3 font-medium">{t('role')}</th>
                <th className="px-4 py-3 font-medium">{t('status')}</th>
                <th className="px-4 py-3 font-medium text-right">餘額</th>
                <th className="px-4 py-3 font-medium text-right">儲存</th>
                <th className="px-4 py-3 font-medium">{t('lastLogin')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => {
                const isSelf = u.id === myId
                return (
                  <tr
                    key={u.id}
                    className="border-b border-[var(--glass-border)] last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-[var(--glass-text-primary)]">
                      {u.name}
                      {isSelf && (
                        <span className="ml-2 text-xs text-[var(--glass-text-tertiary)]">
                          ({t('youSelf')})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{u.displayName || '—'}</td>
                    <td className="px-4 py-3">{u.email || '—'}</td>
                    <td className="px-4 py-3">
                      {isSelf ? (
                        <span className="glass-chip glass-chip-success px-2 py-0.5 text-xs">
                          {t(`role_${u.role}` as 'role_admin')}
                        </span>
                      ) : (
                        <select
                          value={u.role}
                          disabled={busyUserId === u.id}
                          onChange={(e) => changeRole(u, e.target.value as Role)}
                          className="glass-input-base px-2 py-1 text-xs"
                        >
                          <option value="admin">{t('role_admin')}</option>
                          <option value="editor">{t('role_editor')}</option>
                          <option value="member">{t('role_member')}</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          u.isActive
                            ? 'glass-chip glass-chip-success px-2 py-0.5 text-xs'
                            : 'glass-chip glass-chip-danger px-2 py-0.5 text-xs'
                        }
                      >
                        {u.isActive ? t('active') : t('inactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setCreditModal({ user: u, delta: '', note: '', submitting: false, err: null })}
                        className="font-mono text-xs text-[var(--glass-text-primary)] hover:text-amber-400"
                        title="點擊補值"
                      >
                        {formatBalance(u.balance)}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[10px] tracking-wider text-[var(--glass-text-secondary)]">
                      {formatBytes(u.storage.bytes)}
                      <div className="text-[9px] text-[var(--glass-text-tertiary)]">{u.storage.objectCount} 件</div>
                    </td>
                    <td className="px-4 py-3 text-[var(--glass-text-secondary)]">
                      {formatDate(u.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setCreditModal({ user: u, delta: '', note: '', submitting: false, err: null })}
                          className="glass-btn-base glass-btn-secondary px-3 py-1.5 text-xs"
                          title="補值 / 扣值"
                        >
                          補值
                        </button>
                        <button
                          type="button"
                          disabled={isSelf || busyUserId === u.id}
                          onClick={() => toggleActive(u)}
                          className={
                            u.isActive
                              ? 'glass-btn-base glass-btn-danger px-3 py-1.5 text-xs disabled:opacity-50'
                              : 'glass-btn-base glass-btn-primary px-3 py-1.5 text-xs disabled:opacity-50'
                          }
                        >
                          {u.isActive ? t('disable') : t('enable')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!loading && sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-[var(--glass-text-tertiary)]"
                  >
                    {t('noUsers')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {creditModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 p-4"
          onClick={() => !creditModal.submitting && setCreditModal(null)}
        >
          <div
            className="w-full max-w-md rounded-md border border-amber-900/30 bg-stone-900 p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-600">
                Credit / Debit
              </div>
              <div className="mt-1 font-serif-cn text-lg text-stone-100">
                為 <span className="text-amber-400">{creditModal.user.name}</span> 補值
              </div>
              <div className="mt-2 font-mono text-xs text-stone-500">
                目前餘額:{formatBalance(creditModal.user.balance)}
                {' · '}已花費:{creditModal.user.balance ? Number(creditModal.user.balance.totalSpent).toLocaleString() : 0}
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-stone-500">
                  金額(正補值,負扣值)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={creditModal.delta}
                  onChange={(e) => setCreditModal({ ...creditModal, delta: e.target.value })}
                  placeholder="100 / -50"
                  autoFocus
                  className="w-full rounded-sm border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-sm text-stone-100 focus:border-amber-500/60 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-stone-500">
                  備註(選填)
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={creditModal.note}
                  onChange={(e) => setCreditModal({ ...creditModal, note: e.target.value })}
                  placeholder="比如:demo 體驗 100 點"
                  className="w-full rounded-sm border border-stone-700 bg-stone-950 px-3 py-2 font-serif-cn text-sm text-stone-100 focus:border-amber-500/60 focus:outline-none"
                />
              </div>
              {creditModal.err ? (
                <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {creditModal.err}
                </div>
              ) : null}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={creditModal.submitting}
                onClick={() => setCreditModal(null)}
                className="rounded-sm border border-stone-700 px-4 py-2 font-serif-cn text-sm text-stone-300 hover:border-stone-600 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={creditModal.submitting || !creditModal.delta}
                onClick={() => void submitCredit()}
                className="rounded-sm bg-amber-500 px-4 py-2 font-serif-cn text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creditModal.submitting ? '送出中…' : '確認'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
