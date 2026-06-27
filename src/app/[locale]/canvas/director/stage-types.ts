/**
 * 导演台 (3D director stage) state — M2a.
 *
 * A lightweight blocking stage: posable 素体 mannequins + one shot camera. The
 * user arranges figures + frames a camera, screenshots the camera POV, and
 * sends it to the canvas as a reference image (feeds i2v / image consistency).
 * Full per-joint rig + pose presets + crowd/props = M2b.
 *
 * Persisted inside the director node's data.stage so reopening restores the
 * scene. Pure data (no three.js objects) so it serializes to the Canvas DB.
 */
import { REST_POSE, type Pose } from './pose-presets'

export type Vec3 = [number, number, number]

export interface StageMannequin {
  id: string
  label: string
  position: Vec3
  rotation: Vec3 // euler radians (whole-body facing)
  scale: number
  color: string
  // Articulated rig (per-joint, M2b). Optional because M2a-era saved stages
  // predate it — normalized to REST_POSE at the load boundary (DirectorNode).
  pose?: Pose
}

export interface StageCamera {
  position: Vec3
  target: Vec3
  fov: number
}

export interface DirectorStageState {
  mannequins: StageMannequin[]
  camera: StageCamera
}

export type TransformMode = 'translate' | 'rotate' | 'scale'
export type StageView = 'director' | 'shot'

const MANNEQUIN_COLORS = ['#6FA8FF', '#FF9E6F', '#7BE3A4', '#C8A2FF', '#F4C44E', '#E86F9E']

export const DEFAULT_STAGE: DirectorStageState = {
  mannequins: [],
  camera: { position: [0, 1.6, 4.5], target: [0, 1, 0], fov: 45 },
}

export function makeMannequin(id: string, index: number): StageMannequin {
  // Fan new figures out along X so they don't overlap.
  const x = (index % 5) * 1.2 - 1.2
  return {
    id,
    label: `角色${index + 1}`,
    position: [x, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    color: MANNEQUIN_COLORS[index % MANNEQUIN_COLORS.length],
    pose: REST_POSE,
  }
}
