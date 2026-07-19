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
export const LIVE_COMPOSITE_MAX_FACE_TRACK_ENTRIES = 600
export const LIVE_COMPOSITE_MAX_FACE_BLENDSHAPE_KEYS = 20
/** Hard byte cap on the timeline JSON blob (defense beyond the count caps). */
export const LIVE_COMPOSITE_MAX_TIMELINE_BYTES = 2_000_000
export const LIVE_COMPOSITE_PROJECT_LIST_CAP = 100

const virtualCharacterSchema = z
  .object({
    assetType: z.enum(['image', 'video']),
    assetName: z.string().trim().min(1).max(255),
    assetKey: z.string().trim().min(1).max(512),
    anchor: z.enum(['screen', 'person']),
    x: z.number().finite().min(-2).max(3),
    y: z.number().finite().min(-2).max(3),
    offsetX: z.number().finite().min(-2).max(2),
    offsetY: z.number().finite().min(-2).max(2),
    scale: z.number().finite().min(0.05).max(2),
    rotation: z.number().finite().min(-360).max(360),
    opacity: z.number().finite().min(0).max(1),
    startTime: z.number().finite().min(0),
    endTime: z.number().finite().min(0),
    loop: z.boolean(),
    depth: z.enum(['behind-person', 'in-front']),
    trackingKeyframes: z.array(z.object({
      id: z.string().trim().min(1).max(64),
      time: z.number().finite().min(0),
      offsetX: z.number().finite().min(-2).max(2),
      offsetY: z.number().finite().min(-2).max(2),
    }).strict()).max(LIVE_COMPOSITE_MAX_KEYFRAMES).optional(),
    appearance: z.object({
      exposure: z.number().finite().min(-1).max(1),
      contrast: z.number().finite().min(-1).max(1),
      saturation: z.number().finite().min(-1).max(1),
      temperature: z.number().finite().min(-1).max(1),
      blur: z.number().finite().min(0).max(20),
      lightWrap: z.number().finite().min(0).max(1),
      shadowOpacity: z.number().finite().min(0).max(1),
      shadowBlur: z.number().finite().min(0).max(100),
      shadowOffsetX: z.number().finite().min(-100).max(100),
      shadowOffsetY: z.number().finite().min(-100).max(100),
    }).strict().optional(),
    motionEnabled: z.boolean().optional(),
    motionKeyframes: z.array(z.object({
      id: z.string().trim().min(1).max(64),
      time: z.number().finite().min(0),
      x: z.number().finite().min(-1).max(2),
      y: z.number().finite().min(-1).max(2),
      scale: z.number().finite().min(0.1).max(5),
      rotation: z.number().finite().min(-360).max(360),
      confidence: z.number().finite().min(0).max(1),
    }).strict()).max(LIVE_COMPOSITE_MAX_KEYFRAMES).optional(),
  })
  .strict()
  .refine((value) => value.endTime >= value.startTime, { message: '角色結束時間不得早於開始時間' })

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

/** Normalized (0-1) face crop box, top-left origin. */
const faceBoxSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    w: z.number().finite().gt(0).max(1),
    h: z.number().finite().gt(0).max(1),
  })
  .strict()

const faceTrackEntrySchema = z
  .object({
    time: z.number().finite().min(0),
    faceBox: faceBoxSchema,
    /** Expression-relevant blendshape scores only (filtered client-side). */
    blendshapes: z.record(z.string().trim().min(1).max(64), z.number().finite().min(0).max(1)),
  })
  .strict()
  .refine((entry) => Object.keys(entry.blendshapes).length <= LIVE_COMPOSITE_MAX_FACE_BLENDSHAPE_KEYS, {
    message: `臉部表情欄位數量超過上限 ${LIVE_COMPOSITE_MAX_FACE_BLENDSHAPE_KEYS}`,
  })

/**
 * Face performance track (spec §3.2 表演分析 + §8.2 非破壞性資料).
 * `sampledAt` lists every analyzed time; `entries` only the detected faces;
 * `problems` the 漏檢/跳動 timecodes. Optional — old projects load fine.
 */
const faceTrackSchema = z
  .object({
    version: z.literal(1),
    sampledAt: z.array(z.number().finite().min(0)).min(1).max(LIVE_COMPOSITE_MAX_FACE_TRACK_ENTRIES),
    entries: z.array(faceTrackEntrySchema).max(LIVE_COMPOSITE_MAX_FACE_TRACK_ENTRIES),
    problems: z.array(z.number().finite().min(0)).max(LIVE_COMPOSITE_MAX_FACE_TRACK_ENTRIES),
  })
  .strict()

export const liveCompositeTimelineSchema = z
  .object({
    keyframes: z.array(serializedKeyframeSchema).min(1).max(LIVE_COMPOSITE_MAX_KEYFRAMES),
    occlusionKeyframes: z.array(serializedKeyframeSchema).min(1).max(LIVE_COMPOSITE_MAX_KEYFRAMES).optional(),
    virtualCharacter: virtualCharacterSchema.optional(),
    faceTrack: faceTrackSchema.optional(),
  })
  .strict()

export type LiveCompositeSerializedStroke = z.infer<typeof serializedStrokeSchema>
export type LiveCompositeSerializedKeyframe = z.infer<typeof serializedKeyframeSchema>
export type LiveCompositeSerializedFaceTrack = z.infer<typeof faceTrackSchema>
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
  for (const keyframe of payload.timeline?.occlusionKeyframes ?? []) {
    if (keyframe.baseMaskKey && !isOwnPlaygroundRefKey(keyframe.baseMaskKey, userId, 'image')) {
      return { field: `timeline.occlusionKeyframes[${keyframe.id}].baseMaskKey`, key: keyframe.baseMaskKey }
    }
  }
  const character = payload.timeline?.virtualCharacter
  if (character && !isOwnPlaygroundRefKey(character.assetKey, userId, character.assetType)) {
    return { field: 'timeline.virtualCharacter.assetKey', key: character.assetKey }
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
    occlusionKeyframes?: Array<LiveCompositeSerializedKeyframe & { baseMaskUrl?: string }>
    virtualCharacter?: NonNullable<LiveCompositeSerializedTimeline['virtualCharacter']> & { assetUrl: string }
    faceTrack?: LiveCompositeSerializedFaceTrack
  }
  createdAt: string
  updatedAt: string
}
