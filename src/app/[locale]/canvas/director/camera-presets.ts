/**
 * 导演台 camera angle presets (Batch A) — cinematic shot placements.
 *
 * Each preset is an offset in the SUBJECT's local frame (subject faces +Z, up
 * +Y, right +X), relative to a focus point. computePreset rotates the offset by
 * the subject's facing (rotation.y) so 正面/侧面/背面/过肩 respect where the
 * character actually looks. '当前视角' is special (snapshots the live orbit view).
 */
import type { Vec3 } from './stage-types'

export interface CameraPreset {
  name: string
  /** Camera position offset in subject-local space (front = +Z, right = +X). */
  off: Vec3
  /** Look-at offset in subject-local space (from focus). */
  tgt: Vec3
  fov: number
  roll?: number
  /** '当前视角' — resolve from the live director view instead of an offset. */
  current?: boolean
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { name: '当前视角', off: [0, 0, 0], tgt: [0, 0, 0], fov: 45, current: true },
  { name: '正面中景', off: [0, 0.0, 3.0], tgt: [0, 0.0, 0], fov: 38 },
  { name: '正面特写', off: [0, 0.5, 1.4], tgt: [0, 0.55, 0], fov: 32 },
  { name: '正面全景', off: [0, 1.2, 6.5], tgt: [0, 0.0, 0], fov: 50 },
  { name: '侧面跟拍', off: [3.0, 0.2, 0.6], tgt: [0, 0.1, 0], fov: 40 },
  { name: '侧面近景', off: [1.8, 0.3, 0.4], tgt: [0, 0.4, 0], fov: 34 },
  { name: '背面中景', off: [0, 0.1, -3.0], tgt: [0, 0.0, 0], fov: 40 },
  { name: '俯拍全景', off: [0, 4.5, 5.0], tgt: [0, 0.0, 0], fov: 50 },
  { name: '45°俯拍', off: [2.4, 3.0, 2.6], tgt: [0, 0.2, 0], fov: 44 },
  { name: '低角度仰拍', off: [0, -0.4, 2.6], tgt: [0, 1.1, 0], fov: 46 },
  { name: '低角度广角', off: [0, 0.0, 3.4], tgt: [0, 0.9, 0], fov: 64 },
  { name: '过肩镜头', off: [-0.7, 0.7, -1.7], tgt: [0, 0.2, 2.5], fov: 42 },
  { name: '过肩镜头(右)', off: [0.7, 0.7, -1.7], tgt: [0, 0.2, 2.5], fov: 42 },
  { name: '鸟瞰', off: [0, 8.0, 1.2], tgt: [0, 0, 0], fov: 55 },
  { name: '荷兰角', off: [1.2, 0.3, 3.0], tgt: [0, 0.2, 0], fov: 42, roll: 14 },
]

/** Rotate a subject-local offset by the subject's facing (Y rotation, radians). */
function rotateY([x, y, z]: Vec3, theta: number): Vec3 {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [x * c + z * s, y, -x * s + z * c]
}

export interface ResolvedShot {
  position: Vec3
  target: Vec3
  fov: number
  roll: number
}

/**
 * Resolve a preset to world position/target. focus = subject mid-point,
 * facingY = subject rotation.y (radians). currentView supplies the live orbit
 * camera for '当前视角'.
 */
export function computePreset(
  preset: CameraPreset,
  focus: Vec3,
  facingY: number,
  currentView?: { position: Vec3; target: Vec3; fov: number } | null,
): ResolvedShot {
  if (preset.current && currentView) {
    return { ...currentView, roll: 0 }
  }
  const pOff = rotateY(preset.off, facingY)
  const tOff = rotateY(preset.tgt, facingY)
  return {
    position: [focus[0] + pOff[0], focus[1] + pOff[1], focus[2] + pOff[2]],
    target: [focus[0] + tOff[0], focus[1] + tOff[1], focus[2] + tOff[2]],
    fov: preset.fov,
    roll: preset.roll ?? 0,
  }
}

/** Numeric width/height ratio for a StageAspect (null = use viewport). */
export function aspectRatio(aspect: string | undefined): number | null {
  switch (aspect) {
    case '21:9': return 21 / 9
    case '16:9': return 16 / 9
    case '4:3': return 4 / 3
    case '1:1': return 1
    case '3:4': return 3 / 4
    case '9:16': return 9 / 16
    default: return null
  }
}
