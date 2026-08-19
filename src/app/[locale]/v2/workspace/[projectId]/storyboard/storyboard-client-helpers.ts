/**
 * Pure helpers, constants, and shared types extracted from
 * V2StoryboardClient.tsx (2026-06-13 — Phase 1 monolith decomposition,
 * "先重構" step 1). Everything here is closure-independent: pure functions,
 * literal constants, and type-only declarations that previously sat at the
 * top of the 3k-line client. Relocating them is a behaviour-preserving move
 * (tsc verifies every reference) and gives the giant component a smaller,
 * navigable head.
 */

export interface PanelCharacterRef {
  name: string
  appearance?: string
}

/**
 * Voice line attached to a panel by the storyboards API. Server joins
 * NovelPromotionVoiceLine via matchedPanelId. `isVoiceover` is derived
 * server-side from speaker markers (OS / VO / V.O. / O.S. / 画外音 / 旁白 /
 * 独白) so the UI can render off-camera lines differently (no lip-sync).
 */
export interface PanelVoiceLine {
  speaker: string
  content: string
  isVoiceover: boolean
}

export interface PanelLike {
  id: string
  storyboardId?: string | null
  panelIndex?: number | null
  description?: string | null
  srtSegment?: string | null
  imageUrl?: string | null
  videoUrl?: string | null
  prompt?: string | null
  videoPrompt?: string | null
  shotType?: string | null
  cameraMove?: string | null
  location?: string | null
  // Decoded server-side; see storyboards API route. The API decodes legacy
  // bare-string entries into {name} shape, but some panels still carry raw
  // strings — so the honest type is the union. Readers must handle both
  // (typeof c === 'string' ? c : c.name).
  characters?: Array<PanelCharacterRef | string> | null
  // 2026-05-13 — Structured voice lines (server joins NovelPromotionVoiceLine).
  // When present, GroupCard's buildInitialNarrative prefers these over
  // srtSegment so OS / voice-over lines can be tagged for off-camera render.
  voiceLines?: PanelVoiceLine[]
  multiShotGroupId?: string | null
  multiShotGroupOrder?: number | null
  /** Group narrative draft persisted on the group's FIRST panel (2026-07-13). */
  groupNarrative?: string | null
  /** Group 時長 pick persisted on the FIRST panel (null = Auto, 2026-07-13). */
  groupDurationSec?: number | null
}

export interface StoryboardLike {
  id: string
  panels?: PanelLike[]
}

export interface ProjectLikeFull {
  novelPromotionData?: {
    videoModel?: string | null
    videoRatio?: string | null
    videoResolution?: string | null
    episodes?: Array<{ id: string }> | null
    // 2026-05-18 — top-level column on NovelPromotionProject. The Seedance
    // narrative builder uses it to drive the styleAnchor + visualModifiers
    // footer (replacing the old hardcoded cinematic terms) and the worker
    // reads it server-side for negative_prompt resolution.
    visualStyleId?: string | null
    // Phase Q (2026-05-21) — episode target total video duration in
    // seconds. Drives script_to_storyboard panel count + auto_group_multi_shot
    // group count. Exposed via VideoModelPickerInline so user can edit
    // inline from STEP 03.
    targetDuration?: number | null
    // 2026-05-29 — per-project generation mode. r2v-narrative enables the
    // auto-chain (analyze → auto-group) + Seedance-only picker filter.
    generationMode?: string | null
    openingPacing?: string | null
  } | null
}

export type MultiShotState =
  | { status: 'idle' }
  | { status: 'submitting'; sent: number; total: number }
  | { status: 'done'; sent: number; failures: number }
  | { status: 'error'; message: string }

export type AnalyzeState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'submitted' }
  | { status: 'error'; message: string }

// 2026-06-22 (Phase 1 step 4 prep) — single source of truth for the
// video-model family used by layout siblings to switch CTA wording +
// disable states (Kling = batch multi-shot, Seedance = composite).
// Previously declared in 3 places (V2GroupsLayout inline union,
// V2StoryboardGroupsView, V2StoryboardGalleryView); consolidated here
// so adding a future family (e.g. 'fal-only') only changes this one
// line. Source comes from getVideoModelVariant(model)?.family.
export type VideoFamily = 'kling' | 'seedance' | null

// 2026-06-22 (Phase 1 step 4) — per-panel image/video display toggle.
// User can switch a panel between showing its still image vs its
// generated video preview. Timeline Shot sub-view needs this type;
// previously declared locally inside V2StoryboardClient.
export type MediaDisplayMode = 'image' | 'video'

// 2026-06-22 (Phase 1 step 4 cleanup, PR #18) — types previously
// parallel-declared across multiple Timeline sub-views. Lifted here so
// future schema additions only touch one place. Source of truth:
//   - FailedTaskMeta:    shape produced by useTaskList's
//                        derived failedPanelImageIds / failedPanelVideoIds.
//   - EpisodeBinding:    EpisodeCharacter junction projection used by
//                        the Inspector's appearance-resolution priority
//                        (mirrors worker collectPanelReferenceImages).
//   - EpisodeWithNumber: NovelPromotionEpisode subset used by the
//                        Inspector for the 「綁定本集」 label.
export interface FailedTaskMeta {
  errorCode: string | null
  errorMessage: string | null
}

export interface EpisodeBinding {
  characterId: string
  appearanceId: string | null
}

export interface EpisodeWithNumber {
  episodeNumber?: number
}

export const KLING_GROUP_SIZE = 5 // panel/group; API allows 2-6

// Six restrained night-blue / process-cyan levels for multi-shot group
// ribbons. The variation keeps adjacent groups legible without turning the
// production timeline into a rainbow.
export const GROUP_ACCENTS = [
  'border-l-[var(--production-blue-hover)]',
  'border-l-[var(--production-blue)]',
  'border-l-[var(--process-cyan-deep)]',
  'border-l-[#408B9A]',
  'border-l-[var(--process-cyan)]',
  'border-l-[var(--process-cyan-strong)]',
] as const

/**
 * Build a tailwind aspect-ratio class from a "W:H" project setting.
 * Supports the same set of ratios Tencent VOD GG/Kling expose
 * (1:1 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9 / 2:3 / 3:2). Anything else
 * falls back to 16:9 so the layout doesn't break when the project
 * setting is malformed or absent.
 */
export function aspectClassFromRatio(ratio: string | null | undefined): string {
  if (!ratio) return 'aspect-video'
  const trimmed = ratio.trim()
  switch (trimmed) {
    case '1:1':  return 'aspect-square'
    case '16:9': return 'aspect-video'
    case '9:16': return 'aspect-[9/16]'
    case '4:3':  return 'aspect-[4/3]'
    case '3:4':  return 'aspect-[3/4]'
    case '3:2':  return 'aspect-[3/2]'
    case '2:3':  return 'aspect-[2/3]'
    case '21:9': return 'aspect-[21/9]'
    default: {
      const [w, h] = trimmed.split(':').map((n) => Number.parseFloat(n))
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        return `aspect-[${w}/${h}]`
      }
      return 'aspect-video'
    }
  }
}

export function accentForGroupId(groupId: string | null | undefined, allGroupIds: string[]): string {
  if (!groupId) return 'border-l-transparent'
  const idx = allGroupIds.indexOf(groupId)
  if (idx < 0) return 'border-l-transparent'
  return GROUP_ACCENTS[idx % GROUP_ACCENTS.length]
}

export function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return []
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  // The last chunk could be of size 1, which the API rejects. Merge it
  // into the previous chunk if there is one.
  if (out.length >= 2 && out[out.length - 1].length === 1) {
    const tail = out.pop() as T[]
    out[out.length - 1].push(tail[0])
  }
  return out
}
