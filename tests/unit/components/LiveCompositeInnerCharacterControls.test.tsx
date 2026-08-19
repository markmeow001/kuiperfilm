import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CharacterMotionPanel } from '@/app/[locale]/live-composite/CharacterMotionPanel'
import { VirtualCharacterPanel } from '@/app/[locale]/live-composite/VirtualCharacterPanel'
import type { VirtualCharacterLayer } from '@/app/[locale]/live-composite/live-composite-types'

const layer: VirtualCharacterLayer = {
  assetType: 'image',
  assetName: 'character.png',
  assetUrl: 'blob:character',
  assetKey: null,
  anchor: 'screen',
  x: 0.5,
  y: 0.5,
  offsetX: 0,
  offsetY: 0,
  scale: 0.5,
  rotation: 0,
  opacity: 1,
  startTime: 0,
  endTime: 4,
  loop: false,
  depth: 'behind-person',
  motionEnabled: false,
  motionKeyframes: [],
}

describe('Live Composite inner character controls presentation', () => {
  it('尚未上傳角色 -> 上傳 label 是 44px 並顯示青色鍵盤焦點', () => {
    render(
      <VirtualCharacterPanel
        layer={null}
        keyframes={[]}
        currentTime={0}
        duration={4}
        disabled={false}
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onAutoMatch={vi.fn()}
        motionBusy={false}
        motionMessage={null}
        onAnalyzeMotionCurrent={vi.fn()}
        onAnalyzeMotionClip={vi.fn()}
      />,
    )

    expect(screen.getByLabelText('上傳透明角色素材').parentElement).toHaveClass(
      'min-h-11',
      'focus-within:ring-cyan-300/70',
    )
  })

  it('角色已上傳 -> 定位、數字與遮擋控制符合 44px 青色焦點契約', () => {
    render(
      <VirtualCharacterPanel
        layer={layer}
        keyframes={[]}
        currentTime={0}
        duration={4}
        disabled={false}
        onSelect={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onAutoMatch={vi.fn()}
        motionBusy={false}
        motionMessage={null}
        onAnalyzeMotionCurrent={vi.fn()}
        onAnalyzeMotionClip={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: '指定畫面位置' })).toHaveClass(
      'min-h-11',
      'border-cyan-300/50',
      'focus-visible:ring-cyan-300/70',
    )
    expect(screen.getByLabelText('開始秒數')).toHaveClass('h-11', 'focus-visible:ring-2')
    expect(screen.getByLabelText('結束秒數')).toHaveClass('h-11', 'focus-visible:ring-2')
    expect(screen.getByRole('combobox', { name: '遮擋層級' })).toHaveClass(
      'h-11',
      'focus-visible:ring-cyan-300/70',
    )
  })

  it('骨架動作 -> 展開控制與兩個分析動作都是 44px 青色控制', () => {
    render(
      <CharacterMotionPanel
        layer={layer}
        disabled={false}
        busy={false}
        message={null}
        onChange={vi.fn()}
        onAnalyzeCurrent={vi.fn()}
        onAnalyzeClip={vi.fn()}
      />,
    )

    expect(screen.getByText('骨架參考動作')).toHaveClass('min-h-11', 'focus-visible:ring-cyan-300/70')
    for (const name of ['擷取目前姿勢', '分析整段動作']) {
      expect(screen.getByRole('button', { name })).toHaveClass(
        'min-h-11',
        'border-cyan-300/25',
        'focus-visible:ring-cyan-300/70',
      )
    }
  })
})
