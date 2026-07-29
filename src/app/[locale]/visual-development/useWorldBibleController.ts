'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UserModelOption } from '@/lib/query/hooks/useUserModels'
import type { WorldAssetCode } from '@/lib/visual-development/world-bible'
import type {
  WorldBibleAssetView,
  WorldBibleFormState,
  WorldBibleReferenceView,
  WorldBibleWorkspaceController,
} from './visual-development-types'

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
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const imageModels = useMemo(() => input.imageModels.filter((model) => {
    if (references.length === 0) return true
    if (references.length === 1) return model.capabilities?.image?.supportReferenceImage === true
    return model.capabilities?.image?.supportMultiReferenceImage === true
  }), [input.imageModels, references.length])

  const load = useCallback(async () => {
    if (!input.projectId) {
      setForm(EMPTY_FORM)
      setReferences([])
      setAssets([])
      setStatus('draft')
      setVersion(1)
      setCanonId(null)
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
      setForm((current) => ({
        ...current,
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
        modelKey: world?.modelKey ?? current.modelKey,
        resolution: world?.resolution ?? '',
        aspectRatio: world?.aspectRatio ?? '16:9',
      }))
      setReferences(world?.references ?? [])
      setAssets(world?.assets ?? [])
      setStatus(world?.status ?? 'draft')
      setVersion(world?.version ?? 1)
      setCanonId(world?.canonId ?? null)
    } finally {
      setIsLoading(false)
    }
  }, [input.projectId])

  useEffect(() => { void load() }, [load])

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
    if (!input.projectId || !form.modelKey) return
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
  }, [form, input, load])

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

  return {
    form,
    references,
    assets,
    status,
    version,
    canonId,
    imageModels,
    isLoading,
    isSaving,
    isGenerating,
    isUploading,
    onFieldChange: (field, value) => setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'modelKey' ? { resolution: '' } : {}),
    })),
    onSave: () => void save(),
    onUploadReferences: (files) => void uploadReferences(files),
    onRemoveReference: (referenceId) => void removeReference(referenceId),
    onGenerate: () => void generate(),
    onReviewAsset: (code: WorldAssetCode, approved: boolean, rejectionNote?: string) => void patch(
      { action: 'asset-review', code, approved, rejectionNote },
      'World Bible 資產審核失敗',
    ),
    onLock: () => void patch({ action: 'canon-lock' }, 'World Bible 尚未符合鎖定條件'),
  }
}
