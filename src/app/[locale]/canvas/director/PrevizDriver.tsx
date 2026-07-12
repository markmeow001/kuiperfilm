'use client'

/**
 * previz 3D 驱动层 — 挂在 SceneContents 里的每帧消费者。
 *
 * 预演激活时：每帧读时钟 → locateInSequence + evalShot → **命令式**写
 * viewCamera 与 actor group（绝不经 React state；沿用 capture() 的 stateRef
 * 思路）。移动中的人偶按 walk-cycle 叠加程序化步态（关节 group 依赖
 * Mannequin 的 `bone:*` 命名）。退出预演时把 group transform 与关节全部
 * 恢复回舞台常驻值（React 的 props 不会自动重设——值没变它不会重写
 * three 对象）。
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { Vec3 } from './stage-types'
import type { StageShot } from './previz-types'
import { evalShot, locateInSequence } from './previz-eval'
import type { Pose } from './pose-presets'
import { WALK_STRIDE_M, walkJointAngles } from './walk-cycle'

const DEG2RAD = Math.PI / 180

/** 恢复用的舞台常驻摆位（人偶带 pose → 可走路 + 关节恢复；道具没有）。 */
export interface RestActor { id: string; position: Vec3; rotation: Vec3; pose?: Pose }

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

const WALK_JOINTS = ['hipL', 'hipR', 'kneeL', 'kneeR', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR'] as const
type WalkJoint = (typeof WALK_JOINTS)[number]
type BoneMap = Partial<Record<WalkJoint | 'pelvis', THREE.Object3D>>

/** group → 具名骨骼查找缓存（WeakMap：group 重挂载自动失效）。 */
const boneCache = new WeakMap<THREE.Group, BoneMap>()
function bonesOf(group: THREE.Group): BoneMap {
  let map = boneCache.get(group)
  if (map) return map
  map = {}
  for (const j of WALK_JOINTS) {
    const o = group.getObjectByName(`bone:${j}`)
    if (o) map[j] = o
  }
  const pelvis = group.getObjectByName('bone:pelvis')
  if (pelvis) map.pelvis = pelvis
  boneCache.set(group, map)
  return map
}

/** 把关节写回「自身 pose + 叠加量」；叠加量全 0 = 恢复原姿势。 */
function applyJoints(group: THREE.Group, base: Pose, add: Partial<Record<WalkJoint, number>>, bobY: number) {
  const bones = bonesOf(group)
  for (const j of WALK_JOINTS) {
    const bone = bones[j]
    if (!bone) continue
    const b = base.joints[j]
    bone.rotation.set(b[0] + (add[j] ?? 0), b[1], b[2])
  }
  if (bones.pelvis) bones.pelvis.position.y = 0.9 + base.root[1] + bobY
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
      // 程序化步态：只对人偶（有 pose 的 rest actor）叠加；停走时归零恢复。
      const basePose = restRef.current.find((a) => a.id === id)?.pose
      if (!basePose) continue // 道具/未知对象不走步态
      if (actor.moving) {
        const phase = (actor.travelDist / WALK_STRIDE_M) * Math.PI * 2
        const w = walkJointAngles(phase)
        applyJoints(group, basePose, w, w.rootBobY)
      } else {
        applyJoints(group, basePose, {}, 0)
      }
    }
  })

  // 退出预演 → actor group transform + 人偶关节 恢复舞台常驻值 + 相机 fov 复位。
  useEffect(() => {
    if (active) return
    for (const a of restRef.current) {
      const group = actorRefs.current[a.id]
      if (!group) continue
      applyVec3(group.position, a.position)
      group.rotation.set(a.rotation[0], a.rotation[1], a.rotation[2])
      if (a.pose) applyJoints(group, a.pose, {}, 0)
    }
    const cam = camera as THREE.PerspectiveCamera
    if (cam.fov !== 45) {
      cam.fov = 45
      cam.updateProjectionMatrix()
    }
  }, [active, camera, actorRefs])

  return null
}
