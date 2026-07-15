/** Full-frame (36×24mm) lens helpers. Three.js PerspectiveCamera.fov is vertical. */
import type { Vec3 } from './stage-types'

const SENSOR_HEIGHT_MM = 24

export const FOCAL_LENGTH_PRESETS_MM = [18, 24, 35, 50, 85, 135] as const

export function focalLengthToFov(focalLengthMm: number): number {
  if (!Number.isFinite(focalLengthMm) || focalLengthMm <= 0) throw new Error('焦段必须是正数')
  return (2 * Math.atan(SENSOR_HEIGHT_MM / (2 * focalLengthMm)) * 180) / Math.PI
}

export function fovToFocalLength(fovDeg: number): number {
  if (!Number.isFinite(fovDeg) || fovDeg <= 0 || fovDeg >= 180) throw new Error('FOV 必须介于 0 与 180 度之间')
  return SENSOR_HEIGHT_MM / (2 * Math.tan((fovDeg * Math.PI) / 360))
}

/** Keep the current viewing angle while framing the target at an exact distance. */
export function frameCameraAtDistance(position: Vec3, target: Vec3, distance: number): Vec3 {
  if (!Number.isFinite(distance) || distance <= 0) throw new Error('构图距离必须是正数')
  const offset: Vec3 = [position[0] - target[0], position[1] - target[1], position[2] - target[2]]
  const currentDistance = Math.hypot(...offset)
  const direction: Vec3 = currentDistance > 1e-6
    ? [offset[0] / currentDistance, offset[1] / currentDistance, offset[2] / currentDistance]
    : [0, 0, 1]
  return [target[0] + direction[0] * distance, target[1] + direction[1] * distance, target[2] + direction[2] * distance]
}
