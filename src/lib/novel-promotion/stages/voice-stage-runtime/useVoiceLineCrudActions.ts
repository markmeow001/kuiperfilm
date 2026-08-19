'use client'

import { useCallback } from 'react'
import { shouldShowError } from '@/lib/error-utils'
import { getErrorMessage } from './utils'
import type { VoiceLine } from './types'

interface MutationLike<TInput = unknown, TOutput = unknown> {
  mutateAsync: (input: TInput) => Promise<TOutput>
}

interface UseVoiceLineCrudActionsParams {
  episodeId: string
  t: (key: string, values?: { content: string }) => string
  voiceLines: VoiceLine[]
  editingLineId: string | null
  editingContent: string
  editingSpeaker: string
  editingMatchedPanelId: string
  createClientRequestId: string | null
  setVoiceLines: React.Dispatch<React.SetStateAction<VoiceLine[]>>
  setSubmittingVoiceLineIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setIsSavingLineEditor: (value: boolean) => void
  getBoundPanelIdForLine: (line: VoiceLine) => string
  handleCancelEdit: () => void
  notifyVoiceLinesChanged: () => void
  createVoiceLineMutation: MutationLike<{ episodeId: string; content: string; speaker: string; matchedPanelId: string | null; clientRequestId: string }, { voiceLine: VoiceLine }>
  updateVoiceLineMutation: MutationLike<{ episodeId: string; lineId: string; content?: string; speaker?: string; matchedPanelId?: string | null; audioUrl?: string | null; emotionPrompt?: string | null; emotionStrength?: number }, { voiceLine: VoiceLine }>
  deleteVoiceLineMutation: MutationLike<{ episodeId: string; lineId: string }>
}

export function useVoiceLineCrudActions({
  episodeId,
  t,
  voiceLines,
  editingLineId,
  editingContent,
  editingSpeaker,
  editingMatchedPanelId,
  createClientRequestId,
  setVoiceLines,
  setSubmittingVoiceLineIds,
  setIsSavingLineEditor,
  getBoundPanelIdForLine,
  handleCancelEdit,
  notifyVoiceLinesChanged,
  createVoiceLineMutation,
  updateVoiceLineMutation,
  deleteVoiceLineMutation,
}: UseVoiceLineCrudActionsParams) {
  const handleSaveEdit = useCallback(async () => {
    const content = editingContent.trim()
    const speaker = editingSpeaker.trim()

    if (!content || !speaker) {
      alert(t('errors.invalidLineInput'))
      return
    }

    setIsSavingLineEditor(true)
    try {
      if (editingLineId) {
        const originalLine = voiceLines.find((line) => line.id === editingLineId)
        if (!originalLine) return

        const originalMatchedPanelId = getBoundPanelIdForLine(originalLine)
        if (
          content === originalLine.content &&
          speaker === originalLine.speaker &&
          editingMatchedPanelId === originalMatchedPanelId
        ) {
          handleCancelEdit()
          return
        }

        const data = await updateVoiceLineMutation.mutateAsync({
          episodeId,
          lineId: editingLineId,
          content,
          speaker,
          matchedPanelId: editingMatchedPanelId || null,
        })
        const updatedLine = data.voiceLine as VoiceLine
        setVoiceLines((prev) => prev.map((line) => (line.id === editingLineId ? updatedLine : line)))
      } else {
        if (!createClientRequestId) {
          throw new Error('VOICE_LINE_DRAFT_KEY_MISSING')
        }
        const data = await createVoiceLineMutation.mutateAsync({
          episodeId,
          content,
          speaker,
          matchedPanelId: editingMatchedPanelId || null,
          clientRequestId: createClientRequestId,
        })
        const createdLine = data.voiceLine as VoiceLine
        setVoiceLines((prev) => [...prev, createdLine].sort((left, right) => left.lineIndex - right.lineIndex))
      }

      notifyVoiceLinesChanged()
      handleCancelEdit()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        const message = editingLineId ? t('errors.saveFailed') : t('errors.addFailed')
        alert(`${message}: ${getErrorMessage(error)}`)
      }
    } finally {
      setIsSavingLineEditor(false)
    }
  }, [
    createVoiceLineMutation,
    createClientRequestId,
    editingContent,
    editingLineId,
    editingMatchedPanelId,
    editingSpeaker,
    episodeId,
    getBoundPanelIdForLine,
    handleCancelEdit,
    notifyVoiceLinesChanged,
    setIsSavingLineEditor,
    setVoiceLines,
    t,
    updateVoiceLineMutation,
    voiceLines,
  ])

  const handleDeleteLine = useCallback(async (lineId: string) => {
    const line = voiceLines.find((item) => item.id === lineId)
    if (!line) return

    const content = line.content.slice(0, 50) + (line.content.length > 50 ? '...' : '')
    const confirmed = window.confirm(t('confirm.deleteLine', { content }))
    if (!confirmed) return

    try {
      await deleteVoiceLineMutation.mutateAsync({ episodeId, lineId })
      setVoiceLines((prev) => {
        const filtered = prev.filter((item) => item.id !== lineId)
        return filtered.map((item, index) => ({ ...item, lineIndex: index + 1 }))
      })
      setSubmittingVoiceLineIds((prev) => {
        if (!prev.has(lineId)) return prev
        const next = new Set(prev)
        next.delete(lineId)
        return next
      })
      notifyVoiceLinesChanged()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(`${t('errors.deleteFailed')}: ${getErrorMessage(error)}`)
      }
    }
  }, [
    deleteVoiceLineMutation,
    episodeId,
    notifyVoiceLinesChanged,
    setSubmittingVoiceLineIds,
    setVoiceLines,
    t,
    voiceLines,
  ])

  const handleDeleteAudio = useCallback(async (lineId: string) => {
    const line = voiceLines.find((item) => item.id === lineId)
    if (!line || !line.audioUrl) return

    const content = line.content.slice(0, 50) + (line.content.length > 50 ? '...' : '')
    const confirmed = window.confirm(t('confirm.deleteAudio', { content }))
    if (!confirmed) return

    try {
      await updateVoiceLineMutation.mutateAsync({ episodeId, lineId, audioUrl: null })
      setVoiceLines((prev) => prev.map((item) => (item.id === lineId ? { ...item, audioUrl: null } : item)))
      notifyVoiceLinesChanged()
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(`${t('errors.deleteAudioFailed')}: ${getErrorMessage(error)}`)
      }
    }
  }, [episodeId, notifyVoiceLinesChanged, setVoiceLines, t, updateVoiceLineMutation, voiceLines])

  const handleSaveEmotionSettings = useCallback(async (
    lineId: string,
    emotionPrompt: string | null,
    emotionStrength: number,
  ) => {
    try {
      await updateVoiceLineMutation.mutateAsync({ episodeId, lineId, emotionPrompt, emotionStrength })
      setVoiceLines((prev) => prev.map((line) => (
        line.id === lineId ? { ...line, emotionPrompt, emotionStrength } : line
      )))
    } catch (error: unknown) {
      if (shouldShowError(error)) {
        alert(`${t('errors.emotionSaveFailed')}: ${getErrorMessage(error)}`)
      }
    }
  }, [episodeId, setVoiceLines, t, updateVoiceLineMutation])

  return {
    handleSaveEdit,
    handleDeleteLine,
    handleDeleteAudio,
    handleSaveEmotionSettings,
  }
}
