'use client'

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { CastingFormState, FaceBibleFormState, ProjectOption } from './visual-development-types'

export function useVisualDevelopmentProjectSelection(createFailedMessage: string) {
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState('')

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/projects?page=1&pageSize=100')
      if (!response.ok) return
      const data = await response.json() as { projects?: ProjectOption[] }
      const nextProjects = Array.isArray(data.projects) ? data.projects : []
      setProjects(nextProjects)
      const requestedProjectId = new URLSearchParams(window.location.search).get('projectId') ?? ''
      setProjectId((current) => current || nextProjects.find((project) => project.id === requestedProjectId)?.id || nextProjects[0]?.id || '')
    })()
  }, [])

  const changeProject = useCallback((nextProjectId: string) => {
    setProjectId(nextProjectId)
    const url = new URL(window.location.href)
    if (nextProjectId) url.searchParams.set('projectId', nextProjectId)
    else url.searchParams.delete('projectId')
    window.history.replaceState(null, '', url)
  }, [])

  const createProject = useCallback(async (input: { name: string; description: string }) => {
    const response = await fetch('/api/projects', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: input.name, description: input.description, generationMode: 'r2v-narrative' }),
    })
    const payload = await response.json() as { project?: ProjectOption; error?: { message?: string; details?: { message?: string } } }
    if (!response.ok || !payload.project) {
      window.alert(payload.error?.details?.message ?? payload.error?.message ?? createFailedMessage)
      throw new Error('PROJECT_CREATE_FAILED')
    }
    setProjects((current) => [payload.project as ProjectOption, ...current.filter((project) => project.id !== payload.project?.id)])
    changeProject(payload.project.id)
  }, [changeProject, createFailedMessage])

  return { projects, projectId, changeProject, createProject }
}

export function useVisualDevelopmentCharacterAutosave(input: {
  projectId: string
  characterCode: string
  form: CastingFormState
  faceForm: FaceBibleFormState
  isLoading: boolean
  revisionRef: MutableRefObject<string>
}) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedDraftRef = useRef('')
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const activeScopeRef = useRef('')
  const scopeKey = `${input.projectId}:${input.characterCode.trim().toUpperCase()}`
  activeScopeRef.current = scopeKey

  useEffect(() => {
    lastSavedDraftRef.current = ''
    setSaveStatus('idle')
  }, [scopeKey])

  useEffect(() => {
    const characterCode = input.form.characterCode.trim().toUpperCase()
    const characterName = input.form.characterName.trim()
    if (!input.projectId || !characterName || !/^[A-Z0-9][A-Z0-9_-]+$/.test(characterCode) || input.isLoading) return
    const draft = {
      characterCode,
      characterName,
      characterDna: {
        ...input.form.characterDna,
        identityAnchors: input.faceForm.identityAnchors,
        allowedVariation: input.faceForm.allowedVariation,
        forbiddenDrift: input.faceForm.forbiddenDrift,
      },
      castingBrief: input.form.castingBrief,
    }
    const signature = JSON.stringify(draft)
    if (signature === lastSavedDraftRef.current) return
    const timer = window.setTimeout(() => {
      const requestScope = scopeKey
      const pending = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (activeScopeRef.current !== requestScope) return
          setSaveStatus('saving')
          const response = await fetch(`/api/visual-development/${input.projectId}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              ...draft,
              ...(input.revisionRef.current ? { expectedUpdatedAt: input.revisionRef.current } : {}),
            }),
          })
          const payload = await response.json() as {
            data?: { character?: { updatedAt?: string } | null }
            error?: { message?: string }
          }
          if (!response.ok) throw new Error(payload.error?.message ?? 'Autosave failed')
          if (activeScopeRef.current !== requestScope) return
          if (payload.data?.character?.updatedAt) input.revisionRef.current = payload.data.character.updatedAt
          lastSavedDraftRef.current = signature
          setSaveStatus('saved')
        })
      saveQueueRef.current = pending
      void pending.catch(() => {
        if (activeScopeRef.current === requestScope) setSaveStatus('error')
      })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [input.faceForm, input.form, input.isLoading, input.projectId, input.revisionRef, scopeKey])

  return saveStatus
}
