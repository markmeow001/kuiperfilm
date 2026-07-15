/**
 * 导演路线方案 — 类型 + LLM 输出容错解析（纯模块，无 worker/queue 依赖）。
 *
 * 单独成档的原因：handler 的 import 链带 BullMQ/Redis，客户端
 * (route-materialize) 与单测都要用这里的类型和 parseRoutePlans，
 * 不能经由 handler 引入。
 */
import { CAMERA_PRESETS } from '@/app/[locale]/canvas/director/camera-presets'

export const ROUTE_MOVEMENTS = ['固定', '推近', '拉远', '横移', '升降'] as const
export type RouteMovement = (typeof ROUTE_MOVEMENTS)[number]

export interface DirectorRoutePlanShot {
  label: string
  note: string
  durationSec: number
  /** camera-presets 的 name（'当前视角' 除外）。 */
  cameraPreset: string
  movement: RouteMovement
  /** 该镜头对焦的卡司 label（可空 = 第一个人偶）。 */
  focus?: string
}

export interface DirectorRoutePlan {
  name: string
  style: string
  shots: DirectorRoutePlanShot[]
}

export type DirectorRouteInputMode = 'brief' | 'storyboard'

export const DIRECTOR_ROUTE_DESCRIPTION_LIMITS: Record<DirectorRouteInputMode, number> = {
  brief: 500,
  storyboard: 5000,
}

export interface DirectorRouteSegment {
  order: number
  title: string
  /** AI 从原始分镜抽出的可拍摄事件摘要，方便用户核对是否遗漏。 */
  sourceSummary: string
  plans: DirectorRoutePlan[]
}

const MAX_PLANS = 3
export const MAX_STORYBOARD_SEGMENTS = 24
export const MAX_SHOTS_PER_PLAN = 6
/** 与 previz-types MAX_SCENE_SEC 一致（R2V 参考视频上限）。 */
export const MAX_SCENE_SEC = 15
const MIN_SHOT_SEC = 0.5
const FALLBACK_PRESET = '正面中景'

/** 可用机位预设名（排除依赖实时视角的 '当前视角'）。 */
export const PRESET_NAMES = CAMERA_PRESETS.filter((p) => !p.current).map((p) => p.name)

/** Tolerant parse + 白名单收敛。exported for unit tests. */
export function parseRoutePlans(text: string): DirectorRoutePlan[] {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('CANVAS_DIRECTOR_ROUTES_PARSE: no JSON array in model output')
  }
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1))
  if (!Array.isArray(parsed)) {
    throw new Error('CANVAS_DIRECTOR_ROUTES_PARSE: result is not an array')
  }
  const plans: DirectorRoutePlan[] = []
  for (const raw of parsed) {
    if (plans.length >= MAX_PLANS) break
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const rawShots = Array.isArray(o.shots) ? o.shots : []
    const shots: DirectorRoutePlanShot[] = []
    let used = 0
    for (const [i, rs] of rawShots.entries()) {
      if (shots.length >= MAX_SHOTS_PER_PLAN) break
      if (!rs || typeof rs !== 'object') continue
      const s = rs as Record<string, unknown>
      const remaining = MAX_SCENE_SEC - used
      if (remaining < MIN_SHOT_SEC) break
      const rawDur = typeof s.durationSec === 'number' && Number.isFinite(s.durationSec) ? s.durationSec : 3
      const durationSec = Math.round(Math.min(Math.max(rawDur, MIN_SHOT_SEC), remaining) * 10) / 10
      used += durationSec
      shots.push({
        label: typeof s.label === 'string' && s.label.trim() ? s.label.trim() : `${String(i + 1).padStart(2, '0')} 镜头`,
        note: typeof s.note === 'string' ? s.note.trim() : '',
        durationSec,
        cameraPreset: typeof s.cameraPreset === 'string' && PRESET_NAMES.includes(s.cameraPreset) ? s.cameraPreset : FALLBACK_PRESET,
        movement: ROUTE_MOVEMENTS.includes(s.movement as RouteMovement) ? (s.movement as RouteMovement) : '固定',
        ...(typeof s.focus === 'string' && s.focus.trim() ? { focus: s.focus.trim() } : {}),
      })
    }
    if (shots.length === 0) continue
    plans.push({
      name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : `方案 ${plans.length + 1}`,
      style: typeof o.style === 'string' ? o.style.trim() : '',
      shots,
    })
  }
  if (plans.length === 0) {
    throw new Error('CANVAS_DIRECTOR_ROUTES_PARSE: no valid plans parsed')
  }
  return plans
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('CANVAS_DIRECTOR_ROUTES_PARSE: no JSON object in model output')
  }
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CANVAS_DIRECTOR_ROUTES_PARSE: result is not an object')
  }
  return parsed as Record<string, unknown>
}

/**
 * 新版统一输出：短描述只有一个 segment（2-3 套方案）；完整分镜会依剧情顺序
 * 拆成多个 segment（每段一套精选方案）。所有 plan 仍经过 parseRoutePlans 的
 * 镜位、运镜、镜头数与 15 秒白名单收敛。
 */
export function parseDirectorRouteSegments(text: string, mode: DirectorRouteInputMode): DirectorRouteSegment[] {
  const root = extractJsonObject(text)
  if (!Array.isArray(root.segments)) {
    throw new Error('CANVAS_DIRECTOR_ROUTES_PARSE: segments is not an array')
  }
  const maxSegments = mode === 'storyboard' ? MAX_STORYBOARD_SEGMENTS : 1
  const maxPlans = mode === 'storyboard' ? 1 : MAX_PLANS
  const segments: DirectorRouteSegment[] = []
  for (const raw of root.segments) {
    if (segments.length >= maxSegments) break
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const segment = raw as Record<string, unknown>
    const rawPlans = Array.isArray(segment.plans) ? segment.plans.slice(0, maxPlans) : []
    let plans: DirectorRoutePlan[]
    try {
      plans = parseRoutePlans(JSON.stringify(rawPlans))
    } catch {
      continue
    }
    const order = segments.length + 1
    segments.push({
      order,
      title: typeof segment.title === 'string' && segment.title.trim() ? segment.title.trim() : `段落 ${order}`,
      sourceSummary: typeof segment.sourceSummary === 'string' ? segment.sourceSummary.trim().slice(0, 600) : '',
      plans,
    })
  }
  if (segments.length === 0) {
    throw new Error('CANVAS_DIRECTOR_ROUTES_PARSE: no valid segments parsed')
  }
  return segments
}
