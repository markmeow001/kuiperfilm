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
import type { StageMannequin, Vec3 } from './stage-types'
import type { StageShot } from './previz-types'
import { evalShot, locateInSequence } from './previz-eval'

const DEG2RAD = Math.PI / 180

export interface PrevizDriverProps {
  active: boolean
  shots: StageShot[]
  getTimeSec: () => number
  /** SceneContents 的人偶 group refs（id → group）。 */
  mannequinRefs: React.MutableRefObject<Record<string, THREE.Group | null>>
  /** 恢复用的舞台常驻摆位。 */
  mannequins: StageMannequin[]
}

function applyVec3(target: THREE.Vector3, v: Vec3) {
  target.set(v[0], v[1], v[2])
}

export function PrevizDriver({ active, shots, getTimeSec, mannequinRefs, mannequins }: PrevizDriverProps) {
  const { camera } = useThree()
  const mannequinsRef = useRef(mannequins)
  mannequinsRef.current = mannequins

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
      const group = mannequinRefs.current[id]
      if (!group) continue
      applyVec3(group.position, actor.position)
      group.rotation.set(actor.rotation[0], actor.rotation[1], actor.rotation[2])
    }
  })

  // 退出预演 → 人偶 group 恢复舞台常驻摆位 + 相机 fov 复位。
  useEffect(() => {
    if (active) return
    for (const m of mannequinsRef.current) {
      const group = mannequinRefs.current[m.id]
      if (!group) continue
      applyVec3(group.position, m.position)
      group.rotation.set(m.rotation[0], m.rotation[1], m.rotation[2])
    }
    const cam = camera as THREE.PerspectiveCamera
    if (cam.fov !== 45) {
      cam.fov = 45
      cam.updateProjectionMatrix()
    }
  }, [active, camera, mannequinRefs])

  return null
}
