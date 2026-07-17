/**
 * Live Composite project persistence — shared contract (2026-07-17).
 *
 * Single source of truth for the serialized timeline JSON stored in
 * `LiveCompositeProject.timeline` and for the storage-key ownership rules.
 * Used by the /api/live-composite/projects routes (validation) and by the
 * live-composite client (serialize/deserialize) so the two sides cannot
 * drift apart.
 *
 * Serialized stroke note: the in-memory `MaskStroke` uses `tool:
 * 'keep' | 'erase'` and `size` (brush diameter as a 0-1 fraction). The wire
 * format keeps the same tool values and stores the brush as `brushPercent`
 * (= size * 100) per the approved schema comment.
 */
import { z } from 'zod'

export const LIVE_COMPOSITE_MAX_KEYFRAMES = 600
export const LIVE_COMPOSITE_MAX_STROKES_PER_KEYFRAME = 500
export const LIVE_COMPOSITE_MAX_POINTS_PER_STROKE = 5_000
/** Hard byte cap on the timeline JSON blob (defense beyond the count caps). */
export const LIVE_COMPOSITE_MAX_TIMELINE_BYTES = 2_000_000
export const LIVE_COMPOSITE_PROJECT_LIST_CAP = 100

const normalizedPointSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict()

const serializedStrokeSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    tool: z.enum(['keep', 'erase']),
    /** Brush diameter as percent of the shorter source edge (in-memory `size` * 100). */
    brushPercent: z.number().gt(0).max(100),
    points: z.array(normalizedPointSchema).min(1).max(LIVE_COMPOSITE_MAX_POINTS_PER_STROKE),
  })
  .strict()

const serializedKeyframeSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    time: z.number().finite().min(0),
    baseMaskKey: z.string().trim().min(1).max(512).optional(),
    strokes: z.array(serializedStrokeSchema).max(LIVE_COMPOSITE_MAX_STROKES_PER_KEYFRAME),
  })
  .strict()

export const liveCompositeTimelineSchema = z
  .object({
    keyframes: z.array(serializedKeyframeSchema).min(1).max(LIVE_COMPOSITE_MAX_KEYFRAMES),
  })
  .strict()

export type LiveCompositeSerializedStroke = z.infer<typeof serializedStrokeSchema>
export type LiveCompositeSerializedKeyframe = z.infer<typeof serializedKeyframeSchema>
export type LiveCompositeSerializedTimeline = z.infer<typeof liveCompositeTimelineSchema>

const nameSchema = z.string().trim().min(1).max(120)
const storageKeySchema = z.string().trim().min(1).max(512)
const backgroundColorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, '背景色必須是 # 開頭的十六進位色碼')

export const liveCompositeProjectCreateSchema = z
  .object({
    name: nameSchema.optional(),
    videoKey: storageKeySchema.optional(),
    videoName: z.string().trim().min(1).max(255).optional(),
    backgroundKey: storageKeySchema.optional(),
    backgroundColor: backgroundColorSchema.optional(),
    timeline: liveCompositeTimelineSchema,
  })
  .strict()

export const liveCompositeProjectUpdateSchema = z
  .object({
    name: nameSchema.optional(),
    videoKey: storageKeySchema.nullable().optional(),
    videoName: z.string().trim().min(1).max(255).nullable().optional(),
    backgroundKey: storageKeySchema.nullable().optional(),
    backgroundColor: backgroundColorSchema.optional(),
    timeline: liveCompositeTimelineSchema.optional(),
  })
  .strict()

export type LiveCompositeProjectCreateInput = z.infer<typeof liveCompositeProjectCreateSchema>
export type LiveCompositeProjectUpdateInput = z.infer<typeof liveCompositeProjectUpdateSchema>

export type LiveCompositeKeyKind = 'image' | 'video'

/**
 * A storage key is acceptable only inside the caller's OWN playground-ref
 * upload namespace. Anything else (another user's key, an arbitrary COS
 * path, a URL) is rejected — foreign keys must never be persisted, and the
 * GET route signs whatever is stored.
 */
export function isOwnPlaygroundRefKey(key: string, userId: string, kind: LiveCompositeKeyKind): boolean {
  if (!userId || !key || key.includes('..')) return false
  const prefix = kind === 'video' ? `video/playground-ref/${userId}/` : `images/playground-ref/${userId}/`
  return key.startsWith(prefix) && key.length > prefix.length
}

export interface ForeignStorageKey {
  field: string
  key: string
}

/**
 * Walk every storage key in a create/update payload and return the first
 * one that is not in the caller's own namespace (null when all are OK).
 * Video keys live under video/playground-ref/, background + mask PNGs under
 * images/playground-ref/.
 */
export function findForeignStorageKey(
  payload: {
    videoKey?: string | null
    backgroundKey?: string | null
    timeline?: LiveCompositeSerializedTimeline
  },
  userId: string,
): ForeignStorageKey | null {
  if (payload.videoKey && !isOwnPlaygroundRefKey(payload.videoKey, userId, 'video')) {
    return { field: 'videoKey', key: payload.videoKey }
  }
  if (payload.backgroundKey && !isOwnPlaygroundRefKey(payload.backgroundKey, userId, 'image')) {
    return { field: 'backgroundKey', key: payload.backgroundKey }
  }
  for (const keyframe of payload.timeline?.keyframes ?? []) {
    if (keyframe.baseMaskKey && !isOwnPlaygroundRefKey(keyframe.baseMaskKey, userId, 'image')) {
      return { field: `timeline.keyframes[${keyframe.id}].baseMaskKey`, key: keyframe.baseMaskKey }
    }
  }
  return null
}

export function timelineByteSize(timeline: LiveCompositeSerializedTimeline): number {
  return JSON.stringify(timeline).length
}

/** GET list row shape. */
export interface LiveCompositeProjectSummary {
  id: string
  name: string
  videoName: string | null
  updatedAt: string
}

/** GET detail shape — keys plus fresh signed URLs (never bare foreign keys). */
export interface LiveCompositeProjectDetail {
  id: string
  name: string
  videoKey: string | null
  videoUrl: string | null
  videoName: string | null
  backgroundKey: string | null
  backgroundUrl: string | null
  backgroundColor: string
  timeline: {
    keyframes: Array<LiveCompositeSerializedKeyframe & { baseMaskUrl?: string }>
  }
  createdAt: string
  updatedAt: string
}
