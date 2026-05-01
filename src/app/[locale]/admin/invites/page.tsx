'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import Navbar from '@/components/Navbar'

type Role = 'admin' | 'editor' | 'member'

interface InviteRow {
  id: string
  code: string
  role: Role | string
  createdBy: string
  usedBy: string | null
  usedAt: string | null
  expiresAt: string | null
  revokedAt: string | null
  note: string | null
  createdAt: string
  updatedAt: string
  creator?: { id: string; name: string; displayName: string | null } | null
  user?: { id: string; name: string; displayName: string | null } | null
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

function inviteStatus(invite: InviteRow): 'used' | 'revoked' | 'expired' | 'usable' {
  if (invite.usedBy) return 'used'
  if (invite.revokedAt) return 'revoked'
  if (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) return 'expired'
  return 'usable'
}

export default function AdminInvitesPage() {
  const t = useTranslations('admin')
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const [formRole, setFormRole] = useState<Role>('member')
  const [formExpiresHours, setFormExpiresHours] = useState<number | ''>(168)
  const [formNote, setFormNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/invites', { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setInvites(data.invites ?? [])
    } catch (err) {
      setError(getErrorMessage(err, t('loadInvitesFailed')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setFormRole('member')
    setFormExpiresHours(168)
    setFormNote('')
    setError(null)
    setShowCreate(true)
  }

  async function submitCreate() {
    setCreating(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { role: formRole }
      if (typeof formExpiresHours === 'number' && formExpiresHours > 0) {
        body.expires_hours = formExpiresHours
      }
      if (formNote.trim()) body.note = formNote.trim()
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
      }
      setInvites((prev) => [data.invite, ...prev])
      setShowCreate(false)
      await copyToClipboard(data.invite.code)
    } catch (err) {
      setError(getErrorMessage(err, t('createInviteFailed')))
    } finally {
      setCreating(false)
    }
  }

  async function revoke(invite: InviteRow) {
    if (busyId) return
    if (!confirm(t('confirmRevoke', { code: invite.code.slice(0, 8) }))) return
    setBusyId(invite.id)
    setError(null)
    try {
      const res = await fetch(`/api/admin/invites/${invite.id}`, {
        method: 'DELETE',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
      }
      setInvites((prev) =>
        prev.map((it) =>
          it.id === invite.id ? { ...it, revokedAt: new Date().toISOString() } : it
        )
      )
    } catch (err) {
      setError(getErrorMessage(err, t('revokeFailed')))
    } finally {
      setBusyId(null)
    }
  }

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // best-effort; some browsers refuse without explicit user gesture
    }
  }

  return (
    <div className="glass-page min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <a href="../" className="font-mono text-[10px] tracking-wider text-[var(--glass-text-secondary)] hover:text-amber-400">
            ← 後台首頁
          </a>
          <div className="flex items-center gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--glass-tone-info-bg)]/30 p-1">
            <a
              href="../users"
              className="rounded-sm px-4 py-1.5 font-medium text-sm text-[var(--glass-text-secondary)] transition-colors hover:bg-[var(--glass-tone-info-fg)]/10 hover:text-[var(--glass-text-primary)]"
            >
              使用者管理
            </a>
            <span className="rounded-sm bg-[var(--glass-tone-info-fg)]/15 px-4 py-1.5 font-medium text-sm text-[var(--glass-tone-info-fg)]">
              邀請碼管理
            </span>
          </div>
        </div>
        <header className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[var(--glass-text-primary)]">
              {t('invitesTitle')}
            </h1>
            <p className="text-sm text-[var(--glass-text-secondary)] mt-1">
              {t('invitesSubtitle')}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm"
            >
              {loading ? t('loading') : t('refresh')}
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="glass-btn-base glass-btn-primary px-4 py-2 text-sm"
            >
              {t('createInvite')}
            </button>
          </div>
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
                <th className="px-4 py-3 font-medium">{t('code')}</th>
                <th className="px-4 py-3 font-medium">{t('role')}</th>
                <th className="px-4 py-3 font-medium">{t('status')}</th>
                <th className="px-4 py-3 font-medium">{t('note')}</th>
                <th className="px-4 py-3 font-medium">{t('expiresAt')}</th>
                <th className="px-4 py-3 font-medium">{t('usedAt')}</th>
                <th className="px-4 py-3 font-medium">{t('createdAt')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => {
                const status = inviteStatus(inv)
                return (
                  <tr
                    key={inv.id}
                    className="border-b border-[var(--glass-border)] last:border-0"
                  >
                    <td className="px-4 py-3">
                      <code className="px-2 py-0.5 rounded bg-[var(--glass-tone-info-bg)] text-xs font-mono tracking-wider">
                        {inv.code}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(inv.code)}
                        className="ml-2 text-xs text-[var(--glass-tone-info-fg)] hover:underline"
                      >
                        {t('copy')}
                      </button>
                    </td>
                    <td className="px-4 py-3">{t(`role_${inv.role}` as 'role_admin')}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          status === 'usable'
                            ? 'glass-chip glass-chip-success px-2 py-0.5 text-xs'
                            : status === 'used'
                              ? 'glass-chip glass-chip-info px-2 py-0.5 text-xs'
                              : status === 'revoked'
                                ? 'glass-chip glass-chip-danger px-2 py-0.5 text-xs'
                                : 'glass-chip glass-chip-warning px-2 py-0.5 text-xs'
                        }
                      >
                        {t(`status_${status}` as 'status_usable')}
                      </span>
                    </td>
                    <td className="px-4 py-3">{inv.note || '—'}</td>
                    <td className="px-4 py-3 text-[var(--glass-text-secondary)]">
                      {formatDate(inv.expiresAt)}
                    </td>
                    <td className="px-4 py-3 text-[var(--glass-text-secondary)]">
                      {formatDate(inv.usedAt)}
                      {inv.user && (
                        <span className="ml-1 text-[var(--glass-text-tertiary)]">
                          ({inv.user.name})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--glass-text-secondary)]">
                      {formatDate(inv.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={status !== 'usable' || busyId === inv.id}
                        onClick={() => revoke(inv)}
                        className="glass-btn-base glass-btn-danger px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        {t('revoke')}
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!loading && invites.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-10 text-center text-[var(--glass-text-tertiary)]"
                  >
                    {t('noInvites')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            className="glass-surface-modal max-w-md w-full p-6 rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--glass-text-primary)] mb-4">
              {t('createInvite')}
            </h2>

            <div className="space-y-4">
              <label className="block">
                <span className="glass-field-label block mb-1">{t('role')}</span>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as Role)}
                  className="glass-input-base w-full px-3 py-2"
                >
                  <option value="member">{t('role_member')}</option>
                  <option value="editor">{t('role_editor')}</option>
                  <option value="admin">{t('role_admin')}</option>
                </select>
              </label>

              <label className="block">
                <span className="glass-field-label block mb-1">
                  {t('expiresHours')}
                </span>
                <input
                  type="number"
                  min={1}
                  max={8760}
                  value={formExpiresHours}
                  onChange={(e) => {
                    const v = e.target.value
                    setFormExpiresHours(v === '' ? '' : Number(v))
                  }}
                  className="glass-input-base w-full px-3 py-2"
                  placeholder={t('expiresHoursPlaceholder')}
                />
                <p className="text-xs text-[var(--glass-text-tertiary)] mt-1">
                  {t('expiresHoursHint')}
                </p>
              </label>

              <label className="block">
                <span className="glass-field-label block mb-1">{t('note')}</span>
                <input
                  type="text"
                  maxLength={200}
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  className="glass-input-base w-full px-3 py-2"
                  placeholder={t('notePlaceholder')}
                />
              </label>
            </div>

            {error && (
              <div className="glass-tone-danger rounded-lg px-4 py-3 mt-4 text-sm">
                {error}
              </div>
            )}

            <div className="mt-6 flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                disabled={creating}
                className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={submitCreate}
                disabled={creating}
                className="glass-btn-base glass-btn-primary px-4 py-2 text-sm"
              >
                {creating ? t('loading') : t('create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
