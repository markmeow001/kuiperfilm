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
        onCommit={vi.fn()}
        onSwitch={vi.fn()}
        onView={onView}
        onSend={vi.fn()}
        onApplyPreset={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '◉ 进入该摄像机视角' }))
    expect(onView).toHaveBeenCalledWith('camera-a')
  })
})
