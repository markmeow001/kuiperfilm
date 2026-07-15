import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrevizTimeline } from '@/app/[locale]/canvas/director/PrevizTimeline'
import { makeCamera } from '@/app/[locale]/canvas/director/stage-types'
import type { StageShot } from '@/app/[locale]/canvas/director/previz-types'
import type { PrevizPlayback } from '@/app/[locale]/canvas/director/use-previz-playback'

function playback(): PrevizPlayback {
  return {
    active: false,
    playing: false,
    rate: 1,
    mode: 'shot',
    timeSec: 0,
    rangeStartSec: 0,
    rangeEndSec: 0,
    getTimeSec: () => 0,
    enter: vi.fn(),
    exit: vi.fn(),
    toggle: vi.fn(),
    seek: vi.fn(),
    setRate: vi.fn(),
  }
}

const SHOT: StageShot = {
  id: 'shot-1',
  label: '01 镜头',
  durationSec: 5,
  easing: 'linear',
  start: { camera: makeCamera('camera-start', 0), actors: {} },
  end: { camera: makeCamera('camera-end', 0), actors: {} },
}

describe('PrevizTimeline responsive density', () => {
  it('无镜头 -> 只显示启动动作，不显示无效播放与导出控制', () => {
    const onAddShot = vi.fn()
    render(<PrevizTimeline shots={[]} selectedShotId={null} playback={playback()} onSelectShot={vi.fn()} onAddShot={onAddShot} onToggleRoutes={vi.fn()} onExport={vi.fn()} />)

    expect(screen.getByRole('button', { name: '✨ AI 路线' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '＋ 建立第一镜' }))
    expect(onAddShot).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '▶ 预演' })).not.toBeInTheDocument()
    expect(screen.queryByText('导出 ▾')).not.toBeInTheDocument()
    expect(screen.queryByText(/00:00\.0/)).not.toBeInTheDocument()
  })

  it('有镜头 -> 显示精简播放范围与单一导出入口', () => {
    render(<PrevizTimeline shots={[SHOT]} selectedShotId="shot-1" playback={playback()} onSelectShot={vi.fn()} onAddShot={vi.fn()} onExport={vi.fn()} />)

    expect(screen.getByRole('button', { name: '▶ 预演' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '单镜' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '全片' })).toBeInTheDocument()
    expect(screen.getByText('导出 ▾')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出选中镜头' })).toBeInTheDocument()
  })
})
