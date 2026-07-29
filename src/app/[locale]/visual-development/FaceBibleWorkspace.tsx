import { AppIcon } from '@/components/ui/icons'
import type { FaceBibleWorkspaceController } from './visual-development-types'
import { visualDevelopmentDownloadHref } from './visual-development-download'
import { VisualDevelopmentImage } from './VisualDevelopmentImage'

export interface FaceBibleTranslations {
  canonSource: string
  canonRequired: string
  identityRecord: string
  identityAnchors: string
  allowedVariation: string
  forbiddenDrift: string
  modelBinding: string
  referenceOnly: string
  modelRequired: string
  resolution: string
  aspectRatio: string
  generate: string
  generating: string
  waiting: string
  approve: string
  approved: string
  reject: string
  rejectionPrompt: string
  lock: string
  locked: string
  lockHint: string
  modelHint: string
  seedUnsupported: string
}

interface FaceBibleWorkspaceProps {
  controller: FaceBibleWorkspaceController
  translations: FaceBibleTranslations
}

const PLACEHOLDER_CODES = [
  'VIEW-L3Q',
  'VIEW-R3Q',
  'VIEW-LPROFILE',
  'VIEW-RPROFILE',
  'VIEW-LOW',
  'EXPR-RESTRAINED',
  'EXPR-FEAR',
  'EXPR-GRIEF',
  'EXPR-DETERMINED',
  'DETAIL-SKIN',
] as const

export function FaceBibleWorkspace({ controller, translations }: FaceBibleWorkspaceProps) {
  const selectedModel = controller.imageModels.find((model) => model.value === controller.form.modelKey)
  const resolutions = selectedModel?.capabilities?.image?.resolutionOptions ?? []
  const ratios = selectedModel?.capabilities?.image?.aspectRatioOptions ?? ['3:4']
  const candidates = controller.batch?.candidates ?? PLACEHOLDER_CODES.map((code, index) => ({
    id: `face-pending-${index}`,
    code,
    taskStatus: 'pending',
    progress: 0,
    resultUrl: null,
    requestedSeed: null,
    seedStatus: 'pending',
    shortlisted: false,
    isCanon: false,
    errorMessage: null,
    rejectionNote: null,
  }))
  const canLock = Boolean(
    controller.batch
    && controller.batch.status !== 'canon_locked'
    && candidates.length === PLACEHOLDER_CODES.length
    && candidates.every((candidate) => candidate.resultUrl && candidate.shortlisted),
  )

  if (!controller.canonCandidate) {
    return (
      <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-8 text-center">
        <AppIcon name="lock" className="mx-auto h-6 w-6 text-amber-300" />
        <h3 className="mt-4 font-serif-cn text-base font-semibold text-white">{translations.canonRequired}</h3>
        <p className="mx-auto mt-2 max-w-xl font-serif-cn text-xs leading-5 text-text-secondary">
          {translations.lockHint}
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-4 rounded-2xl border border-white/[0.08] bg-raised p-4 lg:grid-cols-[180px_minmax(0,1fr)]">
        <div>
          <div className="mb-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">{translations.canonSource}</div>
          <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-primary-500/30 bg-[#101013]">
            {controller.canonCandidate.resultUrl && (
              <VisualDevelopmentImage src={controller.canonCandidate.resultUrl} alt="Canon identity" />
            )}
            <span className="absolute right-2 top-2 rounded-md bg-primary-500 px-2 py-1 font-mono text-[8px] font-semibold text-black">CANON</span>
          </div>
          <p className="mt-2 truncate font-mono text-[8px] text-text-tertiary">
            {controller.characterCode} · {controller.canonCandidate.code}
          </p>
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">
            <AppIcon name="brain" className="h-3.5 w-3.5" />
            {translations.identityRecord}
          </div>
          <div className="grid gap-3">
            <FaceField label={translations.identityAnchors} value={controller.form.identityAnchors} onChange={(value) => controller.onFieldChange('identityAnchors', value)} rows={3} />
            <div className="grid gap-3 md:grid-cols-2">
              <FaceField label={translations.allowedVariation} value={controller.form.allowedVariation} onChange={(value) => controller.onFieldChange('allowedVariation', value)} rows={2} />
              <FaceField label={translations.forbiddenDrift} value={controller.form.forbiddenDrift} onChange={(value) => controller.onFieldChange('forbiddenDrift', value)} rows={2} />
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
        <div className="flex flex-col gap-4 border-b border-white/[0.07] p-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9px] tracking-[0.18em] text-text-tertiary">{translations.modelBinding}</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_110px_110px]">
              <select value={controller.form.modelKey} onChange={(event) => controller.onFieldChange('modelKey', event.target.value)} className="h-10 min-w-0 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50">
                <option value="">{translations.modelRequired}</option>
                {controller.imageModels.map((model) => (
                  <option key={model.value} value={model.value}>{model.label} · {model.providerName ?? model.provider}</option>
                ))}
              </select>
              <select value={controller.form.resolution} onChange={(event) => controller.onFieldChange('resolution', event.target.value)} className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50">
                <option value="">{translations.resolution}</option>
                {resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
              </select>
              <select value={controller.form.aspectRatio} onChange={(event) => controller.onFieldChange('aspectRatio', event.target.value)} className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50">
                {ratios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
              </select>
            </div>
            <p className="mt-2 font-serif-cn text-[10px] leading-4 text-text-tertiary">
              {translations.referenceOnly} · {translations.modelHint}
            </p>
          </div>
          <button type="button" disabled={controller.isGenerating || controller.isLoading || !controller.form.modelKey || !controller.form.identityAnchors || !controller.form.forbiddenDrift} onClick={controller.onGenerate} className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary-500 px-3 text-[10px] font-semibold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-35">
            <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
            {controller.isGenerating ? translations.generating : translations.generate}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-px bg-white/[0.07] sm:grid-cols-3 2xl:grid-cols-5">
          {candidates.map((candidate) => (
            <article key={candidate.id} className="bg-[#0b0b0d] p-2.5">
              <div className={`relative aspect-[3/4] overflow-hidden rounded-xl border bg-[#101013] ${candidate.shortlisted ? 'border-primary-500/60' : 'border-white/[0.07]'}`}>
                {candidate.resultUrl ? (
                  <VisualDevelopmentImage src={candidate.resultUrl} alt={candidate.code} />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary">
                    <AppIcon name="user" className="h-5 w-5 opacity-55" />
                    <span className="font-mono text-[8px] tracking-[0.12em]">{candidate.taskStatus === 'pending' ? translations.waiting : `${candidate.taskStatus} ${candidate.progress}%`}</span>
                  </div>
                )}
                <span className="absolute left-2 top-2 rounded-md border border-white/[0.08] bg-black/60 px-1.5 py-1 font-mono text-[7px] text-white backdrop-blur">{candidate.code}</span>
                {candidate.shortlisted && <span className="absolute right-2 top-2 rounded-md bg-primary-500 px-1.5 py-1 font-mono text-[7px] font-semibold text-black">APPROVED</span>}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[7px] text-text-tertiary">
                  {candidate.seedStatus === 'applied' ? `SEED ${candidate.requestedSeed}` : translations.seedUnsupported}
                </span>
                {candidate.resultUrl && (
                  <div className="flex gap-1">
                    <a href={visualDevelopmentDownloadHref(candidate.resultUrl, `${controller.characterCode}-face-${candidate.code}`)} aria-label={`Download ${candidate.code}`} className="rounded bg-white/[0.05] p-1 text-text-tertiary hover:text-white"><AppIcon name="download" className="h-3 w-3" /></a>
                    <button type="button" onClick={() => controller.onReview(candidate.id, true)} className={`rounded px-1.5 py-1 text-[8px] ${candidate.shortlisted ? 'bg-primary-500/[0.16] text-primary-400' : 'bg-white/[0.05] text-text-tertiary'}`}>{candidate.shortlisted ? translations.approved : translations.approve}</button>
                    <button type="button" onClick={() => {
                      const note = window.prompt(translations.rejectionPrompt, candidate.rejectionNote ?? '')
                      if (note?.trim()) controller.onReview(candidate.id, false, note.trim())
                    }} className="rounded bg-white/[0.05] px-1.5 py-1 text-[8px] text-text-tertiary">{translations.reject}</button>
                  </div>
                )}
              </div>
              {candidate.errorMessage && <p className="mt-1 line-clamp-2 text-[8px] text-red-300">{candidate.errorMessage}</p>}
              {candidate.rejectionNote && !candidate.shortlisted && <p className="mt-1 line-clamp-2 text-[8px] text-amber-200/70">{candidate.rejectionNote}</p>}
            </article>
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-white/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-serif-cn text-[10px] leading-4 text-text-tertiary">{translations.lockHint}</p>
          <button type="button" disabled={!canLock || controller.characterStatus === 'face_locked'} onClick={controller.onLock} className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-primary-500/30 bg-primary-500/[0.1] px-4 text-[10px] font-medium text-primary-400 disabled:cursor-not-allowed disabled:opacity-35">
            <AppIcon name="badgeCheck" className="h-3.5 w-3.5" />
            {controller.characterStatus === 'face_locked' || controller.batch?.status === 'canon_locked' ? translations.locked : translations.lock}
          </button>
        </div>
      </section>
    </div>
  )
}

function FaceField({ label, value, onChange, rows }: { label: string; value: string; onChange: (value: string) => void; rows: number }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[8px] tracking-[0.13em] text-text-tertiary">{label}</span>
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} className="w-full resize-y rounded-xl border border-white/[0.08] bg-[#0d0d10] px-3 py-2.5 text-xs text-white outline-none placeholder:text-text-tertiary focus:border-primary-500/50" />
    </label>
  )
}
