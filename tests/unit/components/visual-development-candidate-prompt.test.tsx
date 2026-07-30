import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CandidatePromptEditor } from '@/app/[locale]/visual-development/CandidatePromptEditor'
import type { CastingCandidateView } from '@/app/[locale]/visual-development/visual-development-types'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'versions') return `versions ${values?.count}`
    return key
  },
}))

const candidate: CastingCandidateView = {
  id: 'candidate-1',
  code: 'COSTUME-FRONT',
  taskStatus: 'completed',
  progress: 100,
  resultUrl: '/current.jpg',
  requestedSeed: 123,
  seedStatus: 'applied',
  shortlisted: false,
  isCanon: false,
  errorMessage: null,
  prompt: 'current prompt',
  originPrompt: 'original immutable prompt',
  negativePrompt: null,
  modelKey: 'atlascloud::flux-2-pro',
  provider: 'atlascloud',
  modelId: 'flux-2-pro',
  modelVersion: null,
  aspectRatio: '3:4',
  resolution: null,
  history: [{
    taskId: 'task-original',
    prompt: 'original immutable prompt',
    negativePrompt: null,
    requestedSeed: 111,
    effectiveSeed: 111,
    seedStatus: 'applied',
    modelKey: 'atlascloud::flux-2-pro',
    provider: 'atlascloud',
    modelId: 'flux-2-pro',
    modelVersion: null,
    aspectRatio: '3:4',
    resolution: null,
    shortlisted: false,
    isCanon: false,
    rejectionNote: null,
    createdAt: '2026-07-30T00:00:00.000Z',
    taskStatus: 'completed',
    progress: 100,
    resultUrl: null,
    errorCode: null,
    errorMessage: null,
  }],
}

describe('CandidatePromptEditor', () => {
  it('預設收起 Prompt -> 點擊按鈕後才開啟完整操控面板', () => {
    render(
      <CandidatePromptEditor
        candidate={{ ...candidate, negativePrompt: 'blood, dirt, wounds' }}
        isRegenerating={false}
        onRegenerate={vi.fn()}
      />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByText('original immutable prompt')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /panelButton/ }))

    expect(screen.getByRole('dialog', { name: 'panelTitle' })).toBeInTheDocument()
    expect(screen.getAllByText('original immutable prompt')).toHaveLength(2)
    expect(screen.getByText('blood, dirt, wounds')).toBeInTheDocument()
    expect(screen.getByText('atlascloud::flux-2-pro')).toBeInTheDocument()
  })

  it('修改 Prompt -> 只以指定 Seed 策略重生目前這張資產', () => {
    const onRegenerate = vi.fn()
    render(
      <CandidatePromptEditor
        candidate={candidate}
        isRegenerating={false}
        onRegenerate={onRegenerate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /panelButton/ }))
    const editor = screen.getByRole('textbox', { name: /regenerateTitle/ })
    expect(editor).toHaveValue('current prompt')
    fireEvent.change(editor, { target: { value: 'edited prompt for this slot only' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'seedMode' }), { target: { value: 'reuse' } })
    fireEvent.click(screen.getByRole('button', { name: 'saveAndRegenerate' }))

    expect(onRegenerate).toHaveBeenCalledWith(
      'candidate-1',
      'edited prompt for this slot only',
      'reuse',
    )
  })

  it('disables regeneration when the batch is Canon locked', () => {
    render(
      <CandidatePromptEditor
        candidate={candidate}
        disabled
        isRegenerating={false}
        onRegenerate={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /panelButton/ }))
    expect(screen.getByRole('button', { name: 'saveAndRegenerate' })).toBeDisabled()
    expect(screen.getByText('canonLockedHint')).toBeInTheDocument()
  })

  it('keeps a failed version editable and retryable while preserving history', () => {
    const onRegenerate = vi.fn()
    render(
      <CandidatePromptEditor
        candidate={{ ...candidate, taskStatus: 'failed', resultUrl: null }}
        isRegenerating={false}
        onRegenerate={onRegenerate}
      />,
    )

    expect(screen.getByText('versions 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /panelButton/ }))
    fireEvent.click(screen.getByRole('button', { name: 'saveAndRegenerate' }))
    expect(onRegenerate).toHaveBeenCalledWith('candidate-1', 'current prompt', 'new')
  })

  it('blocks duplicate submission while the current version is still queued', () => {
    render(
      <CandidatePromptEditor
        candidate={{ ...candidate, taskStatus: 'queued', resultUrl: null }}
        isRegenerating={false}
        onRegenerate={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /panelButton/ }))
    expect(screen.getByRole('button', { name: 'saveAndRegenerate' })).toBeDisabled()
    expect(screen.queryByText('canonLockedHint')).not.toBeInTheDocument()
  })
})
