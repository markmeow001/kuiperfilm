import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CompositeAssetPanel } from '@/app/[locale]/live-composite/CompositeAssetPanel'
import styles from '@/app/[locale]/live-composite/LiveCompositeShell.module.css'

type CompositeAssetPanelProps = ComponentProps<typeof CompositeAssetPanel>

describe('CompositeAssetPanel', () => {
  it('左側素材欄 -> 提供 flex 高度約束與 overscroll 防護樣式', () => {
    const props = {
      mode: 'depth-rebuild',
      depthRebuild: <div>深度重建控制</div>,
      interactionDisabled: false,
    } satisfies Partial<CompositeAssetPanelProps>

    render(<CompositeAssetPanel {...props as unknown as CompositeAssetPanelProps} />)

    const aside = screen.getByRole('complementary')
    expect(aside).toHaveClass(styles.assetPanel)
  })
})
