'use client'

import { useEffect, useRef } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { LocalizedDevelopmentStage } from './DevelopmentRail'
import { CastingWorkspace } from './CastingWorkspace'
import { FaceBibleWorkspace, type FaceBibleTranslations } from './FaceBibleWorkspace'
import { HairDesignWorkspace, type HairDesignTranslations } from './HairDesignWorkspace'
import { WorldBibleWorkspace, type WorldBibleTranslations } from './WorldBibleWorkspace'
import { ProductionStageWorkspace, type ProductionStageTranslations } from './ProductionStageWorkspace'
import { ScriptImportWorkspace, type ScriptImportTranslations } from './ScriptImportWorkspace'
import { ResearchWorkspace, type ResearchTranslations } from './ResearchWorkspace'
import { CharacterRoster } from './CharacterRoster'
import type { CastingWorkspaceController, CharacterOption, FaceBibleWorkspaceController, HairDesignWorkspaceController, ProductionStageWorkspaceController, ResearchWorkspaceController, ScriptImportWorkspaceController, WorldBibleWorkspaceController } from './visual-development-types'

export interface CastingTranslations {
  batch: string
  model: string
  notConnected: string
  count: string
  ratio: string
  generate: string
  waiting: string
  seedPending: string
  candidate: string
  seedUnsupported: string
  seedApplied: string
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

export interface StageWorkspaceTranslations {
  objective: string
  deliverables: string
  approvalGate: string
  previewNotice: string
  characterRoster: {
    title: string
    loaded: string
    current: string
  }
  script: ScriptImportTranslations
  research: ResearchTranslations
  world: WorldBibleTranslations
  casting: CastingTranslations
  face: FaceBibleTranslations
  hair: HairDesignTranslations
  production: ProductionStageTranslations
  board: {
    title: string
    description: string
    addReference: string
    emptySlot: string
  }
}

interface StageWorkspaceProps {
  candidateCount: 4 | 8 | 10
  onCandidateCountChange: (count: 4 | 8 | 10) => void
  stage: LocalizedDevelopmentStage
  nextStage: LocalizedDevelopmentStage | null
  onStageSelect: (stageId: LocalizedDevelopmentStage['id']) => void
  characters: CharacterOption[]
  characterCode: string
  isLoadingCharacter: boolean
  onCharacterChange: (characterCode: string) => void
  scriptImportController: ScriptImportWorkspaceController
  researchController: ResearchWorkspaceController
  worldBibleController: WorldBibleWorkspaceController
  castingController: CastingWorkspaceController
  faceBibleController: FaceBibleWorkspaceController
  hairDesignController: HairDesignWorkspaceController
  productionStageController: ProductionStageWorkspaceController
  translations: StageWorkspaceTranslations
}

export function StageWorkspace({
  candidateCount,
  onCandidateCountChange,
  stage,
  nextStage,
  onStageSelect,
  characters,
  characterCode,
  isLoadingCharacter,
  onCharacterChange,
  scriptImportController,
  researchController,
  worldBibleController,
  castingController,
  faceBibleController,
  hairDesignController,
  productionStageController,
  translations,
}: StageWorkspaceProps) {
  const isCharacterStage = !['script', 'research', 'world'].includes(stage.id)
  const mainRef = useRef<HTMLElement>(null)

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [stage.id])

  const advance = () => {
    if (nextStage) onStageSelect(nextStage.id)
  }

  return (
    <main ref={mainRef} className="min-h-0 min-w-0 overflow-y-auto overscroll-y-contain bg-canvas [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mb-6 flex flex-col gap-5 border-b border-white/[0.07] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] tracking-[0.2em] text-primary-400">
                PHASE {stage.code}
              </span>
              <span className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-[8px] tracking-[0.14em] text-text-tertiary">
                {translations.previewNotice}
              </span>
            </div>
            <h2 className="mt-2 font-serif-cn text-2xl font-semibold tracking-tight text-white">
              {stage.title}
            </h2>
            <p className="mt-2 max-w-3xl font-serif-cn text-sm leading-6 text-text-secondary">
              {stage.objective}
            </p>
          </div>
          <StageIcon stage={stage} />
        </div>

        {isCharacterStage && (
          <CharacterRoster
            characters={characters}
            characterCode={characterCode}
            isLoading={isLoadingCharacter}
            onCharacterChange={onCharacterChange}
            labels={translations.characterRoster}
          />
        )}

        {stage.id === 'script' ? (
          <ScriptImportWorkspace controller={scriptImportController} translations={translations.script} />
        ) : stage.id === 'research' ? (
          <ResearchWorkspace controller={researchController} translations={translations.research} />
        ) : stage.id === 'world' ? (
          <WorldBibleWorkspace controller={worldBibleController} translations={translations.world} />
        ) : stage.id === 'casting' ? (
          <CastingWorkspace
            candidateCount={candidateCount}
            controller={castingController}
            onCandidateCountChange={onCandidateCountChange}
            translations={translations.casting}
          />
        ) : stage.id === 'face' ? (
          <FaceBibleWorkspace controller={faceBibleController} translations={translations.face} />
        ) : stage.id === 'hair' ? (
          <HairDesignWorkspace controller={hairDesignController} nextStage={nextStage} onAdvance={advance} translations={translations.hair} />
        ) : ['costume', 'accessory', 'silhouette', 'expression', 'ability', 'hero', 'turnaround', 'evolution', 'integration', 'video'].includes(stage.id) ? (
          <ProductionStageWorkspace controller={productionStageController} nextStage={nextStage} onAdvance={advance} translations={translations.production} />
        ) : (
          <GenericStageBoard stage={stage} translations={translations} />
        )}

        {!['script', 'research', 'world', 'casting', 'face', 'hair', 'costume', 'accessory', 'silhouette', 'expression', 'ability', 'hero', 'turnaround', 'evolution', 'integration', 'video'].includes(stage.id) && <section className="mt-6 grid gap-3 md:grid-cols-[1fr_0.8fr]">
          <div className="rounded-2xl border border-white/[0.07] bg-raised p-5">
            <div className="font-mono text-[9px] tracking-[0.18em] text-text-tertiary">
              {translations.deliverables}
            </div>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {stage.deliverables.map((deliverable) => (
                <li
                  key={deliverable}
                  className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-3 text-xs leading-5 text-text-secondary"
                >
                  <span className="mt-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-white/15">
                    <span className="h-1 w-1 rounded-full bg-text-tertiary" />
                  </span>
                  {deliverable}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-primary-500/20 bg-primary-500/[0.045] p-5">
            <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.18em] text-primary-400">
              <AppIcon name="lock" className="h-3.5 w-3.5" />
              {translations.approvalGate}
            </div>
            <p className="mt-4 font-serif-cn text-sm leading-6 text-text-secondary">{stage.gate}</p>
            <button
              type="button"
              disabled
              className="mt-5 flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 py-2.5 text-xs text-text-tertiary"
            >
              <AppIcon name="badgeCheck" className="h-4 w-4" />
              Canon Lock
            </button>
          </div>
        </section>}
      </div>
    </main>
  )
}

function StageIcon({ stage }: { stage: LocalizedDevelopmentStage }) {
  return (
    <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary-500/20 bg-primary-500/[0.07] text-primary-400 sm:flex">
      <AppIcon name={stage.icon} className="h-5 w-5" />
    </div>
  )
}

function GenericStageBoard({
  stage,
  translations,
}: {
  stage: LocalizedDevelopmentStage
  translations: StageWorkspaceProps['translations']
}) {
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-raised p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[9px] tracking-[0.18em] text-text-tertiary">
            {translations.objective}
          </div>
          <h3 className="mt-2 font-serif-cn text-base font-semibold text-white">
            {translations.board.title}
          </h3>
          <p className="mt-1 max-w-2xl font-serif-cn text-xs leading-5 text-text-secondary">
            {translations.board.description}
          </p>
        </div>
        <AppIcon name={stage.icon} className="h-4 w-4 shrink-0 text-primary-400" />
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {stage.deliverables.slice(0, 3).map((deliverable) => (
          <div
            key={deliverable}
            className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.1] bg-[#0d0d10] px-4 text-center"
          >
            <AppIcon name="imageEdit" className="h-5 w-5 text-text-tertiary" />
            <p className="mt-3 text-xs text-text-secondary">{deliverable}</p>
            <span className="mt-2 font-mono text-[8px] tracking-[0.12em] text-text-tertiary">
              {translations.board.emptySlot}
            </span>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled
        className="mt-4 flex cursor-not-allowed items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2 text-[10px] text-text-tertiary"
      >
        <AppIcon name="plus" className="h-3.5 w-3.5" />
        {translations.board.addReference}
      </button>
    </section>
  )
}
