'use client'

/**
 * previz 3D 驱动层 — 挂在 SceneContents 里的每帧消费者。
 *
 * 预演激活时：每帧读时钟 → locateInSequence + evalShot → **命令式**写
 * viewCamera 与人偶 group（绝不经 React state；沿用 capture() 的 stateRef
 * 思路）。退出预演时把人偶 group 恢复回舞台常驻摆位（React 的 props 不会
 * 自动重设——值没变它不会重写 three 对象）。
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Vec3 } from './stage-types'
import type { StageShot } from './previz-types'
import { evalShot, locateInSequence } from './previz-eval'

const DEG2RAD = Math.PI / 180

/** 恢复用的舞台常驻摆位（人偶 + 道具统一按 id）。 */
export interface RestActor { id: string; position: Vec3; rotation: Vec3 }

export interface PrevizDriverProps {
  active: boolean
  shots: StageShot[]
  getTimeSec: () => number
  /** SceneContents 的 actor group refs（人偶+道具共用一本，id → group）。 */
  actorRefs: React.MutableRefObject<Record<string, THREE.Group | null>>
  restActors: RestActor[]
}

function applyVec3(target: THREE.Vector3, v: Vec3) {
  target.set(v[0], v[1], v[2])
}

export function PrevizDriver({ active, shots, getTimeSec, actorRefs, restActors }: PrevizDriverProps) {
  const { camera } = useThree()
  const restRef = useRef(restActors)
  restRef.current = restActors

  useFrame(() => {
    if (!active) return
    const loc = locateInSequence(shots, getTimeSec())
    if (!loc) return
    const ev = evalShot(shots[loc.index], loc.t)
    const cam = camera as THREE.PerspectiveCamera
    applyVec3(cam.position, ev.camera.position)
    cam.lookAt(ev.camera.target[0], ev.camera.target[1], ev.camera.target[2])
    if (ev.camera.roll) cam.rotateZ(ev.camera.roll * DEG2RAD)
    if (cam.fov !== ev.camera.fov) {
      cam.fov = ev.camera.fov
      cam.updateProjectionMatrix()
    }
    for (const [id, actor] of Object.entries(ev.actors)) {
      const group = actorRefs.current[id]
      if (!group) continue
      applyVec3(group.position, actor.position)
      group.rotation.set(actor.rotation[0], actor.rotation[1], actor.rotation[2])
    }
  })

  // 退出预演 → actor group 恢复舞台常驻摆位 + 相机 fov 复位。
  useEffect(() => {
    if (active) return
    for (const a of restRef.current) {
      const group = actorRefs.current[a.id]
      if (!group) continue
      applyVec3(group.position, a.position)
      group.rotation.set(a.rotation[0], a.rotation[1], a.rotation[2])
    }
    const cam = camera as THREE.PerspectiveCamera
    if (cam.fov !== 45) {
      cam.fov = 45
      cam.updateProjectionMatrix()
    }
  }, [active, camera, actorRefs])

  return null
}
