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
import { normalizeShots, type StageShot } from './previz-types'

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

/** 道具几何类型（'car' 是低模组合体，其余为基础几何）。 */
export type PropKind = 'box' | 'sphere' | 'cylinder' | 'car'
export const PROP_KINDS: { key: PropKind; label: string }[] = [
  { key: 'box', label: '方块' },
  { key: 'sphere', label: '球体' },
  { key: 'cylinder', label: '圆柱' },
  { key: 'car', label: '车（低模）' },
]

export interface StageProp {
  id: string
  label: string
  kind: PropKind
  position: Vec3
  rotation: Vec3
  /** 道具允许非等比缩放。 */
  scale: Vec3
  color: string
}

export function makeProp(id: string, index: number, kind: PropKind = 'box'): StageProp {
  const def = PROP_KINDS.find((k) => k.key === kind) ?? PROP_KINDS[0]
  return {
    id,
    label: `${def.label}${index + 1}`,
    kind: def.key,
    position: [((index % 4) - 1.5) * 1.5, 0, -1.5],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: '#B84A39',
  }
}

export interface StageCamera {
  id: string
  label: string
  position: Vec3
  target: Vec3
  fov: number
  /** Dutch-angle roll in degrees (0 = level). */
  roll?: number
  /** When set, the camera's look-at follows this mannequin or prop (overrides target). */
  lookAtObjectId?: string | null
}

/** Output framing aspect for screenshots. 'auto' = the live viewport ratio. */
export type StageAspect = 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
export const STAGE_ASPECTS: StageAspect[] = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']

/** Scene background behind the mannequins. */
export type BackgroundMode = 'none' | 'flat' | 'sphere'
export interface StageBackground {
  mode: BackgroundMode
  /** durable COS key of the uploaded scene image (baked into screenshots). */
  key?: string | null
  /** signed URL for editor display (may expire between sessions). */
  url?: string | null
  /** 全景球 horizontal rotation in degrees. */
  rotationDeg?: number
  /** 全景球 radius. */
  radius?: number
  /** solid sky colour fallback when mode === 'none'. */
  skyColor?: string
}

export const DEFAULT_BACKGROUND: StageBackground = { mode: 'none', rotationDeg: 0, radius: 60, skyColor: '#0A0A0B' }

export interface DirectorStageState {
  mannequins: StageMannequin[]
  cameras: StageCamera[]
  aspect?: StageAspect
  background?: StageBackground
  /** 道具 (v3)。 */
  props: StageProp[]
  /** previz 镜头序列 (v3) — see previz-types.ts. */
  shots: StageShot[]
}

export type TransformMode = 'translate' | 'rotate' | 'scale'

const MANNEQUIN_COLORS = ['#6FA8FF', '#FF9E6F', '#7BE3A4', '#C8A2FF', '#F4C44E', '#E86F9E']

export const DEFAULT_STAGE: DirectorStageState = {
  mannequins: [],
  cameras: [{ id: 'cam-1', label: '机位1', position: [0, 1.6, 4.5], target: [0, 1, 0], fov: 45 }],
  props: [],
  shots: [],
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
/** A finite 3-tuple, else fallback. Guards malformed persisted Vec3 fields. */
function vec3(v: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? [v[0], v[1], v[2]]
    : fallback
}
function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

export function normalizeStage(raw: unknown): DirectorStageState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as {
    mannequins?: unknown
    cameras?: unknown
    camera?: { position?: Vec3; target?: Vec3; fov?: number }
  }
  // Validate each element's shape — a malformed entry (number, missing Vec3)
  // would otherwise feed `undefined` into R3F <group position> and throw.
  const mannequins: StageMannequin[] = (Array.isArray(r.mannequins) ? r.mannequins : [])
    .filter(isObj)
    .map((m, i) => ({
      id: typeof m.id === 'string' ? m.id : `m_restored_${i}`,
      label: typeof m.label === 'string' ? m.label : `角色${i + 1}`,
      position: vec3(m.position, [0, 0, 0]),
      rotation: vec3(m.rotation, [0, 0, 0]),
      scale: typeof m.scale === 'number' && Number.isFinite(m.scale) ? m.scale : 1,
      color: typeof m.color === 'string' ? m.color : '#6FA8FF',
      bodyType: m.bodyType as StageMannequin['bodyType'],
      pose: (m.pose as StageMannequin['pose']) ?? REST_POSE,
    }))
  let cameras: StageCamera[] = (Array.isArray(r.cameras) ? r.cameras : [])
    .filter(isObj)
    .map((c, i) => ({
      id: typeof c.id === 'string' ? c.id : `cam_restored_${i}`,
      label: typeof c.label === 'string' ? c.label : `机位${i + 1}`,
      position: vec3(c.position, [0, 1.6, 4.5]),
      target: vec3(c.target, [0, 1, 0]),
      fov: typeof c.fov === 'number' && Number.isFinite(c.fov) ? c.fov : 45,
      roll: typeof c.roll === 'number' && Number.isFinite(c.roll) ? c.roll : undefined,
      // Persist only lookAtObjectId from now on; consume the former mannequin-only
      // key once here so existing saved stages keep their tracking target.
      lookAtObjectId: typeof c.lookAtObjectId === 'string'
        ? c.lookAtObjectId
        : typeof c.lookAtMannequinId === 'string' ? c.lookAtMannequinId : null,
    }))
  if (cameras.length === 0 && r.camera) {
    cameras = [{ id: 'cam-1', label: '机位1', position: r.camera.position ?? [0, 1.6, 4.5], target: r.camera.target ?? [0, 1, 0], fov: r.camera.fov ?? 45 }]
  }
  if (cameras.length === 0) cameras = DEFAULT_STAGE.cameras.map((c) => ({ ...c }))
  const rawAspect = (r as { aspect?: string }).aspect
  const aspect: StageAspect = STAGE_ASPECTS.includes(rawAspect as StageAspect) ? (rawAspect as StageAspect) : 'auto'
  const rawBg = (r as { background?: Partial<StageBackground> }).background
  const background: StageBackground = rawBg && typeof rawBg === 'object'
    ? { ...DEFAULT_BACKGROUND, ...rawBg, mode: (['none', 'flat', 'sphere'] as const).includes(rawBg.mode as BackgroundMode) ? (rawBg.mode as BackgroundMode) : 'none' }
    : { ...DEFAULT_BACKGROUND }
  const rawProps = (r as { props?: unknown }).props
  const props: StageProp[] = (Array.isArray(rawProps) ? rawProps : [])
    .filter(isObj)
    .map((p, i) => ({
      id: typeof p.id === 'string' ? p.id : `p_restored_${i}`,
      label: typeof p.label === 'string' && p.label ? p.label : `道具${i + 1}`,
      kind: PROP_KINDS.some((k) => k.key === p.kind) ? (p.kind as PropKind) : 'box',
      position: vec3(p.position, [0, 0, 0]),
      rotation: vec3(p.rotation, [0, 0, 0]),
      scale: vec3(p.scale, [1, 1, 1]),
      color: typeof p.color === 'string' ? p.color : '#B84A39',
    }))
  const shots = normalizeShots((r as { shots?: unknown }).shots)
  return { mannequins, cameras, aspect, background, props, shots }
}
