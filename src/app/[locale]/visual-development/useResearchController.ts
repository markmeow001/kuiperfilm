'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_RESEARCH,
  evaluateResearchGate,
  type ResearchGateResult,
  type ResearchStatus,
} from '@/lib/visual-development/research'
import type {
  ResearchFormState,
  ResearchReferenceMetadata,
  ResearchReferenceView,
  ResearchWorkspaceController,
} from './visual-development-types'

const EMPTY_FORM: ResearchFormState = {
  designQuestion: '',
  visualHypothesis: '',
  eraAndCulture: '',
  materialReality: '',
  cinematicLanguage: '',
  culturalBoundaries: '',
  assumptionsAndUnknowns: '',
  sourcePolicy: '',
}

const EMPTY_GATE: ResearchGateResult = evaluateResearchGate(EMPTY_RESEARCH)

type ResearchResponse = {
  data?: {
    research?: Partial<ResearchFormState> & {
      references?: ResearchReferenceView[]
      status?: ResearchStatus
      version?: number
      canonId?: string | null
      gate?: ResearchGateResult
    }
    worldStatus?: string
  }
  error?: { message?: string; details?: { message?: string } }
}

function errorMessage(payload: ResearchResponse, fallback: string): string {
  return payload.error?.details?.message ?? payload.error?.message ?? fallback
}

interface UseResearchControllerInput {
  projectId: string
  onResearchChanged: () => void
}

export function useResearchController(input: UseResearchControllerInput): ResearchWorkspaceController {
  const [form, setForm] = useState<ResearchFormState>(EMPTY_FORM)
  const [references, setReferences] = useState<ResearchReferenceView[]>([])
  const [gate, setGate] = useState<ResearchGateResult>(EMPTY_GATE)
  const [status, setStatus] = useState<ResearchStatus>('draft')
  const [version, setVersion] = useState(1)
  const [canonId, setCanonId] = useState<string | null>(null)
  const [worldStatus, setWorldStatus] = useState('draft')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const hydratedProjectRef = useRef('')
  const savedSignatureRef = useRef('')
  const onResearchChangedRef = useRef(input.onResearchChanged)
  onResearchChangedRef.current = input.onResearchChanged

  const load = useCallback(async () => {
    if (!input.projectId) {
      setForm(EMPTY_FORM)
      setReferences([])
      setGate(EMPTY_GATE)
      setStatus('draft')
      setVersion(1)
      setCanonId(null)
      setWorldStatus('draft')
      hydratedProjectRef.current = ''
      savedSignatureRef.current = ''
      return
    }
    setIsLoading(true)
    try {
      const response = await fetch(`/api/visual-development/${input.projectId}/research`)
      const payload = await response.json() as ResearchResponse
      if (!response.ok) {
        window.alert(errorMessage(payload, '參考考據載入失敗'))
        return
      }
      const research = payload.data?.research
      const nextForm: ResearchFormState = {
        designQuestion: research?.designQuestion ?? '',
        visualHypothesis: research?.visualHypothesis ?? '',
        eraAndCulture: research?.eraAndCulture ?? '',
        materialReality: research?.materialReality ?? '',
        cinematicLanguage: research?.cinematicLanguage ?? '',
        culturalBoundaries: research?.culturalBoundaries ?? '',
        assumptionsAndUnknowns: research?.assumptionsAndUnknowns ?? '',
        sourcePolicy: research?.sourcePolicy ?? '',
      }
      setForm(nextForm)
      setReferences(research?.references ?? [])
      setGate(research?.gate ?? EMPTY_GATE)
      setStatus(research?.status ?? 'draft')
      setVersion(research?.version ?? 1)
      setCanonId(research?.canonId ?? null)
      setWorldStatus(payload.data?.worldStatus ?? 'draft')
      hydratedProjectRef.current = input.projectId
      savedSignatureRef.current = JSON.stringify(nextForm)
    } finally {
      setIsLoading(false)
    }
  }, [input.projectId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (
      !input.projectId
      || hydratedProjectRef.current !== input.projectId
      || isLoading
      || status === 'locked'
      || worldStatus === 'world_locked'
    ) return
    const signature = JSON.stringify(form)
    if (signature === savedSignatureRef.current) return
    const timer = window.setTimeout(() => {
      setIsSaving(true)
      void fetch(`/api/visual-development/${input.projectId}/research`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ research: form }),
      }).then(async (response) => {
        const payload = await response.json() as ResearchResponse
        if (!response.ok) throw new Error(errorMessage(payload, '參考考據自動儲存失敗'))
        savedSignatureRef.current = signature
        if (payload.data?.research?.gate) setGate(payload.data.research.gate)
        onResearchChangedRef.current()
      }).catch((error) => {
        window.alert(error instanceof Error ? error.message : String(error))
      }).finally(() => setIsSaving(false))
    }, 900)
    return () => window.clearTimeout(timer)
  }, [form, input.projectId, isLoading, status, worldStatus])

  const persist = useCallback(async (): Promise<boolean> => {
    if (!input.projectId) return false
    const response = await fetch(`/api/visual-development/${input.projectId}/research`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ research: form }),
    })
    const payload = await response.json() as ResearchResponse
    if (!response.ok) {
      window.alert(errorMessage(payload, '參考考據儲存失敗'))
      return false
    }
    savedSignatureRef.current = JSON.stringify(form)
    if (payload.data?.research?.gate) setGate(payload.data.research.gate)
    return true
  }, [form, input.projectId])

  const save = useCallback(async () => {
    setIsSaving(true)
    try {
      if (!await persist()) return
      await load()
      input.onResearchChanged()
    } finally {
      setIsSaving(false)
    }
  }, [input, load, persist])

  const uploadReference = useCallback(async (file: File, metadata: ResearchReferenceMetadata) => {
    if (!input.projectId) return
    setIsUploading(true)
    try {
      if (!await persist()) return
      const data = new FormData()
      data.append('file', file)
      for (const [key, value] of Object.entries(metadata)) data.append(key, String(value))
      const response = await fetch(`/api/visual-development/${input.projectId}/research/reference`, {
        method: 'POST',
        body: data,
      })
      const payload = await response.json() as ResearchResponse
      if (!response.ok) {
        window.alert(errorMessage(payload, `參考素材上傳失敗：${file.name}`))
        return
      }
      await load()
      input.onResearchChanged()
    } finally {
      setIsUploading(false)
    }
  }, [input, load, persist])

  const removeReference = useCallback(async (referenceId: string) => {
    if (!input.projectId) return
    const response = await fetch(`/api/visual-development/${input.projectId}/research/reference`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referenceId }),
    })
    const payload = await response.json() as ResearchResponse
    if (!response.ok) {
      window.alert(errorMessage(payload, '參考素材移除失敗'))
      return
    }
    await load()
    input.onResearchChanged()
  }, [input, load])

  const patch = useCallback(async (body: Record<string, unknown>, fallback: string) => {
    if (!input.projectId) return
    const response = await fetch(`/api/visual-development/${input.projectId}/research`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json() as ResearchResponse
    if (!response.ok) {
      window.alert(errorMessage(payload, fallback))
      return
    }
    await load()
    input.onResearchChanged()
  }, [input, load])

  const lock = useCallback(async () => {
    if (!await persist()) return
    await patch({ action: 'canon-lock' }, 'Research Canon 尚未符合鎖定條件')
  }, [patch, persist])

  return {
    form,
    references,
    gate,
    status,
    version,
    canonId,
    worldStatus,
    isLoading,
    isSaving,
    isUploading,
    onFieldChange: (field, value) => setForm((current) => ({ ...current, [field]: value })),
    onSave: () => void save(),
    onUploadReference: (file, metadata) => void uploadReference(file, metadata),
    onRemoveReference: (referenceId) => void removeReference(referenceId),
    onReviewReference: (referenceId, approved, rejectionNote) => void patch({
      action: 'reference-review',
      referenceId,
      approved,
      rejectionNote,
    }, '參考素材審核失敗'),
    onSetReferenceProcessing: (referenceId, externalProcessingAllowed, downstreamEnabled) => void patch({
      action: 'reference-processing',
      referenceId,
      externalProcessingAllowed,
      downstreamEnabled,
    }, '參考素材外部處理設定失敗'),
    onLock: () => void lock(),
    onReload: () => void load(),
  }
}
