import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CharacterAppearancePanel } from '@/app/[locale]/live-composite/CharacterAppearancePanel'

describe('CharacterAppearancePanel', () => {
  it('[光影 range 控制] -> 每個 slider 都放在獨立的可觸控 label', () => {
    render(
      <CharacterAppearancePanel
        disabled={false}
        onChange={vi.fn()}
        onAutoMatch={vi.fn()}
      />,
    )

    const sliders = screen.getAllByRole('slider')
    expect(sliders).toHaveLength(10)
    for (const slider of sliders) {
      expect(
        slider.closest('[data-live-composite-control-hit-area]')?.tagName,
      ).toBe('LABEL')
    }
  })
})
