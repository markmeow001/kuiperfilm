import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterAppearancesPanel', () => ({
  V2CharacterAppearancesPanel: ({
    currentEpisodeId,
    activeAppearanceId,
  }: {
    currentEpisodeId: string | null
    activeAppearanceId: string
  }) => (
    <div
      data-testid="appearances-panel"
      data-episode-id={currentEpisodeId ?? ''}
      data-active-appearance-id={activeAppearanceId}
    />
  ),
}))

import { V2CharacterEditModal } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterEditModal'

describe('V2CharacterEditModal active episode appearance', () => {
  it('[character array starts with A but episode resolves B] -> displays and operates on the injected B view', () => {
    const onRegenerate = vi.fn()
    const onRedescribe = vi.fn()
    const appearanceA = {
      id: 'appearance-a',
      appearanceIndex: 0,
      changeReason: '日常服',
      description: 'A prompt',
      imageUrl: '/a.jpg',
    }
    const appearanceB = {
      id: 'appearance-b',
      appearanceIndex: 1,
      changeReason: '戰鬥服',
      description: 'B prompt',
      imageUrl: '/b.jpg',
    }

    render(
      <V2CharacterEditModal
        projectId="project-1"
        currentEpisodeId="episode-2"
        character={{
          id: 'character-1',
          name: '林真',
          appearances: [appearanceA, appearanceB],
        }}
        activeAppearance={appearanceB}
        activeAppearanceSource="episode"
        imageUrl="/b.jpg"
        onClose={vi.fn()}
        onZoomImage={vi.fn()}
        onRegenerate={onRegenerate}
        onUploadFile={vi.fn()}
        onUploadAndExpandToMultiView={vi.fn()}
        isRegenerating={false}
        isUploading={false}
        isExpanding={false}
        onSaveName={vi.fn()}
        onSaveIntroduction={vi.fn()}
        onSaveVisualPrompt={vi.fn()}
        isSavingName={false}
        isSavingIntroduction={false}
        isSavingVisualPrompt={false}
        onRedescribe={onRedescribe}
        isRedescribing={false}
        onToggleLock={vi.fn()}
        isLocking={false}
        lockError={null}
        onDelete={vi.fn()}
        isDeleting={false}
      />,
    )

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('modalLabel')
    expect(status).toHaveTextContent('戰鬥服')
    expect(status).toHaveTextContent('sourceEpisode')
    expect(status).not.toHaveTextContent('日常服')
    expect(screen.getByRole('img', { name: '林真' })).toHaveAttribute('src', '/b.jpg')
    expect(screen.getByDisplayValue('B prompt')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('A prompt')).not.toBeInTheDocument()

    const panel = screen.getByTestId('appearances-panel')
    expect(panel).toHaveAttribute('data-episode-id', 'episode-2')
    expect(panel).toHaveAttribute('data-active-appearance-id', 'appearance-b')

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    fireEvent.click(screen.getByRole('button', { name: '↻ 從圖抽描述' }))
    expect(onRegenerate).toHaveBeenCalledTimes(1)
    expect(onRedescribe).toHaveBeenCalledTimes(1)
  })
})
