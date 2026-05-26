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

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

interface V2NewProjectClientProps {
  locale: string
}

interface ExtractedEpisode {
  number: number
  title: string
  content: string
  wordCount: number
  contentByLang?: Record<string, string>
}

type ExtractMode = 'table' | 'markers' | 'prose'

type ScriptCode = 'zh' | 'en' | 'ja' | 'ko' | 'ru' | 'ar'

interface ExtractResponse {
  mode: ExtractMode
  episodes: ExtractedEpisode[]
  rawText: string
  meta: {
    sourceFormat: 'docx' | 'txt' | 'md'
    plainTextChars: number
    tableRowsDetected?: number
    markerType?: string
    languages?: {
      detected: ScriptCode[]
      isMultilingual: boolean
    }
  }
}

// Script labels moved into messages/{locale}/v2New.json (upload.scriptLabels)
// so en users see "Chinese" / "Japanese" etc. Source-of-truth catalog still
// lives at src/lib/script-language-detector.ts SCRIPT_LABELS for non-V2 callers.

interface WorkspaceOption {
  id: string
  name: string
  organization?: { name?: string | null } | null
}

export function V2NewProjectClient({ locale }: V2NewProjectClientProps) {
  const t = useTranslations('v2New')
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Phase 12.5+ — pick the target workspace at create time.
  // "" = 個人專案 (default). Pre-fills from `?ws=<id>` if user navigated
  // here from a workspace-filtered project list (small UX win).
  const [workspaceId, setWorkspaceId] = useState<string>(searchParams?.get('ws') ?? '')
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/workspaces')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { workspaces?: WorkspaceOption[]; workspaceMemberships?: WorkspaceOption[] }) => {
        if (cancelled) return
        const owned = data.workspaces ?? []
        const member = data.workspaceMemberships ?? []
        const seen = new Set<string>()
        const merged: WorkspaceOption[] = []
        for (const w of [...owned, ...member]) {
          if (seen.has(w.id)) continue
          seen.add(w.id)
          merged.push(w)
        }
        setWorkspaces(merged)
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([])
      })
    return () => {
      cancelled = true
    }
  }, [])
  // Set if /api/projects succeeded but bulk-import failed — used to
  // expose a manual "go to empty project" navigation escape hatch.
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)

  // Bulk-upload state. File is held in memory until submit so the user
  // can review the extraction result before committing.
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState<ExtractResponse | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  // When the doc is multilingual, user picks which script to keep.
  // Defaults to the dominant detected script (first in meta.languages).
  const [chosenLang, setChosenLang] = useState<ScriptCode | null>(null)

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
        setExtractError(t('footer.errorExtract', { status: res.status, detail: text || t('footer.errorUnknown') }))
        return
      }
      const json = (await res.json()) as ExtractResponse
      setExtracted(json)
      // Auto-pick the dominant script when multilingual; null otherwise
      // (no picker shown, content stays as-is).
      if (json.meta.languages?.isMultilingual && json.meta.languages.detected.length > 0) {
        setChosenLang(json.meta.languages.detected[0])
      } else {
        setChosenLang(null)
      }
    } catch (err) {
      setExtractError(t('footer.errorExtractException', { reason: (err as Error).message }))
    } finally {
      setExtracting(false)
    }
  }

  function clearFile() {
    setPickedFile(null)
    setExtracted(null)
    setExtractError(null)
    setChosenLang(null)
  }

  // Resolve final content for an episode given the current language pick.
  // For monolingual docs (no chosenLang), returns original `content`.
  function resolveEpisodeContent(ep: ExtractedEpisode): string {
    if (chosenLang && ep.contentByLang?.[chosenLang]) {
      return ep.contentByLang[chosenLang]
    }
    return ep.content
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
          // null sentinel — empty string = 個人專案
          workspaceId: workspaceId || null,
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        setError(t('footer.errorPrefix', { status: res.status, detail: text || t('footer.errorUnknown') }))
        return
      }
      const data = (await res.json()) as { project?: { id?: string } }
      const newId = data.project?.id
      if (!newId) {
        setError(t('footer.errorNoId'))
        return
      }

      // Step 2: if we successfully extracted episodes, bulk-create them.
      // Failures must surface — project is already created, so we keep
      // the user on this page with a working "前往空白專案" escape hatch
      // and an explicit error rather than silently navigating away.
      if (extracted) {
        const episodesToCreate = extracted.episodes.length > 0
          ? extracted.episodes.map((ep) => ({
              name: ep.title || t('upload.episodeShort', { n: ep.number }),
              novelText: resolveEpisodeContent(ep),
            }))
          : [{ name: t('upload.episodeShort', { n: 1 }), novelText: extracted.rawText }]
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
            `${t('footer.errorPrefix', { status: batchRes.status, detail: text || t('footer.errorUnknown') })}\n${t('footer.halfDoneNote')}`,
          )
          setCreatedProjectId(newId)
          return
        }
      }

      router.push(`/${locale}/v2/workspace/${newId}`)
    } catch (err) {
      setError(t('footer.errorBuildFailed', { reason: (err as Error).message }))
    } finally {
      setSubmitting(false)
    }
  }

  const episodeCount = extracted?.episodes.length ?? 0
  const modeLabel: Record<ExtractMode, string> = {
    table: t('upload.modeTable', { rows: extracted?.meta.tableRowsDetected ?? 0 }),
    markers: t('upload.modeMarkers', { type: extracted?.meta.markerType ?? '' }),
    prose: t('upload.modeProse'),
  }
  // Script labels via translations so en users see "Chinese" / "Japanese"
  // etc. Caller passes the ScriptCode key from SCRIPT_LABELS.
  const scriptLabel = (code: ScriptCode): string =>
    t(`upload.scriptLabels.${code}` as `upload.scriptLabels.${ScriptCode}`)

  return (
    <div className="grain min-h-screen bg-stone-950 text-stone-200">
      <header className="border-b border-stone-800/60 px-12 py-5">
        <Link
          href={`/${locale}/v2`}
          className="font-mono text-[14px] tracking-[0.2em] text-stone-500 transition-colors hover:text-amber-400"
        >
          {t('backToProjects')}
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-12 py-16">
        <div className="mb-10">
          <div className="font-mono text-[14px] tracking-[0.25em] text-amber-500/70">
            {t('step')}
          </div>
          <h1 className="mt-2 font-serif-cn text-3xl font-light text-stone-100">
            {t('title')}
          </h1>
          <p className="mt-1 font-fraunces text-sm italic text-stone-500">
            {t('subtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-stone-500">
              {t('form.nameLabel')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('form.namePlaceholder')}
              maxLength={100}
              required
              autoFocus
              className="w-full rounded-sm border border-stone-800 bg-stone-900/40 px-4 py-3 font-serif-cn text-base text-stone-200 placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-stone-500">
              {t('form.descLabel')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('form.descPlaceholder')}
              maxLength={500}
              rows={4}
              className="w-full resize-none rounded-sm border border-stone-800 bg-stone-900/40 px-4 py-3 font-serif-cn text-sm leading-relaxed text-stone-200 placeholder:text-stone-600 focus:border-amber-500/60 focus:outline-none"
            />
            <div className="mt-1 text-right font-mono text-[14px] text-stone-700">
              {t('form.descCounter', { count: description.length })}
            </div>
          </div>

          {/* Phase 12.5+ — workspace assignment. "" = personal scope */}
          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-stone-500">
              {t('form.wsLabel')}
            </label>
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="w-full rounded-sm border border-stone-800 bg-stone-900/40 px-4 py-3 font-serif-cn text-sm text-stone-200 focus:border-amber-500/60 focus:outline-none"
            >
              <option value="">{t('form.wsPersonalOption')}</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}{w.organization?.name ? ` · ${w.organization.name}` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 font-fraunces text-[11px] italic text-stone-500">
              {t('form.wsHint')}
            </p>
          </div>

          {/* Bulk-upload picker */}
          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-stone-500">
              {t('upload.label')}
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
                {t('upload.cta')}
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
                    aria-label={t('upload.removeAria')}
                  >
                    <AppIcon name="close" className="h-4 w-4" />
                  </button>
                </div>

                {/* Extraction status */}
                <div className="mt-3 border-t border-stone-800/60 pt-3">
                  {extracting ? (
                    <p className="font-mono text-[12px] tracking-wider text-amber-500/70">
                      {t('upload.extracting')}
                    </p>
                  ) : extractError ? (
                    <p className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-serif-cn text-xs text-rose-300">
                      {extractError}
                    </p>
                  ) : extracted ? (
                    <div>
                      <p className="font-mono text-[12px] tracking-wider text-emerald-500/80">
                        {episodeCount > 0 ? t('upload.detected', { count: episodeCount }) : t('upload.detectedZero')}
                        <span className="ml-2 text-stone-500">· {modeLabel[extracted.mode]}</span>
                      </p>

                      {/* Language picker — only when multilingual. Filtered
                          content has been pre-computed server-side per
                          detected script, so switching is instant. */}
                      {extracted.meta.languages?.isMultilingual ? (
                        <div className="mt-3 rounded-sm border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                          <p className="mb-2 font-serif-cn text-[12px] text-amber-200/90">
                            {t('upload.multilingualPrompt')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {extracted.meta.languages.detected.map((code) => (
                              <label
                                key={code}
                                className={`flex cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 py-1 font-serif-cn text-[12px] transition-colors ${
                                  chosenLang === code
                                    ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                                    : 'border-stone-700 text-stone-400 hover:border-stone-600'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="script-pick"
                                  className="h-3 w-3 accent-amber-500"
                                  checked={chosenLang === code}
                                  onChange={() => setChosenLang(code)}
                                />
                                {scriptLabel(code)}
                              </label>
                            ))}
                          </div>
                          <p className="mt-2 font-mono text-[11px] text-stone-500">
                            {t('upload.multilingualNote')}
                          </p>
                        </div>
                      ) : null}

                      {episodeCount > 0 ? (
                        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-2 font-serif-cn text-[12px] text-stone-400">
                          {extracted.episodes.slice(0, 8).map((ep) => (
                            <li key={ep.number} className="truncate">
                              <span className="mr-2 font-mono text-amber-500/70">
                                {t('upload.episodeShort', { n: ep.number })}
                              </span>
                              {ep.title}
                            </li>
                          ))}
                          {episodeCount > 8 ? (
                            <li className="font-mono text-[11px] text-stone-600">
                              {t('upload.episodeShort', { n: `… +${episodeCount - 8}` })}
                            </li>
                          ) : null}
                        </ul>
                      ) : (
                        <p className="mt-2 font-serif-cn text-xs text-stone-500">
                          {t('upload.noStructureHint')}
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
              {t('footer.tipHeader')}
              <span className="text-amber-400"> · {t('footer.tipBullet1')}</span>
              <span className="text-amber-400"> · {t('footer.tipBullet2')}</span>
              <span> · {t('footer.tipBullet3')}</span>
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
                  {t('footer.goToBlank')}
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <Link
              href={`/${locale}/v2`}
              className="rounded-sm border border-stone-800 bg-stone-900/30 px-5 py-2.5 font-serif-cn text-sm text-stone-400 transition-colors hover:border-stone-700 hover:text-stone-200"
            >
              {t('footer.cancel')}
            </Link>
            <button
              type="submit"
              disabled={submitting || extracting || !name.trim()}
              className="flex items-center gap-2 rounded-sm bg-amber-500 px-6 py-2.5 font-serif-cn text-sm font-medium text-stone-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="sparklesAlt" className="h-4 w-4" />
              {submitting
                ? t('footer.submitting')
                : episodeCount > 0
                  ? t('footer.submitWithImport', { count: episodeCount })
                  : t('footer.submit')}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
