import { AppIcon } from '@/components/ui/icons'
import { getVisualDevelopmentAspectRatios } from '@/lib/visual-development/model-options'
import type { ReactNode } from 'react'
import type { CastingCandidateView, HairDesignWorkspaceController } from './visual-development-types'
import { visualDevelopmentDownloadHref } from './visual-development-download'
import { VisualDevelopmentImage } from './VisualDevelopmentImage'
import { CandidatePromptEditor } from './CandidatePromptEditor'
import { GenerationBatchHistory } from './GenerationBatchHistory'

export interface HairDesignTranslations {
  prerequisite: string
  prerequisiteHint: string
  identityAuthority: string
  designRecord: string
  hairSilhouette: string
  partingAndHairline: string
  lengthAndTexture: string
  storyRequirements: string
  forbiddenDrift: string
  modelBinding: string
  modelRequired: string
  modelHint: string
  resolution: string
  aspectRatio: string
  exploreTitle: string
  exploreDescription: string
  generateExploration: string
  select: string
  selected: string
  validationTitle: string
  validationDescription: string
  generateValidation: string
  waiting: string
  approve: string
  approved: string
  reject: string
  rejectionPrompt: string
  lock: string
  locked: string
  lockHint: string
  nextPhase: string
  generating: string
  seedUnsupported: string
  historyTitle: string
  historyDescription: string
  historyNewest: string
}

interface HairDesignWorkspaceProps {
  controller: HairDesignWorkspaceController
  nextStage: { code: string; shortTitle: string } | null
  onAdvance: () => void
  translations: HairDesignTranslations
}

const EXPLORATION_CODES = [
  'HAIR-LONG-CENTER',
  'HAIR-LONG-SIDE',
  'HAIR-SHOULDER',
  'HAIR-BOB',
  'HAIR-CROPPED',
  'HAIR-SLICKED',
  'HAIR-LOW-TIED',
  'HAIR-HALF-TIED',
  'HAIR-BRAIDED',
  'HAIR-ASYMMETRIC',
] as const

const VALIDATION_CODES = [
  'HAIR-VIEW-FRONT',
  'HAIR-VIEW-PROFILE',
  'HAIR-VIEW-BACK',
  'HAIR-SIL-BACKLIGHT',
  'HAIR-MOVE-WALK',
  'HAIR-MOVE-WIND',
  'HAIR-STATE-FORMAL',
  'HAIR-STATE-DISTRESSED',
] as const

function placeholders(codes: readonly string[], prefix: string): CastingCandidateView[] {
  return codes.map((code, index) => ({
    id: `${prefix}-${index}`,
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
}

export function HairDesignWorkspace({ controller, nextStage, onAdvance, translations }: HairDesignWorkspaceProps) {
  const selectedModel = controller.imageModels.find((model) => model.value === controller.form.modelKey)
  const resolutions = selectedModel?.capabilities?.image?.resolutionOptions ?? []
  const ratios = selectedModel ? getVisualDevelopmentAspectRatios(selectedModel.capabilities, 'image') : []
  const exploration = controller.explorationBatch?.candidates ?? placeholders(EXPLORATION_CODES, 'hair-explore')
  const validation = controller.validationBatch?.candidates ?? placeholders(VALIDATION_CODES, 'hair-validate')
  const canGenerate = Boolean(
    controller.form.modelKey
    && controller.form.aspectRatio
    && controller.form.hairSilhouette
    && controller.form.partingAndHairline
    && controller.form.lengthAndTexture
    && controller.form.storyRequirements
    && controller.form.forbiddenDrift,
  )
  const canLock = Boolean(
    controller.validationBatch
    && controller.validationBatch.status !== 'canon_locked'
    && validation.length === VALIDATION_CODES.length
    && validation.every((candidate) => candidate.resultUrl && candidate.shortlisted),
  )
  const isLocked = controller.validationBatches.some((batch) => batch.status === 'canon_locked')
  const faceReady = [
    'face_locked',
    'hair_exploration_in_progress',
    'hair_direction_selected',
    'hair_validation_in_progress',
    'hair_locked',
  ].includes(controller.characterStatus)

  if (!controller.identityCandidate || !faceReady) {
    return (
      <section className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-8 text-center">
        <AppIcon name="lock" className="mx-auto h-6 w-6 text-amber-300" />
        <h3 className="mt-4 font-serif-cn text-base font-semibold text-white">{translations.prerequisite}</h3>
        <p className="mx-auto mt-2 max-w-xl font-serif-cn text-xs leading-5 text-text-secondary">
          {translations.prerequisiteHint}
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-4 rounded-2xl border border-white/[0.08] bg-raised p-4 xl:grid-cols-[160px_minmax(0,1fr)]">
        <div>
          <div className="mb-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">{translations.identityAuthority}</div>
          <ReferenceCard candidate={controller.identityCandidate} badge="FACE ID" />
          <p className="mt-2 truncate font-mono text-[8px] text-text-tertiary">{controller.characterCode} · EXPR-RESTRAINED</p>
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">
            <AppIcon name="imageEdit" className="h-3.5 w-3.5" />
            {translations.designRecord}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <HairField label={translations.hairSilhouette} value={controller.form.hairSilhouette} onChange={(value) => controller.onFieldChange('hairSilhouette', value)} />
            <HairField label={translations.partingAndHairline} value={controller.form.partingAndHairline} onChange={(value) => controller.onFieldChange('partingAndHairline', value)} />
            <HairField label={translations.lengthAndTexture} value={controller.form.lengthAndTexture} onChange={(value) => controller.onFieldChange('lengthAndTexture', value)} />
            <HairField label={translations.storyRequirements} value={controller.form.storyRequirements} onChange={(value) => controller.onFieldChange('storyRequirements', value)} />
            <div className="md:col-span-2">
              <HairField label={translations.forbiddenDrift} value={controller.form.forbiddenDrift} onChange={(value) => controller.onFieldChange('forbiddenDrift', value)} rows={2} />
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
                {controller.imageModels.map((model) => <option key={model.value} value={model.value}>{model.label} · {model.providerName ?? model.provider}</option>)}
              </select>
              <select value={controller.form.resolution} onChange={(event) => controller.onFieldChange('resolution', event.target.value)} className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50">
                <option value="">{translations.resolution}</option>
                {resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
              </select>
              <select value={controller.form.aspectRatio} onChange={(event) => controller.onFieldChange('aspectRatio', event.target.value)} className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50">
                <option value="">{translations.aspectRatio}</option>
                {ratios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
              </select>
            </div>
            <p className="mt-2 font-serif-cn text-[10px] leading-4 text-text-tertiary">{translations.modelHint}</p>
          </div>
        </div>

        <StageHeader index="01" title={translations.exploreTitle} description={translations.exploreDescription}>
          <button type="button" disabled={isLocked || controller.isGenerating || controller.isLoading || !canGenerate} onClick={controller.onGenerateExploration} className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-primary-500 px-3 text-[10px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35">
            <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
            {controller.isGenerating ? translations.generating : translations.generateExploration}
          </button>
        </StageHeader>
        <GenerationBatchHistory
          batches={controller.explorationBatches}
          activeBatchId={controller.activeExplorationBatchId}
          onSelect={controller.onSelectExplorationBatch}
          title={translations.historyTitle}
          description={translations.historyDescription}
          newest={translations.historyNewest}
        />
        <div className="grid grid-cols-2 gap-px bg-white/[0.07] sm:grid-cols-3 2xl:grid-cols-5">
          {exploration.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              waiting={translations.waiting}
              seedUnsupported={translations.seedUnsupported}
              regenerationDisabled={isLocked || controller.explorationBatch?.status === 'canon_locked' || candidate.isCanon}
              isRegenerating={controller.regeneratingCandidateIds.includes(candidate.id)}
              onRegenerate={controller.onRegenerateCandidate}
            >
              {candidate.resultUrl && (
                <button type="button" disabled={isLocked} onClick={() => controller.onSelectDirection(candidate.id)} className={`rounded px-2 py-1 text-[8px] disabled:opacity-35 ${candidate.isCanon ? 'bg-primary-500 text-black' : 'bg-white/[0.06] text-text-secondary'}`}>
                  {candidate.isCanon ? translations.selected : translations.select}
                </button>
              )}
            </CandidateCard>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
        <StageHeader index="02" title={translations.validationTitle} description={translations.validationDescription}>
          <button type="button" disabled={isLocked || controller.isGenerating || controller.isLoading || !canGenerate || !controller.selectedHairCandidate} onClick={controller.onGenerateValidation} className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-primary-500/35 bg-primary-500/[0.1] px-3 text-[10px] font-semibold text-primary-300 disabled:cursor-not-allowed disabled:opacity-35">
            <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
            {controller.isGenerating ? translations.generating : translations.generateValidation}
          </button>
        </StageHeader>
        <GenerationBatchHistory
          batches={controller.validationBatches}
          activeBatchId={controller.activeValidationBatchId}
          onSelect={controller.onSelectValidationBatch}
          title={translations.historyTitle}
          description={translations.historyDescription}
          newest={translations.historyNewest}
        />
        {controller.selectedHairCandidate && (
          <div className="flex items-center gap-3 border-b border-white/[0.07] bg-primary-500/[0.035] px-4 py-3">
            <div className="h-12 w-10 overflow-hidden rounded-lg border border-primary-500/30 bg-[#101013]">
              {controller.selectedHairCandidate.resultUrl && <VisualDevelopmentImage src={controller.selectedHairCandidate.resultUrl} alt="Selected hair" />}
            </div>
            <div>
              <div className="font-mono text-[8px] tracking-[0.16em] text-primary-400">REFERENCE IMAGE 2 · HAIR ONLY</div>
              <div className="mt-1 text-[11px] text-white">{controller.selectedHairCandidate.code}</div>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-px bg-white/[0.07] sm:grid-cols-3 xl:grid-cols-4">
          {validation.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              waiting={translations.waiting}
              seedUnsupported={translations.seedUnsupported}
              regenerationDisabled={isLocked}
              isRegenerating={controller.regeneratingCandidateIds.includes(candidate.id)}
              onRegenerate={controller.onRegenerateCandidate}
            >
              {candidate.resultUrl && (
                <div className="flex gap-1">
                  <button type="button" disabled={isLocked} onClick={() => controller.onReviewValidation(candidate.id, true)} className={`rounded px-1.5 py-1 text-[8px] disabled:opacity-35 ${candidate.shortlisted ? 'bg-primary-500/[0.16] text-primary-400' : 'bg-white/[0.05] text-text-tertiary'}`}>{candidate.shortlisted ? translations.approved : translations.approve}</button>
                  <button type="button" disabled={isLocked} onClick={() => {
                    const note = window.prompt(translations.rejectionPrompt, candidate.rejectionNote ?? '')
                    if (note?.trim()) controller.onReviewValidation(candidate.id, false, note.trim())
                  }} className="rounded bg-white/[0.05] px-1.5 py-1 text-[8px] text-text-tertiary disabled:opacity-35">{translations.reject}</button>
                </div>
              )}
            </CandidateCard>
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-white/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-2xl font-serif-cn text-[10px] leading-4 text-text-tertiary">{translations.lockHint}</p>
          {isLocked && nextStage ? (
            <button type="button" onClick={onAdvance} className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-500 px-3 text-[10px] font-semibold text-black transition-colors hover:bg-primary-400">
              <AppIcon name="arrowRight" className="h-3.5 w-3.5" />
              {translations.nextPhase} · {nextStage.code} {nextStage.shortTitle}
            </button>
          ) : (
            <button type="button" disabled={!canLock} onClick={controller.onLock} className="flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-500 px-3 text-[10px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35">
              <AppIcon name="lock" className="h-3.5 w-3.5" />
              {isLocked ? translations.locked : translations.lock}
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function ReferenceCard({ candidate, badge }: { candidate: CastingCandidateView; badge: string }) {
  return (
    <div className="relative aspect-[4/5] overflow-hidden rounded-xl border border-primary-500/30 bg-[#101013]">
      {candidate.resultUrl && <VisualDevelopmentImage src={candidate.resultUrl} alt={badge} />}
      <span className="absolute right-2 top-2 rounded-md bg-primary-500 px-2 py-1 font-mono text-[8px] font-semibold text-black">{badge}</span>
    </div>
  )
}

function HairField({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (value: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-serif-cn text-[10px] leading-4 text-text-secondary">{label}</span>
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#0d0d10] px-3 py-2.5 text-xs leading-5 text-white outline-none placeholder:text-text-tertiary focus:border-primary-500/45" />
    </label>
  )
}

function StageHeader({ index, title, description, children }: { index: string; title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-white/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary-500/25 bg-primary-500/[0.08] font-mono text-[9px] text-primary-400">{index}</span>
        <div>
          <h3 className="font-serif-cn text-sm font-semibold text-white">{title}</h3>
          <p className="mt-1 max-w-2xl font-serif-cn text-[10px] leading-4 text-text-tertiary">{description}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

function CandidateCard({
  candidate,
  waiting,
  seedUnsupported,
  regenerationDisabled,
  isRegenerating,
  onRegenerate,
  children,
}: {
  candidate: CastingCandidateView
  waiting: string
  seedUnsupported: string
  regenerationDisabled: boolean
  isRegenerating: boolean
  onRegenerate: HairDesignWorkspaceController['onRegenerateCandidate']
  children: ReactNode
}) {
  return (
    <article className="bg-[#0b0b0d] p-2.5">
      <div className={`relative aspect-[3/4] overflow-hidden rounded-xl border bg-[#101013] ${candidate.isCanon || candidate.shortlisted ? 'border-primary-500/60' : 'border-white/[0.07]'}`}>
        {candidate.resultUrl ? <VisualDevelopmentImage src={candidate.resultUrl} alt={candidate.code} /> : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary">
            <AppIcon name="user" className="h-5 w-5 opacity-55" />
            <span className="font-mono text-[8px] tracking-[0.12em]">{candidate.taskStatus === 'pending' ? waiting : `${candidate.taskStatus} ${candidate.progress}%`}</span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-md border border-white/[0.08] bg-black/60 px-1.5 py-1 font-mono text-[7px] text-white backdrop-blur">{candidate.code}</span>
      </div>
      <div className="mt-2 flex min-h-6 items-center justify-between gap-2">
        <span className="truncate font-mono text-[7px] text-text-tertiary">{candidate.seedStatus === 'applied' ? `SEED ${candidate.requestedSeed}` : seedUnsupported}</span>
        <div className="flex items-center gap-1">
          {candidate.resultUrl && <a href={visualDevelopmentDownloadHref(candidate.resultUrl, `hair-${candidate.code}`)} aria-label={`Download ${candidate.code}`} className="rounded bg-white/[0.05] p-1 text-text-tertiary hover:text-white"><AppIcon name="download" className="h-3 w-3" /></a>}
          {children}
        </div>
      </div>
      {candidate.prompt && (
        <div className="-mx-2.5 -mb-2.5 mt-2">
          <CandidatePromptEditor
            candidate={candidate}
            disabled={regenerationDisabled}
            isRegenerating={isRegenerating}
            onRegenerate={onRegenerate}
          />
        </div>
      )}
    </article>
  )
}
