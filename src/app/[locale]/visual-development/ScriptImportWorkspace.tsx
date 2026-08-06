'use client'

import { AppIcon } from '@/components/ui/icons'
import {
  SCRIPT_ANALYSIS_MAX_CHARS,
  SCRIPT_ANALYSIS_MIN_CHARS,
} from '@/lib/visual-development/script-analysis'
import type { ScriptImportWorkspaceController } from './visual-development-types'

export interface ScriptImportTranslations {
  source: string
  sourceDescription: string
  title: string
  titlePlaceholder: string
  paste: string
  pastePlaceholder: string
  upload: string
  uploading: string
  supportedFiles: string
  model: string
  modelPlaceholder: string
  modelHint: string
  analyze: string
  analyzing: string
  review: string
  reviewDescription: string
  synopsis: string
  worldDraft: string
  characters: string
  locations: string
  selectAll: string
  clearAll: string
  applyWorld: string
  applyWorldHint: string
  apply: string
  applying: string
  noAnalysis: string
  draftNotice: string
  charactersSelected: string
  evidence: string
  sourceVersions: string
  currentVersion: string
  loadSource: string
  downloadSource: string
}

export function ScriptImportWorkspace({
  controller,
  translations: t,
}: {
  controller: ScriptImportWorkspaceController
  translations: ScriptImportTranslations
}) {
  const canAnalyze = controller.sourceTitle.trim().length > 0
    && controller.scriptText.trim().length >= SCRIPT_ANALYSIS_MIN_CHARS
    && controller.scriptText.length <= SCRIPT_ANALYSIS_MAX_CHARS
    && Boolean(controller.modelKey)
    && !controller.isAnalyzing
  const allSelected = Boolean(controller.analysis)
    && controller.selectedCharacterCodes.length === controller.analysis?.characters.length

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
        <div className="grid border-b border-white/[0.07] lg:grid-cols-[1fr_280px]">
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">
              <AppIcon name="fileText" className="h-4 w-4" />
              {t.source}
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-text-secondary">{t.sourceDescription}</p>
          </div>
          <label className="group flex cursor-pointer items-center justify-center gap-3 border-t border-white/[0.07] bg-white/[0.018] px-5 py-5 transition-colors hover:bg-primary-500/[0.05] lg:border-l lg:border-t-0">
            <AppIcon name="upload" className="h-4 w-4 text-primary-400" />
            <span className="text-xs text-white">{controller.isUploading ? t.uploading : t.upload}</span>
            <input
              type="file"
              className="sr-only"
              accept=".docx,.pdf,.txt,.md,.markdown"
              disabled={controller.isUploading}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) controller.onFileSelected(file)
                event.currentTarget.value = ''
              }}
            />
          </label>
        </div>

        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-4">
            <label className="block">
              <span className="font-mono text-[9px] tracking-[0.14em] text-text-tertiary">{t.title}</span>
              <input
                value={controller.sourceTitle}
                onChange={(event) => controller.onSourceTitleChange(event.target.value)}
                placeholder={t.titlePlaceholder}
                maxLength={240}
                className="mt-2 h-11 w-full rounded-xl border border-white/[0.08] bg-[#0a0a0c] px-3 text-sm text-white outline-none transition-colors placeholder:text-text-tertiary focus:border-primary-500/45"
              />
            </label>
            <label className="block">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[9px] tracking-[0.14em] text-text-tertiary">{t.paste}</span>
                <span className={`font-mono text-[9px] ${controller.scriptText.length > SCRIPT_ANALYSIS_MAX_CHARS ? 'text-red-400' : 'text-text-tertiary'}`}>
                  {controller.scriptText.length.toLocaleString()} / {SCRIPT_ANALYSIS_MAX_CHARS.toLocaleString()}
                </span>
              </div>
              <textarea
                value={controller.scriptText}
                onChange={(event) => controller.onScriptTextChange(event.target.value)}
                placeholder={t.pastePlaceholder}
                className="mt-2 min-h-72 w-full resize-y rounded-xl border border-white/[0.08] bg-[#0a0a0c] px-4 py-3 font-serif-cn text-sm leading-6 text-text-secondary outline-none transition-colors placeholder:text-text-tertiary focus:border-primary-500/45"
              />
            </label>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-white/[0.07] bg-[#0b0b0d] p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[9px] tracking-[0.14em] text-text-tertiary">{t.sourceVersions}</span>
                {controller.sourceVersionId && <span className="rounded bg-primary-500/[0.12] px-2 py-1 font-mono text-[8px] text-primary-300">{t.currentVersion}</span>}
              </div>
              {controller.sources.length === 0 ? (
                <p className="mt-3 text-[10px] leading-5 text-text-tertiary">—</p>
              ) : (
                <div className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-1">
                  {[...controller.sources].reverse().map((source) => {
                    const selected = controller.sourceVersionId === source.id
                    return (
                      <div key={source.id} className={`rounded-lg border px-3 py-2 transition-colors ${selected ? 'border-primary-500/30 bg-primary-500/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
                        <button
                          type="button"
                          onClick={() => controller.onSelectSource(source.id)}
                          aria-pressed={selected}
                          className="block w-full text-left"
                          title={t.loadSource}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-[10px] text-white">V{source.version} · {source.sourceTitle}</span>
                            {selected && <span className="rounded bg-primary-500/[0.12] px-1.5 py-0.5 font-mono text-[7px] text-primary-300">{t.currentVersion}</span>}
                          </span>
                          <span className="mt-1 block font-mono text-[8px] text-text-tertiary">{source.sourceFormat.toUpperCase()} · {new Date(source.createdAt).toLocaleString()}</span>
                        </button>
                        <a
                          href={`/api/playground/download?url=${encodeURIComponent(source.downloadUrl)}&filename=${encodeURIComponent(source.name)}`}
                          aria-label={`${t.downloadSource}: ${source.sourceTitle}`}
                          className="mt-2 inline-flex items-center gap-1.5 rounded border border-white/[0.07] px-2 py-1 font-mono text-[7px] text-text-tertiary hover:border-primary-500/25 hover:text-white"
                        >
                          <AppIcon name="download" className="h-3 w-3 shrink-0 text-primary-400" />
                          {t.downloadSource}
                        </a>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-white/[0.07] bg-[#0b0b0d] p-4">
              <label className="block">
                <span className="font-mono text-[9px] tracking-[0.14em] text-text-tertiary">{t.model}</span>
                <select
                  value={controller.modelKey}
                  onChange={(event) => controller.onModelChange(event.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-white/[0.08] bg-[#111114] px-3 text-xs text-white outline-none focus:border-primary-500/45"
                >
                  <option value="">{t.modelPlaceholder}</option>
                  {controller.llmModels.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}{model.providerName ? ` · ${model.providerName}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-3 text-[11px] leading-5 text-text-tertiary">{t.modelHint}</p>
            </div>
            <div className="rounded-xl border border-primary-500/20 bg-primary-500/[0.045] p-4">
              <div className="flex items-center gap-2 text-[11px] font-medium text-primary-300">
                <AppIcon name="lock" className="h-3.5 w-3.5" />
                {t.draftNotice}
              </div>
              <p className="mt-3 font-mono text-[9px] leading-5 tracking-[0.08em] text-text-tertiary">{t.supportedFiles}</p>
            </div>
            <button
              type="button"
              onClick={controller.onAnalyze}
              disabled={!canAnalyze}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <AppIcon name={controller.isAnalyzing ? 'refresh' : 'brain'} className={`h-4 w-4 ${controller.isAnalyzing ? 'animate-spin' : ''}`} />
              {controller.isAnalyzing ? t.analyzing : t.analyze}
            </button>
          </aside>
        </div>
        {controller.errorMessage && (
          <div className="border-t border-red-500/20 bg-red-500/[0.06] px-5 py-3 text-xs text-red-300 sm:px-6">
            {controller.errorMessage}
          </div>
        )}
      </section>

      {!controller.analysis ? (
        <section className="flex min-h-44 items-center justify-center rounded-2xl border border-dashed border-white/[0.1] bg-raised text-center">
          <div>
            <AppIcon name="brain" className="mx-auto h-5 w-5 text-text-tertiary" />
            <p className="mt-3 text-xs text-text-tertiary">{t.noAnalysis}</p>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-white/[0.08] bg-raised p-5 sm:p-6">
          <div className="flex flex-col gap-4 border-b border-white/[0.07] pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="font-mono text-[9px] tracking-[0.18em] text-primary-400">{t.review}</div>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-text-secondary">{t.reviewDescription}</p>
            </div>
            <div className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[9px] text-text-tertiary">
              {controller.analysis.modelKey}
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <article className="rounded-xl border border-white/[0.07] bg-[#0b0b0d] p-4">
              <h3 className="font-mono text-[9px] tracking-[0.16em] text-text-tertiary">{t.synopsis}</h3>
              <p className="mt-3 font-serif-cn text-sm leading-6 text-text-secondary">{controller.analysis.synopsis}</p>
            </article>
            <article className="rounded-xl border border-white/[0.07] bg-[#0b0b0d] p-4">
              <h3 className="font-mono text-[9px] tracking-[0.16em] text-text-tertiary">{t.worldDraft}</h3>
              <p className="mt-3 font-serif-cn text-sm leading-6 text-text-secondary">{controller.analysis.worldBible.projectPremise}</p>
              <p className="mt-3 text-xs leading-5 text-text-tertiary">{controller.analysis.worldBible.visualThesis}</p>
            </article>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-mono text-[9px] tracking-[0.16em] text-primary-400">{t.characters}</h3>
              <p className="mt-1 text-xs text-text-tertiary">
                {t.charactersSelected.replace('{selected}', String(controller.selectedCharacterCodes.length)).replace('{total}', String(controller.analysis.characters.length))}
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg border border-white/[0.08] px-3 py-2 text-[10px] text-text-secondary hover:border-primary-500/35 hover:text-white"
              onClick={() => controller.onSelectAllCharacters(!allSelected)}
            >
              {allSelected ? t.clearAll : t.selectAll}
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {controller.analysis.characters.map((character) => {
              const checked = controller.selectedCharacterCodes.includes(character.code)
              return (
                <button
                  key={character.code}
                  type="button"
                  onClick={() => controller.onToggleCharacter(character.code)}
                  className={`min-h-36 rounded-xl border p-4 text-left transition-colors ${checked ? 'border-primary-500/35 bg-primary-500/[0.06]' : 'border-white/[0.07] bg-[#0b0b0d] opacity-65'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{character.name}</div>
                      <div className="mt-1 font-mono text-[8px] tracking-[0.12em] text-text-tertiary">{character.code} · {character.entityType}</div>
                    </div>
                    <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${checked ? 'border-primary-400 bg-primary-500 text-white' : 'border-white/15'}`}>
                      {checked && <AppIcon name="check" className="h-3 w-3" />}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-text-secondary">{character.role}</p>
                  <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-text-tertiary">{character.coreTraits}</p>
                </button>
              )
            })}
          </div>

          {controller.analysis.locations.length > 0 && (
            <div className="mt-6">
              <h3 className="font-mono text-[9px] tracking-[0.16em] text-primary-400">{t.locations}</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {controller.analysis.locations.map((location) => (
                  <span key={location.name} className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2 text-[11px] text-text-secondary">
                    {location.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {controller.analysis.confidenceNotes.length > 0 && (
            <details className="mt-6 rounded-xl border border-white/[0.07] bg-[#0b0b0d] px-4 py-3">
              <summary className="cursor-pointer font-mono text-[9px] tracking-[0.14em] text-text-tertiary">{t.evidence}</summary>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-text-tertiary">
                {controller.analysis.confidenceNotes.map((note) => <li key={note}>— {note}</li>)}
              </ul>
            </details>
          )}

          <div className="mt-6 flex flex-col gap-4 rounded-xl border border-primary-500/20 bg-primary-500/[0.045] p-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex cursor-pointer items-start gap-3">
              <input type="checkbox" checked={controller.applyWorldBible} onChange={(event) => controller.onApplyWorldBibleChange(event.target.checked)} className="mt-0.5 accent-pink-500" />
              <span>
                <span className="block text-xs font-medium text-white">{t.applyWorld}</span>
                <span className="mt-1 block text-[11px] leading-5 text-text-tertiary">{t.applyWorldHint}</span>
              </span>
            </label>
            <button
              type="button"
              disabled={controller.isApplying || (!controller.applyWorldBible && controller.selectedCharacterCodes.length === 0)}
              onClick={controller.onApply}
              className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-500 px-5 text-xs font-semibold text-white hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <AppIcon name={controller.isApplying ? 'refresh' : 'badgeCheck'} className={`h-4 w-4 ${controller.isApplying ? 'animate-spin' : ''}`} />
              {controller.isApplying ? t.applying : t.apply}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
