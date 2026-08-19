import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: () => <span aria-hidden="true" />,
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterAppearancesPanel', () => ({
  V2CharacterAppearancesPanel: () => <div data-testid="appearances-panel" />,
}))

import { V2CharacterEditModal } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterEditModal'
import type { V2CharacterEditModalProps } from '@/app/[locale]/v2/workspace/[projectId]/subjects/V2CharacterEditModal'

function buildProps(overrides: Partial<V2CharacterEditModalProps> = {}): V2CharacterEditModalProps {
  return {
    projectId: 'project-1',
    currentEpisodeId: 'episode-1',
    character: {
      id: 'character-1',
      name: '林真',
      profileConfirmed: false,
      appearances: [{ id: 'appearance-1', imageUrl: '/lin-zhen.jpg' }],
    },
    activeAppearance: { id: 'appearance-1', imageUrl: '/lin-zhen.jpg' },
    activeAppearanceSource: 'episode',
    imageUrl: '/lin-zhen.jpg',
    onClose: vi.fn(),
    onZoomImage: vi.fn(),
    onRegenerate: vi.fn(),
    onUploadFile: vi.fn(),
    isRegenerating: false,
    isUploading: false,
    onSaveName: vi.fn(),
    onSaveIntroduction: vi.fn(),
    onSaveVisualPrompt: vi.fn(),
    isSavingName: false,
    isSavingIntroduction: false,
    isSavingVisualPrompt: false,
    onToggleLock: vi.fn(),
    isLocking: false,
    onDelete: vi.fn(),
    isDeleting: false,
    ...overrides,
  }
}

describe('V2CharacterEditModal finalization state', () => {
  it('定稿失敗 -> 顯示該角色錯誤並提供可點擊重試', () => {
    const onRetry = vi.fn()
    render(
      <V2CharacterEditModal
        {...buildProps({ onToggleLock: onRetry, lockError: '連線中斷' })}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('連線中斷')
    const retryButton = screen.getByRole('button', { name: 'retryLock' })
    expect(retryButton).toHaveClass('min-h-11')
    fireEvent.click(retryButton)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('角色定稿中或已定稿 -> 定稿按鈕不可重複送出', () => {
    const { rerender } = render(
      <V2CharacterEditModal {...buildProps({ isLocking: true })} />,
    )
    expect(screen.getByRole('button', { name: 'locking' })).toBeDisabled()

    rerender(
      <V2CharacterEditModal
        {...buildProps({
          character: {
            id: 'character-1',
            name: '林真',
            profileConfirmed: true,
            appearances: [{ id: 'appearance-1', imageUrl: '/lin-zhen.jpg' }],
          },
        })}
      />,
    )
    expect(screen.getByRole('button', { name: 'locked' })).toBeDisabled()
  })
})
