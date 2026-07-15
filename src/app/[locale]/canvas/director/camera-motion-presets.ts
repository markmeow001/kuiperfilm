import type { StageShot } from './previz-types'
import type { Vec3 } from './stage-types'

export type CameraMoveKey = 'push-in' | 'pull-out' | 'truck-right' | 'crane-up' | 'orbit-right' | 'follow'

export interface CameraMovePreset {
  key: CameraMoveKey
  label: string
  description: string
}

export const CAMERA_MOVE_PRESETS: CameraMovePreset[] = [
  { key: 'push-in', label: '推进', description: '沿视线靠近主体' },
  { key: 'pull-out', label: '拉远', description: '沿视线远离主体' },
  { key: 'truck-right', label: '横移', description: '向画面右侧平移' },
  { key: 'crane-up', label: '升降', description: '摄影机向上升起' },
  { key: 'orbit-right', label: '环绕', description: '绕主体顺时针环绕' },
  { key: 'follow', label: '跟拍', description: '跟随已锁定人物或道具' },
]

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (v: Vec3, n: number): Vec3 => [v[0] * n, v[1] * n, v[2] * n]
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2])
const normalize = (v: Vec3): Vec3 => {
  const n = length(v)
  return n > 1e-6 ? scale(v, 1 / n) : [0, 0, -1]
}
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

function orbitPoint(position: Vec3, target: Vec3, angleRad: number): Vec3 {
  const offset = sub(position, target)
  const c = Math.cos(angleRad)
  const s = Math.sin(angleRad)
  return [target[0] + offset[0] * c + offset[2] * s, position[1], target[2] - offset[0] * s + offset[2] * c]
}

/**
 * Apply a one-click move to a shot's existing keyframe structure.
 * Returns null only when 跟拍 has no valid locked object in both actor snapshots.
 */
export function applyCameraMovePreset(shot: StageShot, key: CameraMoveKey, trackingObjectId?: string | null): StageShot | null {
  const startCamera = shot.start.camera
  const position = [...startCamera.position] as Vec3
  const target = [...startCamera.target] as Vec3
  const forward = normalize(sub(target, position))
  const distance = Math.max(length(sub(target, position)), 1)
  const travel = Math.max(distance * 0.35, 0.8)
  let endPosition = [...position] as Vec3
  let endTarget = [...target] as Vec3
  let cameraWaypoints: Vec3[] | undefined

  switch (key) {
    case 'push-in':
      endPosition = add(position, scale(forward, Math.min(travel, Math.max(distance - 0.5, 0.25))))
      break
    case 'pull-out':
      endPosition = add(position, scale(forward, -travel))
      break
    case 'truck-right': {
      const right = normalize(cross(forward, [0, 1, 0]))
      const delta = scale(right, travel)
      endPosition = add(position, delta)
      endTarget = add(target, delta)
      break
    }
    case 'crane-up': {
      const delta: Vec3 = [0, travel, 0]
      endPosition = add(position, delta)
      endTarget = add(target, scale(delta, 0.35))
      break
    }
    case 'orbit-right': {
      const angle = Math.PI / 4
      endPosition = orbitPoint(position, target, angle)
      cameraWaypoints = [orbitPoint(position, target, angle / 2)]
      break
    }
    case 'follow': {
      if (!trackingObjectId) return null
      const actorStart = shot.start.actors[trackingObjectId]
      const actorEnd = shot.end.actors[trackingObjectId]
      if (!actorStart || !actorEnd) return null
      const delta = sub(actorEnd.position, actorStart.position)
      endPosition = add(position, delta)
      endTarget = add(target, delta)
      break
    }
  }

  const preset = CAMERA_MOVE_PRESETS.find((item) => item.key === key)
  return {
    ...shot,
    note: [shot.note, preset?.label].filter(Boolean).join(' / '),
    end: {
      ...shot.end,
      camera: { ...startCamera, position: endPosition, target: endTarget },
    },
    cameraWaypoints,
  }
}
