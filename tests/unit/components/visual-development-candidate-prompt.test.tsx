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
  it('shows the immutable original prompt and regenerates only the selected candidate with an editable prompt', () => {
    const onRegenerate = vi.fn()
    render(
      <CandidatePromptEditor
        candidate={candidate}
        isRegenerating={false}
        onRegenerate={onRegenerate}
      />,
    )

    expect(screen.getAllByText('original immutable prompt').length).toBeGreaterThan(0)
    const editor = screen.getByRole('textbox')
    expect(editor).toHaveValue('current prompt')
    fireEvent.change(editor, { target: { value: 'edited prompt for this slot only' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'reuse' } })
    fireEvent.click(screen.getByRole('button', { name: 'regenerateOne' }))

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

    expect(screen.getByRole('button', { name: 'regenerateOne' })).toBeDisabled()
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
    fireEvent.click(screen.getByRole('button', { name: 'regenerateOne' }))
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

    expect(screen.getByRole('button', { name: 'regenerateOne' })).toBeDisabled()
    expect(screen.queryByText('canonLockedHint')).not.toBeInTheDocument()
  })
})
