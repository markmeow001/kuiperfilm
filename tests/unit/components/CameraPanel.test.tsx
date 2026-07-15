import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CameraPanel } from '@/app/[locale]/canvas/director/CameraPanel'
import { makeCamera } from '@/app/[locale]/canvas/director/stage-types'

describe('CameraPanel POV action', () => {
  it('enters the currently selected camera view from the explicit action', () => {
    const camera = makeCamera('camera-a', 0)
    const onView = vi.fn()
    render(
      <CameraPanel
        camera={camera}
        cameraId={camera.id}
        cameras={[camera]}
        mannequins={[]}
        props={[]}
        onCommit={vi.fn()}
        onSwitch={vi.fn()}
        onView={onView}
        onSend={vi.fn()}
        onApplyPreset={vi.fn()}
        onApplyFraming={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '◉ 进入该摄像机视角' }))
    expect(onView).toHaveBeenCalledWith('camera-a')
  })

  it('选择道具追踪 -> 写入统一场景物件目标', () => {
    const camera = makeCamera('camera-a', 0)
    const onCommit = vi.fn()
    render(
      <CameraPanel
        camera={camera}
        cameraId={camera.id}
        cameras={[camera]}
        mannequins={[]}
        props={[{ id: 'prop-a', label: '汽车', kind: 'car', position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#fff' }]}
        onCommit={onCommit}
        onSwitch={vi.fn()}
        onView={vi.fn()}
        onSend={vi.fn()}
        onApplyPreset={vi.fn()}
        onApplyFraming={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: /注视目标/ }), { target: { value: 'prop-a' } })
    expect(onCommit).toHaveBeenCalledWith('camera-a', { lookAtObjectId: 'prop-a' })
  })

  it('点击 50mm -> 写入对应全画幅垂直 FOV', () => {
    const camera = makeCamera('camera-a', 0)
    const onCommit = vi.fn()
    render(
      <CameraPanel
        camera={camera}
        cameraId={camera.id}
        cameras={[camera]}
        mannequins={[]}
        props={[]}
        onCommit={onCommit}
        onSwitch={vi.fn()}
        onView={vi.fn()}
        onSend={vi.fn()}
        onApplyPreset={vi.fn()}
        onApplyFraming={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '50mm' }))
    expect(onCommit.mock.calls.at(-1)?.[0]).toBe('camera-a')
    expect(onCommit.mock.calls.at(-1)?.[1].fov).toBeCloseTo(26.99, 1)
  })

  it('点击特写构图 -> 保留视角方向并请求 1.4 米构图距离', () => {
    const camera = makeCamera('camera-a', 0)
    const onApplyFraming = vi.fn()
    render(
      <CameraPanel
        camera={camera}
        cameraId={camera.id}
        cameras={[camera]}
        mannequins={[]}
        props={[]}
        onCommit={vi.fn()}
        onSwitch={vi.fn()}
        onView={vi.fn()}
        onSend={vi.fn()}
        onApplyPreset={vi.fn()}
        onApplyFraming={onApplyFraming}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '特写' }))
    expect(onApplyFraming).toHaveBeenCalledWith('camera-a', 1.4, 32)
  })
})
