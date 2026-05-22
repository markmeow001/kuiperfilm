'use client'

/**
 * Bulk-episode upload: drop a .docx / .txt / .md outline (e.g. the
 * industry-standard 集数 column DOCX), preview detected episodes, then
 * bulk-create them via /episodes/batch.
 *
 * Decision boundaries:
 *   - Heavy lifting (DOCX parse, table walk, marker regex) lives in
 *     /api/files/extract-episodes — this component is just file picker +
 *     preview UI.
 *   - For `mode: prose` we DO NOT silently call the LLM split here; the
 *     CLAUDE.md "AI route 不准旁路 worker" rule means any AI episode
 *     split must go through the EPISODE_SPLIT_LLM worker (already wired
 *     to the existing SmartImportWizard). For prose-only files we offer
 *     the user a "create as single episode" option and point them at the
 *     SmartImport flow for real AI splitting.
 */

import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AppIcon } from '@/components/ui/icons'
import { queryKeys } from '@/lib/query/keys'

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
    detectedTitle?: string
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

const SCRIPT_LABELS: Record<ScriptCode, string> = {
  zh: '中文',
  en: 'English / 拉丁文',
  ja: '日本語',
  ko: '한국어',
  ru: 'Русский',
  ar: 'العربية',
}

interface BulkEpisodeUploadButtonProps {
  projectId: string
  hasExistingEpisodes: boolean
  /** Phase 12.5 — when false, disables the upload trigger and shows a viewer tooltip. */
  canEdit?: boolean
  viewerTip?: string
}

export function BulkEpisodeUploadButton({ projectId, hasExistingEpisodes, canEdit = true, viewerTip }: BulkEpisodeUploadButtonProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [extracting, setExtracting] = useState(false)
  const [preview, setPreview] = useState<ExtractResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [clearExisting, setClearExisting] = useState(false)
  const [creating, setCreating] = useState(false)
  const [chosenLang, setChosenLang] = useState<ScriptCode | null>(null)

  function openPicker() {
    setErrorMsg(null)
    fileInputRef.current?.click()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    await runExtract(file)
  }

  async function runExtract(file: File) {
    setExtracting(true)
    setErrorMsg(null)
    setPreview(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/files/extract-episodes', {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        setErrorMsg(`抽取失敗 (${res.status}): ${text || '未知錯誤'}`)
        return
      }
      const json = (await res.json()) as ExtractResponse
      setPreview(json)
      if (json.meta.languages?.isMultilingual && json.meta.languages.detected.length > 0) {
        setChosenLang(json.meta.languages.detected[0])
      } else {
        setChosenLang(null)
      }
    } catch (err) {
      setErrorMsg(`抽取失敗:${(err as Error).message}`)
    } finally {
      setExtracting(false)
    }
  }

  function resolveContent(ep: ExtractedEpisode): string {
    if (chosenLang && ep.contentByLang?.[chosenLang]) {
      return ep.contentByLang[chosenLang]
    }
    return ep.content
  }

  async function confirmCreate() {
    if (!preview) return
    setCreating(true)
    setErrorMsg(null)
    try {
      const episodesToCreate = preview.episodes.length > 0
        ? preview.episodes.map((ep) => ({
            name: ep.title || `第 ${ep.number} 集`,
            novelText: resolveContent(ep),
          }))
        // prose fallback: dump full text into one episode
        : [{ name: '第 1 集', novelText: preview.rawText }]

      const res = await fetch(`/api/novel-promotion/${projectId}/episodes/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodes: episodesToCreate,
          clearExisting,
          importStatus: 'imported',
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        setErrorMsg(`建立集數失敗 (${res.status}): ${text || '未知錯誤'}`)
        return
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
      setPreview(null)
      setClearExisting(false)
    } catch (err) {
      setErrorMsg(`建立集數失敗:${(err as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  function cancelPreview() {
    setPreview(null)
    setErrorMsg(null)
    setClearExisting(false)
    setChosenLang(null)
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".docx,.txt,.md,.markdown"
        onChange={handleFileChange}
        className="hidden"
      />

      <button
        type="button"
        onClick={openPicker}
        disabled={extracting || !canEdit}
        className="flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/5 px-4 py-2 font-serif-cn text-sm text-amber-300 transition-all hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50"
        title={!canEdit ? viewerTip : '支援 .docx / .txt / .md,自動偵測「第X集」標題或 集数 表格,一鍵分集'}
      >
        <AppIcon name="upload" className="h-4 w-4" />
        {extracting ? '抽取中…' : '上傳劇本檔案'}
      </button>

      {errorMsg && !preview ? (
        <p className="mt-2 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-serif-cn text-xs text-rose-300">
          {errorMsg}
        </p>
      ) : null}

      {preview ? (
        <PreviewModal
          preview={preview}
          hasExistingEpisodes={hasExistingEpisodes}
          clearExisting={clearExisting}
          setClearExisting={setClearExisting}
          chosenLang={chosenLang}
          setChosenLang={setChosenLang}
          creating={creating}
          errorMsg={errorMsg}
          onConfirm={() => void confirmCreate()}
          onCancel={cancelPreview}
        />
      ) : null}
    </>
  )
}

interface PreviewModalProps {
  preview: ExtractResponse
  hasExistingEpisodes: boolean
  clearExisting: boolean
  setClearExisting: (v: boolean) => void
  chosenLang: ScriptCode | null
  setChosenLang: (v: ScriptCode | null) => void
  creating: boolean
  errorMsg: string | null
  onConfirm: () => void
  onCancel: () => void
}

function PreviewModal({
  preview,
  hasExistingEpisodes,
  clearExisting,
  setClearExisting,
  chosenLang,
  setChosenLang,
  creating,
  errorMsg,
  onConfirm,
  onCancel,
}: PreviewModalProps) {
  const episodeCount = preview.episodes.length
  const modeLabel: Record<ExtractMode, string> = {
    table: `表格 (${preview.meta.tableRowsDetected ?? 0} 列)`,
    markers: `標題 (${preview.meta.markerType ?? '未知格式'})`,
    prose: '無結構 — 單集模式',
  }
  const summary = episodeCount > 0
    ? `偵測到 ${episodeCount} 集 — 模式:${modeLabel[preview.mode]}`
    : `未偵測到分集結構 — ${preview.meta.plainTextChars} 字將寫入單一集`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-10">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-sm border border-amber-900/40 bg-stone-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-800/60 px-6 py-4">
          <div>
            <div className="font-fraunces text-base italic text-amber-500/90">預覽抽取結果</div>
            <div className="mt-1 font-mono text-[12px] tracking-wider text-stone-500">{summary}</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-sm p-1 text-stone-500 transition-colors hover:bg-stone-900 hover:text-stone-300"
            aria-label="關閉"
          >
            <AppIcon name="close" className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Language picker — only when multilingual. */}
          {preview.meta.languages?.isMultilingual ? (
            <div className="mb-4 rounded-sm border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
              <p className="mb-2 font-serif-cn text-xs text-amber-200/90">
                偵測到多語言混排,匯入前選一種保留:
              </p>
              <div className="flex flex-wrap gap-2">
                {preview.meta.languages.detected.map((code) => (
                  <label
                    key={code}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 py-1 font-serif-cn text-xs transition-colors ${
                      chosenLang === code
                        ? 'border-amber-500/70 bg-amber-500/15 text-amber-200'
                        : 'border-stone-700 text-stone-400 hover:border-stone-600'
                    }`}
                  >
                    <input
                      type="radio"
                      name="bulk-script-pick"
                      className="h-3 w-3 accent-amber-500"
                      checked={chosenLang === code}
                      onChange={() => setChosenLang(code)}
                    />
                    {SCRIPT_LABELS[code]}
                  </label>
                ))}
              </div>
              <p className="mt-2 font-mono text-[11px] text-stone-500">
                其他語言段落會被自動移除,場景頭(INT./EXT.)和雙語標題會保留。
              </p>
            </div>
          ) : null}

          {episodeCount > 0 ? (
            <ul className="space-y-3">
              {preview.episodes.slice(0, 50).map((ep) => (
                <li key={ep.number} className="rounded-sm border border-stone-800/60 bg-stone-900/30 px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-xs tracking-wider text-amber-500/70">
                        第 {ep.number} 集
                      </span>
                      <span className="font-serif-cn text-sm text-stone-200">{ep.title}</span>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-stone-600">{ep.wordCount} chars</span>
                  </div>
                  <p className="mt-2 line-clamp-2 font-serif-cn text-xs leading-relaxed text-stone-400">
                    {ep.content.slice(0, 240)}
                    {ep.content.length > 240 ? '…' : ''}
                  </p>
                </li>
              ))}
              {episodeCount > 50 ? (
                <li className="px-4 py-2 font-mono text-[11px] text-stone-600">
                  …還有 {episodeCount - 50} 集未顯示(全部會被建立)
                </li>
              ) : null}
            </ul>
          ) : (
            <div className="rounded-sm border border-amber-900/30 bg-amber-500/5 px-4 py-4 font-serif-cn text-sm leading-relaxed text-amber-200/80">
              <p className="mb-2">
                檔案內沒偵測到「第X集」標題或集數表格。系統會把整份文本寫入<span className="text-amber-300">單一集</span>。
              </p>
              <p className="text-xs text-amber-200/60">
                如果這是一整本小說,請在貼進編輯器後到「分鏡」step 使用 AI 拆分,
                或先回前頁用「Smart Import」嚮導跑 LLM 自動切集。
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-stone-800/60 px-6 py-4">
          {hasExistingEpisodes ? (
            <label className="mb-3 flex items-center gap-2 font-serif-cn text-xs text-stone-400">
              <input
                type="checkbox"
                checked={clearExisting}
                onChange={(e) => setClearExisting(e.target.checked)}
                className="h-4 w-4 rounded-sm border border-stone-700 bg-stone-900 text-amber-500 focus:ring-1 focus:ring-amber-500"
              />
              <span>
                匯入前先清空現有集數
                <span className="ml-1 text-rose-300/80">(會刪除既有集數內容,無法復原)</span>
              </span>
            </label>
          ) : null}

          {errorMsg ? (
            <p className="mb-3 rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-serif-cn text-xs text-rose-300">
              {errorMsg}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={creating}
              className="rounded-sm border border-stone-700 px-4 py-2 font-serif-cn text-sm text-stone-300 transition-all hover:bg-stone-900 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={creating}
              className="flex items-center gap-2 rounded-sm bg-amber-500 px-5 py-2 font-serif-cn text-sm font-medium text-stone-950 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <AppIcon name="check" className="h-4 w-4" />
              {creating ? '建立中…' : episodeCount > 0 ? `建立 ${episodeCount} 集` : '建立單集'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
