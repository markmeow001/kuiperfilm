import { describe, expect, it } from 'vitest'
import { buildDirectorOutputMetadata } from '@/app/[locale]/canvas/lib/director-output-metadata'
import type { DirectorStageState } from '@/app/[locale]/canvas/director/stage-types'
import { makeShot } from '@/app/[locale]/canvas/director/previz-types'

function stageFixture(): DirectorStageState {
  const camera = { id: 'cam-a', label: '主机位', position: [1, 2, 3] as [number, number, number], target: [0, 1, 0] as [number, number, number], fov: 35 }
  const actors = { actorA: { position: [0, 0, 0] as [number, number, number], rotation: [0, 1, 0] as [number, number, number] } }
  return {
    aspect: '16:9',
    background: { mode: 'flat', key: 'images/playground-ref/user-1/bg.jpg' },
    cameras: [camera],
    mannequins: [{ id: 'actorA', label: '角色A', position: [0, 0, 0], rotation: [0, 1, 0], scale: 1, color: '#fff', bodyType: 'female' }],
    props: [{ id: 'propA', label: '桌子', kind: 'box', position: [2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], color: '#333' }],
    shots: [
      makeShot('shot-1', 0, camera, actors),
      makeShot('shot-2', 1, camera, actors),
    ],
  }
}

describe('director output metadata', () => {
  it('发送机位静帧 -> 固定保存相机、人物与道具快照', () => {
    const state = stageFixture()
    const result = buildDirectorOutputMetadata({ directorNodeId: 'director-1', source: 'camera-still', state, cameraId: 'cam-a' })

    expect(result).toMatchObject({
      directorNodeId: 'director-1',
      source: 'camera-still',
      camera: { id: 'cam-a', fov: 35 },
      actors: [{ id: 'actorA', label: '角色A', bodyType: 'female' }],
      props: [{ id: 'propA', label: '桌子', kind: 'box' }],
      shots: [],
      aspect: '16:9',
      background: { mode: 'flat', key: 'images/playground-ref/user-1/bg.jpg' },
    })
    state.cameras[0].position[0] = 99
    expect(result.camera?.position).toEqual([1, 2, 3])
  })

  it('单镜预演 -> 只保存实际导出的 shot，保留走位资料', () => {
    const state = stageFixture()
    state.shots[1].movePaths = { actorA: [[0, 0, 0], [2, 0, 1]] }
    const result = buildDirectorOutputMetadata({
      directorNodeId: 'director-1',
      source: 'previz-shot',
      state,
      shotIds: ['shot-2'],
    })

    expect(result.shots.map((shot) => shot.id)).toEqual(['shot-2'])
    expect(result.shots[0].movePaths?.actorA).toEqual([[0, 0, 0], [2, 0, 1]])
  })
})
