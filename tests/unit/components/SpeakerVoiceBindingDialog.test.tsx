import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SpeakerVoiceBindingDialog from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/SpeakerVoiceBindingDialog'

const catalogMock = vi.hoisted(() => ({
  refetch: vi.fn(),
  value: {
    data: [
      { id: 'preset-ann', name: 'Ann Studio', description: 'Warm', gender: 'female', previewUrl: 'https://signed.example/ann.wav' },
      { id: 'preset-ben', name: 'Ben Studio', description: null, gender: 'male', previewUrl: 'https://signed.example/ben.wav' },
    ],
    isLoading: false,
    isError: false,
  },
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => (
    values?.speaker ? `${key}:${values.speaker}` : key
  ),
}))
vi.mock('@/lib/query/mutations/useVoiceMutations', () => ({
  useProjectVoicePresets: () => ({ ...catalogMock.value, refetch: catalogMock.refetch }),
}))

describe('SpeakerVoiceBindingDialog system catalog boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('[select trusted preset] -> [exact preset id bound; custom upload/design remain disabled]', () => {
    const onBound = vi.fn()
    render(
      <SpeakerVoiceBindingDialog
        isOpen
        speaker="Ann"
        projectId="project-a"
        episodeId="episode-a"
        onClose={vi.fn()}
        onBound={onBound}
      />,
    )

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Ann Studio/ }))
    fireEvent.click(screen.getByRole('button', { name: 'bindPreset' }))
    expect(onBound).toHaveBeenCalledWith('Ann', 'preset-ann')

    expect(screen.getByRole('button', { name: 'uploadAudio' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'aiDesign' })).toBeDisabled()
    expect(screen.getByText('customSourceUnavailable')).toBeInTheDocument()
  })
})
