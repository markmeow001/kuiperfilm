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
import { useSkills } from '@/lib/query/hooks/useSkills'
import { V2HomeRail } from '../V2HomeRail'
import { PageHeader } from '@/components/v2/PageHeader'
import studioStyles from '../StudioShell.module.css'

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
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1)
  // 2026-05-29 — per-project generation mode + opening pacing.
  const [generationMode, setGenerationMode] = useState<'r2v-narrative' | 't2i-storyboard'>('r2v-narrative')
  const [openingPacing, setOpeningPacing] = useState<'hook' | 'cinematic'>('hook')
  // 2026-06-10 (Phase 2.5) — optional Skill anchor. null = 自由創作 (status
  // quo). Set = project pipeline driven by Skill.config at submit time.
  // Pre-fills from `?skill=<id>` query param (e.g. user clicked
  // 「用此 Skill 建立專案」 from /skills/[slug] detail page CTA).
  const [originSkillId, setOriginSkillId] = useState<string | null>(
    searchParams?.get('skill') ?? null,
  )
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
          generationMode,
          openingPacing,
          // Phase 2.5 — optional Skill anchor. null = 自由創作 generic flow.
          originSkillId: originSkillId,
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
  const wizardSteps = [
    { number: 1 as const, title: t('wizard.basic'), hint: t('wizard.basicHint') },
    { number: 2 as const, title: t('wizard.production'), hint: t('wizard.productionHint') },
    { number: 3 as const, title: t('wizard.script'), hint: t('wizard.scriptHint') },
  ]

  return (
    <div
      className={`${studioStyles.studioRoot} ${studioStyles.canvasAtmosphere} kuiper-dashboard kuiper-new-project min-h-screen pb-24 lg:pb-0 lg:pl-[76px] xl:pl-[272px]`}
      data-studio-theme="dark"
    >
      <V2HomeRail locale={locale} />
      <header className="kuiper-dashboard-topbar sticky top-0 z-30 border-b px-4 py-3 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[52px] max-w-5xl items-center justify-between gap-4">
          <Link
            href={`/${locale}/v2`}
            className="inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-[var(--darkroom-muted)] transition-colors hover:text-[var(--process-cyan-strong)]"
          >
            <AppIcon name="arrowLeft" className="h-4 w-4" />
            {t('backToProjects').replace(/^←\s*/, '')}
          </Link>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--process-cyan-strong)]">
            {wizardStep} / {wizardSteps.length}
          </span>
        </div>
      </header>

      <main className="kuiper-dashboard-main mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <PageHeader
          eyebrow={t('step')}
          title={t('title')}
          description={t('subtitle')}
        />

        <ol className="mt-8 grid grid-cols-3 gap-2" aria-label={t('title')}>
          {wizardSteps.map((step) => {
            const active = step.number === wizardStep
            const complete = step.number < wizardStep
            return (
              <li
                key={step.number}
                aria-current={active ? 'step' : undefined}
                className={`min-w-0 rounded-xl border p-3 transition-colors ${
                  active
                    ? 'border-[var(--process-cyan)] bg-[var(--process-cyan-soft)]'
                    : complete
                      ? 'border-[color-mix(in_srgb,var(--process-cyan)_35%,transparent)] bg-[var(--production-surface)]'
                      : 'border-[var(--production-border)] bg-[var(--production-muted)]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    active
                      ? 'bg-[var(--process-cyan)] text-[#071014]'
                      : complete
                        ? 'bg-[var(--process-cyan-deep)] text-white'
                        : 'bg-[var(--darkroom-surface)] text-[var(--darkroom-muted)]'
                  }`}>
                    {complete ? '✓' : step.number}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-[var(--production-ink)]">{step.title}</span>
                    <span className="mt-0.5 hidden truncate text-[11px] text-[var(--production-ink-muted)] md:block">{step.hint}</span>
                  </span>
                </div>
              </li>
            )
          })}
        </ol>

        <form onSubmit={handleSubmit} className="kuiper-dashboard-card mt-5 space-y-6 p-5 sm:p-7">
          {wizardStep === 1 ? (
            <div className="space-y-6">
          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
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
              className={`${studioStyles.inputSurface} w-full rounded-xl border px-4 py-3 font-serif-cn text-base placeholder:text-[#71818a]`}
            />
          </div>

          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
              {t('form.descLabel')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('form.descPlaceholder')}
              maxLength={500}
              rows={4}
              className={`${studioStyles.inputSurface} w-full resize-none rounded-xl border px-4 py-3 font-serif-cn text-sm leading-relaxed placeholder:text-[#71818a]`}
            />
            <div className="mt-1 text-right font-mono text-[14px] text-[var(--production-ink-muted)]">
              {t('form.descCounter', { count: description.length })}
            </div>
          </div>

          {/* Phase 12.5+ — workspace assignment. "" = personal scope */}
          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
              {t('form.wsLabel')}
            </label>
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className={`${studioStyles.inputSurface} w-full rounded-xl border px-4 py-3 font-serif-cn text-sm`}
            >
              <option value="">{t('form.wsPersonalOption')}</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}{w.organization?.name ? ` · ${w.organization.name}` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 font-fraunces text-[11px] italic text-[var(--production-ink-muted)]">
              {t('form.wsHint')}
            </p>
          </div>
            </div>
          ) : null}

          {wizardStep === 2 ? (
            <div className="space-y-6">
          {/* 2026-05-29 — generation mode selector (R2V-narrative vs T2I-storyboard) */}
          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
              {t('form.modeLabel')}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([
                { v: 'r2v-narrative' as const, title: t('form.modeR2vTitle'), desc: t('form.modeR2vDesc') },
                { v: 't2i-storyboard' as const, title: t('form.modeT2iTitle'), desc: t('form.modeT2iDesc') },
              ]).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setGenerationMode(opt.v)}
                  aria-pressed={generationMode === opt.v}
                  className={`${studioStyles.selectableSurface} ${generationMode === opt.v ? studioStyles.selectableSurfaceActive : ''} rounded-xl border px-3 py-2.5 text-left transition-colors`}
                >
                  <div className={`font-mono text-[13px] tracking-wider ${generationMode === opt.v ? 'text-[var(--process-cyan-strong)]' : 'text-[var(--production-ink)]'}`}>
                    {opt.title}
                  </div>
                  <div className="mt-0.5 font-fraunces text-[11px] italic text-[var(--production-ink-muted)]">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 2026-05-29 — opening pacing selector (hook vs cinematic) */}
          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
              {t('form.pacingLabel')}
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([
                { v: 'hook' as const, title: t('form.pacingHookTitle'), desc: t('form.pacingHookDesc') },
                { v: 'cinematic' as const, title: t('form.pacingCinematicTitle'), desc: t('form.pacingCinematicDesc') },
              ]).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setOpeningPacing(opt.v)}
                  aria-pressed={openingPacing === opt.v}
                  className={`${studioStyles.selectableSurface} ${openingPacing === opt.v ? studioStyles.selectableSurfaceActive : ''} rounded-xl border px-3 py-2.5 text-left transition-colors`}
                >
                  <div className={`font-mono text-[13px] tracking-wider ${openingPacing === opt.v ? 'text-[var(--process-cyan-strong)]' : 'text-[var(--production-ink)]'}`}>
                    {opt.title}
                  </div>
                  <div className="mt-0.5 font-fraunces text-[11px] italic text-[var(--production-ink-muted)]">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 2026-06-10 (Phase 2.5) — optional Skill anchor.
              First button is 自由創作 (no Skill = generic flow, status quo).
              Rest are user's installed Skills. List source = useSkills({ installed: true }).
              Empty Skill library → only the 自由創作 option shows + a hint
              linking to /skills (browse marketplace later). */}
          <SkillAnchorPicker
            originSkillId={originSkillId}
            onChange={setOriginSkillId}
          />
            </div>
          ) : null}

          {wizardStep === 3 ? (
            <div className="space-y-6">
          {/* Bulk-upload picker */}
          <div>
            <label className="mb-2 block font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
              {t('upload.label')}
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,.pdf,.txt,.md,.markdown"
              onChange={handleFileChange}
              className="hidden"
            />
            {!pickedFile ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`${studioStyles.toolSurface} flex min-h-16 w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 font-serif-cn text-sm transition-colors hover:border-[var(--process-cyan)] hover:bg-[color-mix(in_srgb,var(--process-cyan-soft)_70%,var(--darkroom-raised))]`}
              >
                <AppIcon name="upload" className="h-4 w-4" />
                {t('upload.cta')}
              </button>
            ) : (
              <div className={`${studioStyles.raisedSurface} rounded-xl border p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-serif-cn text-sm text-[var(--production-ink)]">
                      {pickedFile.name}
                    </div>
                    <div className="mt-1 font-mono text-[12px] tracking-wider text-[var(--production-ink-muted)]">
                      {Math.round(pickedFile.size / 1024).toLocaleString()} KB
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={clearFile}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--production-ink-muted)] transition-colors hover:bg-[var(--darkroom-surface)] hover:text-[var(--production-ink)]"
                    aria-label={t('upload.removeAria')}
                  >
                    <AppIcon name="close" className="h-4 w-4" />
                  </button>
                </div>

                {/* Extraction status */}
                <div className="mt-3 border-t border-[var(--production-border)] pt-3">
                  {extracting ? (
                    <p className="font-mono text-[12px] tracking-wider text-[var(--process-cyan-strong)]">
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
                        <span className="ml-2 text-[var(--production-ink-muted)]">· {modeLabel[extracted.mode]}</span>
                      </p>

                      {/* Language picker — only when multilingual. Filtered
                          content has been pre-computed server-side per
                          detected script, so switching is instant. */}
                      {extracted.meta.languages?.isMultilingual ? (
                        <div className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--process-cyan)_35%,transparent)] bg-[var(--process-cyan-soft)] px-3 py-2">
                          <p className="mb-2 font-serif-cn text-[12px] text-[var(--process-cyan-strong)]">
                            {t('upload.multilingualPrompt')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {extracted.meta.languages.detected.map((code) => (
                              <label
                                key={code}
                                className={`flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-1 font-serif-cn text-[12px] transition-colors ${
                                  chosenLang === code
                                    ? 'border-[var(--process-cyan)] bg-[var(--process-cyan-soft)] text-[var(--process-cyan-strong)]'
                                    : 'border-[var(--production-border)] text-[var(--production-ink-muted)] hover:border-[var(--process-cyan)]'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="script-pick"
                                  className="h-4 w-4 accent-[var(--process-cyan)]"
                                  checked={chosenLang === code}
                                  onChange={() => setChosenLang(code)}
                                />
                                {scriptLabel(code)}
                              </label>
                            ))}
                          </div>
                          <p className="mt-2 font-mono text-[11px] text-[var(--production-ink-muted)]">
                            {t('upload.multilingualNote')}
                          </p>
                        </div>
                      ) : null}

                      {episodeCount > 0 ? (
                        <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-2 font-serif-cn text-[12px] text-[var(--production-ink-muted)]">
                          {extracted.episodes.slice(0, 8).map((ep) => (
                            <li key={ep.number} className="truncate">
                              <span className="mr-2 font-mono text-[var(--process-cyan-strong)]">
                                {t('upload.episodeShort', { n: ep.number })}
                              </span>
                              {ep.title}
                            </li>
                          ))}
                          {episodeCount > 8 ? (
                            <li className="font-mono text-[11px] text-[var(--production-ink-muted)]">
                              {t('upload.episodeShort', { n: `… +${episodeCount - 8}` })}
                            </li>
                          ) : null}
                        </ul>
                      ) : (
                        <p className="mt-2 font-serif-cn text-xs text-[var(--production-ink-muted)]">
                          {t('upload.noStructureHint')}
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className={`${studioStyles.raisedSurface} rounded-xl border p-4`}>
            <div className="font-mono text-[14px] tracking-wider text-[var(--process-cyan-strong)]">
              💡 TIP
            </div>
            <p className="mt-2 font-serif-cn text-xs leading-relaxed text-[var(--production-ink-muted)]">
              {t('footer.tipHeader')}
              <span className="text-[var(--process-cyan-strong)]"> · {t('footer.tipBullet1')}</span>
              <span className="text-[var(--process-cyan-strong)]"> · {t('footer.tipBullet2')}</span>
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
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--production-border)] pt-5">
            <Link
              href={`/${locale}/v2`}
              className="inline-flex min-h-11 items-center px-2 text-[13px] font-medium text-[var(--production-ink-muted)] hover:text-[var(--production-ink)]"
            >
              {t('footer.cancel')}
            </Link>
            <div className="flex items-center gap-2">
              {wizardStep > 1 ? (
                <button
                  type="button"
                  onClick={() => setWizardStep((wizardStep - 1) as 1 | 2)}
                  className="kuiper-dashboard-secondary inline-flex min-h-11 items-center gap-2 px-4 text-[13px] font-semibold"
                >
                  <AppIcon name="chevronLeft" className="h-4 w-4" />
                  {t('wizard.back')}
                </button>
              ) : null}
              {wizardStep < 3 ? (
                <button
                  type="button"
                  disabled={wizardStep === 1 && !name.trim()}
                  onClick={() => setWizardStep((wizardStep + 1) as 2 | 3)}
                  className="kuiper-dashboard-primary inline-flex min-h-11 items-center gap-2 px-5 text-[13px] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {t('wizard.next')}
                  <AppIcon name="chevronRight" className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting || extracting || !name.trim()}
                  className="kuiper-dashboard-primary flex min-h-11 items-center gap-2 px-5 text-[13px] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <AppIcon name="sparklesAlt" className="h-4 w-4" />
                  {submitting
                    ? t('footer.submitting')
                    : episodeCount > 0
                      ? t('footer.submitWithImport', { count: episodeCount })
                      : t('footer.submit')}
                </button>
              )}
            </div>
          </div>
        </form>
      </main>
    </div>
  )
}

// ─── Phase 2.5 — Skill anchor picker (sub-component) ───
//
// Renders the optional Skill selector inside the new-project form.
// First option is always 自由創作 (no Skill = generic flow, status quo).
// Remaining options come from the user's installed Skills.
//
// Empty Skill library: only 自由創作 renders + a small hint nudging
// users to /skills to install one (Phase 3.5 marketplace).
//
// Style matches the shared studio-dark production shell.

interface SkillAnchorPickerProps {
  originSkillId: string | null
  onChange: (id: string | null) => void
}

function SkillAnchorPicker({ originSkillId, onChange }: SkillAnchorPickerProps) {
  const t = useTranslations('v2New.form')
  const skillsQuery = useSkills({ installed: true })
  const skills = skillsQuery.data?.skills ?? []
  const installed = skills.filter((s) => s.enabled)

  // Build option list — free creation first, then installed Skills.
  const options: Array<{ id: string | null; name: string; desc: string }> = [
    {
      id: null,
      name: t('skillFreeTitle'),
      desc: t('skillFreeDesc'),
    },
    ...installed.map((s) => ({
      id: s.id,
      name: s.name,
      desc:
        s.description.length > 60
          ? `${s.description.slice(0, 58)}…`
          : s.description,
    })),
  ]

  return (
    <div>
      <label className="mb-2 block font-mono text-[14px] tracking-wider text-[var(--production-ink-muted)]">
        {t('skillLabel')}
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((opt) => (
          <button
            key={opt.id ?? 'free'}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={originSkillId === opt.id}
            className={`${studioStyles.selectableSurface} ${originSkillId === opt.id ? studioStyles.selectableSurfaceActive : ''} rounded-xl border px-3 py-2.5 text-left transition-colors`}
          >
            <div
              className={`font-mono text-[13px] tracking-wider ${
                originSkillId === opt.id ? 'text-[var(--process-cyan-strong)]' : 'text-[var(--production-ink)]'
              }`}
            >
              {opt.name}
            </div>
            <div className="mt-0.5 font-fraunces text-[11px] italic text-[var(--production-ink-muted)]">
              {opt.desc}
            </div>
          </button>
        ))}
      </div>
      {installed.length === 0 && !skillsQuery.isLoading ? (
        <p className="mt-2 font-fraunces text-[11px] italic text-[var(--production-ink-muted)]">
          {t('skillEmptyHint')}
          <Link
            href="/skills"
            className="text-[var(--process-cyan-strong)] underline-offset-4 hover:underline"
          >
            {t('skillEmptyHintLink')}
          </Link>
          {t('skillEmptyHintTail')}
        </p>
      ) : null}
    </div>
  )
}
