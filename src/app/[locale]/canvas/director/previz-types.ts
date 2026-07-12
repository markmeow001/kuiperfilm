/**
 * 导演台 v3 — 镜头预演 (previz) data model.
 *
 * A stage gains an ordered shot sequence (`shots`). Each shot animates ONE
 * camera pose + the actors' placements from a 起幅 keyframe to a 落幅 keyframe
 * over `durationSec`, optionally routed through 运镜关键点 (camera) and
 * 调度线 waypoints (actors). The whole scene is hard-capped at 15s — that is
 * exactly the AtlasCloud Seedance R2V reference-video ceiling, so an exported
 * previz clip is always a legal R2V reference.
 *
 * Pure data + normalization (no three.js) so it serializes into data.stage.
 * Interpolation lives in previz-eval.ts (imports these types; never the
 * reverse — keep the dependency one-way).
 */
import type { Vec3 } from './stage-types'

export const MAX_SCENE_SEC = 15
export const SHOT_MIN_SEC = 0.5

/** One end of a shot (起幅 or 落幅): camera pose + actor placement snapshot. */
export interface ShotKeyframe {
  camera: { position: Vec3; target: Vec3; fov: number; roll?: number }
  /** actor id → placement. An id absent from BOTH keyframes uses its live stage transform. */
  actors: Record<string, { position: Vec3; rotation: Vec3 }>
}

export type ShotEasing = 'linear' | 'easeInOut'

export interface StageShot {
  id: string
  /** 「01 开场·远景」 */
  label: string
  /** 景别/机位/运镜描述（喂导演指令文本） */
  note?: string
  /** 0.5–15s；全片合计 ≤ MAX_SCENE_SEC（clampShots 强制） */
  durationSec: number
  start: ShotKeyframe
  end: ShotKeyframe
  /** 运镜关键点：起幅 → … → 落幅 的中间路径点 */
  cameraWaypoints?: Vec3[]
  /** actor id → 调度线中间点 */
  movePaths?: Record<string, Vec3[]>
  easing?: ShotEasing
}

export function totalDurationSec(shots: StageShot[]): number {
  let sum = 0
  for (const s of shots) sum += s.durationSec
  return sum
}

/**
 * Enforce per-shot [SHOT_MIN_SEC, MAX_SCENE_SEC] and the 15s scene budget:
 * walk in order, clamp the shot that overflows to the remaining budget, drop
 * everything after the budget is exhausted. Returns a new array (no mutation).
 */
export function clampShots(shots: StageShot[]): StageShot[] {
  const out: StageShot[] = []
  let used = 0
  for (const s of shots) {
    const remaining = MAX_SCENE_SEC - used
    if (remaining < SHOT_MIN_SEC) break
    const wanted = Math.min(Math.max(s.durationSec, SHOT_MIN_SEC), MAX_SCENE_SEC)
    const dur = Math.min(wanted, remaining)
    out.push(dur === s.durationSec ? s : { ...s, durationSec: dur })
    used += dur
  }
  return out
}

/** 以当前机位 + 全体 actor 摆位建一个静止镜头（起幅=落幅，深拷贝互不串改）。 */
export function makeShot(
  id: string,
  index: number,
  camera: ShotKeyframe['camera'],
  actors: ShotKeyframe['actors'],
): StageShot {
  const snapshot = (): ShotKeyframe => ({
    camera: { ...camera, position: [...camera.position], target: [...camera.target] },
    actors: Object.fromEntries(
      Object.entries(actors).map(([aid, a]) => [aid, { position: [...a.position] as Vec3, rotation: [...a.rotation] as Vec3 }]),
    ),
  })
  const nn = String(index + 1).padStart(2, '0')
  return { id, label: `${nn} 镜头`, durationSec: 3, start: snapshot(), end: snapshot(), easing: 'easeInOut' }
}

// ---------------------------------------------------------------------------
// normalization (persisted / possibly hostile data → current shape)
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function vec3(v: unknown, fallback: Vec3): Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? [v[0], v[1], v[2]]
    : fallback
}

function vec3List(v: unknown): Vec3[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Vec3[] = []
  for (const p of v) {
    if (Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      out.push([p[0], p[1], p[2]])
    }
  }
  return out.length > 0 ? out : undefined
}

function normalizeKeyframe(raw: unknown): ShotKeyframe | null {
  if (!isObj(raw) || !isObj(raw.camera)) return null
  const cam = raw.camera
  const camera: ShotKeyframe['camera'] = {
    position: vec3(cam.position, [0, 1.6, 4.5]),
    target: vec3(cam.target, [0, 1, 0]),
    fov: typeof cam.fov === 'number' && Number.isFinite(cam.fov) ? cam.fov : 45,
    ...(typeof cam.roll === 'number' && Number.isFinite(cam.roll) ? { roll: cam.roll } : {}),
  }
  const actors: ShotKeyframe['actors'] = {}
  if (isObj(raw.actors)) {
    for (const [aid, a] of Object.entries(raw.actors)) {
      if (!isObj(a)) continue
      actors[aid] = { position: vec3(a.position, [0, 0, 0]), rotation: vec3(a.rotation, [0, 0, 0]) }
    }
  }
  return { camera, actors }
}

/** Never throws; malformed entries are dropped, missing fields defaulted. */
export function normalizeShots(raw: unknown): StageShot[] {
  if (!Array.isArray(raw)) return []
  const out: StageShot[] = []
  for (const [i, r] of raw.entries()) {
    if (!isObj(r)) continue
    const start = normalizeKeyframe(r.start)
    const end = normalizeKeyframe(r.end)
    if (!start || !end) continue // unrenderable without both keyframes
    const movePaths: Record<string, Vec3[]> = {}
    if (isObj(r.movePaths)) {
      for (const [aid, pts] of Object.entries(r.movePaths)) {
        const list = vec3List(pts)
        if (list) movePaths[aid] = list
      }
    }
    const dur = typeof r.durationSec === 'number' && Number.isFinite(r.durationSec) ? r.durationSec : 3
    out.push({
      id: typeof r.id === 'string' ? r.id : `shot_restored_${i}`,
      label: typeof r.label === 'string' && r.label ? r.label : `${String(i + 1).padStart(2, '0')} 镜头`,
      ...(typeof r.note === 'string' && r.note ? { note: r.note } : {}),
      durationSec: Math.min(Math.max(dur, SHOT_MIN_SEC), MAX_SCENE_SEC),
      start,
      end,
      ...(vec3List(r.cameraWaypoints) ? { cameraWaypoints: vec3List(r.cameraWaypoints) } : {}),
      ...(Object.keys(movePaths).length > 0 ? { movePaths } : {}),
      easing: r.easing === 'linear' ? 'linear' : 'easeInOut',
    })
  }
  return clampShots(out)
}
