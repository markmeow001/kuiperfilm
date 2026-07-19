import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MaskKeyframeRail } from '@/app/[locale]/live-composite/MaskKeyframeRail'

describe('MaskKeyframeRail', () => {
  it('點擊關鍵影格 -> 跳到該遮罩時間', () => {
    const onSeek = vi.fn()
    render(
      <MaskKeyframeRail
        duration={10}
        currentTime={3}
        keyframes={[
          { id: 'start', time: 0, strokes: [] },
          { id: 'second', time: 5, strokes: [] },
        ]}
        activeKeyframeId="start"
        hasExactKeyframe={false}
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onApplyToStart={vi.fn()}
        onApplyToEnd={vi.fn()}
        onSeek={onSeek}
      />,
    )

    fireEvent.click(screen.getByText('進階：時間遮罩修正'))
    fireEvent.click(screen.getByRole('button', { name: '前往遮罩關鍵影格 5.00 秒' }))
    expect(onSeek).toHaveBeenCalledWith(5)
  })

  it('影片輸出中 -> 關鍵影格修改與跳轉全部鎖定', () => {
    render(
      <MaskKeyframeRail
        duration={10}
        currentTime={2}
        keyframes={[{ id: 'frame-1', time: 1, strokes: [] }]}
        activeKeyframeId="frame-1"
        hasExactKeyframe
        disabled
        onAdd={vi.fn()}
        onDelete={vi.fn()}
        onApplyToStart={vi.fn()}
        onApplyToEnd={vi.fn()}
        onSeek={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('進階：時間遮罩修正'))
    expect(screen.getByRole('button', { name: '從這裡套用到片頭' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '前往遮罩關鍵影格 1.00 秒' })).toBeDisabled()
  })

  it('目前不是關鍵影格 -> 可複製遮罩並向前後套用', () => {
    const onAdd = vi.fn()
    const onApplyToStart = vi.fn()
    const onApplyToEnd = vi.fn()
    render(
      <MaskKeyframeRail
        duration={10}
        currentTime={3}
        keyframes={[{ id: 'start', time: 0, strokes: [] }]}
        activeKeyframeId="start"
        hasExactKeyframe={false}
        onAdd={onAdd}
        onDelete={vi.fn()}
        onApplyToStart={onApplyToStart}
        onApplyToEnd={onApplyToEnd}
        onSeek={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('進階：時間遮罩修正'))
    fireEvent.click(screen.getByRole('button', { name: '在 3.00s 建立修正' }))
    fireEvent.click(screen.getByRole('button', { name: '從這裡套用到片頭' }))
    fireEvent.click(screen.getByRole('button', { name: '從這裡套用到片尾' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onApplyToStart).toHaveBeenCalledTimes(1)
    expect(onApplyToEnd).toHaveBeenCalledTimes(1)
  })
})
