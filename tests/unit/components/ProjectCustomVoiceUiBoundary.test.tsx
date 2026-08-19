import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const uploadVoiceHookMock = vi.hoisted(() => vi.fn(() => ({
  mutate: vi.fn(),
  isPending: false,
})))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => (
    values?.speaker ? `${key}:${values.speaker}` : key
  ),
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: () => <span aria-hidden="true" />,
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterAppearancesPanel', () => ({
  V2CharacterAppearancesPanel: () => <div data-testid="appearances-panel" />,
}))

vi.mock('@/lib/query/mutations/character-voice-mutations', () => ({
  useUploadProjectCharacterVoice: uploadVoiceHookMock,
}))

vi.mock('@/lib/query/mutations', () => ({
  useUploadProjectCharacterVoice: uploadVoiceHookMock,
}))

import { V2CharacterEditModal } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterEditModal'
import ProjectVoiceSettings from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/VoiceSettings'
import SpeakerVoiceStatus from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/voice/SpeakerVoiceStatus'

describe('project custom voice consent boundary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('[project character surfaces render] -> [upload/design controls stay disabled and no upload hook or file input is reachable]', () => {
    const v2 = render(
      <V2CharacterEditModal
        projectId="project-1"
        currentEpisodeId="episode-1"
        character={{
          id: 'character-1',
          name: 'Lin',
          customVoiceUrl: 'https://unsafe.example/existing.wav',
          appearances: [{ id: 'appearance-1', imageUrl: '/lin.jpg' }],
        }}
        activeAppearance={{ id: 'appearance-1', imageUrl: '/lin.jpg' }}
        activeAppearanceSource="episode"
        imageUrl="/lin.jpg"
        onClose={vi.fn()}
        onZoomImage={vi.fn()}
        onRegenerate={vi.fn()}
        onUploadFile={vi.fn()}
        isRegenerating={false}
        isUploading={false}
        onSaveName={vi.fn()}
        onSaveIntroduction={vi.fn()}
        onSaveVisualPrompt={vi.fn()}
        isSavingName={false}
        isSavingIntroduction={false}
        isSavingVisualPrompt={false}
        onToggleLock={vi.fn()}
        isLocking={false}
        onDelete={vi.fn()}
        isDeleting={false}
      />,
    )

    const legacy = render(
      <ProjectVoiceSettings
        characterId="character-1"
      />,
    )

    expect(uploadVoiceHookMock).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'uploadAudio' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'aiDesign' })).toHaveLength(2)
    for (const button of screen.getAllByRole('button', { name: /^(uploadAudio|aiDesign)$/ })) {
      expect(button).toBeDisabled()
    }
    expect(screen.getAllByText('customSourceUnavailable')).toHaveLength(2)
    expect(v2.container.querySelector('input[accept*="audio"]')).toBeNull()
    expect(legacy.container.querySelector('input[accept*="audio"]')).toBeNull()
    expect(v2.container.querySelector('audio')).toBeNull()
    expect(legacy.container.querySelector('audio')).toBeNull()
  })

  it('[matched project character opens voice settings] -> [safe inline system catalog opens instead of project Assets]', () => {
    const onOpenAssetLibrary = vi.fn()
    const onOpenInlineBinding = vi.fn()

    render(
      <SpeakerVoiceStatus
        speakers={['Lin']}
        speakerStats={{ Lin: 2 }}
        getSpeakerVoiceUrl={() => null}
        onOpenAssetLibrary={onOpenAssetLibrary}
        onOpenInlineBinding={onOpenInlineBinding}
        hasSpeakerCharacter={() => true}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'speakerVoice.voiceSettings' }))
    expect(onOpenInlineBinding).toHaveBeenCalledWith('Lin')
    expect(onOpenAssetLibrary).not.toHaveBeenCalled()
  })
})
