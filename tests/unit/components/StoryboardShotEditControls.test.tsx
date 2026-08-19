/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) =>
    values?.number ? `${key}:${values.number}` : key,
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}))

import { StoryboardShotEditControls } from '@/app/[locale]/v2/workspace/[projectId]/storyboard/StoryboardShotEditControls'

const callbacks = {
  onInsertBefore: vi.fn(),
  onInsertAfter: vi.fn(),
  onMoveEarlier: vi.fn(),
  onMoveLater: vi.fn(),
  onDelete: vi.fn(),
}

function renderControls(overrides: Partial<React.ComponentProps<typeof StoryboardShotEditControls>> = {}) {
  return render(
    <StoryboardShotEditControls
      canEdit
      hasSelection
      selectedNumber={2}
      canMoveEarlier
      canMoveLater
      isBusy={false}
      error={null}
      viewerTip="viewer cannot edit"
      {...callbacks}
      {...overrides}
    />,
  )
}

describe('StoryboardShotEditControls', () => {
  beforeEach(() => vi.clearAllMocks())

  it('[editor 選中中間鏡頭] -> [before/after/move/delete 各自只觸發精確 callback]', () => {
    renderControls()

    fireEvent.click(screen.getByRole('button', { name: 'shotEdit.insertBefore' }))
    fireEvent.click(screen.getByRole('button', { name: 'shotEdit.insertAfter' }))
    fireEvent.click(screen.getByRole('button', { name: 'shotEdit.moveEarlier' }))
    fireEvent.click(screen.getByRole('button', { name: 'shotEdit.moveLater' }))
    fireEvent.click(screen.getByRole('button', { name: 'shotEdit.delete' }))

    expect(callbacks.onInsertBefore).toHaveBeenCalledTimes(1)
    expect(callbacks.onInsertAfter).toHaveBeenCalledTimes(1)
    expect(callbacks.onMoveEarlier).toHaveBeenCalledTimes(1)
    expect(callbacks.onMoveLater).toHaveBeenCalledTimes(1)
    expect(callbacks.onDelete).toHaveBeenCalledTimes(1)
  })

  it('[viewer 即使有 selection] -> [所有 mutation control disabled 且 click 零 callback]', () => {
    renderControls({ canEdit: false })

    for (const name of [
      'shotEdit.insertBefore',
      'shotEdit.insertAfter',
      'shotEdit.moveEarlier',
      'shotEdit.moveLater',
      'shotEdit.delete',
    ]) {
      const button = screen.getByRole('button', { name })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('title', 'viewer cannot edit')
      fireEvent.click(button)
    }

    expect(callbacks.onInsertBefore).not.toHaveBeenCalled()
    expect(callbacks.onInsertAfter).not.toHaveBeenCalled()
    expect(callbacks.onMoveEarlier).not.toHaveBeenCalled()
    expect(callbacks.onMoveLater).not.toHaveBeenCalled()
    expect(callbacks.onDelete).not.toHaveBeenCalled()
  })

  it('[第一鏡或最後一鏡] -> [只封鎖越界 move，insert/delete 仍可用]', () => {
    const { rerender } = renderControls({
      selectedNumber: 1,
      canMoveEarlier: false,
      canMoveLater: true,
    })

    expect(screen.getByRole('button', { name: 'shotEdit.moveEarlier' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'shotEdit.moveLater' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'shotEdit.insertBefore' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'shotEdit.delete' })).toBeEnabled()

    rerender(
      <StoryboardShotEditControls
        canEdit
        hasSelection
        selectedNumber={4}
        canMoveEarlier
        canMoveLater={false}
        isBusy={false}
        error={null}
        viewerTip="viewer cannot edit"
        {...callbacks}
      />,
    )

    expect(screen.getByRole('button', { name: 'shotEdit.moveEarlier' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'shotEdit.moveLater' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'shotEdit.insertAfter' })).toBeEnabled()
  })

  it('[mutation busy 或無 selection] -> [handler fail closed 且顯示 server error]', () => {
    const { rerender } = renderControls({ isBusy: true, error: 'write failed' })

    expect(screen.getByRole('alert')).toHaveTextContent('write failed')
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()

    rerender(
      <StoryboardShotEditControls
        canEdit
        hasSelection={false}
        selectedNumber={null}
        canMoveEarlier={false}
        canMoveLater={false}
        isBusy={false}
        error={null}
        viewerTip="viewer cannot edit"
        {...callbacks}
      />,
    )

    for (const button of screen.getAllByRole('button')) {
      fireEvent.click(button)
      expect(button).toBeDisabled()
    }
    expect(callbacks.onDelete).not.toHaveBeenCalled()
  })
})
