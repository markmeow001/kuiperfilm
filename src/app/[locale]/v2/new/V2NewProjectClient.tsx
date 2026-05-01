'use client'

/**
 * Phase 12.x.x — v2 new-project form.
 *
 * Stage A scope: minimal form (name + optional description). videoRatio
 * and style preset stay editable on ScriptPage for now; Stage B will
 * lift them up to project-level settings.
 *
 * After create:
 *   POST /api/projects → { project: { id } } → router.push /v2/workspace/<id>
 */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppIcon } from '@/components/ui/icons'

interface V2NewProjectClientProps {
  locale: string
}

export function V2NewProjectClient({ locale }: V2NewProjectClientProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          mode: 'novel-promotion',
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        setError(`建立失敗 (${res.status}): ${text || '未知錯誤'}`)
        return
      }
      const data = (await res.json()) as { project?: { id?: string } }
      const newId = data.project?.id
      if (!newId) {
        setError('建立失敗:server 沒回 project id')
        return
      }
      router.push(`/${locale}/v2/workspace/${newId}`)
    } catch (err) {
      setError(`建立失敗:${(err as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grain min-h-screen bg-stone-950 text-stone-200">
      <header className="border-b border-stone-800/60 px-12 py-5">
        <Link
          href={`/${locale}/v2`}
          className="font-mono text-[10px] tracking-[0.2em] text-stone-500 transition-colors hover:text-amber-400"
        >
          ← 我的專案
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-12 py-16">
        <div className="mb-10">
          <div className="font-mono text-[10px] tracking-[0.25em] text-amber-500/70">
            STEP 00 — NEW
          </div>
          <h1 className="mt-2 font-serif-cn text-3xl font-light text-stone-100">
            新建專案
          </h1>
          <p className="mt-1 font-fraunces text-sm italic text-stone-500">
            Begin a new short-drama project
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="mb-2 block font-mono text-[10px] tracking-wider text-stone-500">
              專案名稱 · NAME *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例:雨夜的火車站、總裁的小秘書、武林獨白…"
              maxLength={100}
              required
              autoFocus
              className="w-full rounded-sm border border-stone-800 bg-stone-900/40 px-4 py-3 font-serif-cn text-base text-stone-200 placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block font-mono text-[10px] tracking-wider text-stone-500">
              簡述 · DESCRIPTION（選填）
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句話描述故事大綱、目標觀眾、或這部專案的核心情緒…"
              maxLength={500}
              rows={4}
              className="w-full resize-none rounded-sm border border-stone-800 bg-stone-900/40 px-4 py-3 font-serif-cn text-sm leading-relaxed text-stone-200 placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
            />
            <div className="mt-1 text-right font-mono text-[10px] text-stone-700">
              {description.length} / 500
            </div>
          </div>

          <div className="rounded-sm border border-stone-800/60 bg-stone-900/20 p-4">
            <div className="font-mono text-[10px] tracking-wider text-stone-500">
              💡 TIP
            </div>
            <p className="mt-2 font-serif-cn text-xs leading-relaxed text-stone-400">
              建立後進入工作區,你可以
              <span className="text-amber-400">逐集貼劇本</span>、
              <span className="text-amber-400">設定畫面比例與風格</span>、
              然後在「主體」與「分鏡」step 用 AI 自動拆解角色 / 場景 / 鏡頭。
            </p>
          </div>

          {error ? (
            <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-serif-cn text-sm text-rose-300">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <Link
              href={`/${locale}/v2`}
              className="rounded-sm border border-stone-800 bg-stone-900/30 px-5 py-2.5 font-serif-cn text-sm text-stone-400 transition-colors hover:border-stone-700 hover:text-stone-200"
            >
              取消
            </Link>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="flex items-center gap-2 rounded-sm bg-amber-500 px-6 py-2.5 font-serif-cn text-sm font-medium text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-4 w-4" />
              {submitting ? '建立中…' : '建立並進入工作區'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
