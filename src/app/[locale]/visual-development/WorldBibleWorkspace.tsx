import { AppIcon } from '@/components/ui/icons'
import { WORLD_ASSET_DEFINITIONS } from '@/lib/visual-development/world-bible'
import type { WorldBibleFormState, WorldBibleWorkspaceController } from './visual-development-types'
import { visualDevelopmentDownloadHref } from './visual-development-download'
import { VisualDevelopmentImage } from './VisualDevelopmentImage'

export interface WorldBibleTranslations {
  foundation: string
  foundationDescription: string
  projectPremise: string
  visualThesis: string
  eraAndGeography: string
  societyAndFactions: string
  technologyRules: string
  colorScript: string
  materialRules: string
  architectureLanguage: string
  cameraFormat: string
  forbiddenElements: string
  save: string
  saving: string
  references: string
  referencesDescription: string
  addReferences: string
  uploading: string
  remove: string
  modelBinding: string
  modelRequired: string
  resolution: string
  aspectRatio: string
  generate: string
  generating: string
  assets: string
  assetsDescription: string
  waiting: string
  approve: string
  approved: string
  reject: string
  rejectionPrompt: string
  seedUnsupported: string
  canonGate: string
  canonGateDescription: string
  lock: string
  locked: string
  version: string
}

interface WorldBibleWorkspaceProps {
  controller: WorldBibleWorkspaceController
  translations: WorldBibleTranslations
}

const REQUIRED_FIELDS: Array<keyof WorldBibleFormState> = [
  'projectPremise',
  'visualThesis',
  'eraAndGeography',
  'societyAndFactions',
  'technologyRules',
  'colorScript',
  'materialRules',
  'architectureLanguage',
  'cameraFormat',
  'forbiddenElements',
]

export function WorldBibleWorkspace({ controller, translations }: WorldBibleWorkspaceProps) {
  const selectedModel = controller.imageModels.find((model) => model.value === controller.form.modelKey)
  const resolutions = selectedModel?.capabilities?.image?.resolutionOptions ?? []
  const aspectRatios = selectedModel?.capabilities?.image?.aspectRatioOptions ?? ['16:9']
  const fieldsComplete = REQUIRED_FIELDS.every((field) => controller.form[field].trim().length > 0)
  const assetsComplete = controller.assets.length === WORLD_ASSET_DEFINITIONS.length
    && controller.assets.every((asset) => asset.taskStatus === 'completed' && asset.approved)
  const generationActive = controller.assets.some((asset) => asset.taskStatus === 'queued' || asset.taskStatus === 'processing')
  const isLocked = controller.status === 'world_locked'

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
        <div className="grid border-b border-white/[0.07] lg:grid-cols-[1fr_260px]">
          <div className="p-5">
            <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">
              <AppIcon name="globe" className="h-3.5 w-3.5" />
              {translations.foundation}
            </div>
            <p className="mt-2 max-w-3xl font-serif-cn text-xs leading-5 text-text-secondary">
              {translations.foundationDescription}
            </p>
          </div>
          <div className="border-t border-white/[0.07] bg-[#0d0d10] p-5 lg:border-l lg:border-t-0">
            <div className="font-mono text-[8px] tracking-[0.16em] text-text-tertiary">WORLD CANON</div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className={`rounded-full border px-2.5 py-1 font-mono text-[8px] ${isLocked ? 'border-primary-500/30 bg-primary-500/[0.1] text-primary-400' : 'border-white/[0.08] text-text-tertiary'}`}>
                {isLocked ? translations.locked : controller.status.toUpperCase()}
              </span>
              <span className="font-mono text-[8px] text-text-tertiary">{translations.version} {controller.version}</span>
            </div>
            {controller.canonId && <p className="mt-3 truncate font-mono text-[8px] text-white">{controller.canonId}</p>}
          </div>
        </div>

        <div className="grid gap-3 p-5 lg:grid-cols-2">
          <WorldField label={translations.projectPremise} field="projectPremise" controller={controller} multiline />
          <WorldField label={translations.visualThesis} field="visualThesis" controller={controller} multiline />
          <WorldField label={translations.eraAndGeography} field="eraAndGeography" controller={controller} multiline />
          <WorldField label={translations.societyAndFactions} field="societyAndFactions" controller={controller} multiline />
          <WorldField label={translations.technologyRules} field="technologyRules" controller={controller} multiline />
          <WorldField label={translations.colorScript} field="colorScript" controller={controller} multiline />
          <WorldField label={translations.materialRules} field="materialRules" controller={controller} multiline />
          <WorldField label={translations.architectureLanguage} field="architectureLanguage" controller={controller} multiline />
          <WorldField label={translations.cameraFormat} field="cameraFormat" controller={controller} multiline />
          <WorldField label={translations.forbiddenElements} field="forbiddenElements" controller={controller} multiline />
        </div>
        <div className="flex justify-end border-t border-white/[0.07] px-5 py-3">
          <button type="button" disabled={isLocked || controller.isSaving || controller.isLoading} onClick={controller.onSave} className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-4 text-[10px] text-white transition-colors hover:border-white/[0.18] disabled:cursor-not-allowed disabled:opacity-35">
            <AppIcon name="bookmark" className="h-3.5 w-3.5 text-primary-400" />
            {controller.isSaving ? translations.saving : translations.save}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/[0.08] bg-raised p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-mono text-[9px] tracking-[0.18em] text-primary-400">{translations.references}</div>
            <p className="mt-1 font-serif-cn text-xs leading-5 text-text-secondary">{translations.referencesDescription}</p>
          </div>
          <label className={`flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-primary-500/30 bg-primary-500/[0.08] px-3 text-[10px] text-primary-400 ${isLocked || controller.isUploading ? 'pointer-events-none opacity-35' : ''}`}>
            <AppIcon name="plus" className="h-3.5 w-3.5" />
            {controller.isUploading ? translations.uploading : translations.addReferences}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={isLocked || controller.isUploading} onChange={(event) => {
              if (event.target.files) controller.onUploadReferences(event.target.files)
              event.currentTarget.value = ''
            }} />
          </label>
        </div>
        {controller.references.length === 0 ? (
          <div className="mt-4 flex min-h-28 items-center justify-center rounded-xl border border-dashed border-white/[0.1] bg-[#0d0d10] font-mono text-[8px] tracking-[0.15em] text-text-tertiary">NO REFERENCES · TEXT-ONLY GENERATION IS ALLOWED</div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {controller.references.map((reference) => (
              <article key={reference.id} className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0d0d10]">
                <div className="aspect-[4/3] bg-black/30">
                  {reference.previewUrl && <VisualDevelopmentImage src={reference.previewUrl} alt={reference.name} />}
                </div>
                <div className="p-2">
                  <p className="truncate text-[9px] text-white">{reference.name}</p>
                  <button type="button" disabled={isLocked} onClick={() => controller.onRemoveReference(reference.id)} className="mt-1 font-mono text-[8px] text-red-300/70 disabled:opacity-35">{translations.remove}</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-raised">
        <div className="flex flex-col gap-4 border-b border-white/[0.07] p-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9px] tracking-[0.18em] text-text-tertiary">{translations.modelBinding}</div>
            <div className="mt-2 grid gap-2 md:grid-cols-[minmax(240px,1fr)_130px_110px]">
              <select value={controller.form.modelKey} disabled={isLocked} onChange={(event) => controller.onFieldChange('modelKey', event.target.value)} className="h-10 min-w-0 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50 disabled:opacity-40">
                <option value="">{translations.modelRequired}</option>
                {controller.imageModels.map((model) => <option key={model.value} value={model.value}>{model.label} · {model.providerName ?? model.provider}</option>)}
              </select>
              <select value={controller.form.resolution} disabled={isLocked} onChange={(event) => controller.onFieldChange('resolution', event.target.value)} className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50 disabled:opacity-40">
                <option value="">{translations.resolution}</option>
                {resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
              </select>
              <select value={controller.form.aspectRatio} disabled={isLocked} onChange={(event) => controller.onFieldChange('aspectRatio', event.target.value)} className="h-10 rounded-xl border border-white/[0.09] bg-[#0d0d10] px-3 text-xs text-white outline-none focus:border-primary-500/50 disabled:opacity-40">
                {aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}
              </select>
            </div>
          </div>
          <button type="button" disabled={isLocked || !fieldsComplete || !controller.form.modelKey || controller.isGenerating || generationActive} onClick={controller.onGenerate} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 text-[10px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35">
            <AppIcon name="sparklesAlt" className="h-3.5 w-3.5" />
            {controller.isGenerating || generationActive ? translations.generating : translations.generate}
          </button>
        </div>

        <div className="p-5">
          <div className="font-mono text-[9px] tracking-[0.18em] text-primary-400">{translations.assets}</div>
          <p className="mt-1 font-serif-cn text-xs leading-5 text-text-secondary">{translations.assetsDescription}</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {WORLD_ASSET_DEFINITIONS.map((definition) => {
              const asset = controller.assets.find((item) => item.code === definition.code)
              return (
                <article key={definition.code} className={`overflow-hidden rounded-xl border bg-[#0d0d10] ${asset?.approved ? 'border-primary-500/35' : 'border-white/[0.08]'}`}>
                  <div className="relative aspect-video bg-black/25">
                    {asset?.resultUrl ? <VisualDevelopmentImage src={asset.resultUrl} alt={definition.title} /> : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-tertiary">
                        <AppIcon name="imageEdit" className="h-5 w-5 opacity-55" />
                        <span className="font-mono text-[8px] tracking-[0.13em]">{asset ? `${asset.taskStatus} ${asset.progress}%` : translations.waiting}</span>
                      </div>
                    )}
                    <span className="absolute left-2 top-2 rounded-md border border-white/[0.08] bg-black/60 px-2 py-1 font-mono text-[8px] text-white">{definition.code}</span>
                    {asset?.approved && <span className="absolute right-2 top-2 rounded-md bg-primary-500 px-2 py-1 font-mono text-[8px] font-semibold text-black">APPROVED</span>}
                  </div>
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-xs font-medium text-white">{definition.title}</h4>
                        <p className="mt-1 text-[9px] leading-4 text-text-tertiary">{definition.purpose}</p>
                      </div>
                      {asset?.taskStatus === 'completed' && !isLocked && (
                        <div className="flex shrink-0 gap-1">
                          <button type="button" onClick={() => controller.onReviewAsset(definition.code, true)} className={`rounded px-2 py-1 text-[8px] ${asset.approved ? 'bg-primary-500/[0.16] text-primary-400' : 'bg-white/[0.05] text-text-tertiary'}`}>{asset.approved ? translations.approved : translations.approve}</button>
                          <button type="button" onClick={() => {
                            const note = window.prompt(translations.rejectionPrompt, asset.rejectionNote ?? '')
                            if (note?.trim()) controller.onReviewAsset(definition.code, false, note.trim())
                          }} className="rounded bg-white/[0.05] px-2 py-1 text-[8px] text-text-tertiary">{translations.reject}</button>
                        </div>
                      )}
                    </div>
                    {asset && <p className="mt-2 font-mono text-[8px] text-text-tertiary">{asset.seedStatus === 'applied' ? `SEED ${asset.requestedSeed}` : translations.seedUnsupported}</p>}
                    {asset?.resultUrl && <a href={visualDevelopmentDownloadHref(asset.resultUrl, `world-${definition.code}`)} className="mt-2 inline-flex items-center gap-1.5 rounded bg-white/[0.05] px-2 py-1 text-[8px] text-text-tertiary hover:text-white"><AppIcon name="download" className="h-3 w-3" />DOWNLOAD</a>}
                    {asset?.errorMessage && <p className="mt-2 text-[9px] text-red-300">{asset.errorMessage}</p>}
                    {asset?.rejectionNote && !asset.approved && <p className="mt-2 text-[9px] text-amber-200/70">{asset.rejectionNote}</p>}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-primary-500/20 bg-primary-500/[0.045] p-5">
        <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400"><AppIcon name="lock" className="h-3.5 w-3.5" />{translations.canonGate}</div>
        <p className="mt-3 font-serif-cn text-xs leading-5 text-text-secondary">{translations.canonGateDescription}</p>
        <button type="button" disabled={isLocked || !fieldsComplete || !assetsComplete} onClick={controller.onLock} className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-primary-500/25 bg-primary-500/[0.08] text-[10px] text-primary-400 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.03] disabled:text-text-tertiary disabled:opacity-45">
          <AppIcon name="badgeCheck" className="h-4 w-4" />
          {isLocked ? translations.locked : translations.lock}
        </button>
      </section>
    </div>
  )
}

function WorldField({ label, field, controller, multiline = false }: { label: string; field: keyof WorldBibleFormState; controller: WorldBibleWorkspaceController; multiline?: boolean }) {
  const className = 'w-full rounded-xl border border-white/[0.08] bg-[#0d0d10] px-3 py-2.5 text-xs text-white outline-none placeholder:text-text-tertiary focus:border-primary-500/50 disabled:cursor-not-allowed disabled:opacity-45'
  const disabled = controller.status === 'world_locked'
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[8px] tracking-[0.13em] text-text-tertiary">{label}</span>
      {multiline ? <textarea rows={3} value={controller.form[field]} disabled={disabled} onChange={(event) => controller.onFieldChange(field, event.target.value)} className={`${className} resize-y`} /> : <input value={controller.form[field]} disabled={disabled} onChange={(event) => controller.onFieldChange(field, event.target.value)} className={className} />}
    </label>
  )
}
