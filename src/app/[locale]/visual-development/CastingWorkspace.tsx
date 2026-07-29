import { AppIcon } from '@/components/ui/icons'
import { getVisualDevelopmentAspectRatios } from '@/lib/visual-development/model-options'
import type { CastingWorkspaceController } from './visual-development-types'
import { visualDevelopmentDownloadHref } from './visual-development-download'
import { VisualDevelopmentImage } from './VisualDevelopmentImage'

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
  performerAge: string
  ethnicity: string
  faceStructure: string
  emotionalRead: string
  lifeHistory: string
  directorPrompt: string
  directorPromptDescription: string
  directorPromptPlaceholder: string
  framingStandard: string
  resolution: string
  modelBinding: string
  historyTitle: string
  historyDescription: string
  historyNewest: string
  historyBatch: string
  historyImages: string
  generateHint: string
  shortlist: string
  canonLock: string
  canonLocked: string
  generating: string
  worldRequired: string
  worldLocked: string
  completeWorld: string
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
  const aspectRatios = selectedModel ? getVisualDevelopmentAspectRatios(selectedModel.capabilities, 'image') : []
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
  const candidateAspectRatio = toCssAspectRatio(controller.batch?.aspectRatio ?? controller.form.aspectRatio)

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
          <Field label={translations.apparentAge} value={controller.form.castingBrief.apparentAge} onChange={(value) => controller.onFieldChange('castingBrief', 'apparentAge', value)} placeholder="18" />
          <Field label={translations.performerAge} value={controller.form.castingBrief.performerAge} onChange={(value) => controller.onFieldChange('castingBrief', 'performerAge', value)} placeholder="21+" />
          <Field label={translations.ethnicity} value={controller.form.castingBrief.ethnicity} onChange={(value) => controller.onFieldChange('castingBrief', 'ethnicity', value)} />
          <Field label={translations.faceStructure} value={controller.form.castingBrief.faceStructure} onChange={(value) => controller.onFieldChange('castingBrief', 'faceStructure', value)} />
          <Field label={translations.emotionalRead} value={controller.form.castingBrief.emotionalRead} onChange={(value) => controller.onFieldChange('castingBrief', 'emotionalRead', value)} />
          <div className="lg:col-span-2">
            <Field label={translations.lifeHistory} value={controller.form.castingBrief.lifeHistory} onChange={(value) => controller.onFieldChange('castingBrief', 'lifeHistory', value)} multiline />
          </div>
          <div className="lg:col-span-2 rounded-xl border border-primary-500/20 bg-primary-500/[0.045] p-3">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="casting-director-prompt" className="flex items-center gap-2 font-mono text-[9px] tracking-[0.13em] text-primary-300">
                <AppIcon name="brain" className="h-3.5 w-3.5" />
                {translations.directorPrompt}
              </label>
              <span className="rounded-md border border-white/[0.08] bg-black/20 px-2 py-1 font-mono text-[7px] tracking-[0.08em] text-text-tertiary">
                {translations.framingStandard}
              </span>
            </span>
            <span className="mt-2 block font-serif-cn text-[10px] leading-5 text-text-tertiary">
              {translations.directorPromptDescription}
            </span>
            <textarea
              id="casting-director-prompt"
              rows={4}
              value={controller.form.castingBrief.directorPrompt ?? ''}
              onChange={(event) => controller.onFieldChange('castingBrief', 'directorPrompt', event.target.value)}
              placeholder={translations.directorPromptPlaceholder}
              className="mt-3 w-full resize-y rounded-xl border border-white/[0.09] bg-[#0a0a0d] px-3 py-3 text-xs leading-5 text-white outline-none placeholder:text-text-tertiary focus:border-primary-500/50"
            />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
        <div className="flex flex-col gap-4 border-b border-white/[0.07] p-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9px] tracking-[0.18em] text-text-tertiary">
              {translations.modelBinding}
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(220px,1fr)_140px_120px]">
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
              <select
                value={controller.form.aspectRatio}
                onChange={(event) => controller.onIdentityChange('aspectRatio', event.target.value)}
                className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50"
              >
                <option value="">{translations.ratio}</option>
                {aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
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
            {controller.worldStatus === 'world_locked' ? (
              <button type="button" disabled={controller.isGenerating || controller.isLoading || !controller.form.modelKey || !controller.form.aspectRatio} onClick={controller.onGenerate} className="ml-1 flex h-9 items-center gap-2 rounded-lg bg-primary-500 px-3 text-[10px] font-semibold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-35">
                <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
                {controller.isGenerating ? translations.generating : translations.generate}
              </button>
            ) : (
              <button type="button" onClick={controller.onOpenWorldBible} className="ml-1 flex h-9 items-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/[0.08] px-3 text-[10px] font-semibold text-amber-100 transition-colors hover:bg-amber-300/[0.14]" title={translations.worldRequired}>
                <AppIcon name="lock" className="h-3.5 w-3.5" />
                {translations.completeWorld}
              </button>
            )}
          </div>
        </div>

        {controller.batches.length > 0 && (
          <div className="border-b border-white/[0.07] bg-black/[0.16] px-4 py-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.16em] text-primary-400">
                  <AppIcon name="clock" className="h-3.5 w-3.5" />
                  {translations.historyTitle}
                </div>
                <p className="mt-1 font-serif-cn text-[10px] text-text-tertiary">{translations.historyDescription}</p>
              </div>
              <span className="font-mono text-[8px] tracking-[0.12em] text-text-tertiary">
                {controller.form.characterCode} · {controller.batches.length}
              </span>
            </div>

            <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1">
              {controller.batches.map((historyBatch, index) => {
                const selected = historyBatch.id === controller.activeBatchId
                const batchNumber = controller.batches.length - index
                const timestamp = formatBatchTimestamp(historyBatch.createdAt)
                return (
                  <button
                    key={historyBatch.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => controller.onSelectBatch(historyBatch.id)}
                    className={`min-w-[190px] snap-start rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/70 ${selected ? 'border-primary-500/55 bg-primary-500/[0.12]' : 'border-white/[0.08] bg-[#0c0c0f] hover:border-primary-500/25 hover:bg-white/[0.04]'}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className={`font-mono text-[9px] tracking-[0.12em] ${selected ? 'text-primary-300' : 'text-text-secondary'}`}>
                        {translations.historyBatch.replace('{number}', String(batchNumber).padStart(2, '0'))}
                      </span>
                      {index === 0 && (
                        <span className="rounded bg-primary-500 px-1.5 py-0.5 font-mono text-[7px] font-semibold tracking-[0.08em] text-black">
                          {translations.historyNewest}
                        </span>
                      )}
                    </span>
                    <span className="mt-1.5 block truncate text-[10px] text-white">{historyBatch.modelId}</span>
                    <span className="mt-1 flex items-center gap-1.5 font-mono text-[8px] text-text-tertiary">
                      {translations.historyImages.replace('{count}', String(historyBatch.candidateCount))}
                      <span aria-hidden="true">·</span>
                      {historyBatch.aspectRatio}
                      {historyBatch.resolution && <><span aria-hidden="true">·</span>{historyBatch.resolution}</>}
                    </span>
                    {timestamp && <span className="mt-1 block font-mono text-[7px] text-text-tertiary/70">{timestamp}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-px bg-white/[0.07] sm:grid-cols-4 2xl:grid-cols-5">
          {displayedCandidates.map((candidate) => (
            <article key={candidate.id} className="group bg-[#0b0b0d] p-2.5">
              <div style={{ aspectRatio: candidateAspectRatio }} className={`relative overflow-hidden rounded-xl border bg-white ${candidate.isCanon ? 'border-primary-500/70' : 'border-white/[0.07]'}`}>
                {candidate.resultUrl ? (
                  <VisualDevelopmentImage
                    src={candidate.resultUrl}
                    alt={`${translations.candidate} ${candidate.code}`}
                    className="h-full w-full object-contain"
                    buttonClassName="bg-white"
                  />
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

function formatBatchTimestamp(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function toCssAspectRatio(value?: string): string {
  const [width, height] = (value ?? '').split(':').map(Number)
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
    ? `${width} / ${height}`
    : '4 / 5'
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
