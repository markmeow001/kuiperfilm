import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrevizShotPanel } from '@/app/[locale]/canvas/director/PrevizShotPanel'
import { makeShot } from '@/app/[locale]/canvas/director/previz-types'

const camera = { position: [0, 1, 5] as [number, number, number], target: [0, 1, 0] as [number, number, number], fov: 45 }
const actors = { person: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] } }

function renderPanel(trackingTargetLabel?: string | null) {
  const shot = makeShot('shot-1', 0, camera, actors)
  const onApplyCameraMove = vi.fn()
  render(
    <PrevizShotPanel
      shot={shot}
      shots={[shot]}
      actorInfos={[{ id: 'person', label: '角色A' }]}
      onPatch={vi.fn()}
      onDelete={vi.fn()}
      onSetCamera={vi.fn()}
      onSetActors={vi.fn()}
      onJump={vi.fn()}
      onAddCameraWaypoint={vi.fn()}
      onAddActorWaypoint={vi.fn()}
      onClearActorWaypoints={vi.fn()}
      onApplyCameraMove={onApplyCameraMove}
      trackingTargetLabel={trackingTargetLabel}
    />,
  )
  return onApplyCameraMove
}

describe('PrevizShotPanel camera moves', () => {
  it('点击环绕 -> 套用环绕运镜预设', () => {
    const onApplyCameraMove = renderPanel('角色A')
    fireEvent.click(screen.getByRole('button', { name: '环绕' }))
    expect(onApplyCameraMove).toHaveBeenCalledWith('orbit-right')
  })

  it('没有锁定目标 -> 跟拍按钮不可用且说明原因', () => {
    renderPanel(null)
    expect(screen.getByRole('button', { name: '跟拍' })).toBeDisabled()
    expect(screen.getByText('跟拍需先在摄像机面板锁定人物或道具')).toBeInTheDocument()
  })
})
