'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'
import { useUserModels } from '@/lib/query/hooks/useUserModels'
import { DevelopmentInspector } from './DevelopmentInspector'
import { DevelopmentRail, type LocalizedDevelopmentStage } from './DevelopmentRail'
import { StageWorkspace } from './StageWorkspace'
import {
  DEFAULT_VISUAL_DEVELOPMENT_STAGE,
  VISUAL_DEVELOPMENT_STAGES,
  type VisualDevelopmentStageId,
} from './visual-development-config'
import type {
  CastingBatchView,
  CastingCandidateView,
  CastingFormState,
  CastingWorkspaceController,
  FaceBibleFormState,
  FaceBibleWorkspaceController,
  ProjectOption,
} from './visual-development-types'

interface VisualDevelopmentClientProps {
  locale: string
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

const EMPTY_FORM: CastingFormState = {
  worldBible: { projectPremise: '', visualThesis: '' },
  characterDna: { role: '', coreTraits: '' },
  castingBrief: {
    apparentAge: '24–28',
    ethnicity: '',
    faceStructure: '',
    emotionalRead: '',
    lifeHistory: '',
  },
  characterCode: 'CHAR-01',
  characterName: '',
  modelKey: '',
  resolution: '',
}

const EMPTY_FACE_FORM: FaceBibleFormState = {
  identityAnchors: '',
  allowedVariation: 'camera angle, gaze direction and the requested micro-expression only',
  forbiddenDrift: 'apparent age, ancestry, face width, eye spacing, nose shape, lip volume, jawline, hairline and distinctive marks',
  modelKey: '',
  resolution: '',
  aspectRatio: '3:4',
}

type WorkspaceResponse = {
  data?: {
    workspace?: {
      worldBible?: Record<string, string> | null
      characters?: Array<{
        code: string
        name: string
        status: string
        characterDna?: Record<string, string> | null
        castingBrief?: Record<string, string> | null
        castingBatches?: CastingBatchView[]
      }>
    } | null
  }
}

export function VisualDevelopmentClient({ locale }: VisualDevelopmentClientProps) {
  const t = useTranslations('visualDevelopment')
  const [activeStageId, setActiveStageId] = useState<VisualDevelopmentStageId>(
    DEFAULT_VISUAL_DEVELOPMENT_STAGE,
  )
  const [candidateCount, setCandidateCount] = useState<4 | 8 | 10>(10)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState('')
  const [form, setForm] = useState<CastingFormState>(EMPTY_FORM)
  const [batch, setBatch] = useState<CastingBatchView | null>(null)
  const [faceBatch, setFaceBatch] = useState<CastingBatchView | null>(null)
  const [faceForm, setFaceForm] = useState<FaceBibleFormState>(EMPTY_FACE_FORM)
  const [characterStatus, setCharacterStatus] = useState('draft')
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isGeneratingFace, setIsGeneratingFace] = useState(false)
  const modelsQuery = useUserModels()

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/projects?page=1&pageSize=100')
      if (!response.ok) return
      const data = await response.json() as { projects?: ProjectOption[] }
      const nextProjects = Array.isArray(data.projects) ? data.projects : []
      setProjects(nextProjects)
      setProjectId((current) => current || nextProjects[0]?.id || '')
    })()
  }, [])

  const loadWorkspace = useCallback(async (selectedProjectId: string) => {
    if (!selectedProjectId) {
      setBatch(null)
      setFaceBatch(null)
      return
    }
    setIsLoadingWorkspace(true)
    try {
      const response = await fetch(`/api/visual-development/${selectedProjectId}`)
      if (!response.ok) return
      const payload = await response.json() as WorkspaceResponse
      const workspace = payload.data?.workspace
      const character = workspace?.characters?.[0]
      const batches = character?.castingBatches ?? []
      setBatch(batches.find((item) => item.stage === 'casting') ?? null)
      setFaceBatch(batches.find((item) => item.stage === 'face-lock') ?? null)
      if (workspace && character) {
        setCharacterStatus(character.status)
        setForm((current) => ({
          ...current,
          worldBible: { ...current.worldBible, ...(workspace.worldBible ?? {}) },
          characterDna: { ...current.characterDna, ...(character.characterDna ?? {}) },
          castingBrief: { ...current.castingBrief, ...(character.castingBrief ?? {}) },
          characterCode: character.code,
          characterName: character.name,
        }))
        setFaceForm((current) => ({
          ...current,
          identityAnchors: character.characterDna?.identityAnchors ?? current.identityAnchors,
          allowedVariation: character.characterDna?.allowedVariation ?? current.allowedVariation,
          forbiddenDrift: character.characterDna?.forbiddenDrift ?? current.forbiddenDrift,
        }))
      }
    } finally {
      setIsLoadingWorkspace(false)
    }
  }, [])

  useEffect(() => {
    setBatch(null)
    setFaceBatch(null)
    setForm(EMPTY_FORM)
    setFaceForm(EMPTY_FACE_FORM)
    setCharacterStatus('draft')
    void loadWorkspace(projectId)
  }, [projectId, loadWorkspace])

  useEffect(() => {
    const hasActiveTasks = [batch, faceBatch].some((activeBatch) => activeBatch?.candidates.some((candidate) =>
      candidate.taskStatus === 'queued' || candidate.taskStatus === 'processing'))
    if (!projectId || !hasActiveTasks) return
    const timer = window.setInterval(() => void loadWorkspace(projectId), 3000)
    return () => window.clearInterval(timer)
  }, [batch, faceBatch, projectId, loadWorkspace])

  const updateField = useCallback((
    group: 'worldBible' | 'characterDna' | 'castingBrief',
    field: string,
    value: string,
  ) => {
    setForm((current) => ({ ...current, [group]: { ...current[group], [field]: value } }))
  }, [])

  const updateIdentity = useCallback((field: 'characterCode' | 'characterName' | 'modelKey' | 'resolution', value: string) => {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'modelKey' ? { resolution: '' } : {}),
    }))
  }, [])

  const generateCasting = useCallback(async () => {
    if (!projectId || !form.modelKey) return
    setIsGenerating(true)
    try {
      const response = await fetch(`/api/visual-development/${projectId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          candidateCount,
          aspectRatio: '4:5',
          meta: { locale },
        }),
      })
      const payload = await response.json() as { error?: { message?: string; details?: { message?: string } } }
      if (!response.ok && response.status !== 207) {
        window.alert(payload.error?.details?.message ?? payload.error?.message ?? t('workspace.casting.generateFailed'))
        return
      }
      await loadWorkspace(projectId)
    } finally {
      setIsGenerating(false)
    }
  }, [candidateCount, form, loadWorkspace, locale, projectId, t])

  const handleCandidateAction = useCallback(async (
    candidateId: string,
    action: 'shortlist' | 'canon-lock',
    shortlisted?: boolean,
  ) => {
    if (!projectId) return
    const response = await fetch(`/api/visual-development/${projectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ candidateId, action, shortlisted }),
    })
    if (!response.ok) {
      const payload = await response.json() as { error?: { message?: string } }
      window.alert(payload.error?.message ?? t('workspace.casting.actionFailed'))
      return
    }
    await loadWorkspace(projectId)
  }, [loadWorkspace, projectId, t])

  const referenceImageModels = useMemo(
    () => (modelsQuery.data?.image ?? []).filter((model) => model.capabilities?.image?.supportReferenceImage === true),
    [modelsQuery.data?.image],
  )

  const updateFaceField = useCallback((field: keyof FaceBibleFormState, value: string) => {
    if (field === 'modelKey') {
      const selected = referenceImageModels.find((model) => model.value === value)
      const ratios = selected?.capabilities?.image?.aspectRatioOptions ?? ['3:4']
      const preferredRatio = ['3:4', '4:5', '9:16', '1:1'].find((ratio) => ratios.includes(ratio)) ?? ratios[0] ?? ''
      setFaceForm((current) => ({ ...current, modelKey: value, resolution: '', aspectRatio: preferredRatio }))
      return
    }
    setFaceForm((current) => ({ ...current, [field]: value }))
  }, [referenceImageModels])

  const generateFaceBible = useCallback(async () => {
    if (!projectId || !faceForm.modelKey) return
    setIsGeneratingFace(true)
    try {
      const response = await fetch(`/api/visual-development/${projectId}/face-bible`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          characterCode: form.characterCode,
          modelKey: faceForm.modelKey,
          resolution: faceForm.resolution,
          aspectRatio: faceForm.aspectRatio,
          faceLockRecord: {
            identityAnchors: faceForm.identityAnchors,
            allowedVariation: faceForm.allowedVariation,
            forbiddenDrift: faceForm.forbiddenDrift,
          },
          meta: { locale },
        }),
      })
      const payload = await response.json() as { error?: { message?: string; details?: { message?: string } } }
      if (!response.ok && response.status !== 207) {
        window.alert(payload.error?.details?.message ?? payload.error?.message ?? t('workspace.face.generateFailed'))
        return
      }
      await loadWorkspace(projectId)
    } finally {
      setIsGeneratingFace(false)
    }
  }, [faceForm, form.characterCode, loadWorkspace, locale, projectId, t])

  const reviewFaceAsset = useCallback(async (candidateId: string, approved: boolean, rejectionNote?: string) => {
    if (!projectId) return
    const response = await fetch(`/api/visual-development/${projectId}/face-bible`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'asset-review', candidateId, approved, rejectionNote }),
    })
    if (!response.ok) {
      const payload = await response.json() as { error?: { message?: string } }
      window.alert(payload.error?.message ?? t('workspace.face.reviewFailed'))
      return
    }
    await loadWorkspace(projectId)
  }, [loadWorkspace, projectId, t])

  const lockFaceBible = useCallback(async () => {
    if (!projectId || !faceBatch) return
    const response = await fetch(`/api/visual-development/${projectId}/face-bible`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'face-bible-lock', batchId: faceBatch.id }),
    })
    if (!response.ok) {
      const payload = await response.json() as { error?: { message?: string } }
      window.alert(payload.error?.message ?? t('workspace.face.lockFailed'))
      return
    }
    await loadWorkspace(projectId)
  }, [faceBatch, loadWorkspace, projectId, t])

  const castingController = useMemo<CastingWorkspaceController>(() => ({
    batch,
    form,
    imageModels: modelsQuery.data?.image ?? [],
    isGenerating,
    isLoading: isLoadingWorkspace || modelsQuery.isLoading,
    onFieldChange: updateField,
    onIdentityChange: updateIdentity,
    onGenerate: () => void generateCasting(),
    onCandidateAction: (candidateId, action, shortlisted) => void handleCandidateAction(candidateId, action, shortlisted),
  }), [batch, form, generateCasting, handleCandidateAction, isGenerating, isLoadingWorkspace, modelsQuery.data?.image, modelsQuery.isLoading, updateField, updateIdentity])

  const canonCandidate = useMemo<CastingCandidateView | null>(
    () => batch?.candidates.find((candidate) => candidate.isCanon) ?? null,
    [batch],
  )

  const faceBibleController = useMemo<FaceBibleWorkspaceController>(() => ({
    batch: faceBatch,
    canonCandidate,
    characterCode: form.characterCode,
    characterStatus,
    form: faceForm,
    imageModels: referenceImageModels,
    isGenerating: isGeneratingFace,
    isLoading: isLoadingWorkspace || modelsQuery.isLoading,
    onFieldChange: updateFaceField,
    onGenerate: () => void generateFaceBible(),
    onReview: (candidateId, approved, rejectionNote) => void reviewFaceAsset(candidateId, approved, rejectionNote),
    onLock: () => void lockFaceBible(),
  }), [canonCandidate, characterStatus, faceBatch, faceForm, generateFaceBible, isGeneratingFace, isLoadingWorkspace, lockFaceBible, modelsQuery.isLoading, referenceImageModels, reviewFaceAsset, updateFaceField])

  const stages = useMemo<LocalizedDevelopmentStage[]>(
    () =>
      VISUAL_DEVELOPMENT_STAGES.map((stage) => ({
        ...stage,
        title: t(`stages.${stage.id}.title`),
        shortTitle: t(`stages.${stage.id}.shortTitle`),
        objective: t(`stages.${stage.id}.objective`),
        deliverables: toStringArray(t.raw(`stages.${stage.id}.deliverables`)),
        gate: t(`stages.${stage.id}.gate`),
      })),
    [t],
  )

  const activeStage = stages.find((stage) => stage.id === activeStageId) ?? stages[0]

  return (
    <div className="kuiper-stage flex min-h-screen flex-col overflow-hidden text-text-primary">
      <header className="relative z-30 border-b border-white/[0.07] bg-[#060607]/95 px-4 backdrop-blur-xl sm:px-6">
        <div className="flex min-h-[72px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <Link
              href={`/${locale}/v2`}
              aria-label={t('header.back')}
              title={t('header.back')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-text-secondary transition-colors hover:border-primary-500/40 hover:text-primary-400"
            >
              <AppIcon name="chevronLeft" className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.22em] text-primary-400">
                <span>{t('header.eyebrow')}</span>
                <span className="hidden h-px w-6 bg-primary-500/40 sm:block" />
                <span className="hidden text-text-tertiary sm:inline">{t('header.system')}</span>
              </div>
              <h1 className="mt-1 truncate font-serif-cn text-lg font-semibold text-white">
                {t('header.title')}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              aria-label={t('header.project')}
              className="hidden h-9 max-w-56 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[11px] text-text-secondary outline-none focus:border-primary-500/50 md:block"
            >
              <option value="">{t('header.noProject')}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <span className="rounded-lg border border-primary-500/25 bg-primary-500/[0.08] px-2.5 py-1.5 font-mono text-[9px] tracking-[0.16em] text-primary-400">
              {t('header.preview')}
            </span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)_304px]">
        <DevelopmentRail
          activeStageId={activeStageId}
          groups={{
            foundation: t('rail.groups.foundation'),
            identity: t('rail.groups.identity'),
            design: t('rail.groups.design'),
            production: t('rail.groups.production'),
          }}
          locale={locale}
          onSelect={setActiveStageId}
          stages={stages}
          title={t('rail.title')}
        />

        <StageWorkspace
          castingController={castingController}
          faceBibleController={faceBibleController}
          candidateCount={candidateCount}
          onCandidateCountChange={setCandidateCount}
          stage={activeStage}
          translations={{
            objective: t('workspace.objective'),
            deliverables: t('workspace.deliverables'),
            approvalGate: t('workspace.approvalGate'),
            previewNotice: t('workspace.previewNotice'),
            casting: {
              batch: t('workspace.casting.batch'),
              model: t('workspace.casting.model'),
              notConnected: t('workspace.casting.notConnected'),
              count: t('workspace.casting.count'),
              ratio: t('workspace.casting.ratio'),
              generate: t('workspace.casting.generate', { count: candidateCount }),
              waiting: t('workspace.casting.waiting'),
              seedPending: t('workspace.casting.seedPending'),
              candidate: t('workspace.casting.candidate'),
              seedUnsupported: t('workspace.casting.seedUnsupported'),
              seedApplied: t('workspace.casting.seedApplied'),
              projectSetup: t('workspace.casting.projectSetup'),
              worldPremise: t('workspace.casting.worldPremise'),
              visualThesis: t('workspace.casting.visualThesis'),
              characterName: t('workspace.casting.characterName'),
              characterCode: t('workspace.casting.characterCode'),
              characterRole: t('workspace.casting.characterRole'),
              coreTraits: t('workspace.casting.coreTraits'),
              apparentAge: t('workspace.casting.apparentAge'),
              ethnicity: t('workspace.casting.ethnicity'),
              faceStructure: t('workspace.casting.faceStructure'),
              emotionalRead: t('workspace.casting.emotionalRead'),
              lifeHistory: t('workspace.casting.lifeHistory'),
              resolution: t('workspace.casting.resolution'),
              modelBinding: t('workspace.casting.modelBinding'),
              generateHint: t('workspace.casting.generateHint'),
              shortlist: t('workspace.casting.shortlist'),
              canonLock: t('workspace.casting.canonLock'),
              canonLocked: t('workspace.casting.canonLocked'),
              generating: t('workspace.casting.generating'),
            },
            face: {
              canonSource: t('workspace.face.canonSource'),
              canonRequired: t('workspace.face.canonRequired'),
              identityRecord: t('workspace.face.identityRecord'),
              identityAnchors: t('workspace.face.identityAnchors'),
              allowedVariation: t('workspace.face.allowedVariation'),
              forbiddenDrift: t('workspace.face.forbiddenDrift'),
              modelBinding: t('workspace.face.modelBinding'),
              referenceOnly: t('workspace.face.referenceOnly'),
              modelRequired: t('workspace.face.modelRequired'),
              resolution: t('workspace.face.resolution'),
              aspectRatio: t('workspace.face.aspectRatio'),
              generate: t('workspace.face.generate'),
              generating: t('workspace.face.generating'),
              waiting: t('workspace.face.waiting'),
              approve: t('workspace.face.approve'),
              approved: t('workspace.face.approved'),
              reject: t('workspace.face.reject'),
              rejectionPrompt: t('workspace.face.rejectionPrompt'),
              lock: t('workspace.face.lock'),
              locked: t('workspace.face.locked'),
              lockHint: t('workspace.face.lockHint'),
              modelHint: t('workspace.face.modelHint'),
              seedUnsupported: t('workspace.face.seedUnsupported'),
            },
            board: {
              title: t('workspace.board.title'),
              description: t('workspace.board.description'),
              addReference: t('workspace.board.addReference'),
              emptySlot: t('workspace.board.emptySlot'),
            },
          }}
        />

        <DevelopmentInspector
          batch={activeStageId === 'face' ? faceBatch : batch}
          candidateCount={activeStageId === 'face' ? 10 : candidateCount}
          worldReady={Boolean(form.worldBible.projectPremise && form.worldBible.visualThesis)}
          characterReady={Boolean(form.characterName && form.characterDna.role && form.characterDna.coreTraits)}
          modelLabel={modelsQuery.data?.image.find((model) => model.value === (activeStageId === 'face' ? faceForm.modelKey : form.modelKey))?.label ?? null}
          labels={{
            title: t('inspector.title'),
            canon: t('inspector.canon'),
            promptStack: t('inspector.promptStack'),
            worldBible: t('inspector.worldBible'),
            characterDna: t('inspector.characterDna'),
            stageTemplate: t('inspector.stageTemplate'),
            modelAdapter: t('inspector.modelAdapter'),
            empty: t('inspector.empty'),
            loaded: t('inspector.loaded'),
            notConnected: t('inspector.notConnected'),
            seedRegistry: t('inspector.seedRegistry'),
            lockPolicy: t('inspector.lockPolicy'),
            lockPolicyDescription: t('inspector.lockPolicyDescription'),
            recordNotice: t('inspector.recordNotice'),
          }}
          stage={activeStage}
        />
      </div>
    </div>
  )
}
