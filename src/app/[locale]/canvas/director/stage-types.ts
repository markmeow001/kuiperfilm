/**
 * 导演台 (3D director stage) state.
 *
 * v2 (持久场景 + 多机位): one stage holds the cast (mannequins) in their spatial
 * relationship + MULTIPLE cameras. Each camera screenshots the SAME blocking →
 * one frame per camera, so every frame shares consistent positions (the basis
 * for a coherent 剧, not disconnected one-offs). Cast appearance is propagated
 * by wiring character nodes into the director (DirectorNode auto-wires them onto
 * each spawned frame).
 *
 * Pure data (no three.js) so it serializes into the Canvas DB via data.stage.
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
  // predate it — normalized to REST_POSE by normalizeStage().
  pose?: Pose
}

export interface StageCamera {
  id: string
  label: string
  position: Vec3
  target: Vec3
  fov: number
  /** Dutch-angle roll in degrees (0 = level). */
  roll?: number
  /** When set, the camera's look-at follows this mannequin (overrides target). */
  lookAtMannequinId?: string | null
}

/** Output framing aspect for screenshots. 'auto' = the live viewport ratio. */
export type StageAspect = 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
export const STAGE_ASPECTS: StageAspect[] = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

export interface DirectorStageState {
  mannequins: StageMannequin[]
  cameras: StageCamera[]
  aspect?: StageAspect
}

export type TransformMode = 'translate' | 'rotate' | 'scale'

const MANNEQUIN_COLORS = ['#6FA8FF', '#FF9E6F', '#7BE3A4', '#C8A2FF', '#F4C44E', '#E86F9E']

export const DEFAULT_STAGE: DirectorStageState = {
  mannequins: [],
  cameras: [{ id: 'cam-1', label: '机位1', position: [0, 1.6, 4.5], target: [0, 1, 0], fov: 45 }],
}

export function makeMannequin(id: string, index: number): StageMannequin {
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

export function makeCamera(id: string, index: number): StageCamera {
  return {
    id,
    label: `机位${index + 1}`,
    position: [(index % 4) * 1.6 - 0.8, 1.6, 4.5 - (index % 2)],
    target: [0, 1, 0],
    fov: 45,
  }
}

/**
 * Normalize a persisted (possibly older) stage into the current shape:
 *  - fill REST_POSE for pre-rig mannequins
 *  - migrate a single `camera` (v1) → `cameras: [camera]`
 * Never throws — degrades to DEFAULT_STAGE pieces.
 */
export function normalizeStage(raw: unknown): DirectorStageState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as {
    mannequins?: unknown
    cameras?: unknown
    camera?: { position?: Vec3; target?: Vec3; fov?: number }
  }
  const mannequins: StageMannequin[] = Array.isArray(r.mannequins)
    ? (r.mannequins as StageMannequin[]).filter(Boolean).map((m) => (m.pose ? m : { ...m, pose: REST_POSE }))
    : []
  let cameras: StageCamera[] = Array.isArray(r.cameras) ? (r.cameras as StageCamera[]).filter(Boolean) : []
  if (cameras.length === 0 && r.camera) {
    cameras = [{ id: 'cam-1', label: '机位1', position: r.camera.position ?? [0, 1.6, 4.5], target: r.camera.target ?? [0, 1, 0], fov: r.camera.fov ?? 45 }]
  }
  if (cameras.length === 0) cameras = DEFAULT_STAGE.cameras.map((c) => ({ ...c }))
  const rawAspect = (r as { aspect?: string }).aspect
  const aspect: StageAspect = STAGE_ASPECTS.includes(rawAspect as StageAspect) ? (rawAspect as StageAspect) : 'auto'
  return { mannequins, cameras, aspect }
}
