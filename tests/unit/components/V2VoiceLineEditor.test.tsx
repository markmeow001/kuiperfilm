import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import enVoice from '../../../messages/en/v2Voice.json'
import { VoiceLinePanel } from '@/app/[locale]/v2/workspace/[projectId]/voice/VoiceLinePanel'
import type {
  VoiceLine,
  VoiceLineDraftPayload,
} from '@/app/[locale]/v2/workspace/[projectId]/voice/voice-workspace-types'

const line: VoiceLine = {
  id: 'line-1',
  lineIndex: 1,
  speaker: 'Narrator',
  content: 'The old line',
  emotionPrompt: null,
  emotionStrength: 0.4,
  audioUrl: null,
  lineTaskRunning: false,
  matchedPanelId: 'panel-1',
  matchedStoryboardId: 'storyboard-1',
  matchedPanelIndex: 0,
}

const panelOptions = [
  { id: 'panel-1', label: 'Shot 1 — opening' },
  { id: 'panel-2', label: 'Shot 2 — close-up' },
]

function renderPanel(input: {
  canEdit?: boolean
  voiceLines?: VoiceLine[]
  panelQueryState?: 'loading' | 'error' | 'ready'
  onCreate?: (payload: VoiceLineDraftPayload) => Promise<void>
  onUpdate?: (payload: VoiceLineDraftPayload & { lineId: string }) => Promise<void>
  onDelete?: (lineId: string) => Promise<void>
  onRetryPanels?: () => void
} = {}) {
  const props = {
    canEdit: input.canEdit ?? true,
    voiceLines: input.voiceLines ?? [line],
    panelOptions,
    panelQueryState: input.panelQueryState ?? 'ready',
    taskStatesByLineId: new Map(),
    boundSpeakers: new Set<string>(),
    playingKey: null,
    savingLineId: null,
    submittingLineIds: new Set<string>(),
    onTogglePreview: vi.fn(),
    onGenerate: vi.fn(),
    onSaveEmotion: vi.fn(),
    onCreate: input.onCreate ?? vi.fn(async () => undefined),
    onUpdate: input.onUpdate ?? vi.fn(async () => undefined),
    onDelete: input.onDelete ?? vi.fn(async () => undefined),
    onRetryPanels: input.onRetryPanels ?? vi.fn(),
  }

  const rendered = render(
    <NextIntlClientProvider locale="en" messages={{ v2Voice: enVoice }}>
      <VoiceLinePanel {...props} />
    </NextIntlClientProvider>,
  )
  return { ...rendered, props }
}

describe('V2 Voice line editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
  })

  it('[create fails once] -> [keeps exact draft and retries the same owned-panel payload]', async () => {
    const onCreate = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 409 — reload and retry'))
      .mockResolvedValueOnce(undefined)
    renderPanel({ voiceLines: [], onCreate })

    fireEvent.click(screen.getByRole('button', { name: 'Add dialogue line' }))
    const form = screen.getByRole('form', { name: 'Add dialogue line' })
    fireEvent.change(within(form).getByLabelText('Dialogue text'), {
      target: { value: '  A new line  ' },
    })
    fireEvent.change(within(form).getByLabelText('Speaker'), {
      target: { value: '  Ann  ' },
    })
    fireEvent.change(within(form).getByLabelText('Shot binding'), {
      target: { value: 'panel-2' },
    })

    fireEvent.click(within(form).getByRole('button', { name: 'Add line' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('HTTP 409 — reload and retry')
    expect(within(form).getByLabelText('Dialogue text')).toHaveValue('  A new line  ')
    expect(within(form).getByLabelText('Speaker')).toHaveValue('  Ann  ')
    expect(within(form).getByLabelText('Shot binding')).toHaveValue('panel-2')

    fireEvent.click(within(form).getByRole('button', { name: 'Retry add' }))
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2))
    const firstPayload = onCreate.mock.calls[0]?.[0] as VoiceLineDraftPayload
    const secondPayload = onCreate.mock.calls[1]?.[0] as VoiceLineDraftPayload
    expect(firstPayload).toMatchObject({
      content: 'A new line',
      speaker: 'Ann',
      matchedPanelId: 'panel-2',
    })
    expect(firstPayload.clientRequestId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(secondPayload).toEqual({
      content: 'A new line',
      speaker: 'Ann',
      matchedPanelId: 'panel-2',
      clientRequestId: firstPayload.clientRequestId,
    })
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Add dialogue line' })).not.toBeInTheDocument()
    })
  })

  it('[editor updates text, speaker and panel] -> [submits one exact line payload]', async () => {
    const onUpdate = vi.fn(async () => undefined)
    renderPanel({ onUpdate })

    fireEvent.click(screen.getByRole('button', { name: 'Edit line 1' }))
    const form = screen.getByRole('form', { name: 'Edit line 1' })
    fireEvent.change(within(form).getByLabelText('Dialogue text'), {
      target: { value: 'Rewritten line' },
    })
    fireEvent.change(within(form).getByLabelText('Speaker'), {
      target: { value: 'Ann' },
    })
    fireEvent.change(within(form).getByLabelText('Shot binding'), {
      target: { value: 'panel-2' },
    })
    fireEvent.click(within(form).getByRole('button', { name: 'Save line' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({
      lineId: 'line-1',
      content: 'Rewritten line',
      speaker: 'Ann',
      matchedPanelId: 'panel-2',
    }))
  })

  it('[delete fails once] -> [keeps the line and exposes an explicit retry]', async () => {
    const onDelete = vi.fn()
      .mockRejectedValueOnce(new Error('Delete conflict'))
      .mockResolvedValueOnce(undefined)
    renderPanel({ onDelete })

    fireEvent.click(screen.getByRole('button', { name: 'Delete line 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Delete conflict')
    expect(screen.getByText('The old line')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry delete line 1' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2))
    expect(onDelete).toHaveBeenNthCalledWith(1, 'line-1')
    expect(onDelete).toHaveBeenNthCalledWith(2, 'line-1')
  })

  it('[viewer] -> [renders line content but has zero mutation UI and invokes zero handlers]', () => {
    const onCreate = vi.fn(async () => undefined)
    const onUpdate = vi.fn(async () => undefined)
    const onDelete = vi.fn(async () => undefined)
    const onGenerate = vi.fn()
    const onSaveEmotion = vi.fn()
    const { props } = renderPanel({ canEdit: false, onCreate, onUpdate, onDelete })

    expect(screen.getByText('The old line')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add dialogue line' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit line 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete line 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save emotion' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate voice' })).not.toBeInTheDocument()
    expect(onCreate).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
    expect(onGenerate).not.toHaveBeenCalled()
    expect(onSaveEmotion).not.toHaveBeenCalled()
    expect(props.onGenerate).not.toHaveBeenCalled()
    expect(props.onSaveEmotion).not.toHaveBeenCalled()
  })

  it('[storyboard query fails] -> [binding is unavailable with retry, never a believable empty list]', () => {
    const onRetryPanels = vi.fn()
    renderPanel({ panelQueryState: 'error', onRetryPanels })

    expect(screen.getByRole('alert')).toHaveTextContent('Shot choices could not be loaded')
    const retry = screen.getByRole('button', { name: 'Reload shot choices' })
    expect(retry).toHaveClass('min-h-11')
    fireEvent.click(retry)
    expect(onRetryPanels).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Edit line 1' }))
    const binding = screen.getByLabelText('Shot binding')
    expect(binding).toBeDisabled()
    expect(binding).toHaveValue('panel-1')
  })

  it('[390px editor] -> [single-column form and every editor action is at least 44px]', () => {
    renderPanel({ voiceLines: [] })
    const add = screen.getByRole('button', { name: 'Add dialogue line' })
    expect(add).toHaveClass('min-h-11')
    fireEvent.click(add)

    const form = screen.getByRole('form', { name: 'Add dialogue line' })
    expect(form).toHaveClass('min-w-0')
    expect(within(form).getByLabelText('Dialogue text')).toHaveClass('min-h-11')
    expect(within(form).getByLabelText('Speaker')).toHaveClass('min-h-11')
    expect(within(form).getByLabelText('Shot binding')).toHaveClass('min-h-11')
    expect(within(form).getByRole('button', { name: 'Cancel' })).toHaveClass('min-h-11')
    expect(within(form).getByRole('button', { name: 'Add line' })).toHaveClass('min-h-11')
  })

  it('[line card controls] -> [every visible interactive control has a 44px hit area]', () => {
    renderPanel()

    expect(screen.getByRole('button', { name: 'Play line 1' })).toHaveClass('h-11', 'w-11')
    expect(screen.getByRole('button', { name: 'Edit line 1' })).toHaveClass('min-h-11', 'min-w-11')
    expect(screen.getByRole('button', { name: 'Delete line 1' })).toHaveClass('min-h-11', 'min-w-11')
    expect(screen.getByLabelText('Emotion direction')).toHaveClass('min-h-11')
    expect(screen.getByLabelText('Emotion strength')).toHaveClass('h-11')
    expect(screen.getByRole('button', { name: 'Save emotion' })).toHaveClass('min-h-11')
    expect(screen.getByRole('button', { name: 'Generate voice' })).toHaveClass('min-h-11')
  })
})
