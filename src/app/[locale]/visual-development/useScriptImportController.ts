'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UserModelOption } from '@/lib/query/hooks/useUserModels'
import type { ScriptAnalysisDocument, ScriptSourceFormat } from '@/lib/visual-development/script-analysis'
import type { ScriptImportWorkspaceController, ScriptSourceVersionView } from './visual-development-types'

type AnalysisResponse = {
  data?: {
    analysis?: ScriptAnalysisDocument | null
    sources?: ScriptSourceVersionView[]
    task?: { id: string; status: string; errorMessage?: string | null } | null
  }
  error?: { message?: string; details?: { message?: string } }
}

function responseError(payload: AnalysisResponse, fallback: string) {
  return payload.error?.details?.message ?? payload.error?.message ?? fallback
}

export function useScriptImportController(input: {
  projectId: string
  locale: string
  llmModels: UserModelOption[]
  onApplied: () => Promise<void>
}): ScriptImportWorkspaceController {
  const [sourceTitle, setSourceTitle] = useState('')
  const [sourceFormat, setSourceFormat] = useState<ScriptSourceFormat>('pasted')
  const [scriptText, setScriptText] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [analysis, setAnalysis] = useState<ScriptAnalysisDocument | null>(null)
  const [sources, setSources] = useState<ScriptSourceVersionView[]>([])
  const [sourceVersionId, setSourceVersionId] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<string | null>(null)
  const [selectedCharacterCodes, setSelectedCharacterCodes] = useState<string[]>([])
  const [applyWorldBible, setApplyWorldBible] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const analysisIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!modelKey && input.llmModels[0]) setModelKey(input.llmModels[0].value)
  }, [input.llmModels, modelKey])

  const refresh = useCallback(async () => {
    if (!input.projectId) return
    try {
      const response = await fetch(`/api/visual-development/${input.projectId}/script-analysis`)
      const payload = await response.json() as AnalysisResponse
      if (!response.ok) {
        setErrorMessage(responseError(payload, 'Unable to load screenplay analysis'))
        return
      }
      const nextAnalysis = payload.data?.analysis ?? null
      const nextTask = payload.data?.task ?? null
      setAnalysis(nextAnalysis)
      setSources(payload.data?.sources ?? [])
      setTaskStatus(nextTask?.status ?? null)
      setIsAnalyzing(nextTask?.status === 'queued' || nextTask?.status === 'processing')
      if (nextTask?.status === 'failed') setErrorMessage(nextTask.errorMessage ?? 'Screenplay analysis failed')
      if (nextAnalysis && analysisIdRef.current !== nextAnalysis.id) {
        analysisIdRef.current = nextAnalysis.id
        setSelectedCharacterCodes(nextAnalysis.characters.map((character) => character.code))
        setApplyWorldBible(true)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setIsAnalyzing(false)
    }
  }, [input.projectId])

  useEffect(() => {
    setAnalysis(null)
    setSources([])
    setSourceVersionId(null)
    setTaskStatus(null)
    setSelectedCharacterCodes([])
    setErrorMessage(null)
    analysisIdRef.current = null
    void refresh()
  }, [input.projectId, refresh])

  useEffect(() => {
    if (!isAnalyzing || !input.projectId) return
    const timer = window.setInterval(() => void refresh(), 3000)
    return () => window.clearInterval(timer)
  }, [input.projectId, isAnalyzing, refresh])

  const onFileSelected = useCallback(async (file: File) => {
    setIsUploading(true)
    setErrorMessage(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/files/extract-episodes', { method: 'POST', body: formData })
      const payload = await response.json() as {
        rawText?: string
        meta?: { sourceFormat?: ScriptSourceFormat }
        error?: { message?: string; details?: { message?: string } }
      }
      if (!response.ok || !payload.rawText) {
        setErrorMessage(payload.error?.details?.message ?? payload.error?.message ?? 'Unable to read screenplay file')
        return
      }
      setScriptText(payload.rawText)
      setSourceFormat(payload.meta?.sourceFormat ?? 'txt')
      const nextTitle = file.name.replace(/\.(docx|txt|md|markdown)$/i, '')
      setSourceTitle(nextTitle)
      if (!input.projectId) {
        setErrorMessage('Select or create a project before importing a screenplay')
        return
      }
      const sourceData = new FormData()
      sourceData.append('file', file)
      sourceData.append('scriptText', payload.rawText)
      sourceData.append('sourceTitle', nextTitle)
      const sourceResponse = await fetch(`/api/visual-development/${input.projectId}/script-source`, {
        method: 'POST',
        body: sourceData,
      })
      const sourcePayload = await sourceResponse.json() as { data?: { source?: ScriptSourceVersionView }; error?: { message?: string; details?: { message?: string } } }
      if (!sourceResponse.ok || !sourcePayload.data?.source) {
        setErrorMessage(sourcePayload.error?.details?.message ?? sourcePayload.error?.message ?? 'Unable to save screenplay source')
        return
      }
      setSourceVersionId(sourcePayload.data.source.id)
      await refresh()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsUploading(false)
    }
  }, [input.projectId, refresh])

  const onAnalyze = useCallback(async () => {
    if (!input.projectId || !modelKey || !sourceTitle.trim() || !scriptText.trim()) return
    setIsAnalyzing(true)
    setErrorMessage(null)
    try {
      let activeSourceId = sourceVersionId
      if (!activeSourceId) {
        const sourceResponse = await fetch(`/api/visual-development/${input.projectId}/script-source`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sourceTitle, scriptText }),
        })
        const sourcePayload = await sourceResponse.json() as { data?: { source?: ScriptSourceVersionView }; error?: { message?: string; details?: { message?: string } } }
        if (!sourceResponse.ok || !sourcePayload.data?.source) {
          setErrorMessage(sourcePayload.error?.details?.message ?? sourcePayload.error?.message ?? 'Unable to save screenplay source')
          setIsAnalyzing(false)
          return
        }
        activeSourceId = sourcePayload.data.source.id
        setSourceVersionId(activeSourceId)
      }
      const response = await fetch(`/api/visual-development/${input.projectId}/script-analysis`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: activeSourceId, sourceTitle, sourceFormat, modelKey, meta: { locale: input.locale } }),
      })
      const payload = await response.json() as AnalysisResponse
      if (!response.ok) {
        setErrorMessage(responseError(payload, 'Unable to start screenplay analysis'))
        setIsAnalyzing(false)
        return
      }
      setTaskStatus('queued')
      await refresh()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
      setIsAnalyzing(false)
    }
  }, [input.locale, input.projectId, modelKey, refresh, scriptText, sourceFormat, sourceTitle, sourceVersionId])

  const onToggleCharacter = useCallback((code: string) => {
    setSelectedCharacterCodes((current) => current.includes(code)
      ? current.filter((item) => item !== code)
      : [...current, code])
  }, [])

  const onApply = useCallback(async () => {
    if (!input.projectId || !analysis || (!applyWorldBible && selectedCharacterCodes.length === 0)) return
    setIsApplying(true)
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/visual-development/${input.projectId}/script-analysis`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'apply-analysis', applyWorldBible, characterCodes: selectedCharacterCodes }),
      })
      const payload = await response.json() as AnalysisResponse
      if (!response.ok) {
        setErrorMessage(responseError(payload, 'Unable to import screenplay analysis'))
        return
      }
      await Promise.all([refresh(), input.onApplied()])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsApplying(false)
    }
  }, [analysis, applyWorldBible, input, refresh, selectedCharacterCodes])

  return useMemo(() => ({
    sourceTitle,
    sourceFormat,
    scriptText,
    modelKey,
    llmModels: input.llmModels,
    analysis,
    sources,
    sourceVersionId,
    taskStatus,
    errorMessage,
    selectedCharacterCodes,
    applyWorldBible,
    isUploading,
    isAnalyzing,
    isApplying,
    onSourceTitleChange: (value: string) => { setSourceTitle(value); setSourceFormat('pasted'); setSourceVersionId(null) },
    onScriptTextChange: (value: string) => { setScriptText(value); setSourceFormat('pasted'); setSourceVersionId(null) },
    onModelChange: setModelKey,
    onFileSelected: (file: File) => void onFileSelected(file),
    onAnalyze: () => void onAnalyze(),
    onToggleCharacter,
    onSelectAllCharacters: (selected: boolean) => setSelectedCharacterCodes(selected && analysis ? analysis.characters.map((character) => character.code) : []),
    onApplyWorldBibleChange: setApplyWorldBible,
    onApply: () => void onApply(),
  }), [analysis, applyWorldBible, errorMessage, input.llmModels, isAnalyzing, isApplying, isUploading, modelKey, onAnalyze, onApply, onFileSelected, onToggleCharacter, scriptText, selectedCharacterCodes, sourceFormat, sourceTitle, sourceVersionId, sources, taskStatus])
}
