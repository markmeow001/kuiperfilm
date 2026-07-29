import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CharacterRoster } from '@/app/[locale]/visual-development/CharacterRoster'

describe('CharacterRoster', () => {
  it('已匯入多位角色 -> 完整顯示名冊並切換到指定角色', () => {
    const onCharacterChange = vi.fn()
    render(
      <CharacterRoster
        characters={[
          { code: 'CHAR-001', name: '絲諾', status: 'draft' },
          { code: 'CHAR-002', name: '休', status: 'draft' },
          { code: 'CHAR-003', name: '格里芬', status: 'identity_locked' },
        ]}
        characterCode="CHAR-001"
        isLoading={false}
        onCharacterChange={onCharacterChange}
        labels={{ title: '劇本角色名冊', loaded: '已載入 {count} 位角色', current: '目前角色' }}
      />,
    )

    expect(screen.getByText('已載入 3 位角色')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /絲諾/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /休/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /格里芬/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /休/ }))
    expect(onCharacterChange).toHaveBeenCalledWith('CHAR-002')
  })
})
