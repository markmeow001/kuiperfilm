import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RoutePlansPanel } from '@/app/[locale]/canvas/director/RoutePlansPanel'
import type { DirectorRouteSegment } from '@/lib/canvas/director-routes-schema'

const SEGMENTS: DirectorRouteSegment[] = [
  {
    order: 1,
    title: '进入餐厅',
    sourceSummary: '角色A 推门进入餐厅，看见角色B。',
    plans: [{
      name: '跟随进入',
      style: '跟拍 / 压迫感',
      shots: [{ label: '01 推门', note: '跟拍人物入场', durationSec: 6, cameraPreset: '正面全景', movement: '推近', focus: '角色A' }],
    }],
  },
  {
    order: 2,
    title: '桌边对峙',
    sourceSummary: '两人隔桌对峙。',
    plans: [{
      name: '正反打收紧',
      style: '中近景',
      shots: [{ label: '01 对峙', note: '视线交锋', durationSec: 8, cameraPreset: '正面中景', movement: '固定', focus: '角色A' }],
    }],
  },
]

describe('RoutePlansPanel 完整分镜模式', () => {
  it('切到完整分镜 -> 提供 5000 字输入并以 storyboard 模式生成多个有序段落', async () => {
    const onGenerate = vi.fn(async () => SEGMENTS)
    render(<RoutePlansPanel onClose={vi.fn()} onGenerate={onGenerate} onApply={vi.fn()} castLabels={['角色A']} />)

    fireEvent.click(screen.getByRole('button', { name: '完整分镜 · 5000字' }))
    const input = screen.getByPlaceholderText(/直接贴入完整分镜/) as HTMLTextAreaElement
    expect(input.maxLength).toBe(5000)
    fireEvent.change(input, { target: { value: '第一场：角色A 推门。第二场：两人对峙。' } })
    fireEvent.click(screen.getByRole('button', { name: '自动拆分并生成' }))

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith('第一场：角色A 推门。第二场：两人对峙。', 'storyboard'))
    expect(await screen.findByText('进入餐厅')).toBeInTheDocument()
    expect(screen.getByText('桌边对峙')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '套用此段 → 摆台' })).toHaveLength(2)
  })

  it('套用完整分镜段落 -> 回传对应段落并保持面板开启', async () => {
    const onApply = vi.fn()
    render(<RoutePlansPanel onClose={vi.fn()} onGenerate={vi.fn(async () => SEGMENTS)} onApply={onApply} castLabels={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '完整分镜 · 5000字' }))
    fireEvent.change(screen.getByPlaceholderText(/直接贴入完整分镜/), { target: { value: '完整分镜' } })
    fireEvent.click(screen.getByRole('button', { name: '自动拆分并生成' }))
    const buttons = await screen.findAllByRole('button', { name: '套用此段 → 摆台' })
    fireEvent.click(buttons[1])
    expect(onApply).toHaveBeenCalledWith(SEGMENTS[1].plans[0], SEGMENTS[1], true)
  })
})
