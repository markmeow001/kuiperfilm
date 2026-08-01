'use client'

import { useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import {
  RESEARCH_EDITABLE_FIELDS,
  RESEARCH_REFERENCE_CATEGORIES,
  type ResearchReferenceCategory,
  type ResearchRightsStatus,
} from '@/lib/visual-development/research'
import { VisualDevelopmentImage } from './VisualDevelopmentImage'
import type {
  ResearchFormState,
  ResearchReferenceMetadata,
  ResearchReferenceView,
  ResearchWorkspaceController,
} from './visual-development-types'

export interface ResearchTranslations {
  ledger: string
  ledgerDescription: string
  statusDraft: string
  statusLocked: string
  worldAlreadyLocked: string
  designQuestion: string
  visualHypothesis: string
  eraAndCulture: string
  materialReality: string
  cinematicLanguage: string
  culturalBoundaries: string
  assumptionsAndUnknowns: string
  sourcePolicy: string
  save: string
  saving: string
  intake: string
  intakeDescription: string
  file: string
  category: string
  usage: string
  use: string
  avoid: string
  creator: string
  sourceUrl: string
  rightsStatus: string
  license: string
  note: string
  externalProcessing: string
  externalProcessingHint: string
  downstreamReference: string
  downstreamReferenceHint: string
  upload: string
  uploading: string
  fileRequired: string
  evidence: string
  evidenceDescription: string
  emptyEvidence: string
  approve: string
  approved: string
  reject: string
  rejected: string
  pending: string
  remove: string
  rejectionPrompt: string
  categories: Record<ResearchReferenceCategory, string>
  rights: Record<ResearchRightsStatus, string>
  gateTitle: string
  gateDescription: string
  fieldsComplete: string
  categoriesComplete: string
  reviewsComplete: string
  provenanceComplete: string
  processingComplete: string
  lock: string
  locked: string
  version: string
}

interface ResearchWorkspaceProps {
  controller: ResearchWorkspaceController
  translations: ResearchTranslations
}

const DEFAULT_METADATA: ResearchReferenceMetadata = {
  category: 'casting-face',
  usage: 'use',
  note: '',
  sourceUrl: '',
  creator: '',
  license: '',
  rightsStatus: 'editorial-reference',
  externalProcessingAllowed: false,
  downstreamEnabled: false,
}

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function ResearchWorkspace({ controller, translations }: ResearchWorkspaceProps) {
  const [file, setFile] = useState<File | null>(null)
  const [metadata, setMetadata] = useState<ResearchReferenceMetadata>(DEFAULT_METADATA)
  const isLocked = controller.status === 'locked'
  const isBlockedByWorld = controller.worldStatus === 'world_locked' && !isLocked
  const disabled = isLocked || isBlockedByWorld
  const categoryCounts = useMemo(() => Object.fromEntries(RESEARCH_REFERENCE_CATEGORIES.map((category) => [
    category,
    controller.references.filter((reference) => (
      reference.category === category
      && reference.usage === 'use'
      && reference.reviewStatus === 'approved'
    )).length,
  ])) as Record<ResearchReferenceCategory, number>, [controller.references])

  const submitReference = () => {
    if (!file) {
      window.alert(translations.fileRequired)
      return
    }
    controller.onUploadReference(file, metadata)
    setFile(null)
    setMetadata(DEFAULT_METADATA)
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
        <div className="grid border-b border-white/[0.07] lg:grid-cols-[1fr_280px]">
          <div className="p-5">
            <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">
              <AppIcon name="search" className="h-3.5 w-3.5" />
              {translations.ledger}
            </div>
            <p className="mt-2 max-w-3xl font-serif-cn text-xs leading-5 text-text-secondary">
              {translations.ledgerDescription}
            </p>
          </div>
          <div className="border-t border-white/[0.07] bg-[#0d0d10] p-5 lg:border-l lg:border-t-0">
            <div className="font-mono text-[8px] tracking-[0.16em] text-text-tertiary">RESEARCH CANON</div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className={`rounded-full border px-2.5 py-1 font-mono text-[8px] ${isLocked ? 'border-primary-500/30 bg-primary-500/[0.1] text-primary-400' : 'border-white/[0.08] text-text-tertiary'}`}>
                {isLocked ? translations.statusLocked : translations.statusDraft}
              </span>
              <span className="font-mono text-[8px] text-text-tertiary">{translations.version} {controller.version}</span>
            </div>
            {controller.canonId && <p className="mt-3 truncate font-mono text-[8px] text-white">{controller.canonId}</p>}
          </div>
        </div>

        {isBlockedByWorld && (
          <div className="mx-5 mt-5 flex items-start gap-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-100/75">
            <AppIcon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            {translations.worldAlreadyLocked}
          </div>
        )}

        <div className="grid gap-3 p-5 lg:grid-cols-2">
          <ResearchField field="designQuestion" label={translations.designQuestion} controller={controller} disabled={disabled} />
          <ResearchField field="visualHypothesis" label={translations.visualHypothesis} controller={controller} disabled={disabled} />
          <ResearchField field="eraAndCulture" label={translations.eraAndCulture} controller={controller} disabled={disabled} />
          <ResearchField field="materialReality" label={translations.materialReality} controller={controller} disabled={disabled} />
          <ResearchField field="cinematicLanguage" label={translations.cinematicLanguage} controller={controller} disabled={disabled} />
          <ResearchField field="culturalBoundaries" label={translations.culturalBoundaries} controller={controller} disabled={disabled} />
          <ResearchField field="assumptionsAndUnknowns" label={translations.assumptionsAndUnknowns} controller={controller} disabled={disabled} />
          <ResearchField field="sourcePolicy" label={translations.sourcePolicy} controller={controller} disabled={disabled} />
        </div>
        <div className="flex justify-end border-t border-white/[0.07] px-5 py-3">
          <button type="button" disabled={disabled || controller.isSaving || controller.isLoading} onClick={controller.onSave} className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 text-[10px] text-white transition-colors hover:border-white/[0.18] disabled:cursor-not-allowed disabled:opacity-35">
            <AppIcon name="bookmark" className="h-3.5 w-3.5 text-primary-400" />
            {controller.isSaving ? translations.saving : translations.save}
          </button>
        </div>
      </section>

      <section className="grid overflow-hidden rounded-2xl border border-white/[0.08] bg-raised xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="border-b border-white/[0.07] p-5 xl:border-b-0 xl:border-r">
          <div className="font-mono text-[9px] tracking-[0.18em] text-primary-400">{translations.intake}</div>
          <p className="mt-2 font-serif-cn text-xs leading-5 text-text-secondary">{translations.intakeDescription}</p>
          <div className="mt-5 space-y-3">
            <label className="block">
              <span className="mb-1.5 block font-mono text-[8px] tracking-[0.13em] text-text-tertiary">{translations.file}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || controller.isUploading} onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block w-full rounded-xl border border-dashed border-white/[0.12] bg-[#0d0d10] px-3 py-3 text-[9px] text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-primary-500/[0.12] file:px-2 file:py-1 file:text-[9px] file:text-primary-400 disabled:opacity-35" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <ResearchSelect label={translations.category} value={metadata.category} disabled={disabled} onChange={(value) => setMetadata((current) => ({ ...current, category: value as ResearchReferenceCategory }))} options={RESEARCH_REFERENCE_CATEGORIES.map((value) => ({ value, label: translations.categories[value] }))} />
              <ResearchSelect label={translations.usage} value={metadata.usage} disabled={disabled} onChange={(value) => setMetadata((current) => ({
                ...current,
                usage: value as 'use' | 'avoid',
                downstreamEnabled: value === 'use' ? current.downstreamEnabled : false,
              }))} options={[{ value: 'use', label: translations.use }, { value: 'avoid', label: translations.avoid }]} />
            </div>
            <ResearchInput label={translations.creator} value={metadata.creator} disabled={disabled} onChange={(value) => setMetadata((current) => ({ ...current, creator: value }))} />
            <ResearchInput label={translations.sourceUrl} value={metadata.sourceUrl} disabled={disabled} onChange={(value) => setMetadata((current) => ({ ...current, sourceUrl: value }))} />
            <ResearchSelect label={translations.rightsStatus} value={metadata.rightsStatus} disabled={disabled} onChange={(value) => setMetadata((current) => {
              const rightsStatus = value as ResearchRightsStatus
              const canProcessExternally = rightsStatus === 'owned' || rightsStatus === 'licensed' || rightsStatus === 'public-domain'
              return {
                ...current,
                rightsStatus,
                externalProcessingAllowed: canProcessExternally ? current.externalProcessingAllowed : false,
                downstreamEnabled: canProcessExternally ? current.downstreamEnabled : false,
              }
            })} options={Object.entries(translations.rights).map(([value, label]) => ({ value, label }))} />
            <ResearchInput label={translations.license} value={metadata.license} disabled={disabled} onChange={(value) => setMetadata((current) => ({ ...current, license: value }))} />
            <ResearchCheckbox
              label={translations.externalProcessing}
              hint={translations.externalProcessingHint}
              checked={metadata.externalProcessingAllowed}
              disabled={disabled || metadata.rightsStatus === 'editorial-reference' || metadata.rightsStatus === 'unknown'}
              onChange={(checked) => setMetadata((current) => ({
                ...current,
                externalProcessingAllowed: checked,
                downstreamEnabled: checked ? current.downstreamEnabled : false,
              }))}
            />
            <ResearchCheckbox
              label={translations.downstreamReference}
              hint={translations.downstreamReferenceHint}
              checked={metadata.downstreamEnabled}
              disabled={disabled || metadata.usage !== 'use' || !metadata.externalProcessingAllowed}
              onChange={(checked) => setMetadata((current) => ({ ...current, downstreamEnabled: checked }))}
            />
            <label className="block">
              <span className="mb-1.5 block font-mono text-[8px] tracking-[0.13em] text-text-tertiary">{translations.note}</span>
              <textarea rows={3} value={metadata.note} disabled={disabled} onChange={(event) => setMetadata((current) => ({ ...current, note: event.target.value }))} className="w-full resize-y rounded-xl border border-white/[0.08] bg-[#0d0d10] px-3 py-2 text-xs text-white outline-none focus:border-primary-500/50 disabled:opacity-35" />
            </label>
            <button type="button" disabled={disabled || !file || controller.isUploading} onClick={submitReference} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary-500 text-[10px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35">
              <AppIcon name="upload" className="h-3.5 w-3.5" />
              {controller.isUploading ? translations.uploading : translations.upload}
            </button>
          </div>
        </div>

        <div className="min-w-0 p-5">
          <div className="font-mono text-[9px] tracking-[0.18em] text-primary-400">{translations.evidence}</div>
          <p className="mt-2 font-serif-cn text-xs leading-5 text-text-secondary">{translations.evidenceDescription}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {RESEARCH_REFERENCE_CATEGORIES.map((category) => (
              <div key={category} className={`rounded-xl border px-3 py-2 ${categoryCounts[category] > 0 ? 'border-primary-500/25 bg-primary-500/[0.05]' : 'border-white/[0.07] bg-[#0d0d10]'}`}>
                <p className="font-mono text-[8px] text-text-tertiary">{translations.categories[category]}</p>
                <p className="mt-1 text-lg font-semibold text-white">{categoryCounts[category]}</p>
              </div>
            ))}
          </div>
          {controller.references.length === 0 ? (
            <div className="mt-4 flex min-h-64 items-center justify-center rounded-xl border border-dashed border-white/[0.1] bg-[#0d0d10] font-mono text-[8px] tracking-[0.15em] text-text-tertiary">{translations.emptyEvidence}</div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
              {controller.references.map((reference) => (
                <ResearchReferenceCard key={reference.id} reference={reference} disabled={disabled} controller={controller} translations={translations} />
              ))}
            </div>
          )}
        </div>
      </section>

      <ResearchGate controller={controller} translations={translations} disabled={disabled} />
    </div>
  )
}

function ResearchField({ field, label, controller, disabled }: { field: keyof ResearchFormState; label: string; controller: ResearchWorkspaceController; disabled: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[8px] tracking-[0.13em] text-text-tertiary">{label}</span>
      <textarea rows={3} value={controller.form[field]} disabled={disabled} onChange={(event) => controller.onFieldChange(field, event.target.value)} className="w-full resize-y rounded-xl border border-white/[0.08] bg-[#0d0d10] px-3 py-2.5 text-xs leading-5 text-white outline-none focus:border-primary-500/50 disabled:cursor-not-allowed disabled:opacity-45" />
    </label>
  )
}

function ResearchInput({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[8px] tracking-[0.13em] text-text-tertiary">{label}</span>
      <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-xl border border-white/[0.08] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50 disabled:opacity-35" />
    </label>
  )
}

function ResearchSelect({ label, value, disabled, onChange, options }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block font-mono text-[8px] tracking-[0.13em] text-text-tertiary">{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-9 w-full min-w-0 rounded-xl border border-white/[0.08] bg-[#0d0d10] px-2 text-[10px] text-white outline-none focus:border-primary-500/50 disabled:opacity-35">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function ResearchCheckbox({ label, hint, checked, disabled, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={`flex gap-3 rounded-xl border border-white/[0.08] bg-[#0d0d10] p-3 ${disabled ? 'opacity-45' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-primary-500" />
      <span className="min-w-0">
        <span className="block text-[10px] text-white">{label}</span>
        <span className="mt-1 block text-[8px] leading-4 text-text-tertiary">{hint}</span>
      </span>
    </label>
  )
}

function ResearchReferenceCard({ reference, disabled, controller, translations }: { reference: ResearchReferenceView; disabled: boolean; controller: ResearchWorkspaceController; translations: ResearchTranslations }) {
  const sourceUrl = safeSourceUrl(reference.sourceUrl)
  const statusTone = reference.reviewStatus === 'approved'
    ? 'border-primary-500/35 text-primary-400'
    : reference.reviewStatus === 'rejected'
      ? 'border-red-400/25 text-red-300'
      : 'border-amber-300/20 text-amber-200/70'
  return (
    <article className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d0d10]">
      <div className="relative aspect-[4/3] bg-black/30">
        {reference.previewUrl && <VisualDevelopmentImage src={reference.previewUrl} alt={reference.name} />}
        <span className={`absolute left-2 top-2 rounded-md border bg-black/65 px-2 py-1 font-mono text-[8px] ${reference.usage === 'use' ? 'border-primary-500/25 text-primary-400' : 'border-red-400/25 text-red-300'}`}>
          {reference.usage === 'use' ? translations.use : translations.avoid}
        </span>
        <span className={`absolute right-2 top-2 rounded-md border bg-black/65 px-2 py-1 font-mono text-[8px] ${statusTone}`}>
          {reference.reviewStatus === 'approved' ? translations.approved : reference.reviewStatus === 'rejected' ? translations.rejected : translations.pending}
        </span>
      </div>
      <div className="p-3">
        <p className="truncate text-xs font-medium text-white">{reference.name}</p>
        <p className="mt-1 font-mono text-[8px] text-primary-400">{translations.categories[reference.category]}</p>
        <p className="mt-2 line-clamp-3 text-[9px] leading-4 text-text-secondary">{reference.note || '—'}</p>
        <div className="mt-3 space-y-1 border-t border-white/[0.06] pt-2 font-mono text-[8px] text-text-tertiary">
          <p className="truncate">{reference.creator || 'CREATOR —'}</p>
          <p className="truncate">{translations.rights[reference.rightsStatus]}{reference.license ? ` · ${reference.license}` : ''}</p>
          {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-primary-400 hover:text-primary-300"><AppIcon name="externalLink" className="h-3 w-3 shrink-0" /><span className="truncate">SOURCE</span></a>}
        </div>
        {reference.rejectionNote && <p className="mt-2 text-[9px] leading-4 text-red-300/75">{reference.rejectionNote}</p>}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" disabled={disabled} onClick={() => controller.onReviewReference(reference.id, true)} className="rounded-md bg-primary-500/[0.1] px-2 py-1 text-[8px] text-primary-400 disabled:opacity-35">{translations.approve}</button>
          <button type="button" disabled={disabled} onClick={() => {
            const note = window.prompt(translations.rejectionPrompt, reference.rejectionNote ?? '')
            if (note?.trim()) controller.onReviewReference(reference.id, false, note.trim())
          }} className="rounded-md bg-white/[0.05] px-2 py-1 text-[8px] text-text-tertiary disabled:opacity-35">{translations.reject}</button>
          <button type="button" disabled={disabled} onClick={() => controller.onRemoveReference(reference.id)} className="ml-auto rounded-md px-2 py-1 text-[8px] text-red-300/65 hover:bg-red-400/[0.06] disabled:opacity-35"><AppIcon name="trash" className="h-3 w-3" /></button>
        </div>
        <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
          <ResearchCheckbox
            label={translations.externalProcessing}
            hint={translations.externalProcessingHint}
            checked={reference.externalProcessingAllowed}
            disabled={disabled || reference.rightsStatus === 'editorial-reference' || reference.rightsStatus === 'unknown'}
            onChange={(checked) => controller.onSetReferenceProcessing(reference.id, checked, checked ? reference.downstreamEnabled : false)}
          />
          <ResearchCheckbox
            label={translations.downstreamReference}
            hint={translations.downstreamReferenceHint}
            checked={reference.downstreamEnabled}
            disabled={disabled || reference.usage !== 'use' || !reference.externalProcessingAllowed}
            onChange={(checked) => controller.onSetReferenceProcessing(reference.id, reference.externalProcessingAllowed, checked)}
          />
        </div>
      </div>
    </article>
  )
}

function ResearchGate({ controller, translations, disabled }: { controller: ResearchWorkspaceController; translations: ResearchTranslations; disabled: boolean }) {
  const localFieldsComplete = RESEARCH_EDITABLE_FIELDS.every((field) => controller.form[field].trim().length > 0)
  const checks = [
    { label: translations.fieldsComplete, ready: controller.gate.missingFields.length === 0 },
    { label: translations.categoriesComplete, ready: controller.gate.missingCategories.length === 0 },
    { label: translations.reviewsComplete, ready: controller.gate.pendingReferenceIds.length === 0 && controller.references.length > 0 },
    { label: translations.provenanceComplete, ready: controller.gate.untraceableReferenceIds.length === 0 && controller.references.some((reference) => reference.reviewStatus === 'approved') },
    { label: translations.processingComplete, ready: controller.gate.blockedExternalReferenceIds.length === 0 && controller.gate.excessDownstreamReferenceIds.length === 0 && controller.gate.missingConstraintNoteReferenceIds.length === 0 },
  ]
  const isLocked = controller.status === 'locked'
  return (
    <section className="rounded-2xl border border-primary-500/20 bg-primary-500/[0.045] p-5">
      <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400"><AppIcon name="lock" className="h-3.5 w-3.5" />{translations.gateTitle}</div>
      <p className="mt-3 font-serif-cn text-xs leading-5 text-text-secondary">{translations.gateDescription}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {checks.map((check) => (
          <div key={check.label} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[9px] ${check.ready ? 'border-primary-500/20 bg-primary-500/[0.05] text-primary-300' : 'border-white/[0.07] bg-[#0d0d10] text-text-tertiary'}`}>
            <AppIcon name={check.ready ? 'circleCheck' : 'alert'} className="h-3.5 w-3.5 shrink-0" />
            {check.label}
          </div>
        ))}
      </div>
      <button type="button" disabled={disabled || !localFieldsComplete || !controller.gate.ready} onClick={controller.onLock} className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-primary-500/25 bg-primary-500/[0.08] text-[10px] text-primary-400 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.03] disabled:text-text-tertiary disabled:opacity-45">
        <AppIcon name="badgeCheck" className="h-4 w-4" />
        {isLocked ? translations.locked : translations.lock}
      </button>
    </section>
  )
}

export const RESEARCH_FIELD_COUNT = RESEARCH_EDITABLE_FIELDS.length
