import { AppIcon } from '@/components/ui/icons'
import type { LocalizedDevelopmentStage } from './DevelopmentRail'
import type { CastingBatchView } from './visual-development-types'

interface DevelopmentInspectorProps {
  candidateCount: 4 | 8 | 10
  labels: {
    title: string
    canon: string
    promptStack: string
    worldBible: string
    characterDna: string
    stageTemplate: string
    modelAdapter: string
    empty: string
    loaded: string
    notConnected: string
    seedRegistry: string
    lockPolicy: string
    lockPolicyDescription: string
    recordNotice: string
  }
  stage: LocalizedDevelopmentStage
  batch: CastingBatchView | null
  worldReady: boolean
  characterReady: boolean
  modelLabel: string | null
}

export function DevelopmentInspector({
  candidateCount,
  batch,
  worldReady,
  characterReady,
  modelLabel,
  labels,
  stage,
}: DevelopmentInspectorProps) {
  return (
    <aside className="border-t border-white/[0.07] bg-[#09090b] xl:min-h-0 xl:overflow-y-auto xl:border-l xl:border-t-0">
      <div className="border-b border-white/[0.07] px-5 py-5">
        <div className="font-mono text-[9px] tracking-[0.2em] text-text-tertiary">
          SYSTEM INSPECTOR
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-3">
          <h2 className="font-serif-cn text-sm font-semibold text-white">{labels.title}</h2>
          <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[8px] text-text-tertiary">
            {stage.code}
          </span>
        </div>
      </div>

      <div className="space-y-6 p-5">
        <section>
          <SectionHeading icon="brain" label={labels.promptStack} />
          <div className="mt-3 space-y-2">
            <StackRow index="01" label={labels.worldBible} status={worldReady ? labels.loaded : labels.empty} tone={worldReady ? 'ready' : 'empty'} />
            <StackConnector />
            <StackRow index="02" label={labels.characterDna} status={characterReady ? labels.loaded : labels.empty} tone={characterReady ? 'ready' : 'empty'} />
            <StackConnector />
            <StackRow index="03" label={labels.stageTemplate} status={labels.loaded} tone="ready" />
            <StackConnector />
            <StackRow
              index="04"
              label={labels.modelAdapter}
              status={modelLabel ?? labels.notConnected}
              tone={modelLabel ? 'ready' : 'empty'}
            />
          </div>
        </section>

        <section className="border-t border-white/[0.07] pt-5">
          <SectionHeading icon="lock" label={labels.canon} />
          <div className="mt-3 rounded-xl border border-primary-500/20 bg-primary-500/[0.045] p-3.5">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-500/[0.12]">
                <AppIcon name="badgeCheck" className="h-3.5 w-3.5 text-primary-400" />
              </span>
              <span className="text-[11px] font-medium text-white">{labels.lockPolicy}</span>
            </div>
            <p className="mt-3 font-serif-cn text-[11px] leading-5 text-text-secondary">
              {labels.lockPolicyDescription}
            </p>
          </div>
        </section>

        <section className="border-t border-white/[0.07] pt-5">
          <SectionHeading icon="bookmark" label={labels.seedRegistry} />
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {Array.from({ length: candidateCount }, (_, index) => {
              const candidate = batch?.candidates[index]
              return (
              <div
                key={index}
                className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2"
              >
                <span className="font-mono text-[8px] text-text-secondary">
                  {candidate?.code ?? `C-${String(index + 1).padStart(2, '0')}`}
                </span>
                <span className="font-mono text-[7px] tracking-[0.08em] text-text-tertiary">
                  {candidate?.seedStatus === 'applied' ? candidate.requestedSeed : candidate?.seedStatus === 'unsupported' ? 'N/A' : '—'}
                </span>
              </div>
              )
            })}
          </div>
          <p className="mt-3 font-serif-cn text-[10px] leading-4 text-text-tertiary">
            {labels.recordNotice}
          </p>
        </section>
      </div>
    </aside>
  )
}

function SectionHeading({ icon, label }: { icon: 'brain' | 'lock' | 'bookmark'; label: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-text-tertiary">
      <AppIcon name={icon} className="h-3.5 w-3.5 text-primary-400" />
      {label}
    </div>
  )
}

function StackRow({
  index,
  label,
  status,
  tone,
}: {
  index: string
  label: string
  status: string
  tone: 'ready' | 'empty'
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
      <span className="font-mono text-[8px] text-text-tertiary">{index}</span>
      <span className="min-w-0 flex-1 truncate font-serif-cn text-[11px] text-text-secondary">
        {label}
      </span>
      <span
        className={`shrink-0 font-mono text-[7px] tracking-[0.08em] ${
          tone === 'ready' ? 'text-primary-400' : 'text-text-tertiary'
        }`}
      >
        {status}
      </span>
    </div>
  )
}

function StackConnector() {
  return <div aria-hidden="true" className="ml-6 h-1.5 w-px bg-white/[0.09]" />
}
