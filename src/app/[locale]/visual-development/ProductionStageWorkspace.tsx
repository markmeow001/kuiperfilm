import { AppIcon } from '@/components/ui/icons'
import { getVisualDevelopmentAspectRatios } from '@/lib/visual-development/model-options'
import type { ProductionFieldId } from '@/lib/visual-development/production-stages'
import type { CastingCandidateView, ProductionStageWorkspaceController } from './visual-development-types'
import { visualDevelopmentDownloadHref } from './visual-development-download'
import { VisualDevelopmentImage } from './VisualDevelopmentImage'

export interface ProductionStageTranslations {
  prerequisite: string
  prerequisiteHint: string
  designRecord: string
  modelBinding: string
  imageModelRequired: string
  videoModelRequired: string
  modelHint: string
  resolution: string
  aspectRatio: string
  duration: string
  generate: string
  generating: string
  outputs: string
  outputsDescription: string
  waiting: string
  approve: string
  approved: string
  reject: string
  rejectionPrompt: string
  primary: string
  makePrimary: string
  seedUnsupported: string
  lock: string
  locked: string
  lockHint: string
  fields: Record<ProductionFieldId, string>
}

interface ProductionStageWorkspaceProps {
  controller: ProductionStageWorkspaceController
  translations: ProductionStageTranslations
}

export function ProductionStageWorkspace({ controller, translations }: ProductionStageWorkspaceProps) {
  const selectedModel = controller.models.find((model) => model.value === controller.form.modelKey)
  const resolutions = controller.stage.mediaType === 'video'
    ? selectedModel?.capabilities?.video?.resolutionOptions ?? []
    : selectedModel?.capabilities?.image?.resolutionOptions ?? []
  const ratios = selectedModel
    ? getVisualDevelopmentAspectRatios(selectedModel.capabilities, controller.stage.mediaType)
    : []
  const durations = selectedModel?.capabilities?.video?.durationOptions ?? []
  const candidates = controller.batch?.candidates ?? placeholders(controller)
  const fieldsReady = controller.stage.fields.every((field) => controller.form.stageRecord[field]?.trim())
  const canGenerate = controller.prerequisiteReady
    && Boolean(controller.form.modelKey)
    && Boolean(controller.form.aspectRatio)
    && fieldsReady
  const canLock = Boolean(
    controller.batch
    && controller.batch.status !== 'canon_locked'
    && candidates.length === controller.stage.variants.length
    && candidates.every((candidate) => candidate.resultUrl && candidate.shortlisted)
    && candidates.some((candidate) => candidate.isCanon),
  )

  if (!controller.prerequisiteReady) {
    return (
      <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-8 text-center">
        <AppIcon name="lock" className="mx-auto h-6 w-6 text-amber-300" />
        <h3 className="mt-4 font-serif-cn text-base font-semibold text-white">{translations.prerequisite}</h3>
        <p className="mx-auto mt-2 max-w-xl font-serif-cn text-xs leading-5 text-text-secondary">{translations.prerequisiteHint}</p>
        <p className="mt-3 font-mono text-[9px] text-amber-200/70">REQUIRED · {controller.stage.prerequisiteStatus}</p>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/[0.08] bg-raised p-4">
        <div className="mb-3 flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">
          <AppIcon name="imageEdit" className="h-3.5 w-3.5" />
          {translations.designRecord}
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {controller.stage.fields.map((field) => (
            <label key={field} className="block">
              <span className="mb-1.5 block text-[10px] text-text-secondary">{translations.fields[field]}</span>
              <textarea value={controller.form.stageRecord[field]} onChange={(event) => controller.onRecordChange(field, event.target.value)} rows={4} className="w-full resize-none rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 py-2.5 font-serif-cn text-xs leading-5 text-white outline-none focus:border-primary-500/50" />
            </label>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
        <div className="flex flex-col gap-4 border-b border-white/[0.07] p-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9px] tracking-[0.18em] text-text-tertiary">{translations.modelBinding}</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_110px_100px_100px]">
              <select value={controller.form.modelKey} onChange={(event) => controller.onSettingChange('modelKey', event.target.value)} className="h-10 min-w-0 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50">
                <option value="">{controller.stage.mediaType === 'video' ? translations.videoModelRequired : translations.imageModelRequired}</option>
                {controller.models.map((model) => <option key={model.value} value={model.value}>{model.label} · {model.providerName ?? model.provider}</option>)}
              </select>
              <select value={controller.form.resolution} onChange={(event) => controller.onSettingChange('resolution', event.target.value)} className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50">
                <option value="">{translations.resolution}</option>
                {resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
              </select>
              <select value={controller.form.aspectRatio} onChange={(event) => controller.onSettingChange('aspectRatio', event.target.value)} className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50">
                <option value="">{translations.aspectRatio}</option>
                {ratios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
              </select>
              {controller.stage.mediaType === 'video' ? (
                <select value={controller.form.duration} onChange={(event) => controller.onSettingChange('duration', Number(event.target.value))} className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50">
                  {(durations.length ? durations : [5]).map((duration) => <option key={duration} value={duration}>{duration}s</option>)}
                </select>
              ) : <div className="hidden sm:block" />}
            </div>
            <p className="mt-2 font-serif-cn text-[10px] leading-4 text-text-tertiary">{translations.modelHint}</p>
          </div>
          <button type="button" disabled={!canGenerate || controller.isGenerating || controller.isLoading} onClick={controller.onGenerate} className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 text-[10px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35">
            <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
            {controller.isGenerating ? translations.generating : translations.generate}
          </button>
        </div>
        <div className="border-b border-white/[0.07] px-4 py-3">
          <div className="font-mono text-[9px] tracking-[0.18em] text-primary-400">{translations.outputs}</div>
          <p className="mt-1 font-serif-cn text-[10px] leading-4 text-text-tertiary">{translations.outputsDescription}</p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-white/[0.07] xl:grid-cols-4">
          {orderedCandidates(controller, candidates).map((candidate) => (
            <ProductionCandidate key={candidate.id} candidate={candidate} mediaType={controller.stage.mediaType} translations={translations} onReview={controller.onReview} onSelectPrimary={controller.onSelectPrimary} />
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-white/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl font-serif-cn text-[10px] leading-4 text-text-tertiary">{translations.lockHint}</p>
          <button type="button" disabled={!canLock} onClick={controller.onLock} className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-primary-500/35 bg-primary-500/[0.1] px-3 text-[10px] font-semibold text-primary-300 disabled:cursor-not-allowed disabled:opacity-35">
            <AppIcon name="badgeCheck" className="h-3.5 w-3.5" />
            {controller.batch?.status === 'canon_locked' ? translations.locked : translations.lock}
          </button>
        </div>
      </section>
    </div>
  )
}

function placeholders(controller: ProductionStageWorkspaceController): CastingCandidateView[] {
  return controller.stage.variants.map((variant, index) => ({ id: `phase-${controller.stage.phase}-${index}`, code: variant.code, taskStatus: 'pending', progress: 0, resultUrl: null, requestedSeed: null, seedStatus: 'pending', shortlisted: false, isCanon: false, errorMessage: null, rejectionNote: null }))
}

function orderedCandidates(controller: ProductionStageWorkspaceController, candidates: CastingCandidateView[]) {
  return controller.stage.variants.map((variant) => candidates.find((candidate) => candidate.code === variant.code)).filter((candidate): candidate is CastingCandidateView => Boolean(candidate))
}

function ProductionCandidate({ candidate, mediaType, translations, onReview, onSelectPrimary }: { candidate: CastingCandidateView; mediaType: 'image' | 'video'; translations: ProductionStageTranslations; onReview: (id: string, approved: boolean, note?: string) => void; onSelectPrimary: (id: string) => void }) {
  return (
    <article className="min-w-0 bg-[#0c0c0f]">
      <div className="relative aspect-[3/4] overflow-hidden bg-[#111116]">
        {candidate.resultUrl ? mediaType === 'video' ? <video src={candidate.resultUrl} controls playsInline className="h-full w-full object-cover" /> : <VisualDevelopmentImage src={candidate.resultUrl} alt={candidate.code} /> : (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center"><AppIcon name={mediaType === 'video' ? 'video' : 'image'} className="h-5 w-5 text-text-tertiary" /><span className="mt-3 font-mono text-[8px] text-text-tertiary">{candidate.taskStatus === 'processing' ? `${candidate.progress}%` : translations.waiting}</span></div>
        )}
        {candidate.isCanon && <span className="absolute left-2 top-2 rounded bg-primary-500 px-1.5 py-1 font-mono text-[7px] text-black">{translations.primary}</span>}
      </div>
      <div className="space-y-2 p-3">
        <div className="truncate font-mono text-[8px] tracking-[0.1em] text-white">{candidate.code}</div>
        <div className="font-mono text-[7px] text-text-tertiary">{candidate.requestedSeed ? `SEED ${candidate.requestedSeed}` : translations.seedUnsupported}</div>
        {candidate.resultUrl && <div className="flex flex-wrap gap-1">
          <a href={visualDevelopmentDownloadHref(candidate.resultUrl, `${mediaType}-${candidate.code}`)} aria-label={`Download ${candidate.code}`} className="rounded bg-white/[0.05] p-1 text-text-tertiary hover:text-white"><AppIcon name="download" className="h-3 w-3" /></a>
          <button type="button" onClick={() => onReview(candidate.id, true)} className={`rounded px-1.5 py-1 text-[8px] ${candidate.shortlisted ? 'bg-primary-500/[0.16] text-primary-400' : 'bg-white/[0.05] text-text-tertiary'}`}>{candidate.shortlisted ? translations.approved : translations.approve}</button>
          <button type="button" onClick={() => { const note = window.prompt(translations.rejectionPrompt, candidate.rejectionNote ?? ''); if (note?.trim()) onReview(candidate.id, false, note.trim()) }} className="rounded bg-white/[0.05] px-1.5 py-1 text-[8px] text-text-tertiary">{translations.reject}</button>
          <button type="button" onClick={() => onSelectPrimary(candidate.id)} className={`rounded px-1.5 py-1 text-[8px] ${candidate.isCanon ? 'bg-primary-500 text-black' : 'bg-white/[0.05] text-text-tertiary'}`}>{candidate.isCanon ? translations.primary : translations.makePrimary}</button>
        </div>}
      </div>
    </article>
  )
}
