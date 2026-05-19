'use client'

/**
 * Phase 12.x.x — v2 new-project form.
 *
 * Stage A scope: minimal form (name + optional description). videoRatio
 * and style preset stay editable on ScriptPage for now; Stage B will
 * lift them up to project-level settings.
 *
 * Stage C addition (2026-05-18): optional bulk-upload of a multi-episode
 * .docx / .txt / .md outline. Workflow:
 *   1. User picks a file → client POSTs /api/files/extract-episodes
 *      *before* creating the project, so the preview / validation
 *      happens against an isolated parse (no half-created projects on
 *      a parse failure).
 *   2. On submit:
 *      a. POST /api/projects                   → new projectId
 *      b. POST /api/novel-promotion/[id]/episodes/batch  (if episodes)
 *      c. router.push /v2/workspace/[id]
 *      If step b fails, the project is still navigable — user can
 *      import from inside the workspace via BulkEpisodeUploadButton.
 */

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppIcon } from '@/components/ui/icons'

interface V2NewProjectClientProps {
  locale: string
}

interface ExtractedEpisode {
  number: number
  title: string
  content: string
  wordCount: number
}

type ExtractMode = 'table' | 'markers' | 'prose'

interface ExtractResponse {
  mode: ExtractMode
  episodes: ExtractedEpisode[]
  rawText: string
  meta: {
    sourceFormat: 'docx' | 'txt' | 'md'
    plainTextChars: number
    tableRowsDetected?: number
    markerType?: string
  }
}

export function V2NewProjectClient({ locale }: V2NewProjectClientProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set if /api/projects succeeded but bulk-import failed — used to
  // expose a manual "go to empty project" navigation escape hatch.
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)

  // Bulk-upload state. File is held in memory until submit so the user
  // can review the extraction result before committing.
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<ExtractResponse | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPickedFile(file)
    setExtracted(null)
    setExtractError(null)
    setExtracting(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/files/extract-episodes', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        setExtractError(`抽取失敗 (${res.status}): ${text || '未知錯誤'}`)
        return
      }
      const json = (await res.json()) as ExtractResponse
      setExtracted(json)
    } catch (err) {
      setExtractError(`抽取失敗:${(err as Error).message}`)
    } finally {
      setExtracting(false)
    }
  }

  function clearFile() {
    setPickedFile(null)
    setExtracted(null)
    setExtractError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      // Step 1: create the project shell.
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

      // Step 2: if we successfully extracted episodes, bulk-create them.
      // Failures must surface — project is already created, so we keep
      // the user on this page with a working "前往空白專案" escape hatch
      // and an explicit error rather than silently navigating away.
      if (extracted) {
        const episodesToCreate = extracted.episodes.length > 0
          ? extracted.episodes.map((ep) => ({
              name: ep.title || `第 ${ep.number} 集`,
              novelText: ep.content,
            }))
          : [{ name: '第 1 集', novelText: extracted.rawText }]
        const batchRes = await fetch(`/api/novel-promotion/${newId}/episodes/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            episodes: episodesToCreate,
            clearExisting: false,
            importStatus: 'imported',
          }),
        })
        if (!batchRes.ok) {
          const text = await batchRes.text().catch(() => '')
          setError(
            `專案已建立但匯入劇集失敗 (${batchRes.status}): ${text || '未知錯誤'}。` +
            `可點下方「前往空白專案」進入工作區,在劇本頁手動重試上傳。`,
          )
          setCreatedProjectId(newId)
          return
        }
      }

      router.push(`/${locale}/v2/workspace/${newId}`)
    } catch (err) {
      setError(`建立失敗:${(err as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  const episodeCount = extracted?.episodes.length ?? 0
  const modeLabel: Record<ExtractMode, string> = {
    table: `表格 (${extracted?.meta.tableRowsDetected ?? 0} 列)`,
    markers: `標題 (${extracted?.meta.markerType ?? ''})`,
    prose: '無結構 — 將寫入單一集',
  }

  return (
    <div className="grain min-h-screen bg-stone-950 text-stone-200">
      <header className="border-b border-stone-800/60 px-12 py-5">
        <Link
          href={`/${locale}/v2`}
          className="font-mono text-[14px] tracking-[0.2em] text-stone-500 transition-colors hover:text-amber-400"
        >
          ← 我的專案
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-12 py-16">
        <div className="mb-10">
          <div className="font-mono text-[14px] tracking-[0.25em] text-amber-500/70">
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
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-stone-500">
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
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-stone-500">
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
            <div className="mt-1 text-right font-mono text-[14px] text-stone-700">
              {description.length} / 500
            </div>
          </div>

          {/* Bulk-upload picker */}
          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-stone-500">
              劇本檔案 · SCRIPT FILE（選填）
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.txt,.md,.markdown"
              onChange={handleFileChange}
              className="hidden"
            />
            {!pickedFile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-sm border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-6 font-serif-cn text-sm text-amber-300 transition-all hover:bg-amber-500/10"
              >
                <AppIcon name="upload" className="h-4 w-4" />
                上傳 .docx / .txt / .md 自動拆集
              </button>
            ) : (
              <div className="rounded-sm border border-amber-900/40 bg-stone-900/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-serif-cn text-sm text-stone-200">
                      {pickedFile.name}
                    </div>
                    <div className="mt-1 font-mono text-[12px] tracking-wider text-stone-500">
                      {Math.round(pickedFile.size / 1024).toLocaleString()} KB
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearFile}
                    className="shrink-0 rounded-sm p-1 text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-300"
                    aria-label="移除檔案"
                  >
                    <AppIcon name="close" className="h-4 w-4" />
                  </button>
                </div>

                {/* Extraction status */}
                <div className="mt-3 border-t border-stone-800/60 pt-3">
                  {extracting ? (
                    <p className="font-mono text-[12px] tracking-wider text-amber-500/70">
                      抽取中…
                    </p>
                  ) : extractError ? (
                    <p className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-serif-cn text-xs text-rose-300">
                      {extractError}
                    </p>
                  ) : extracted ? (
                    <div>
                      <p className="font-mono text-[12px] tracking-wider text-emerald-500/80">
                        ✓ 偵測到 {episodeCount > 0 ? `${episodeCount} 集` : '0 集'}
                        <span className="ml-2 text-stone-500">· {modeLabel[extracted.mode]}</span>
                      </p>
                      {episodeCount > 0 ? (
                        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-2 font-serif-cn text-[12px] text-stone-400">
                          {extracted.episodes.slice(0, 8).map((ep) => (
                            <li key={ep.number} className="truncate">
                              <span className="mr-2 font-mono text-amber-500/70">
                                第 {ep.number} 集
                              </span>
                              {ep.title}
                            </li>
                          ))}
                          {episodeCount > 8 ? (
                            <li className="font-mono text-[11px] text-stone-600">
                              …還有 {episodeCount - 8} 集
                            </li>
                          ) : null}
                        </ul>
                      ) : (
                        <p className="mt-2 font-serif-cn text-xs text-stone-500">
                          檔案未偵測到分集結構,整份文本會寫入單一集,之後可在工作區手動拆分。
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-sm border border-stone-800/60 bg-stone-900/20 p-4">
            <div className="font-mono text-[14px] tracking-wider text-stone-500">
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
              <p>{error}</p>
              {createdProjectId ? (
                <Link
                  href={`/${locale}/v2/workspace/${createdProjectId}`}
                  className="mt-3 inline-flex items-center gap-2 rounded-sm border border-rose-500/40 px-4 py-2 text-rose-200 transition-colors hover:bg-rose-500/10"
                >
                  前往空白專案 →
                </Link>
              ) : null}
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
              disabled={submitting || extracting || !name.trim()}
              className="flex items-center gap-2 rounded-sm bg-amber-500 px-6 py-2.5 font-serif-cn text-sm font-medium text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-4 w-4" />
              {submitting
                ? '建立中…'
                : episodeCount > 0
                  ? `建立並匯入 ${episodeCount} 集`
                  : '建立並進入工作區'}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
