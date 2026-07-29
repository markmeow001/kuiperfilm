import { AppIcon } from '@/components/ui/icons'
import type { CastingWorkspaceController } from './visual-development-types'
import { visualDevelopmentDownloadHref } from './visual-development-download'

interface CastingTranslations {
  batch: string
  model: string
  notConnected: string
  count: string
  ratio: string
  generate: string
  waiting: string
  seedPending: string
  seedUnsupported: string
  seedApplied: string
  candidate: string
  projectSetup: string
  worldPremise: string
  visualThesis: string
  characterName: string
  characterCode: string
  characterRole: string
  coreTraits: string
  apparentAge: string
  ethnicity: string
  faceStructure: string
  emotionalRead: string
  lifeHistory: string
  resolution: string
  modelBinding: string
  generateHint: string
  shortlist: string
  canonLock: string
  canonLocked: string
  generating: string
  worldRequired: string
  worldLocked: string
}

interface CastingWorkspaceProps {
  candidateCount: 4 | 8 | 10
  controller: CastingWorkspaceController
  onCandidateCountChange: (count: 4 | 8 | 10) => void
  translations: CastingTranslations
}

export function CastingWorkspace({
  candidateCount,
  controller,
  onCandidateCountChange,
  translations,
}: CastingWorkspaceProps) {
  const selectedModel = controller.imageModels.find((model) => model.value === controller.form.modelKey)
  const resolutions = selectedModel?.capabilities?.image?.resolutionOptions ?? []
  const displayedCandidates = controller.batch?.candidates
    ?? Array.from({ length: candidateCount }, (_, index) => ({
      id: `pending-${index}`,
      code: `C-${String(index + 1).padStart(2, '0')}`,
      taskStatus: 'pending',
      progress: 0,
      resultUrl: null,
      requestedSeed: null,
      seedStatus: 'pending',
      shortlisted: false,
      isCanon: false,
      errorMessage: null,
    }))

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-white/[0.08] bg-raised p-4">
        <div className="mb-4 flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">
          <AppIcon name="brain" className="h-3.5 w-3.5" />
          {translations.projectSetup}
        </div>
        <div className={`mb-4 flex items-center gap-2 rounded-xl border px-3 py-2 text-[10px] ${controller.worldStatus === 'world_locked' ? 'border-primary-500/20 bg-primary-500/[0.06] text-primary-400' : 'border-amber-400/20 bg-amber-400/[0.05] text-amber-200/80'}`}>
          <AppIcon name={controller.worldStatus === 'world_locked' ? 'badgeCheck' : 'lock'} className="h-3.5 w-3.5" />
          {controller.worldStatus === 'world_locked' ? translations.worldLocked : translations.worldRequired}
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label={translations.worldPremise} value={controller.form.worldBible.projectPremise} onChange={(value) => controller.onFieldChange('worldBible', 'projectPremise', value)} multiline />
          <Field label={translations.visualThesis} value={controller.form.worldBible.visualThesis} onChange={(value) => controller.onFieldChange('worldBible', 'visualThesis', value)} multiline />
          <Field label={translations.characterName} value={controller.form.characterName} onChange={(value) => controller.onIdentityChange('characterName', value)} />
          <Field label={translations.characterCode} value={controller.form.characterCode} onChange={(value) => controller.onIdentityChange('characterCode', value)} />
          <Field label={translations.characterRole} value={controller.form.characterDna.role} onChange={(value) => controller.onFieldChange('characterDna', 'role', value)} />
          <Field label={translations.coreTraits} value={controller.form.characterDna.coreTraits} onChange={(value) => controller.onFieldChange('characterDna', 'coreTraits', value)} />
          <Field label={translations.apparentAge} value={controller.form.castingBrief.apparentAge} onChange={(value) => controller.onFieldChange('castingBrief', 'apparentAge', value)} placeholder="24–28" />
          <Field label={translations.ethnicity} value={controller.form.castingBrief.ethnicity} onChange={(value) => controller.onFieldChange('castingBrief', 'ethnicity', value)} />
          <Field label={translations.faceStructure} value={controller.form.castingBrief.faceStructure} onChange={(value) => controller.onFieldChange('castingBrief', 'faceStructure', value)} />
          <Field label={translations.emotionalRead} value={controller.form.castingBrief.emotionalRead} onChange={(value) => controller.onFieldChange('castingBrief', 'emotionalRead', value)} />
          <div className="lg:col-span-2">
            <Field label={translations.lifeHistory} value={controller.form.castingBrief.lifeHistory} onChange={(value) => controller.onFieldChange('castingBrief', 'lifeHistory', value)} multiline />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
        <div className="flex flex-col gap-4 border-b border-white/[0.07] p-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9px] tracking-[0.18em] text-text-tertiary">
              {translations.modelBinding}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_140px]">
              <select
                value={controller.form.modelKey}
                onChange={(event) => controller.onIdentityChange('modelKey', event.target.value)}
                className="h-10 min-w-0 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50"
              >
                <option value="">{translations.notConnected}</option>
                {controller.imageModels.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label} · {model.providerName ?? model.provider}
                  </option>
                ))}
              </select>
              <select
                value={controller.form.resolution}
                onChange={(event) => controller.onIdentityChange('resolution', event.target.value)}
                className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50"
              >
                <option value="">{translations.resolution}</option>
                {resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
              </select>
            </div>
            {selectedModel && (
              <p className="mt-2 truncate font-mono text-[8px] text-text-tertiary">
                {selectedModel.value} · {selectedModel.capabilities?.image?.supportSeed ? translations.seedApplied : translations.seedUnsupported}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 font-mono text-[9px] tracking-[0.14em] text-text-tertiary">{translations.count}</span>
            {([4, 8, 10] as const).map((count) => (
              <button key={count} type="button" onClick={() => onCandidateCountChange(count)} aria-pressed={candidateCount === count} className={`h-8 min-w-9 rounded-lg border px-2 font-mono text-[10px] transition-colors ${candidateCount === count ? 'border-primary-500/40 bg-primary-500/[0.12] text-primary-400' : 'border-white/[0.08] bg-white/[0.025] text-text-tertiary hover:text-white'}`}>
                {count}
              </button>
            ))}
            <button type="button" disabled={controller.worldStatus !== 'world_locked' || controller.isGenerating || controller.isLoading || !controller.form.modelKey} onClick={controller.onGenerate} className="ml-1 flex h-9 items-center gap-2 rounded-lg bg-primary-500 px-3 text-[10px] font-semibold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-35">
              <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
              {controller.isGenerating ? translations.generating : translations.generate}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px bg-white/[0.07] sm:grid-cols-4 2xl:grid-cols-5">
          {displayedCandidates.map((candidate) => (
            <article key={candidate.id} className="group bg-[#0b0b0d] p-2.5">
              <div className={`relative aspect-[4/5] overflow-hidden rounded-xl border bg-[#101013] ${candidate.isCanon ? 'border-primary-500/70' : 'border-white/[0.07]'}`}>
                {candidate.resultUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={candidate.resultUrl} alt={`${translations.candidate} ${candidate.code}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary">
                    <AppIcon name="user" className="h-5 w-5 opacity-55" />
                    <span className="font-mono text-[8px] tracking-[0.14em]">{candidate.taskStatus === 'pending' ? translations.waiting : `${candidate.taskStatus} ${candidate.progress}%`}</span>
                  </div>
                )}
                <div className="absolute left-2 top-2 rounded-md border border-white/[0.08] bg-black/55 px-1.5 py-1 font-mono text-[8px] text-white backdrop-blur">{candidate.code}</div>
                {candidate.isCanon && <div className="absolute right-2 top-2 rounded-md bg-primary-500 px-1.5 py-1 font-mono text-[8px] font-semibold text-black">CANON</div>}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[8px] text-text-tertiary">
                  {candidate.seedStatus === 'applied' ? `SEED ${candidate.requestedSeed}` : candidate.seedStatus === 'unsupported' ? translations.seedUnsupported : translations.seedPending}
                </span>
                {candidate.resultUrl && (
                  <div className="flex gap-1">
                    <a href={visualDevelopmentDownloadHref(candidate.resultUrl, `${controller.form.characterCode || 'character'}-casting-${candidate.code}`)} aria-label={`Download ${candidate.code}`} className="rounded bg-white/[0.05] p-1 text-text-tertiary hover:text-white"><AppIcon name="download" className="h-3 w-3" /></a>
                    <button type="button" onClick={() => controller.onCandidateAction(candidate.id, 'shortlist', !candidate.shortlisted)} className={`rounded px-1.5 py-1 text-[8px] ${candidate.shortlisted ? 'bg-white/15 text-white' : 'bg-white/[0.05] text-text-tertiary'}`}>{translations.shortlist}</button>
                    <button type="button" disabled={candidate.isCanon} onClick={() => controller.onCandidateAction(candidate.id, 'canon-lock')} className="rounded bg-primary-500/[0.14] px-1.5 py-1 text-[8px] text-primary-400 disabled:opacity-50">{candidate.isCanon ? translations.canonLocked : translations.canonLock}</button>
                  </div>
                )}
              </div>
              {candidate.errorMessage && <p className="mt-1 line-clamp-2 text-[8px] text-red-300">{candidate.errorMessage}</p>}
            </article>
          ))}
        </div>
      </section>
      <p className="px-1 font-serif-cn text-[11px] leading-5 text-text-tertiary">{translations.generateHint}</p>
    </div>
  )
}

function Field({ label, value, onChange, multiline = false, placeholder }: { label: string; value?: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string }) {
  const className = 'w-full rounded-xl border border-white/[0.08] bg-[#0d0d10] px-3 py-2.5 text-xs text-white outline-none placeholder:text-text-tertiary focus:border-primary-500/50'
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[8px] tracking-[0.13em] text-text-tertiary">{label}</span>
      {multiline ? <textarea rows={3} value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={`${className} resize-y`} /> : <input value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={className} />}
    </label>
  )
}
