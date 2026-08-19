'use client'

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { Modal } from '@/components/v2/Modal'
import { queryKeys } from '@/lib/query/keys'
import { filterByScript, type ScriptCode } from '@/lib/script-language-detector'

interface ExtractedEpisode {
  number: number
  title: string
  content: string
  wordCount: number
  contentByLang?: Record<string, string>
}

type ExtractMode = 'table' | 'markers' | 'prose'
interface ExtractResponse {
  mode: ExtractMode
  episodes: ExtractedEpisode[]
  rawText: string
  meta: {
    detectedTitle?: string
    sourceFormat: 'docx' | 'pdf' | 'txt' | 'md'
    plainTextChars: number
    tableRowsDetected?: number
    markerType?: string
    languages?: {
      detected: ScriptCode[]
      isMultilingual: boolean
    }
  }
}

const MAX_EPISODES = 200
const MAX_EPISODE_NAME_LENGTH = 191
const MAX_EPISODE_TEXT_BYTES = 65_535
const SCRIPT_LABELS: Record<ScriptCode, string> = {
  zh: '中文',
  en: 'English / Latin',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский',
  ar: 'العربية',
}

interface BulkEpisodeUploadButtonProps {
  projectId: string
  existingEpisodeCount: number
  canEdit?: boolean
  viewerTip?: string
  tone?: 'dark' | 'studio'
}

export function BulkEpisodeUploadButton({
  projectId,
  existingEpisodeCount,
  canEdit = true,
  viewerTip,
  tone = 'dark',
}: BulkEpisodeUploadButtonProps) {
  const t = useTranslations('v2Script.import')
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [extracting, setExtracting] = useState(false)
  const [preview, setPreview] = useState<ExtractResponse | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [clearExisting, setClearExisting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [outcomeUnknown, setOutcomeUnknown] = useState(false)
  const [checkingOutcome, setCheckingOutcome] = useState(false)
  const [chosenLang, setChosenLang] = useState<ScriptCode | null>(null)

  function openPicker() {
    setExtractError(null)
    fileInputRef.current?.click()
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setExtracting(true)
    setExtractError(null)
    setCreateError(null)
    setOutcomeUnknown(false)
    setPreview(null)
    setClearExisting(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/files/extract-episodes', {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        setExtractError(t(extractErrorKey(await readStableErrorCode(response))))
        return
      }
      const result = (await response.json()) as ExtractResponse
      setPreview(result)
      const detected = result.meta.languages?.detected ?? []
      setChosenLang(result.meta.languages?.isMultilingual && detected[0] ? detected[0] : null)
    } catch {
      setExtractError(t('errors.extract'))
    } finally {
      setExtracting(false)
    }
  }

  async function confirmCreate() {
    if (!canEdit || !preview || preview.episodes.length > MAX_EPISODES || creating || outcomeUnknown) return
    setCreating(true)
    setCreateError(null)
    try {
      const episodes = buildImportEpisodes(preview, chosenLang, (number) => t('episodeNumber', { number }))
      if (findImportLimitIssue(episodes)) return
      const response = await fetch(`/api/novel-promotion/${projectId}/episodes/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodes, clearExisting, importStatus: 'imported' }),
      })
      if (!response.ok) {
        if (response.status >= 500) {
          // A server failure does not prove the atomic batch failed before
          // commit. Treat it like a lost response and require reconciliation.
          setOutcomeUnknown(true)
          setCreateError(t('errors.outcomeUnknown'))
        } else {
          setOutcomeUnknown(false)
          setCreateError(t('errors.create'))
        }
        return
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
      closePreview()
    } catch {
      // A lost response does not prove the append/replace transaction failed.
      // Directly repeating a non-idempotent batch could duplicate episodes.
      setOutcomeUnknown(true)
      setCreateError(t('errors.outcomeUnknown'))
    } finally {
      setCreating(false)
    }
  }

  function closePreview() {
    setPreview(null)
    setExtractError(null)
    setCreateError(null)
    setOutcomeUnknown(false)
    setCheckingOutcome(false)
    setClearExisting(false)
    setChosenLang(null)
  }

  async function checkProjectAfterUnknownOutcome() {
    if (checkingOutcome) return
    setCheckingOutcome(true)
    try {
      await queryClient.refetchQueries({ queryKey: queryKeys.projectData(projectId) })
    } finally {
      setCheckingOutcome(false)
    }
  }

  return (
    <div className="min-w-0 max-w-full">
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.pdf,.txt,.md,.markdown"
        onChange={handleFileChange}
        className="hidden"
      />
      <div className="flex max-w-[360px] flex-col items-start gap-1.5">
        <button
          type="button"
          onClick={openPicker}
          disabled={extracting || !canEdit}
          aria-describedby="screenplay-import-hint screenplay-import-limits"
          className={tone === 'studio'
            ? 'kuiper-dashboard-secondary flex min-h-11 max-w-full items-center gap-2 px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none'
            : 'flex min-h-11 max-w-full items-center gap-2 rounded-input border border-border-strong bg-raised px-4 py-2 text-sm text-text-secondary transition-all hover:border-primary-500/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none'}
          title={!canEdit ? viewerTip : undefined}
        >
          <AppIcon aria-hidden="true" name="upload" className="h-4 w-4 shrink-0" />
          <span>{extracting ? t('extracting') : t('trigger')}</span>
        </button>
        <p id="screenplay-import-hint" className="text-[12px] leading-5 text-[var(--production-ink-muted)]">
          {t('triggerHint')}
        </p>
        <p id="screenplay-import-limits" className="text-[12px] leading-5 text-[var(--production-ink-muted)]">
          {t('limits')}
        </p>
      </div>

      {extractError ? (
        <p
          role="alert"
          className="mt-2 rounded-[10px] border border-rose-400/35 bg-rose-400/10 px-3 py-2 text-[13px] text-[var(--production-danger)]"
        >
          {extractError}
        </p>
      ) : null}

      <ImportPreviewModal
        preview={preview}
        canEdit={canEdit}
        existingEpisodeCount={existingEpisodeCount}
        clearExisting={clearExisting}
        setClearExisting={(value) => {
          setClearExisting(value)
          if (!outcomeUnknown) setCreateError(null)
        }}
        chosenLang={chosenLang}
        setChosenLang={(value) => {
          setChosenLang(value)
          if (!outcomeUnknown) setCreateError(null)
        }}
        creating={creating}
        outcomeUnknown={outcomeUnknown}
        checkingOutcome={checkingOutcome}
        createError={createError}
        onConfirm={() => void confirmCreate()}
        onCheckOutcome={() => void checkProjectAfterUnknownOutcome()}
        onClose={closePreview}
      />
    </div>
  )
}

interface ImportPreviewModalProps {
  preview: ExtractResponse | null
  canEdit: boolean
  existingEpisodeCount: number
  clearExisting: boolean
  setClearExisting: (value: boolean) => void
  chosenLang: ScriptCode | null
  setChosenLang: (value: ScriptCode | null) => void
  creating: boolean
  outcomeUnknown: boolean
  checkingOutcome: boolean
  createError: string | null
  onConfirm: () => void
  onCheckOutcome: () => void
  onClose: () => void
}

function ImportPreviewModal({
  preview,
  canEdit,
  existingEpisodeCount,
  clearExisting,
  setClearExisting,
  chosenLang,
  setChosenLang,
  creating,
  outcomeUnknown,
  checkingOutcome,
  createError,
  onConfirm,
  onCheckOutcome,
  onClose,
}: ImportPreviewModalProps) {
  const t = useTranslations('v2Script.import')
  const episodeCount = preview?.episodes.length ?? 0
  const tooMany = episodeCount > MAX_EPISODES
  const preparedEpisodes = preview
    ? buildImportEpisodes(preview, chosenLang, (number) => t('episodeNumber', { number }))
    : []
  const limitIssue = findImportLimitIssue(preparedEpisodes)
  const mode = preview ? modeLabel(preview, t) : ''
  const summary = preview
    ? episodeCount > 0
      ? t('summaryEpisodes', { count: episodeCount, mode })
      : t('summarySingle', { count: preview.meta.plainTextChars })
    : ''
  const confirmLabel = createError && !outcomeUnknown
    ? t('retry')
    : clearExisting
      ? episodeCount > 0
        ? t('replaceEpisodes', { count: episodeCount })
        : t('replaceSingle')
      : episodeCount > 0
        ? t('appendEpisodes', { count: episodeCount })
        : t('appendSingle')

  return (
    <Modal
      open={Boolean(preview)}
      onClose={onClose}
      size="lg"
      className="flex max-h-[calc(100dvh-24px)] min-w-0 flex-col overflow-hidden sm:max-h-[88vh]"
    >
      <Modal.Header
        heading={t('previewTitle')}
        subtitle={summary}
        onClose={onClose}
        closeAriaLabel={t('close')}
      />
      <Modal.Body className="min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {preview?.meta.languages?.isMultilingual ? (
          <fieldset className="mb-4 rounded-[12px] border border-[var(--production-border)] bg-[var(--production-tool-soft)] p-3">
            <legend className="px-1 text-[13px] font-semibold text-[var(--production-ink)]">
              {t('languageTitle')}
            </legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {preview.meta.languages.detected.map((code) => (
                <label key={code} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[9px] border border-[var(--production-border)] px-3 text-[13px]">
                  <input
                    type="radio"
                    name="bulk-script-language"
                    checked={chosenLang === code}
                    onChange={() => setChosenLang(code)}
                    className="h-4 w-4 accent-[var(--production-tool)]"
                  />
                  {SCRIPT_LABELS[code]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-5 text-[var(--production-ink-muted)]">
              {t('languageHint')}
            </p>
          </fieldset>
        ) : null}

        {tooMany ? (
          <p role="alert" className="mb-4 rounded-[10px] border border-rose-400/35 bg-rose-400/10 px-3 py-2 text-[13px] text-[var(--production-danger)]">
            {t('errors.tooManyEpisodes')}
          </p>
        ) : null}

        {limitIssue ? (
          <p role="alert" className="mb-4 rounded-[10px] border border-rose-400/35 bg-rose-400/10 px-3 py-2 text-[13px] text-[var(--production-danger)]">
            {limitIssue.kind === 'name'
              ? t('errors.episodeNameTooLong', { number: limitIssue.number })
              : t('errors.episodeTextTooLarge', { number: limitIssue.number })}
          </p>
        ) : null}

        {preview && episodeCount > 0 ? (
          <ul className="space-y-3">
            {preview.episodes.slice(0, 50).map((episode) => (
              <li key={`${episode.number}-${episode.title}`} className="rounded-[12px] border border-[var(--production-border)] bg-[var(--production-raised)] px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <span className="mr-3 font-mono text-[12px] font-semibold text-[var(--production-tool)]">
                      {t('episodeNumber', { number: episode.number })}
                    </span>
                    <span className="break-words text-[14px] text-[var(--production-ink)]">{episode.title}</span>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-[var(--production-ink-muted)]">
                    {t('characterCount', { count: episode.wordCount })}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 break-words text-[13px] leading-5 text-[var(--production-ink-muted)]">
                  {episode.content.slice(0, 240)}{episode.content.length > 240 ? '…' : ''}
                </p>
              </li>
            ))}
            {episodeCount > 50 ? (
              <li className="px-4 py-2 font-mono text-[12px] text-[var(--production-ink-muted)]">
                {t('moreEpisodes', { count: episodeCount - 50 })}
              </li>
            ) : null}
          </ul>
        ) : preview ? (
          <div className="rounded-[12px] border border-[var(--production-border)] bg-[var(--production-tool-soft)] p-4">
            <p className="text-[14px] font-semibold text-[var(--production-ink)]">{t('singleModeTitle')}</p>
            <p className="mt-2 text-[13px] leading-5 text-[var(--production-ink-muted)]">{t('singleModeDescription')}</p>
          </div>
        ) : null}

        {preview && existingEpisodeCount > 0 ? (
          <fieldset className="mt-5 space-y-2">
            <legend className="mb-2 text-[13px] font-semibold text-[var(--production-ink)]">{t('strategyLabel')}</legend>
            <StrategyOption
              checked={!clearExisting}
              label={t('appendLabel')}
              description={t('appendDescription', { count: existingEpisodeCount })}
              onChange={() => setClearExisting(false)}
            />
            <StrategyOption
              checked={clearExisting}
              label={t('replaceLabel')}
              description={t('replaceDescription', { count: existingEpisodeCount })}
              onChange={() => setClearExisting(true)}
            />
          </fieldset>
        ) : null}

        {createError ? (
          <div role="alert" className="mt-4 rounded-[10px] border border-rose-400/35 bg-rose-400/10 px-3 py-3 text-[13px] text-[var(--production-danger)]">
            <p>{createError}</p>
            {outcomeUnknown ? (
              <button
                type="button"
                onClick={onCheckOutcome}
                disabled={checkingOutcome}
                className="kuiper-dashboard-secondary mt-3 min-h-11 px-4 text-[13px] disabled:opacity-50"
              >
                {checkingOutcome ? t('checkingOutcome') : t('checkOutcome')}
              </button>
            ) : null}
          </div>
        ) : null}
      </Modal.Body>
      <Modal.Footer className="flex-col-reverse items-stretch sm:flex-row sm:items-center sm:justify-end">
        <button type="button" onClick={onClose} disabled={creating} className="kuiper-dashboard-secondary min-h-11 px-4 text-[14px] disabled:opacity-50">
          {t('cancel')}
        </button>
        <button type="button" onClick={onConfirm} disabled={!canEdit || creating || tooMany || Boolean(limitIssue) || outcomeUnknown} className="kuiper-dashboard-primary inline-flex min-h-11 items-center justify-center gap-2 px-5 text-[14px] disabled:cursor-not-allowed disabled:opacity-50">
          <AppIcon aria-hidden="true" name="check" className="h-4 w-4" />
          {creating ? t('creating') : confirmLabel}
        </button>
      </Modal.Footer>
    </Modal>
  )
}

function StrategyOption({
  checked,
  label,
  description,
  onChange,
}: {
  checked: boolean
  label: string
  description: string
  onChange: () => void
}) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border p-3 ${checked ? 'border-[var(--production-tool)] bg-[var(--production-tool-soft)]' : 'border-[var(--production-border)]'}`}>
      <input
        type="radio"
        name="bulk-script-strategy"
        checked={checked}
        onChange={onChange}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--production-tool)]"
      />
      <span>
        <span className="block text-[14px] font-semibold text-[var(--production-ink)]">{label}</span>
        <span className="mt-1 block text-[12px] leading-5 text-[var(--production-ink-muted)]">{description}</span>
      </span>
    </label>
  )
}

type Translate = (key: string, values?: Record<string, number | string>) => string

function modeLabel(preview: ExtractResponse, t: Translate): string {
  if (preview.mode === 'table') {
    return t('modeTable', { count: preview.meta.tableRowsDetected ?? 0 })
  }
  if (preview.mode === 'markers') return t('modeMarkers')
  return t('modeProse')
}

function extractErrorKey(code: string | null): string {
  if (code === 'FILE_TOO_LARGE') return 'errors.fileTooLarge'
  if (code === 'PDF_NO_TEXT_LAYER') return 'errors.pdfNoText'
  if (code === 'FILE_TYPE_UNSUPPORTED') return 'errors.unsupported'
  if (code === 'MACRO_DOCX_REJECTED') return 'errors.macro'
  return 'errors.extract'
}

async function readStableErrorCode(response: Response): Promise<string | null> {
  try {
    const body = await response.json() as {
      code?: unknown
      error?: { code?: unknown; details?: { code?: unknown } }
    }
    const candidates = [body.code, body.error?.details?.code, body.error?.code]
    return candidates.find((candidate): candidate is string => typeof candidate === 'string') ?? null
  } catch {
    return null
  }
}

interface PreparedEpisode {
  name: string
  novelText: string
}

function buildImportEpisodes(
  preview: ExtractResponse,
  chosenLang: ScriptCode | null,
  fallbackName: (number: number) => string,
): PreparedEpisode[] {
  if (preview.episodes.length === 0) {
    return [{
      name: fallbackName(1),
      novelText: chosenLang ? filterByScript(preview.rawText, chosenLang) : preview.rawText,
    }]
  }
  return preview.episodes.map((episode) => ({
    name: episode.title || fallbackName(episode.number),
    novelText: chosenLang && episode.contentByLang?.[chosenLang]
      ? episode.contentByLang[chosenLang]
      : episode.content,
  }))
}

function findImportLimitIssue(episodes: PreparedEpisode[]): {
  kind: 'name' | 'text'
  number: number
} | null {
  for (const [index, episode] of episodes.entries()) {
    if (episode.name.length > MAX_EPISODE_NAME_LENGTH) {
      return { kind: 'name', number: index + 1 }
    }
    if (new TextEncoder().encode(episode.novelText).byteLength > MAX_EPISODE_TEXT_BYTES) {
      return { kind: 'text', number: index + 1 }
    }
  }
  return null
}
