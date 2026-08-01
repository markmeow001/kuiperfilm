'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UserModelOption } from '@/lib/query/hooks/useUserModels'
import type { WorldAssetCode } from '@/lib/visual-development/world-bible'
import {
  getVisualDevelopmentAspectRatios,
  pickVisualDevelopmentAspectRatio,
  reconcileVisualDevelopmentAspectRatio,
} from '@/lib/visual-development/model-options'
import type {
  CandidateRegenerationSeedMode,
  WorldBibleAssetView,
  WorldBibleFormState,
  WorldBibleReferenceView,
  WorldBibleWorkspaceController,
} from './visual-development-types'
import type { ResearchStatus } from '@/lib/visual-development/research'

const EMPTY_FORM: WorldBibleFormState = {
  projectPremise: '',
  visualThesis: '',
  eraAndGeography: '',
  societyAndFactions: '',
  technologyRules: '',
  colorScript: '',
  materialRules: '',
  architectureLanguage: '',
  cameraFormat: '',
  forbiddenElements: '',
  modelKey: '',
  resolution: '',
  aspectRatio: '16:9',
}

type WorldBibleResponse = {
  data?: {
    worldBible?: Partial<WorldBibleFormState> & {
      references?: WorldBibleReferenceView[]
      assets?: WorldBibleAssetView[]
      status?: string
      version?: number
      canonId?: string | null
      researchStatus?: ResearchStatus
      inheritedReferenceCount?: number
      generationReservation?: { id: string } | null
      generationReservationActive?: boolean
    }
  }
  error?: { message?: string; details?: { message?: string } }
}

function errorMessage(payload: WorldBibleResponse, fallback: string): string {
  return payload.error?.details?.message ?? payload.error?.message ?? fallback
}

interface UseWorldBibleControllerInput {
  projectId: string
  locale: string
  imageModels: UserModelOption[]
  onWorldChanged: () => void
}

export function useWorldBibleController(input: UseWorldBibleControllerInput): WorldBibleWorkspaceController {
  const [form, setForm] = useState<WorldBibleFormState>(EMPTY_FORM)
  const [references, setReferences] = useState<WorldBibleReferenceView[]>([])
  const [assets, setAssets] = useState<WorldBibleAssetView[]>([])
  const [status, setStatus] = useState('draft')
  const [version, setVersion] = useState(1)
  const [canonId, setCanonId] = useState<string | null>(null)
  const [researchStatus, setResearchStatus] = useState<ResearchStatus>('draft')
  const [inheritedReferenceCount, setInheritedReferenceCount] = useState(0)
  const [generationReservationId, setGenerationReservationId] = useState<string | null>(null)
  const [generationReservationActive, setGenerationReservationActive] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [regeneratingAssetCodes, setRegeneratingAssetCodes] = useState<WorldAssetCode[]>([])
  const hydratedProjectRef = useRef('')
  const lastSavedSignatureRef = useRef('')
  const onWorldChangedRef = useRef(input.onWorldChanged)
  const recoveryInFlightRef = useRef(false)
  onWorldChangedRef.current = input.onWorldChanged

  const imageModels = useMemo(() => input.imageModels.filter((model) => {
    // Phase 00 uploads are internal-only. Only reviewed Phase -1 references
    // participate in provider capability filtering.
    const referenceCount = inheritedReferenceCount
    if (referenceCount === 0) return true
    if (referenceCount === 1) return model.capabilities?.image?.supportReferenceImage === true
    const capabilities = model.capabilities?.image
    const limit = capabilities?.maxReferenceImages ?? (capabilities?.supportMultiReferenceImage === true ? 2 : 1)
    return capabilities?.supportMultiReferenceImage === true && referenceCount <= limit
  }), [inheritedReferenceCount, input.imageModels])

  const load = useCallback(async () => {
    if (!input.projectId) {
      setForm(EMPTY_FORM)
      setReferences([])
      setAssets([])
      setStatus('draft')
      setVersion(1)
      setCanonId(null)
      setResearchStatus('draft')
      setInheritedReferenceCount(0)
      setGenerationReservationId(null)
      setGenerationReservationActive(false)
      hydratedProjectRef.current = ''
      lastSavedSignatureRef.current = ''
      return
    }
    setIsLoading(true)
    try {
      const response = await fetch(`/api/visual-development/${input.projectId}/world-bible`)
      const payload = await response.json() as WorldBibleResponse
      if (!response.ok) {
        window.alert(errorMessage(payload, 'World Bible 載入失敗'))
        return
      }
      const world = payload.data?.worldBible
      const loadedForm: WorldBibleFormState = {
        projectPremise: world?.projectPremise ?? '',
        visualThesis: world?.visualThesis ?? '',
        eraAndGeography: world?.eraAndGeography ?? '',
        societyAndFactions: world?.societyAndFactions ?? '',
        technologyRules: world?.technologyRules ?? '',
        colorScript: world?.colorScript ?? '',
        materialRules: world?.materialRules ?? '',
        architectureLanguage: world?.architectureLanguage ?? '',
        cameraFormat: world?.cameraFormat ?? '',
        forbiddenElements: world?.forbiddenElements ?? '',
        modelKey: world?.modelKey ?? '',
        resolution: world?.resolution ?? '',
        aspectRatio: world?.aspectRatio ?? '16:9',
      }
      setForm(loadedForm)
      setReferences(world?.references ?? [])
      setAssets(world?.assets ?? [])
      setStatus(world?.status ?? 'draft')
      setVersion(world?.version ?? 1)
      setCanonId(world?.canonId ?? null)
      setResearchStatus(world?.researchStatus ?? 'draft')
      setInheritedReferenceCount(world?.inheritedReferenceCount ?? 0)
      setGenerationReservationId(world?.generationReservation?.id ?? null)
      setGenerationReservationActive(world?.generationReservationActive === true)
      hydratedProjectRef.current = input.projectId
      lastSavedSignatureRef.current = JSON.stringify(loadedForm)
    } finally {
      setIsLoading(false)
    }
  }, [input.projectId])

  useEffect(() => { void load() }, [load])

  const recoverReservedGeneration = useCallback(async () => {
    if (!input.projectId || !generationReservationId || recoveryInFlightRef.current) return
    recoveryInFlightRef.current = true
    try {
      const response = await fetch(`/api/visual-development/${input.projectId}/world-bible`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'recover-generation' }),
      })
      if (response.ok) {
        await load()
        onWorldChangedRef.current()
      }
    } finally {
      recoveryInFlightRef.current = false
    }
  }, [generationReservationId, input.projectId, load])

  useEffect(() => {
    if (!generationReservationId) return
    void recoverReservedGeneration()
    const timer = window.setInterval(() => void recoverReservedGeneration(), 5000)
    return () => window.clearInterval(timer)
  }, [generationReservationId, recoverReservedGeneration])

  useEffect(() => {
    if (!form.modelKey || status === 'world_locked') return
    const selected = imageModels.find((model) => model.value === form.modelKey)
    if (!selected) return
    const aspectRatio = reconcileVisualDevelopmentAspectRatio(form.aspectRatio, selected.capabilities, 'image')
    if (aspectRatio !== form.aspectRatio) setForm((current) => ({ ...current, aspectRatio }))
  }, [form.aspectRatio, form.modelKey, imageModels, status])

  useEffect(() => {
    if (!input.projectId || hydratedProjectRef.current !== input.projectId || isLoading || status === 'world_locked') return
    const signature = JSON.stringify(form)
    if (signature === lastSavedSignatureRef.current) return
    const timer = window.setTimeout(() => {
      setIsSaving(true)
      void fetch(`/api/visual-development/${input.projectId}/world-bible`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldBible: form }),
      }).then((response) => {
        if (!response.ok) throw new Error('World Bible autosave failed')
        lastSavedSignatureRef.current = signature
        onWorldChangedRef.current()
      }).catch((error) => {
        window.alert(error instanceof Error ? error.message : String(error))
      }).finally(() => setIsSaving(false))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [form, input.projectId, isLoading, status])

  useEffect(() => {
    const active = assets.some((asset) => asset.taskStatus === 'queued' || asset.taskStatus === 'processing')
    if (!input.projectId || !active) return
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [assets, input.projectId, load])

  const persistForm = useCallback(async (): Promise<boolean> => {
    if (!input.projectId) return false
    const response = await fetch(`/api/visual-development/${input.projectId}/world-bible`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ worldBible: form }),
    })
    const payload = await response.json() as WorldBibleResponse
    if (!response.ok) {
      window.alert(errorMessage(payload, 'World Bible 儲存失敗'))
      return false
    }
    lastSavedSignatureRef.current = JSON.stringify(form)
    return true
  }, [form, input.projectId])

  const save = useCallback(async () => {
    setIsSaving(true)
    try {
      if (!await persistForm()) return
      await load()
      input.onWorldChanged()
    } finally {
      setIsSaving(false)
    }
  }, [input, load, persistForm])

  const uploadReferences = useCallback(async (files: FileList) => {
    if (!input.projectId || files.length === 0) return
    setIsUploading(true)
    try {
      if (!await persistForm()) return
      for (const file of Array.from(files)) {
        const data = new FormData()
        data.append('file', file)
        data.append('category', 'world-reference')
        const response = await fetch(`/api/visual-development/${input.projectId}/world-bible/reference`, {
          method: 'POST',
          body: data,
        })
        const payload = await response.json() as WorldBibleResponse
        if (!response.ok) {
          window.alert(errorMessage(payload, `參考素材上傳失敗：${file.name}`))
          break
        }
      }
      await load()
      input.onWorldChanged()
    } finally {
      setIsUploading(false)
    }
  }, [input, load, persistForm])

  const removeReference = useCallback(async (referenceId: string) => {
    if (!input.projectId) return
    if (!await persistForm()) return
    const response = await fetch(`/api/visual-development/${input.projectId}/world-bible/reference`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referenceId }),
    })
    const payload = await response.json() as WorldBibleResponse
    if (!response.ok) {
      window.alert(errorMessage(payload, '參考素材移除失敗'))
      return
    }
    await load()
    input.onWorldChanged()
  }, [input, load, persistForm])

  const generate = useCallback(async () => {
    const hasActiveGeneration = assets.some((asset) => asset.taskStatus === 'queued' || asset.taskStatus === 'processing')
    if (!input.projectId || !form.modelKey || hasActiveGeneration) return
    setIsGenerating(true)
    try {
      const response = await fetch(`/api/visual-development/${input.projectId}/world-bible`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldBible: form, modelKey: form.modelKey, meta: { locale: input.locale } }),
      })
      const payload = await response.json() as WorldBibleResponse
      if (!response.ok && response.status !== 207) {
        window.alert(errorMessage(payload, 'World Bible 資產生成失敗'))
        return
      }
      await load()
      input.onWorldChanged()
    } finally {
      setIsGenerating(false)
    }
  }, [assets, form, input, load])

  const patch = useCallback(async (body: Record<string, unknown>, fallback: string) => {
    if (!input.projectId) return
    const response = await fetch(`/api/visual-development/${input.projectId}/world-bible`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json() as WorldBibleResponse
    if (!response.ok) {
      window.alert(errorMessage(payload, fallback))
      return
    }
    await load()
    input.onWorldChanged()
  }, [input, load])

  const regenerateAsset = useCallback(async (
    code: WorldAssetCode,
    prompt: string,
    seedMode: CandidateRegenerationSeedMode,
  ) => {
    if (!input.projectId || regeneratingAssetCodes.includes(code)) return
    setRegeneratingAssetCodes((current) => [...current, code])
    try {
      const response = await fetch(`/api/visual-development/${input.projectId}/world-bible`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'regenerate-asset',
          code,
          prompt,
          seedMode,
          meta: { locale: input.locale },
        }),
      })
      const payload = await response.json() as WorldBibleResponse
      if (!response.ok) {
        window.alert(errorMessage(payload, 'World Bible 單張資產重生失敗'))
        return
      }
      await load()
      input.onWorldChanged()
    } finally {
      setRegeneratingAssetCodes((current) => current.filter((value) => value !== code))
    }
  }, [input, load, regeneratingAssetCodes])

  return {
    form,
    references,
    assets,
    status,
    version,
    canonId,
    researchStatus,
    inheritedReferenceCount,
    generationReservationId,
    generationReservationActive,
    imageModels,
    isLoading,
    isSaving,
    isGenerating,
    isUploading,
    regeneratingAssetCodes,
    onFieldChange: (field, value) => setForm((current) => {
      if (field !== 'modelKey') return { ...current, [field]: value }
      const selected = imageModels.find((model) => model.value === value)
      const ratios = selected ? getVisualDevelopmentAspectRatios(selected.capabilities, 'image') : []
      return {
        ...current,
        modelKey: value,
        resolution: '',
        aspectRatio: pickVisualDevelopmentAspectRatio(ratios, 'image'),
      }
    }),
    onSave: () => void save(),
    onUploadReferences: (files) => void uploadReferences(files),
    onRemoveReference: (referenceId) => void removeReference(referenceId),
    onGenerate: () => void generate(),
    onReviewAsset: (code: WorldAssetCode, approved: boolean, rejectionNote?: string) => void patch(
      { action: 'asset-review', code, approved, rejectionNote },
      'World Bible 資產審核失敗',
    ),
    onRegenerateAsset: (code, prompt, seedMode) => void regenerateAsset(code, prompt, seedMode),
    onLock: () => void patch({ action: 'canon-lock' }, 'World Bible 尚未符合鎖定條件'),
    onReload: () => void load(),
  }
}
