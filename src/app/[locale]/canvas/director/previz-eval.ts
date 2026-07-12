/**
 * 导演台 previz 求值器 — pure interpolation, no react/fiber.
 *
 * evalShot(shot, t) answers「t 时刻镜头长什么样」: camera pose + every keyframed
 * actor's placement. The render layer consumes the result imperatively each
 * frame (never through React state — see DirectorStage's stateRef pattern).
 *
 * Paths: a keyframe pair with waypoints becomes a CatmullRom curve (three's
 * battle-tested spline; this module stays DOM-free so it unit-tests in node).
 * Actor facing follows the path tangent when actually moving (model faces +Z
 * at rest → yaw = atan2(dx, dz)); stationary actors keep keyframed rotation.
 */
import * as THREE from 'three'
import type { Vec3 } from './stage-types'
import type { ShotKeyframe, StageShot } from './previz-types'

export interface EvalCamera { position: Vec3; target: Vec3; fov: number; roll: number }
export interface EvalActor {
  position: Vec3
  rotation: Vec3
  /** 该时刻是否在移动（走路循环开关）。 */
  moving: boolean
  /** 沿路径已走距离（米，喂 walk-cycle 相位）。 */
  travelDist: number
}
export interface ShotEval {
  camera: EvalCamera
  actors: Record<string, EvalActor>
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
/** smoothstep — matches CSS ease-in-out feel closely enough for previz. */
const easeInOut = (t: number) => t * t * (3 - 2 * t)

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const lerpVec3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

const toV = (v: Vec3) => new THREE.Vector3(v[0], v[1], v[2])

/**
 * Evaluate a waypointed path at parameter t. Two points → plain lerp;
 * with waypoints → centripetal CatmullRom through [from, ...waypoints, to].
 * Returns position + unit tangent (zero vector when the path has no length).
 */
function evalPath(from: Vec3, to: Vec3, waypoints: Vec3[] | undefined, t: number): { position: Vec3; tangent: Vec3; length: number } {
  if (!waypoints || waypoints.length === 0) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
    const len = Math.hypot(dx, dy, dz)
    return {
      position: lerpVec3(from, to, t),
      tangent: len < 1e-6 ? [0, 0, 0] : [dx / len, dy / len, dz / len],
      length: len,
    }
  }
  const curve = new THREE.CatmullRomCurve3([toV(from), ...waypoints.map(toV), toV(to)], false, 'centripetal')
  const p = curve.getPoint(t)
  const tan = curve.getTangent(t)
  const tanLen = tan.length()
  return {
    position: [p.x, p.y, p.z],
    tangent: tanLen < 1e-6 ? [0, 0, 0] : [tan.x / tanLen, tan.y / tanLen, tan.z / tanLen],
    length: curve.getLength(),
  }
}

function evalActor(id: string, start: ShotKeyframe, end: ShotKeyframe, movePath: Vec3[] | undefined, t: number): EvalActor {
  const a = start.actors[id]
  const b = end.actors[id]
  // present in only one keyframe → parked at that placement for the whole shot
  if (!a || !b) {
    const only = (a ?? b)!
    return { position: [...only.position], rotation: [...only.rotation], moving: false, travelDist: 0 }
  }
  const { position, tangent, length } = evalPath(a.position, b.position, movePath, t)
  const moving = tangent[0] !== 0 || tangent[1] !== 0 || tangent[2] !== 0
  const rotation: Vec3 = moving
    ? [lerp(a.rotation[0], b.rotation[0], t), Math.atan2(tangent[0], tangent[2]), lerp(a.rotation[2], b.rotation[2], t)]
    : lerpVec3(a.rotation, b.rotation, t)
  return { position, rotation, moving, travelDist: moving ? length * t : 0 }
}

/** t∈[0,1] (clamped) → camera pose + keyframed actors' placements. */
export function evalShot(shot: StageShot, rawT: number): ShotEval {
  const linearT = clamp01(rawT)
  const t = (shot.easing ?? 'easeInOut') === 'easeInOut' ? easeInOut(linearT) : linearT
  const s = shot.start, e = shot.end
  const camera: EvalCamera = {
    position: evalPath(s.camera.position, e.camera.position, shot.cameraWaypoints, t).position,
    target: lerpVec3(s.camera.target, e.camera.target, t),
    fov: lerp(s.camera.fov, e.camera.fov, t),
    roll: lerp(s.camera.roll ?? 0, e.camera.roll ?? 0, t),
  }
  const ids = new Set([...Object.keys(s.actors), ...Object.keys(e.actors)])
  const actors: Record<string, EvalActor> = {}
  for (const id of ids) actors[id] = evalActor(id, s, e, shot.movePaths?.[id], t)
  return { camera, actors }
}

/**
 * Map a global scene time (seconds) into { index, t } within the sequence.
 * A shot boundary belongs to the NEXT shot's start; time past the end clamps
 * to the last shot at t=1. Empty sequence → null.
 */
export function locateInSequence(shots: StageShot[], timeSec: number): { index: number; t: number } | null {
  if (shots.length === 0) return null
  let acc = 0
  for (let i = 0; i < shots.length; i++) {
    const dur = shots[i].durationSec
    if (timeSec < acc + dur) return { index: i, t: dur > 0 ? (timeSec - acc) / dur : 0 }
    acc += dur
  }
  return { index: shots.length - 1, t: 1 }
}
