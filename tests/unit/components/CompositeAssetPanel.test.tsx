import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CompositeAssetPanel } from '@/app/[locale]/live-composite/CompositeAssetPanel'

type CompositeAssetPanelProps = ComponentProps<typeof CompositeAssetPanel>

describe('CompositeAssetPanel', () => {
  it('左側素材欄 -> 提供 flex 高度約束與 overscroll 防護樣式', () => {
    const props = {
      mode: 'depth-rebuild',
      onModeChange: vi.fn(),
      depthRebuild: <div>深度重建控制</div>,
      interactionDisabled: false,
    } satisfies Partial<CompositeAssetPanelProps>

    render(<CompositeAssetPanel {...props as unknown as CompositeAssetPanelProps} />)

    const aside = screen.getByRole('complementary')
    expect(aside).toHaveClass('min-h-0')
    expect(aside).toHaveClass('overflow-y-auto')
    expect(aside).toHaveClass('overscroll-contain')
  })
})
