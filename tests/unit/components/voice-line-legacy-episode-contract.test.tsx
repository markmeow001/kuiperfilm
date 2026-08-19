import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceLineCrudActions } from '@/lib/novel-promotion/stages/voice-stage-runtime/useVoiceLineCrudActions'
import type { VoiceLine } from '@/lib/novel-promotion/stages/voice-stage-runtime/types'

const line: VoiceLine = {
  id: 'line-1',
  lineIndex: 1,
  speaker: 'Ann',
  content: 'Original',
  emotionPrompt: null,
  emotionStrength: 0.4,
  audioUrl: '/m/old-audio',
  lineTaskRunning: false,
  matchedPanelId: 'panel-1',
}

describe('legacy voice line CRUD episode contract', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'alert').mockImplementation(() => undefined)
  })

  it('[legacy save/delete/audio/emotion paths] -> [every line mutation carries episodeId]', async () => {
    const updateMutation = {
      mutateAsync: vi.fn(async () => ({ voiceLine: { ...line, content: 'Updated' } })),
    }
    const deleteMutation = { mutateAsync: vi.fn(async () => undefined) }
    const { result } = renderHook(() => useVoiceLineCrudActions({
      episodeId: 'episode-A1',
      t: (key) => key,
      voiceLines: [line],
      editingLineId: 'line-1',
      editingContent: 'Updated',
      editingSpeaker: 'Ann',
      editingMatchedPanelId: 'panel-1',
      createClientRequestId: null,
      setVoiceLines: vi.fn(),
      setSubmittingVoiceLineIds: vi.fn(),
      setIsSavingLineEditor: vi.fn(),
      getBoundPanelIdForLine: (candidate) => candidate.matchedPanelId ?? '',
      handleCancelEdit: vi.fn(),
      notifyVoiceLinesChanged: vi.fn(),
      createVoiceLineMutation: { mutateAsync: vi.fn() },
      updateVoiceLineMutation: updateMutation,
      deleteVoiceLineMutation: deleteMutation,
    }))

    await act(async () => {
      await result.current.handleSaveEdit()
      await result.current.handleDeleteLine('line-1')
      await result.current.handleDeleteAudio('line-1')
      await result.current.handleSaveEmotionSettings('line-1', 'tense', 0.7)
    })

    expect(updateMutation.mutateAsync).toHaveBeenNthCalledWith(1, {
      episodeId: 'episode-A1',
      lineId: 'line-1',
      content: 'Updated',
      speaker: 'Ann',
      matchedPanelId: 'panel-1',
    })
    expect(deleteMutation.mutateAsync).toHaveBeenCalledWith({
      episodeId: 'episode-A1',
      lineId: 'line-1',
    })
    expect(updateMutation.mutateAsync).toHaveBeenNthCalledWith(2, {
      episodeId: 'episode-A1',
      lineId: 'line-1',
      audioUrl: null,
    })
    expect(updateMutation.mutateAsync).toHaveBeenNthCalledWith(3, {
      episodeId: 'episode-A1',
      lineId: 'line-1',
      emotionPrompt: 'tense',
      emotionStrength: 0.7,
    })
  })

  it('[legacy add response is lost then retried] -> [logical draft reuses one clientRequestId]', async () => {
    const createMutation = {
      mutateAsync: vi.fn()
        .mockRejectedValueOnce(new Error('network response lost'))
        .mockResolvedValueOnce({ voiceLine: { ...line, id: 'line-created' } }),
    }
    const handleCancelEdit = vi.fn()
    const { result } = renderHook(() => useVoiceLineCrudActions({
      episodeId: 'episode-A1',
      t: (key) => key,
      voiceLines: [],
      editingLineId: null,
      editingContent: 'New dialogue',
      editingSpeaker: 'Ann',
      editingMatchedPanelId: 'panel-1',
      createClientRequestId: '11111111-1111-4111-8111-111111111111',
      setVoiceLines: vi.fn(),
      setSubmittingVoiceLineIds: vi.fn(),
      setIsSavingLineEditor: vi.fn(),
      getBoundPanelIdForLine: () => '',
      handleCancelEdit,
      notifyVoiceLinesChanged: vi.fn(),
      createVoiceLineMutation: createMutation,
      updateVoiceLineMutation: { mutateAsync: vi.fn() },
      deleteVoiceLineMutation: { mutateAsync: vi.fn() },
    }))

    await act(async () => {
      await result.current.handleSaveEdit()
      await result.current.handleSaveEdit()
    })

    const expectedPayload = {
      episodeId: 'episode-A1',
      content: 'New dialogue',
      speaker: 'Ann',
      matchedPanelId: 'panel-1',
      clientRequestId: '11111111-1111-4111-8111-111111111111',
    }
    expect(createMutation.mutateAsync).toHaveBeenNthCalledWith(1, expectedPayload)
    expect(createMutation.mutateAsync).toHaveBeenNthCalledWith(2, expectedPayload)
    expect(handleCancelEdit).toHaveBeenCalledTimes(1)
  })
})
