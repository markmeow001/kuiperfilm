'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'
import Navbar from '@/components/Navbar'

type Role = 'admin' | 'editor' | 'member'

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
            <span className="rounded-sm bg-[var(--glass-tone-info-fg)]/15 px-4 py-1.5 font-medium text-sm text-[var(--glass-tone-info-fg)]">
              使用者管理
            </span>
            <a
              href="../invites"
              className="rounded-sm px-4 py-1.5 font-medium text-sm text-[var(--glass-text-secondary)] transition-colors hover:bg-[var(--glass-tone-info-fg)]/10 hover:text-[var(--glass-text-primary)]"
            >
              邀請碼管理
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
                <th className="px-4 py-3 font-medium">{t('lastLogin')}</th>
                <th className="px-4 py-3 font-medium">{t('createdAt')}</th>
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
                    <td className="px-4 py-3 text-[var(--glass-text-secondary)]">
                      {formatDate(u.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3 text-[var(--glass-text-secondary)]">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
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
                    </td>
                  </tr>
                )
              })}
              {!loading && sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
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
    </div>
  )
}
