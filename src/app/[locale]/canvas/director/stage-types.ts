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

/** 素体 body type — drives proportion multipliers in Mannequin. */
export type BodyType = 'male' | 'female' | 'broad' | 'muscular' | 'slender' | 'teen' | 'child' | 'chibi'

export interface BodyTypeDef {
  key: BodyType
  label: string
  /** overall height scale, limb thickness, head scale. */
  height: number
  girth: number
  head: number
}

export const BODY_TYPES: BodyTypeDef[] = [
  { key: 'male', label: '男性素体', height: 1.0, girth: 1.0, head: 1.0 },
  { key: 'female', label: '女性素体', height: 0.95, girth: 0.86, head: 0.96 },
  { key: 'broad', label: '宽厚素体', height: 1.0, girth: 1.28, head: 1.05 },
  { key: 'muscular', label: '健壮素体', height: 1.04, girth: 1.18, head: 0.98 },
  { key: 'slender', label: '纤细素体', height: 1.0, girth: 0.78, head: 0.95 },
  { key: 'teen', label: '少年素体', height: 0.86, girth: 0.84, head: 1.06 },
  { key: 'child', label: '儿童素体', height: 0.68, girth: 0.86, head: 1.22 },
  { key: 'chibi', label: '二头身', height: 0.6, girth: 1.15, head: 1.9 },
]

export interface StageMannequin {
  id: string
  label: string
  position: Vec3
  rotation: Vec3 // euler radians (whole-body facing)
  scale: number
  color: string
  /** 素体 body type (default 'male'). */
  bodyType?: BodyType
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

export function makeMannequin(id: string, index: number, bodyType: BodyType = 'male'): StageMannequin {
  const x = (index % 5) * 1.2 - 1.2
  return {
    id,
    label: `角色${String.fromCharCode(65 + (index % 26))}`,
    position: [x, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    color: MANNEQUIN_COLORS[index % MANNEQUIN_COLORS.length],
    bodyType,
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
