'use client'

/**
 * Phase 12.5.4 commit 2 — group card with editable descriptions +
 * per-group multi-shot regen.
 *
 * Each card owns:
 *   - Local description / dialogue drafts per member panel
 *   - Save state per panel (mutation pending / error)
 *   - One regenerate-multi-shot button that submits this group only
 *
 * The card is intentionally "dumb" about overrides in commit 2 —
 * commit 3 will plumb characterOverrides / locationOverrides
 * through `onRegenerate` so the swap-modal pickers can re-anchor
 * subject identity.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { MultiShotBindingsRail } from './MultiShotBindingsRail'
import { CharacterAppearancePickerModal } from './CharacterAppearancePickerModal'
import { LocationViewPickerModal } from './LocationViewPickerModal'
import { NarrativeHighlighter } from './NarrativeHighlighter'
import { visualStyles, getStyleSafe } from '@/lib/style-library'
import {
  useMultiShotTask,
  type MultiShotCharacterBinding,
} from '@/lib/query/hooks/useMultiShotTask'
import {
  buildColdOpenShotBlock,
  detectColdOpenGenre,
  type ColdOpenPanel,
  type ColdOpenVariant,
} from '@/lib/cold-open'
import {
  buildDialogueDrivenDurations,
  computeGroupRecommendedDurationSec,
} from '@/lib/workers/handlers/speech-duration-estimator'
import type { UseMutationResult } from '@tanstack/react-query'

/**
 * Cold-open UI state. `off` = no hook formatting. `auto` = pick the
 * variant from group text via detectColdOpenGenre. `modern` / `period`
 * / `action` = user-pinned variants. Episode 1 / Group 1 defaults to
 * `auto`; all other groups default to `off`.
 */
type ColdOpenMode = 'off' | 'auto' | ColdOpenVariant

interface PanelCharacterRef {
  name: string
  appearance?: string
}

/**
 * Voice line attached to a panel by the storyboards API.
 * Server joins NovelPromotionVoiceLine via matchedPanelId. The
 * `isVoiceover` flag is derived server-side from speaker markers
 * (OS / VO / V.O. / O.S. / 画外音 / 旁白 / 独白) so the UI can render
 * off-camera lines with a different style (no lip-sync indicator).
 */
interface PanelVoiceLine {
  speaker: string
  content: string
  isVoiceover: boolean
}

interface PanelLike {
  id: string
  description?: string | null
  prompt?: string | null
  srtSegment?: string | null
  // Decoded server-side; see storyboards API route.
  characters?: PanelCharacterRef[] | null
  location?: string | null
  multiShotGroupId?: string | null
  multiShotGroupOrder?: number | null
  // Optional shot framing — present on panels created by analyze-novel
  // v2+; legacy panels may have null. Used by buildInitialNarrative to
  // emit 镜头N·<景别> shot titles in the cinematic prompt format.
  shotType?: string | null
  cameraMove?: string | null
  // 2026-05-13 — Structured voice lines (server joins NovelPromotionVoiceLine).
  // When present, buildInitialNarrative prefers these over srtSegment so
  // OS / voice-over lines can be tagged for off-camera rendering.
  voiceLines?: PanelVoiceLine[]
  // 2026-05-13 — Generated panel image (storyboard image gen output).
  // Used by 首幀鎖定 mode to default the first/last frame to existing
  // panel images. Null when image gen hasn't run for this panel.
  imageUrl?: string | null
}

interface CharacterAppearanceRef {
  id: string
  appearanceIndex?: number
  changeReason?: string | null
  description?: string | null
  imageUrl?: string | null
}

interface CharacterRef {
  id: string
  name: string
  appearances?: CharacterAppearanceRef[]
}

interface LocationImageRef {
  id: string
  imageIndex?: number
  description?: string | null
  imageUrl?: string | null
  viewName?: string | null
}

interface LocationRef {
  id: string
  name: string
  images?: LocationImageRef[]
}

type UpdatePanelTextMutation = UseMutationResult<
  unknown,
  Error,
  {
    panelId: string
    description?: string
    srtSegment?: string
    /** Updated panel.characters (array or pre-serialized JSON string).
     * Used by the 出場角色 chip × remove flow. */
    characters?: Array<{ name: string; appearance?: string }> | string | null
    /** Updated panel.location (scene name). Used by the 場景 chip × remove. */
    location?: string | null
  }
>

export interface GroupRegenOverrides {
  characterOverrides: Array<{ characterId: string; appearanceId?: string }>
  locationOverrides: Array<{ locationId: string; viewName?: string }>
  // Phase 2 — segment-level merged narrative + duration override.
  // When `rawPrompt` is non-empty the worker bypasses per-panel
  // prompt assembly and uses this verbatim (intelligence mode).
  rawPrompt?: string
  // Length must equal panelIds.length, sum 5-15. Triggers customize
  // multi-shot mode in the worker so each panel slice gets its own
  // duration anchor in Kling Omni's multi_prompt array.
  panelDurations?: number[]
  // Phase P (2026-05-21) — user's intended TOTAL duration as a single
  // scalar, forwarded EVEN WHEN sendRaw=true. Pre-Phase-P, picking 15s
  // + editing the narrative caused frontend to omit panelDurations (so
  // BobAPI/Tencent customize mode wouldn't silently drop rawPrompt) →
  // worker fell back to dialogue-driven or panel*2.5 baseline → user
  // saw 10-13s instead of the 15s they picked. totalDurationSeconds
  // works AROUND that omission: it's an explicit "user wants N seconds
  // total" signal that workers can use as a tier-1.5 fallback between
  // the explicit panelDurations[] and the dialogue-driven heuristic.
  // 0 means AUTO (let worker decide); omitted is treated the same as 0.
  totalDurationSeconds?: number
  // 2026-05-13 — Option B: 首幀鎖定 / 首尾鎖定 mode.
  // When firstFrameImageUrl is set, worker switches to Kling 3.0 i2v
  // single-shot path: FileInfos[Usage='FirstFrame'] + optional
  // LastFrameUrl, drops multi_shot. Trades multi-shot for pixel-level
  // character/scene consistency. lastFrameImageUrl requires firstFrameImageUrl.
  firstFrameImageUrl?: string
  lastFrameImageUrl?: string
  // Phase E (2026-05-15) — per-group curated style override. When set,
  // wins over project.visualStyleId. Empty string / undefined = inherit
  // project default (no override). Use a real id to force a specific
  // style on this group only — e.g. switch one group to "韓劇" while the
  // rest of the project stays "院線寫實". lightingPresetId follows the
  // same omit-or-id convention.
  visualStyleId?: string
  lightingPresetId?: string
}

interface GroupCardProps {
  groupId: string
  groupOrdinal: number
  groupLabel: string
  accentClass: string
  panels: PanelLike[]
  taskId: string | null
  projectId: string
  updatePanelText: UpdatePanelTextMutation
  characterRoster?: CharacterRef[]
  locationRoster?: LocationRef[]
  /**
   * Per-episode character → appearance binding (EpisodeCharacter rows).
   * Worker resolution priority (see image-task-handler-shared and
   * multi-shot-video-b-path):
   *   1. UI per-call override (characterOverrides)
   *   2. EpisodeCharacter binding ← what this prop carries
   *   3. panel.characters[i].appearance hint (matched by changeReason)
   *   4. appearances[0] default
   * Chip rail MUST mirror this priority — otherwise 出場角色 displays
   * one appearance while the worker renders another (user-reported
   * 2026-05-13: chip said "初始形象" but Kling rendered "王玄Y").
   */
  episodeBindings?: Array<{ characterId: string; appearanceId: string | null }>
  /**
   * Approximate per-group runtime in seconds. Used to compute the
   * cumulative time range badge in the collapsed header. Defaults
   * to 15s when not provided.
   */
  segmentDurationSeconds?: number
  /**
   * Absolute start offset (in seconds) for this group's time-range
   * badge. When provided, the header reads `segmentStartSec` →
   * `segmentStartSec + segmentDurationSeconds`. When omitted, falls
   * back to the legacy `(groupOrdinal - 1) * segmentDurationSeconds`
   * approximation — only correct when every group has the same
   * duration, which is rarely true post-Phase Q.
   */
  segmentStartSec?: number
  /**
   * Episode number (1-indexed) — folded into the download filename
   * as `ep{N}_group{NN}.mp4` so user keeps a sane archive across
   * multi-episode projects.
   */
  episodeNumber?: number | null
  /**
   * 2026-05-17 — when false, both the per-group main CTA and the
   * retry button get disabled with a tooltip pointing at the inline
   * video-model picker. Mirrors the project-level capability gate at
   * V2StoryboardClient handleSubmitMultiShot / onRegenerateGroup.
   * Defaults to true so legacy callers keep working.
   */
  canMultiShot?: boolean
  /**
   * 2026-05-17 — Kling = batch multi-shot (N stitched clips per group);
   * Seedance = composite (1 video with 9-ref @N per group). The CTA
   * label / loading message / done message must match what the worker
   * actually delivers or the user expects N clips and gets one composite
   * (or vice versa). Null defaults to Kling phrasing (back-compat for
   * existing callers that don't pass this prop yet).
   */
  videoFamily?: 'kling' | 'seedance' | null
  /**
   * 2026-05-18 — project-level visual style id (NovelPromotionProject.visualStyleId).
   * Builder uses it to inject styleAnchor + visualModifiers into the Seedance
   * prompt instead of the old hard-coded STYLE_FOOTER_SEEDANCE block. The
   * per-group `visualStyleOverride` picker still wins over this default.
   * Null / undefined = no project style set → builder emits no style footer
   * (worker still applies its own resolveProjectVisualStyle on the server).
   */
  projectVisualStyleId?: string | null
  onRegenerate: (
    panelIds: string[],
    overrides: GroupRegenOverrides,
  ) => Promise<{ taskId: string | null; error?: string }>
}

function formatTimeRange(startSec: number, endSec: number): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }
  return `${fmt(startSec)}-${fmt(endSec)}`
}

export function GroupCard({
  groupId: _groupId,
  groupOrdinal,
  groupLabel,
  accentClass,
  panels,
  taskId,
  projectId,
  updatePanelText,
  characterRoster,
  locationRoster,
  episodeBindings,
  segmentDurationSeconds = 15,
  segmentStartSec,
  episodeNumber,
  canMultiShot = true,
  videoFamily = null,
  projectVisualStyleId = null,
  onRegenerate,
}: GroupCardProps) {
  // Build episode binding lookup ONCE. Empty map when no bindings prop
  // (legacy callers) — falls through to panel-hint / default-[0] priority.
  const episodeBindingByCharId = useMemo(() => {
    const map = new Map<string, string>()
    for (const b of episodeBindings ?? []) {
      if (b.characterId && b.appearanceId) map.set(b.characterId, b.appearanceId)
    }
    return map
  }, [episodeBindings])
  // Collapsed by default — the user referenced the Seedance 2.0
  // 视频方案编辑器 layout where each segment is a list row that
  // expands on click. Helps a multi-group episode (8+ groups) stay
  // readable instead of scrolling through cards.
  const [expanded, setExpanded] = useState<boolean>(false)

  // Override state: keys are characterId / locationId, values are
  // the user's override choice (undefined = no override).
  // null = explicit "revert to default" via the modal's bottom button.
  const [characterOverrides, setCharacterOverrides] = useState<Record<string, string | null>>({})
  const [locationOverrides, setLocationOverrides] = useState<Record<string, string | null>>({})

  const [pickerCharacter, setPickerCharacter] = useState<{
    character: CharacterRef
    currentAppearanceId: string | null
  } | null>(null)
  const [pickerLocation, setPickerLocation] = useState<{
    location: LocationRef
    currentViewName: string | null
  } | null>(null)

  const characterById = useMemo(() => {
    const map = new Map<string, CharacterRef>()
    for (const c of characterRoster ?? []) map.set(c.id, c)
    return map
  }, [characterRoster])
  const locationById = useMemo(() => {
    const map = new Map<string, LocationRef>()
    for (const l of locationRoster ?? []) map.set(l.id, l)
    return map
  }, [locationRoster])

  const overrideCount =
    Object.keys(characterOverrides).length + Object.keys(locationOverrides).length

  // ── Phase 3 — segment-level cast / scenes chips (inline below
  // the narrative). Source from this group's panels:
  //   - panel.characters JSON → character names → resolve to roster
  //   - panel.location → "<name>" or "<name>#<viewHint>" → roster
  // Same swap modals as the left-column chip rail. Mirrors the
  // Seedance "场景: [Park-Day] [Park-Inside] +" affordance the user
  // referenced.
  type CastChip = {
    character: CharacterRef
    appearanceId: string | null
    appearanceLabel: string | null
    avatarUrl: string | null
  }
  type SceneChip = {
    location: LocationRef
    viewName: string | null
    avatarUrl: string | null
  }
  const groupCast = useMemo<CastChip[]>(() => {
    const seen = new Set<string>()
    const out: CastChip[] = []
    for (const panel of panels) {
      // Storyboards hook decodes panel.characters into string[] | null.
      // Each item may be a bare name or, after analyze v2, a stringified
      // `{name, appearance}` JSON. Handle both shapes loosely.
      const charsRaw: unknown[] = Array.isArray(panel.characters) ? panel.characters : []
      for (const item of charsRaw) {
        let name: string | null = null
        let appearanceHint: string | null = null
        if (typeof item === 'string') {
          const trimmed = item.trim()
          if (trimmed.startsWith('{')) {
            try {
              const parsed = JSON.parse(trimmed) as { name?: unknown; appearance?: unknown }
              if (typeof parsed.name === 'string') name = parsed.name
              if (typeof parsed.appearance === 'string') appearanceHint = parsed.appearance
            } catch {
              name = trimmed
            }
          } else {
            name = trimmed
          }
        } else if (item && typeof item === 'object') {
          const r = item as { name?: unknown; appearance?: unknown }
          if (typeof r.name === 'string') name = r.name
          if (typeof r.appearance === 'string') appearanceHint = r.appearance
        }
        if (!name) continue
        const lower = name.trim().toLowerCase()
        if (!lower || seen.has(lower)) continue
        const char = (characterRoster ?? []).find(
          (c) => c.name.toLowerCase().trim() === lower,
        )
        if (!char) continue
        seen.add(lower)
        const appearances = char.appearances ?? []
        // Resolution priority — MUST mirror worker. 2026-05-13 user
        // clarification: per-shot LLM intent (panel.characters[i].appearance)
        // wins over EpisodeCharacter binding so the same character can
        // render different appearances across the same episode based on
        // script context (flashback / present-day / costume change).
        //   1. UI per-call override (characterOverrides[char.id])
        //   2. panel.characters[i].appearance — LLM read script per-shot
        //   3. EpisodeCharacter binding — episode-level fallback
        //   4. appearances[0] — global default
        const overrideId = characterOverrides[char.id]
        const episodeBoundId = episodeBindingByCharId.get(char.id)
        let chosen = appearances[0]
        if (overrideId) {
          const o = appearances.find((a) => a.id === overrideId)
          if (o) chosen = o
        } else if (appearanceHint) {
          const h = appearances.find(
            (a) => (a.changeReason || '').toLowerCase() === appearanceHint!.toLowerCase(),
          )
          if (h) chosen = h
          else if (episodeBoundId) {
            const b = appearances.find((a) => a.id === episodeBoundId)
            if (b) chosen = b
          }
        } else if (episodeBoundId) {
          const b = appearances.find((a) => a.id === episodeBoundId)
          if (b) chosen = b
        }
        if (!chosen) {
          out.push({
            character: char,
            appearanceId: null,
            appearanceLabel: null,
            avatarUrl: null,
          })
          continue
        }
        out.push({
          character: char,
          appearanceId: chosen.id ?? null,
          appearanceLabel: chosen.changeReason ?? null,
          avatarUrl: chosen.imageUrl ?? null,
        })
      }
    }
    return out
  }, [panels, characterRoster, characterOverrides, episodeBindingByCharId])
  const groupScenes = useMemo<SceneChip[]>(() => {
    const seen = new Set<string>()
    const out: SceneChip[] = []
    for (const panel of panels) {
      const loc = (panel as { location?: string | null }).location ?? null
      if (!loc) continue
      const hashIdx = loc.indexOf('#')
      const name = (hashIdx === -1 ? loc : loc.slice(0, hashIdx)).trim()
      if (!name) continue
      const lower = name.toLowerCase()
      if (seen.has(lower)) continue
      const locEntity = (locationRoster ?? []).find(
        (l) => l.name.toLowerCase().trim() === lower,
      )
      if (!locEntity) continue
      seen.add(lower)
      const overrideView = locationOverrides[locEntity.id]
      const images = locEntity.images ?? []
      const matched = overrideView
        ? images.find((img) => (img.viewName ?? '').toLowerCase() === overrideView.toLowerCase())
        : null
      const primary = images.find((img) => (img.imageIndex ?? 0) === 0) ?? images[0]
      const picked = matched ?? primary
      out.push({
        location: locEntity,
        viewName: overrideView !== undefined ? overrideView : (picked?.viewName ?? null),
        avatarUrl: picked?.imageUrl ?? null,
      })
    }
    return out
  }, [panels, locationRoster, locationOverrides])

  // ── Phase 2 — segment-level merged narrative editor ──
  //
  // The user referenced the Seedance 2.0 视频方案编辑器 layout where
  // each segment is one editable narrative paragraph (time-indexed
  // 0-5/5-10/10-15s) instead of N separate panel boxes. Panels stay
  // in the data model — they drive analyze, group splitting, and
  // bindings — but the EDITING unit at this stage is the merged
  // segment. Anything the user types here goes through the
  // `rawPrompt` field on regen so the worker bypasses per-panel
  // prompt assembly.
  // 2026-05-13 — Duration draft has 4 modes:
  //   0  = AUTO (let worker engage dialogue-driven duration allocator;
  //              worker picks per-shot durations from voice line speech length)
  //   5, 10, 15 = explicit total seconds (worker splits evenly across panels)
  //
  // Default to AUTO because the typical short-drama use case is dialogue-
  // driven — user-requested 2026-05-13: 「保留原本對話為主, 去搭配不同的
  // 秒數做切組」. Falls back to 15s in the narrative preview math when
  // AUTO so the time tags shown in the textarea aren't 0-0/0-0/0-0.
  const [totalDurationDraft, setTotalDurationDraft] = useState<number>(0)

  // 2026-05-13 — ReelShort 8-second cold-open hook (Phase 1).
  //
  // Defaults to `auto` for Episode 1 / Group 1 (the hook position where
  // the formula is proven valuable per ReelShort's 5B+ view series).
  // Every other group defaults to `off` to preserve the user's existing
  // flexible narrative — Phase 1 is opt-in everywhere else.
  //
  // See docs/design/reelshort-cold-open-evaluation.md for the full
  // alignment analysis. The `auto` mode runs detectColdOpenGenre over
  // the group's panel text to pick modern / period / action variant
  // without forcing the user to label it manually.
  const isHookEligible = (episodeNumber ?? 1) === 1 && groupOrdinal === 1
  const [coldOpenMode, setColdOpenMode] = useState<ColdOpenMode>(
    isHookEligible ? 'auto' : 'off',
  )

  // 2026-05-13 — Option B 首幀鎖定 (Locked First/Last Frame).
  //
  // Three modes:
  //   'off'             — current multi-shot text-driven (default)
  //   'first_frame'     — Kling 3.0 i2v with FileInfos[Usage='FirstFrame']
  //                       of the first panel's image; single-shot output
  //   'first_last_frame' — Above + LastFrameUrl from the last panel's image;
  //                        single-shot interpolation between two pixel-locked
  //                        frames
  //
  // The two locked-frame modes drop multi-shot capability for that group
  // in exchange for pixel-level character/scene anchoring. Useful for
  // character intros, transitions, and reaction shots where Kling's
  // free-form first-frame imagination tends to drift off-model.
  type FrameLockMode = 'off' | 'first_frame' | 'first_last_frame'
  const [frameLockMode, setFrameLockMode] = useState<FrameLockMode>('off')

  // Phase E (2026-05-15) — per-group curated visual style override.
  // Sentinel '__inherit__' (default) sends nothing → worker uses
  // project.visualStyleId (Phase B/C plumbing). A real styleId wins
  // over the project default for this group's regenerate only.
  const STYLE_INHERIT = '__inherit__'
  const [visualStyleOverride, setVisualStyleOverride] = useState<string>(STYLE_INHERIT)
  const sortedStyleOptions = useMemo(
    () =>
      visualStyles
        .filter((s) => s.isActive !== false)
        .sort((a, b) =>
          a.category === b.category
            ? a.displayOrder - b.displayOrder
            : a.category.localeCompare(b.category),
        ),
    [],
  )

  // 2026-05-13 — upgraded narrative builder using the "五要素導演法"
  // structure (角色錨點 / 場景錨點 / 動作鏈 / 運鏡 / 整體視覺風格).
  // Earlier version emitted bare `0-8 seconds: <desc>` lines which gave
  // Kling Omni nothing to anchor identity / style / scene against, so
  // output drifted toward Omni's xianxia-CG training prior.
  //
  // Format produced (one block per panel + header + footer):
  //   参考图片1的[角色M]人物形象（高度一致）
  //   参考图片2的[场景名]（高度一致）
  //
  //   镜头1（0-8 seconds）·全景·<focus>
  //   [角色] <description>
  //   [角色]: "对白"
  //   镜头：<camera move in EN>
  //   严格无任何字幕、文字、logo或屏幕信息。
  //
  //   ...
  //
  //   整体视觉风格：
  //   <photorealistic English keywords block>
  //
  // Users can still edit verbatim — the auto-seed is just a strong
  // starting point. Once the user types anything, narrativeDirty=true
  // and we stop re-seeding to avoid clobbering their edit.
  const SHOT_TYPE_TO_FRAMING: Record<string, string> = {
    远景: '远景',
    遠景: '远景',
    全景: '全景',
    中景: '中景',
    近景: '近景',
    特写: '特写',
    特寫: '特写',
  }
  const CAMERA_MOVE_TO_EN: Record<string, string> = {
    固定: 'static shot',
    平移: 'pan',
    推镜: 'push in',
    推進: 'push in',
    拉镜: 'pull back',
    拉遠: 'pull back',
    跟拍: 'camera follows',
    手持: 'handheld',
    俯拍: 'high angle',
    仰拍: 'low angle',
    环绕: 'orbit',
    環繞: 'orbit',
    摇降: 'tilt down',
    搖降: 'tilt down',
    摇升: 'tilt up',
    搖升: 'tilt up',
    中度推進: 'medium push in',
  }
  // 2026-05-13 — Style anchor rebuilt for Kling 3.0-Omni photoreal output.
  //
  // Three problems with the old footer-only design:
  //   1. Footer placement = lowest attention weight. Kling parses
  //      photorealistic anchors AFTER 500+ tokens of shot descriptions
  //      so they barely register.
  //   2. CN heading "整体视觉风格" triggers Kling's CN-content path
  //      which is heavily xianxia/wuxia trained → CG output.
  //   3. No explicit anti-stylization. "no cartoonish glow" is weak;
  //      model needs "NOT animation, NOT CG, NOT 3D".
  //
  // New format:
  //   - TOP-anchored (highest attention weight)
  //   - English-only (avoids CN→xianxia trigger)
  //   - Explicit anti-stylization
  //   - Per-shot suffix `(live-action photography)` reinforces at every
  //     time slice so the anchor stays close to the shot description
  // 2026-05-13 (afternoon update) — vocabulary upgrade based on
  // cross-referenced prompt guides (Alibaba official text-to-video,
  // Kling 3.0 templates, awesome-seedance-2-prompts, autoweeb anime
  // formula). All four converge on:
  //   (1) specific light source > abstract "natural lighting" — Kling
  //       attention picks up the concrete keyword, abstract phrases get
  //       averaged into the model's style prior.
  //   (2) physically-believable motion suppressors — defeats Kling Omni's
  //       theatrical-xianxia motion default (huge sword swings, dramatic
  //       head turns, melodramatic gasps) which is the second-biggest
  //       CG-ness trigger after costume styling.
  const STYLE_HEADER_REALISTIC = [
    'STYLE: live-action film photography, shot on Arri Alexa 65 with 35mm lens.',
    // Concrete photographic detail vocabulary — visible texture cues
    // beat abstract "accurate lighting" by a wide margin per all 4 guides.
    'Visible film grain, natural skin texture with pores and micro-imperfections, real fabric weave, real-world material rendering.',
    // Specific light-source palette. Kling biases toward whichever named
    // source first matches the scene; without these tokens it falls back
    // to its xianxia training prior (uniform soft glow + lens flare).
    'LIGHTING: specify exact light source per shot — golden hour backlight, blue hour mist, candle warm flicker, fluorescent overhead, neon reflections, or moonlight rim — paired with one atmospheric detail (haze, steam, dust motes, water ripples).',
    // Motion suppressor — per awesome-seedance-2 "candid, unscripted"
    // and Alibaba's 运动幅度/速度. Photoreal output needs subtle motion.
    'MOTION: candid, unscripted, physically believable movement. Subtle micro-expressions, natural breathing rhythm. NOT theatrical, NOT exaggerated, NOT melodramatic, NOT dramatic head-turns.',
    // 2026-05-13 — Voice-over (OS/VO) lines come marked with the literal
    // string "Voiceover (off-camera, lips do not move)". Kling needs an
    // explicit rule that voice-over speakers must NOT have lip animation
    // — otherwise Kling defaults to lip-syncing every speaker line and
    // produces visible mouth movement for narrator/inner-monologue
    // lines (user-reported 2026-05-13: 「所有OS的對白...角色的嘴唇不能有動作」).
    'DIALOGUE RULE: Lines tagged `Voiceover (off-camera)` are NARRATOR / inner monologue — the on-screen character\'s lips must NOT move while these lines play. Only animate lips for lines without the off-camera tag.',
    'STRICT: NOT animation, NOT CG, NOT 3D render, NOT illustration, NOT digital painting, NOT xianxia stylized art, NOT Genshin Impact aesthetic.',
    'No on-screen text, no subtitles, no logos.',
  ].join(' ')
  const PER_SHOT_STYLE_TAG = '(live-action photography, real grain, real skin texture, candid motion, NO CG, NO animation)'
  // 2026-05-13 — EN'd. CN heading was triggering Kling's CN content path
  // (xianxia bias). Functional payload unchanged.
  const ANTI_TEXT_LINE = 'STRICT: no on-screen text, no subtitles, no logos, no screen UI of any kind.'

  const buildInitialNarrative = (): string => {
    const count = panels.length
    if (count === 0) return ''
    // 2026-05-13 — AUTO mode (totalDurationDraft=0) means "let worker
    // decide per-shot durations from dialogue". For the textarea preview
    // we still need SOME number to print `镜头N（X-Y seconds）` time tags,
    // so fall back to 15s as the cosmetic display total. The actual
    // total sent to Kling comes from worker's dialogue-driven path,
    // NOT from this number.
    const total = totalDurationDraft > 0 ? totalDurationDraft : 15
    const base = Math.max(1, Math.floor(total / count))
    const remainder = Math.max(0, total - base * count)

    // Header: character + scene anchor lines. Index from 1 because the
    // 五要素 convention says "参考图片1的xxx" — slot 1 is the leftmost
    // ref image which the worker also pins as the primary identity anchor.
    //
    // 2026-05-13 — cap at TENCENT_SUBJECT_INFOS_CAP=3. The worker drops
    // entities beyond slot 3 (Tencent VOD SubjectInfos hard limit) but
    // if we wrote anchors for 6 entities while only 3 actually upload,
    // Kling thinks ref slots 4-6 exist and hallucinates content for
    // them. Mirror the worker's slot priority: characters first, then
    // scenes, then drop the rest. Worker's defensive filter (Step 3 in
    // multi-shot-video-b-path raw branch) catches stragglers but
    // emitting clean upfront is cheaper.
    const TENCENT_SUBJECT_INFOS_CAP = 3
    const header: string[] = []
    let refSlot = 1
    const charsToAnchor = groupCast.slice(0, TENCENT_SUBJECT_INFOS_CAP)
    const remainingForScenes = TENCENT_SUBJECT_INFOS_CAP - charsToAnchor.length
    const scenesToAnchor = groupScenes.slice(0, remainingForScenes)

    // 2026-05-13 (later) — user pushback: 「不要用 <<<image_1>>>=王玄
    // 這種寫法,需要的是像 [王玄M] 直接在描述中寫名字」.
    //
    // New format — script-style with bare names:
    //   header: "参考角色：王玄、离 (高度一致)；参考场景：洞府内·白天 (高度一致)"
    //   per-shot anchor line: dropped (description already has names)
    //   description: bare names verbatim — let the worker's
    //     substituteImageRefs translate names → <<<image_N>>> right before
    //     hitting Kling. Frontend stays clean and readable like a script.
    //
    // Single-char name guard still applies (worker skips length<2 names
    // to avoid clobbering Chinese particles like 离地半米).
    const charNameToRefSlot = new Map<string, number>()
    const charNames: string[] = []
    for (const cast of charsToAnchor) {
      charNames.push(cast.character.name)
      charNameToRefSlot.set(cast.character.name.trim().toLowerCase(), refSlot)
      refSlot++
    }
    const sceneNameToRefSlot = new Map<string, number>()
    const sceneLabels: string[] = []
    for (const scene of scenesToAnchor) {
      const sceneLabel = scene.viewName ? `${scene.location.name}·${scene.viewName}` : scene.location.name
      sceneLabels.push(sceneLabel)
      sceneNameToRefSlot.set(scene.location.name.trim().toLowerCase(), refSlot)
      refSlot++
    }
    // 2026-05-13 — Labels EN'd, entity names stay CN. CN entity names are
    // load-bearing (SubjectInfos binding key, scene reference lookup);
    // labels are just structural noise that triggered Kling's CN bias.
    // Result: `Reference characters: 王玄、离 (highly consistent)`.
    const headerLineFragments: string[] = []
    if (charNames.length > 0) {
      headerLineFragments.push(`Reference characters: ${charNames.join('、')} (highly consistent)`)
    }
    if (sceneLabels.length > 0) {
      headerLineFragments.push(`Reference scenes: ${sceneLabels.join('、')} (highly consistent)`)
    }
    if (headerLineFragments.length > 0) {
      header.push(headerLineFragments.join('; '))
    }

    // Helper: extract character names from panel.characters (handles
    // both bare-string and {name, appearance} JSON shapes — same logic
    // as groupCast useMemo above).
    const extractPanelCharNames = (panel: PanelLike): string[] => {
      const out: string[] = []
      const raw: unknown[] = Array.isArray(panel.characters) ? panel.characters : []
      for (const item of raw) {
        let name: string | null = null
        if (typeof item === 'string') {
          const trimmed = item.trim()
          if (trimmed.startsWith('{')) {
            try {
              const parsed = JSON.parse(trimmed) as { name?: unknown }
              if (typeof parsed.name === 'string') name = parsed.name
            } catch {
              name = trimmed
            }
          } else {
            name = trimmed
          }
        } else if (item && typeof item === 'object') {
          const r = item as { name?: unknown }
          if (typeof r.name === 'string') name = r.name
        }
        if (name) out.push(name.trim())
      }
      return out
    }

    // Per-shot blocks
    const shotBlocks: string[] = []
    let cursor = 0
    for (let i = 0; i < count; i++) {
      const dur = base + (i < remainder ? 1 : 0)
      const start = cursor
      const end = cursor + dur
      cursor = end
      const p = panels[i]
      const desc = (p.description ?? p.prompt ?? '').trim()
      // 2026-05-13 — Prefer structured voiceLines (server-joined from
      // NovelPromotionVoiceLine) over the legacy srtSegment string. This
      // exposes the isVoiceover flag so we can format off-camera lines
      // as `Voiceover (off-camera, no lip-sync): "..."` and keep Kling
      // from mouthing the line.
      const structuredVoiceLines = Array.isArray(p.voiceLines) ? p.voiceLines : []
      const dialog = (() => {
        if (structuredVoiceLines.length > 0) {
          return structuredVoiceLines
            .map((v) => v.isVoiceover
              ? `Voiceover (off-camera, lips do not move) — ${v.speaker}: "${v.content}"`
              : `${v.speaker}: "${v.content}"`)
            .join('\n')
        }
        return (p.srtSegment ?? '').trim()
      })()

      // Derive framing from panel.shotType when available, else 'shot N'
      const shotTypeRaw = p.shotType?.trim() ?? ''
      const framing = SHOT_TYPE_TO_FRAMING[shotTypeRaw] ?? '场景'

      // Derive camera move
      const cameraMoveRaw = p.cameraMove?.trim() ?? ''
      const cameraMoveEn = CAMERA_MOVE_TO_EN[cameraMoveRaw] ?? cameraMoveRaw

      // Per-shot binding hint — bare names only, comma-separated. Worker
      // translates these to `<<<image_N>>>` right before Kling. Drop the
      // shot anchor line entirely when no characters are bound for this
      // panel (it was decorative).
      const shotCharNames: string[] = []
      const seenInShot = new Set<string>()
      for (const charName of extractPanelCharNames(p)) {
        const lower = charName.toLowerCase()
        if (seenInShot.has(lower)) continue
        seenInShot.add(lower)
        if (charNameToRefSlot.has(lower)) shotCharNames.push(charName)
      }
      // EN'd labels, CN entity names preserved (same rationale as header).
      const shotBindingFragments: string[] = []
      if (shotCharNames.length > 0) {
        shotBindingFragments.push(`Cast: ${shotCharNames.join('、')}`)
      }
      const panelLocRaw = (p as { location?: string | null }).location ?? ''
      const panelLocName = panelLocRaw.includes('#')
        ? panelLocRaw.slice(0, panelLocRaw.indexOf('#')).trim()
        : panelLocRaw.trim()
      if (panelLocName) {
        shotBindingFragments.push(`Scene: ${panelLocName}`)
      }

      const blockLines: string[] = []
      blockLines.push(`镜头${i + 1}（${start}-${end} seconds）·${framing} ${PER_SHOT_STYLE_TAG}`)
      if (shotBindingFragments.length > 0) {
        blockLines.push(`[${shotBindingFragments.join('] [')}]`)
      }
      if (desc) blockLines.push(desc)
      if (dialog) blockLines.push(dialog)
      // EN label for consistency with Cast/Scene above; move term was already EN.
      if (cameraMoveEn) blockLines.push(`Camera: ${cameraMoveEn}`)
      blockLines.push(ANTI_TEXT_LINE)
      shotBlocks.push(blockLines.join('\n'))
    }

    // 2026-05-13 — Overall Description prefix.
    //
    // Alibaba's official multi-shot text-to-video formula is
    //   `Overall Description + Shot N + Timestamp + Shot Content`
    // Our previous prompt jumped straight to `镜头1`, skipping the
    // overall sentence that orients the model on the segment's
    // narrative arc. Adding it cheap-buys: (a) more coherent shot
    // transitions (model knows where the cut is heading), (b) less
    // style drift across shots (the synopsis primes the visual style
    // for the whole arc, not just shot 1).
    //
    // Source: longest non-empty description in the group — usually
    // the climactic shot, which captures arc intent best. Falls back
    // to first non-empty if nothing distinctive emerges.
    const overallSummary = (() => {
      const descs = panels
        .map((p) => (p.description ?? p.prompt ?? '').trim())
        .filter((s) => s.length > 0)
      if (descs.length === 0) return ''
      const longest = descs.slice().sort((a, b) => b.length - a.length)[0]
      // Trim to ~140 chars so the OVERALL line stays a sentence, not
      // a duplicate of the per-shot descriptions below.
      const trimmed = longest.replace(/\s+/g, ' ').trim()
      return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed
    })()
    const overallLine = overallSummary
      ? `OVERALL: ${overallSummary}`
      : ''

    // 2026-05-13 — ReelShort cold-open branch.
    //
    // When `coldOpenMode !== 'off'`, replace the per-panel shotBlocks
    // with the fixed 4-shot × 2-second hook structure. The STYLE header,
    // OVERALL summary, and reference-character/scene anchors are STILL
    // prepended — the hook formula only owns the per-shot blocks.
    //
    // `auto` mode picks the variant from group text (panel descriptions
    // + character/scene names); manual modes pin a specific variant.
    let resolvedColdOpenVariant: ColdOpenVariant | null = null
    if (coldOpenMode === 'auto') {
      const textBlob = [
        ...panels.map((p) => (p.description ?? p.prompt ?? '').trim()),
        ...charNames,
        ...sceneLabels,
      ]
        .filter(Boolean)
        .join(' ')
      resolvedColdOpenVariant = detectColdOpenGenre(textBlob)
    } else if (coldOpenMode !== 'off') {
      resolvedColdOpenVariant = coldOpenMode
    }
    const coldOpenBlock = resolvedColdOpenVariant
      ? buildColdOpenShotBlock({
          panels: panels.map<ColdOpenPanel>((p) => ({
            id: p.id,
            description: p.description ?? p.prompt ?? '',
            characters: p.characters ?? null,
            location: (p as { location?: string | null }).location ?? null,
            voiceLines: p.voiceLines,
            srtSegment: p.srtSegment ?? null,
          })),
          variant: resolvedColdOpenVariant,
          perShotTag: PER_SHOT_STYLE_TAG,
          antiTextLine: ANTI_TEXT_LINE,
        })
      : null

    // Section order (highest to lowest model attention):
    //   1. STYLE header — locks photoreal output regardless of content
    //   2. OVERALL — primes the narrative arc, helps multi-shot coherence
    //   3. Reference characters / scenes — entity anchors
    //   4. Per-shot blocks (cold-open hook OR free-form depending on mode)
    const sections: string[] = []
    sections.push(STYLE_HEADER_REALISTIC)
    if (overallLine) sections.push(overallLine)
    if (header.length > 0) sections.push(header.join('\n'))
    if (coldOpenBlock) {
      sections.push(coldOpenBlock)
    } else {
      sections.push(shotBlocks.join('\n\n'))
    }
    return sections.join('\n\n')
  }

  // 2026-05-18 — Seedance 五要素 narrative builder (separate from the
  // Kling-tuned buildInitialNarrative above).
  //
  // The Kling format above carries a lot of anti-CG / anti-xianxia
  // tooling (English STYLE header, `[Cast: X] [Scene: Y]` brackets,
  // "STRICT: NOT animation, NOT CG" repetition) that was tuned against
  // Kling 3.0-Omni's xianxia training bias.
  //
  // Seedance 2.0 (BobAPI) handles CN body prose naturally and uses the
  // industry-standard 五要素 prompt structure (角色引用 / 場景設定 /
  // 動作鏈 / 運鏡 / 氛圍-聲音) with the photoreal vocab as a footer.
  // Reference: iangyc-supplied 五要素導演法 spec + a working sample
  // from a competing platform 2026-05-18.
  //
  // Structure:
  //   參考 @圖片1的 {character} 人物形象            ← character ref chip
  //   場景參考 @圖片2的 {scene}                     ← scene ref chip
  //
  //   鏡頭1: {framing}·{title} (Photorealistic Cinematic)
  //   {description prose — action chain, 1-3 visual beats}
  //   嚴格無任何字幕、文字、logo或屏幕信息。
  //   {speaker} 聲音(僅音頻,無畫面文字,嘴部不動):
  //   「{dialogue}」                                 ← when VO present
  //   {speaker}:「{dialogue}」                       ← when on-camera
  //
  //   ...
  //
  //   整體視覺風格:
  //   photorealistic, hyperrealistic, cinematic lighting, ...
  //
  // No `[Cast]`/`[Scene]` brackets per shot — character name appears
  // inline in the prose. No English STYLE prefix — handled by footer.
  const CAMERA_MOVE_TO_CN: Record<string, string> = {
    固定: '固定镜头',
    平移: '平移',
    推镜: '缓慢推镜',
    推進: '缓慢推镜',
    拉镜: '缓慢拉远',
    拉遠: '缓慢拉远',
    跟拍: '跟拍',
    手持: '手持微晃',
    俯拍: '俯拍',
    仰拍: '仰拍',
    环绕: '环绕运镜',
    環繞: '环绕运镜',
    摇降: '摇降',
    搖降: '摇降',
    摇升: '摇升',
    搖升: '摇升',
    中度推進: '中度推镜',
  }

  // 2026-05-18 — footer is now driven by the curated visualStyles catalog
  // (29 styles in src/lib/style-library/visual-styles.ts). The picker's
  // visualStyleOverride wins over projectVisualStyleId; either resolves to
  // a VisualStyle whose styleAnchor + visualModifiers form the footer.
  //
  // RED LINE — what we deliberately do NOT inline anymore:
  //   - Camera/film equipment terms ("Arri Alexa 65", "IMAX quality",
  //     "8K detail", "film grain"). These live in styleAnchor when the
  //     chosen style is a realistic one; on stylized choices (anime,
  //     watercolor, etc.) they were actively wrong.
  //   - Negative directives ("no text", "no subtitles", "no plastic look").
  //     Generation models attend to the noun and sometimes generate it.
  //     The worker now sends a dedicated negative_prompt to BobAPI via
  //     buildVisualStyleNegative() + a universal text/watermark suppressor.
  //
  // Returns empty string when no style is selected — the worker's own
  // resolveProjectVisualStyle on the server is the safety net.
  const buildStyleFooterFromCatalog = (): string => {
    const effectiveStyleId =
      visualStyleOverride && visualStyleOverride !== STYLE_INHERIT
        ? visualStyleOverride
        : projectVisualStyleId
    if (!effectiveStyleId) return ''
    const style = getStyleSafe(effectiveStyleId)
    if (!style) return ''
    const parts = [style.styleAnchor, style.visualModifiers].filter(
      (s): s is string => Boolean(s && s.trim()),
    )
    if (parts.length === 0) return ''
    return ['整体视觉风格:', parts.join('. ')].join('\n')
  }

  const buildInitialNarrativeSeedance = (): string => {
    const count = panels.length
    if (count === 0) return ''

    // Header — 五要素 chips. Up to 3 entities (BobAPI Seedance accepts
    // up to 9 reference images total; first 3 slots are typically the
    // identity anchors — characters first, then scenes).
    const TENCENT_SUBJECT_INFOS_CAP = 3
    const headerLines: string[] = []
    let refSlot = 1
    const charsToAnchor = groupCast.slice(0, TENCENT_SUBJECT_INFOS_CAP)
    const remainingForScenes = TENCENT_SUBJECT_INFOS_CAP - charsToAnchor.length
    const scenesToAnchor = groupScenes.slice(0, remainingForScenes)
    for (const cast of charsToAnchor) {
      headerLines.push(`参考 @图片${refSlot}的 ${cast.character.name} 人物形象`)
      refSlot++
    }
    for (const scene of scenesToAnchor) {
      const sceneLabel = scene.viewName ? `${scene.location.name}·${scene.viewName}` : scene.location.name
      headerLines.push(`场景参考 @图片${refSlot}的 ${sceneLabel}`)
      refSlot++
    }

    // Per-shot blocks
    const shotBlocks: string[] = []
    for (let i = 0; i < count; i++) {
      const p = panels[i]
      const desc = (p.description ?? p.prompt ?? '').trim()
      const shotTypeRaw = p.shotType?.trim() ?? ''
      const framing = SHOT_TYPE_TO_FRAMING[shotTypeRaw] ?? '中景'
      const cameraMoveRaw = p.cameraMove?.trim() ?? ''
      const cameraMoveCn = CAMERA_MOVE_TO_CN[cameraMoveRaw] ?? cameraMoveRaw

      // Shot header: 镜头N: framing·camera
      // Drop the camera fragment when 固定 (visually empty info).
      // 2026-05-18 — dropped "(Photorealistic Cinematic)" tag. It was a
      // hardcoded editing-style claim that contradicted non-realistic
      // visualStyleId choices and added noise to every shot block.
      const cameraFragment = cameraMoveCn && cameraMoveCn !== '固定镜头' ? `·${cameraMoveCn}` : ''
      const lines: string[] = [`镜头${i + 1}: ${framing}${cameraFragment}`]

      if (desc) lines.push(desc)

      // Voice lines — Seedance native dialogue. VO/OS lines get the
      // explicit "仅音频,无画面文字,嘴部不动" rider so BobAPI does NOT
      // lip-sync them (matching the OS rule the prompt chain enforces).
      const structuredVoiceLines = Array.isArray(p.voiceLines) ? p.voiceLines : []
      if (structuredVoiceLines.length > 0) {
        for (const v of structuredVoiceLines) {
          if (v.isVoiceover) {
            lines.push(`${v.speaker} 声音(仅音频，无画面文字，嘴部不动):`)
            lines.push(`「${v.content}」`)
          } else {
            lines.push(`${v.speaker}:「${v.content}」`)
          }
        }
      } else {
        const srt = (p.srtSegment ?? '').trim()
        if (srt) lines.push(srt)
      }

      // 2026-05-18 — removed per-shot negative sentence
      // ("严格无任何字幕、文字、logo或屏幕信息"). Negative directives now
      // ride on BobAPI's negative_prompt body field; emitting them in the
      // positive prompt was probabilistically inducing the very artifacts
      // (subtitle bars, on-screen logos) it was trying to suppress.
      shotBlocks.push(lines.join('\n'))
    }

    const sections: string[] = []
    if (headerLines.length > 0) sections.push(headerLines.join('\n'))
    sections.push(shotBlocks.join('\n\n'))
    const styleFooter = buildStyleFooterFromCatalog()
    if (styleFooter) sections.push(styleFooter)
    return sections.join('\n\n')
  }

  // Family-aware dispatcher. Kling/default keeps the heavily-tuned
  // STYLE_HEADER_REALISTIC anti-CG anchoring. Seedance gets the cleaner
  // 五要素 format with CN body + EN photo-vocabulary footer.
  const buildInitialNarrativeForFamily = (): string =>
    videoFamily === 'seedance'
      ? buildInitialNarrativeSeedance()
      : buildInitialNarrative()

  const [narrativeDraft, setNarrativeDraft] = useState<string>('')
  const [narrativeDirty, setNarrativeDirty] = useState<boolean>(false)
  const [narrativeRegenFlash, setNarrativeRegenFlash] = useState<boolean>(false)
  const narrativeTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Phase O (2026-05-21) — Recommended total duration for this group,
  // derived from panel.srtSegment via the shared dialogue estimator. Used
  // to make the time dropdown's "Auto" label informative: instead of just
  // "Auto (對白驅動)" the user sees "Auto (推薦 12s)" so they know what
  // the system would pick and only need to override when the number feels
  // off. Mirrors the worker-side Phase M tiers so the displayed value
  // matches what the worker will actually use.
  // Phase M parity with worker — wraps the shared helper so V2GroupsLayout
  // can compute the same recommendations across all groups (for the
  // cumulative time-range badge) without duplicating logic.
  const recommendedDurationSec = useMemo<number | null>(
    () => computeGroupRecommendedDurationSec(panels),
    [panels],
  )
  // Re-seed the narrative when panels, duration, cast, or scenes change AND
  // the user hasn't edited it locally — avoids clobbering an in-progress edit.
  // groupCast/groupScenes are included so chip overrides re-trigger seed.
  useEffect(() => {
    if (narrativeDirty) return
    setNarrativeDraft(buildInitialNarrativeForFamily())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, totalDurationDraft, groupCast, groupScenes, coldOpenMode, videoFamily])

  // Local drafts keyed by panel id. Re-seeded whenever the panel's
  // server-side description / dialogue changes (e.g. analyze
  // re-cascades after a description edit somewhere upstream).
  // Still used by the Phase 1 fallback editor (kept behind the
  // 「進階分鏡編輯」 toggle for power users).
  const [descDrafts, setDescDrafts] = useState<Record<string, string>>({})
  const [dialogueDrafts, setDialogueDrafts] = useState<Record<string, string>>({})
  useEffect(() => {
    const nextDesc: Record<string, string> = {}
    const nextDial: Record<string, string> = {}
    for (const p of panels) {
      nextDesc[p.id] = p.description ?? p.prompt ?? ''
      nextDial[p.id] = p.srtSegment ?? ''
    }
    setDescDrafts(nextDesc)
    setDialogueDrafts(nextDial)
  }, [panels])
  const [showAdvancedEditor, setShowAdvancedEditor] = useState<boolean>(false)

  const [savingPanelId, setSavingPanelId] = useState<string | null>(null)
  function handleSaveDescription(panelId: string) {
    const value = descDrafts[panelId] ?? ''
    setSavingPanelId(panelId)
    updatePanelText.mutate(
      { panelId, description: value },
      {
        onSettled: () => setSavingPanelId((prev) => (prev === panelId ? null : prev)),
        onError: (err) => alert(err instanceof Error ? err.message : '儲存描述失敗'),
      },
    )
  }
  function handleSaveDialogue(panelId: string) {
    const value = dialogueDrafts[panelId] ?? ''
    setSavingPanelId(panelId)
    updatePanelText.mutate(
      { panelId, srtSegment: value },
      {
        onSettled: () => setSavingPanelId((prev) => (prev === panelId ? null : prev)),
        onError: (err) => alert(err instanceof Error ? err.message : '儲存對白失敗'),
      },
    )
  }

  const [regenState, setRegenState] = useState<
    | { status: 'idle' }
    | { status: 'submitting' }
    | { status: 'done' }
    | { status: 'error'; message: string }
  >({ status: 'idle' })

  // 2026-05-13 — per-character × remove on the 出場角色 / 演員綁定 chips.
  // Tracks the in-flight removal so the chip can show a spinner.
  const [removingCharId, setRemovingCharId] = useState<string | null>(null)
  // Scene-side equivalent. Keyed by location id to handle multiple
  // scenes in the same group.
  const [removingSceneId, setRemovingSceneId] = useState<string | null>(null)

  /**
   * Remove a character from EVERY panel in this group. Writes panel.characters
   * back to DB via useUpdatePanelText so subsequent regens (and panel-image
   * regens) no longer include this character's reference. Used to fix
   * mis-extracted single-char names like 离 that the analyze LLM injected
   * because '离地半米' substring-matched the character name.
   *
   * Walks each panel sequentially. For each panel that mentions the
   * character (case-insensitive, handles both bare-string and
   * {name, appearance?} shapes), splices that entry out, re-serializes,
   * and PATCH-es the panel. Storyboard query is invalidated by the
   * mutation hook so the chip rail re-derives without the removed cast.
   */
  /**
   * Remove a SCENE from every panel in this group. Sets panel.location to
   * null for any panel whose location.name matches. Worker treats null as
   * 'no scene ref' so that SubjectInfos slot is freed for character/prop
   * reference images instead.
   */
  async function handleRemoveSceneFromGroup(locationId: string, locationName: string) {
    if (removingSceneId) return
    if (!confirm(`從此 group 的所有分鏡移除場景「${locationName}」?\n\n影響 DB,下次重新生成時這個場景不再被當作 reference 上傳到 Kling。\n（不會刪除場景本身,只是這幾個分鏡不再引用他）`)) {
      return
    }
    setRemovingSceneId(locationId)
    const targetLower = locationName.trim().toLowerCase()
    try {
      for (const p of panels) {
        const raw = (p as { location?: string | null }).location ?? null
        if (!raw) continue
        const hashIdx = raw.indexOf('#')
        const locName = (hashIdx === -1 ? raw : raw.slice(0, hashIdx)).trim()
        if (locName.toLowerCase() !== targetLower) continue
        await updatePanelText.mutateAsync({
          panelId: p.id,
          location: null,
        })
      }
    } catch (err) {
      alert(`移除場景失敗:${(err as Error)?.message ?? '未知'}`)
    } finally {
      setRemovingSceneId(null)
    }
  }

  async function handleRemoveCharacterFromGroup(characterId: string, characterName: string) {
    if (removingCharId) return
    if (!confirm(`從此 group 的所有分鏡移除「${characterName}」?\n\n影響 DB,下次重新生成圖/影片時這個角色就不會被綁入。\n（不會刪除角色本身,只是這幾個分鏡不再引用他）`)) {
      return
    }
    setRemovingCharId(characterId)
    const targetLower = characterName.trim().toLowerCase()
    try {
      for (const p of panels) {
        const raw: unknown[] = Array.isArray(p.characters) ? p.characters : []
        if (raw.length === 0) continue
        const filtered: Array<{ name: string; appearance?: string }> = []
        let touched = false
        for (const item of raw) {
          let entryName: string | null = null
          let entryAppearance: string | undefined
          if (typeof item === 'string') {
            const trimmed = item.trim()
            if (trimmed.startsWith('{')) {
              try {
                const parsed = JSON.parse(trimmed) as { name?: unknown; appearance?: unknown }
                if (typeof parsed.name === 'string') entryName = parsed.name
                if (typeof parsed.appearance === 'string') entryAppearance = parsed.appearance
              } catch {
                entryName = trimmed
              }
            } else {
              entryName = trimmed
            }
          } else if (item && typeof item === 'object') {
            const r = item as { name?: unknown; appearance?: unknown }
            if (typeof r.name === 'string') entryName = r.name
            if (typeof r.appearance === 'string') entryAppearance = r.appearance
          }
          if (!entryName) continue
          if (entryName.trim().toLowerCase() === targetLower) {
            touched = true
            continue
          }
          filtered.push(entryAppearance ? { name: entryName, appearance: entryAppearance } : { name: entryName })
        }
        if (!touched) continue
        await updatePanelText.mutateAsync({
          panelId: p.id,
          characters: filtered,
        })
      }
    } catch (err) {
      alert(`移除失敗:${(err as Error)?.message ?? '未知'}`)
    } finally {
      setRemovingCharId(null)
    }
  }
  async function handleRegenerate() {
    if (panels.length < 2) {
      setRegenState({ status: 'error', message: '至少需要 2 鏡才能跑多鏡頭' })
      return
    }
    // Kling 多鏡頭 single dispatch caps at 6 clips per group; Seedance
    // composite caps at 9 references (BobAPI content[] @N hard limit).
    // Worker enforces both — UI just nudges so the user understands which
    // panels get dropped if the group is oversized.
    const maxPanels = videoFamily === 'seedance' ? 9 : 6
    if (panels.length > maxPanels) {
      setRegenState({
        status: 'error',
        message: `一組最多 ${maxPanels} 鏡(會送前 ${maxPanels} 個)`,
      })
    } else {
      setRegenState({ status: 'submitting' })
    }
    const ids = panels.slice(0, 6).map((p) => p.id)
    // 2026-05-13 — AUTO mode (totalDurationDraft=0) means: don't compute
    // panelDurations at all. Worker engages buildDialogueDrivenDurations
    // and picks per-shot timing from voice line speech length.
    //
    // Explicit-duration mode (5/10/15): user pinned a total, distribute
    // evenly across panels. Worker enters customize mode when
    // panelDurations is present, so each multi_prompt[] entry gets the
    // right per-shot anchor in Kling Omni.
    const isAutoDuration = totalDurationDraft === 0
    const panelDurations: number[] | undefined = isAutoDuration ? undefined : (() => {
      const count = ids.length
      const total = Math.max(count, Math.min(15, totalDurationDraft))
      const base = Math.max(1, Math.floor(total / count))
      const remainder = Math.max(0, total - base * count)
      const out: number[] = []
      for (let i = 0; i < count; i++) {
        out.push(base + (i < remainder ? 1 : 0))
      }
      return out
    })()
    const trimmedNarrative = narrativeDraft.trim()
    // 2026-05-13 (rev 2) — sendRaw flip: gate on narrativeDirty.
    //
    // History of this gate:
    //   - rev 1 (earlier today): `sendRaw = trimmedNarrative.length > 0`
    //     — i.e. always send rawPrompt when the textarea has content.
    //     Problem: the textarea ALWAYS has content (auto-seeded by
    //     buildInitialNarrative on mount + on cast/scene/duration change).
    //     So rawPrompt was always sent → worker always ran intelligence
    //     mode → the dialogue-driven duration allocator at
    //     multi-shot-video-b-path.ts:1727 NEVER fired (its gate is
    //     `effectivePanelDurations === undefined && rawPrompt === undefined`).
    //     Result: every group rendered fixed-15s totalDurationDraft split
    //     instead of allocating per-shot durations from voice line length.
    //
    //   - rev 2 (this change): `sendRaw = narrativeDirty`. The textarea
    //     is now treated as a power-user override — only sent when the
    //     user explicitly typed (narrativeDirty=true via onChange). When
    //     the narrative is its auto-seeded default the frontend stays
    //     out of the worker's way, letting buildDialogueDrivenDurations
    //     decide per-shot timing from the actual voice lines (user-
    //     requested 2026-05-13: 「保留原本對話為主, 去搭配不同的秒數做切組」).
    //
    // When sendRaw=true, OMIT panelDurations (Tencent customize mode
    // ignores top-level Prompt; sending both means rawPrompt is silently
    // dropped). When sendRaw=false, also OMIT panelDurations so the
    // worker can engage its dialogue-driven path — only fall back to
    // explicit panelDurations when there's truly no signal upstream.
    //
    // The auto-seeded cinematic STYLE / OVERALL / MOTION header is NOT
    // lost in customize mode: the worker still injects styleHeader +
    // per-shot styleSuffix into each multi_prompt entry. Only the
    // OVERALL preamble (a single sentence) is dropped — Kling derives
    // arc context from the per-shot prompts themselves.
    // 2026-05-13 — cold-open hook overrides the dirty gate. The
    // 4-shot × 2s formula only takes effect when the worker reads
    // rawPrompt (sendRaw=true), so an active coldOpenMode forces the
    // auto-seeded cold-open narrative through even when the user has
    // not manually edited the textarea.
    const sendRaw =
      (narrativeDirty || coldOpenMode !== 'off') && trimmedNarrative.length > 0
    // 2026-05-13 — Option B 首幀鎖定. When user enabled the lock, pull
    // the first panel's image as FirstFrame and (when first_last_frame
    // mode) the last panel's image as LastFrame. Worker switches to
    // Kling 3.0 i2v single-shot when these are present.
    let firstFrameImageUrl: string | undefined
    let lastFrameImageUrl: string | undefined
    if (frameLockMode !== 'off') {
      const firstPanelImage = panels[0]?.imageUrl?.trim()
      if (firstPanelImage) firstFrameImageUrl = firstPanelImage
      if (frameLockMode === 'first_last_frame') {
        const lastPanelImage = panels[panels.length - 1]?.imageUrl?.trim()
        if (lastPanelImage) lastFrameImageUrl = lastPanelImage
      }
    }

    const overrides: GroupRegenOverrides = {
      // Three states:
      //   sendRaw=true              → rawPrompt only (intelligence mode, user override)
      //   sendRaw=false, AUTO       → neither (worker engages dialogue-driven)
      //   sendRaw=false, fixed dur  → panelDurations (customize mode, even split)
      ...(sendRaw
        ? { rawPrompt: trimmedNarrative }
        : panelDurations
          ? { panelDurations }
          : {}),
      // Phase P (2026-05-21) — ALWAYS forward the user's intended total
      // even when sendRaw=true and panelDurations is omitted. Workers
      // use this as a tier-1.5 fallback so "選 15s + 編 narrative" no
      // longer drops to 10-13s baseline. 0 = AUTO (unchanged behavior).
      ...(totalDurationDraft > 0 ? { totalDurationSeconds: totalDurationDraft } : {}),
      characterOverrides: Object.entries(characterOverrides)
        .filter(([, app]) => app !== undefined)
        .map(([characterId, appearanceId]) =>
          appearanceId === null ? { characterId } : { characterId, appearanceId },
        ),
      locationOverrides: Object.entries(locationOverrides)
        .filter(([, view]) => view !== undefined)
        .map(([locationId, viewName]) =>
          viewName === null ? { locationId } : { locationId, viewName },
        ),
      ...(firstFrameImageUrl ? { firstFrameImageUrl } : {}),
      ...(lastFrameImageUrl ? { lastFrameImageUrl } : {}),
      ...(visualStyleOverride !== STYLE_INHERIT
        ? { visualStyleId: visualStyleOverride }
        : {}),
    }
    const result = await onRegenerate(ids, overrides)
    if (result.error) {
      setRegenState({ status: 'error', message: result.error })
    } else {
      setRegenState({ status: 'done' })
      // Keep overrides visible so the user can see what just got
      // applied; manually reset via the chips if needed.
    }
  }

  function handleResetOverrides() {
    setCharacterOverrides({})
    setLocationOverrides({})
  }

  // Cumulative time range for the segment header. Prefer the
  // absolute `segmentStartSec` the parent computed by summing
  // prior groups' actual recommended durations (Phase Q-aware).
  // Fall back to the legacy `(ordinal-1) * thisGroupDuration`
  // approximation only when the parent hasn't supplied a start —
  // that path is incorrect whenever groups have different
  // recommended lengths (which is the norm now), but keeps the
  // component renderable in legacy contexts that haven't been
  // upgraded yet.
  const segmentStart = typeof segmentStartSec === 'number'
    ? segmentStartSec
    : (groupOrdinal - 1) * segmentDurationSeconds
  const segmentEnd = segmentStart + segmentDurationSeconds
  const timeRangeLabel = formatTimeRange(segmentStart, segmentEnd)
  const briefDescription = (() => {
    const head = panels[0]?.description ?? panels[0]?.prompt ?? ''
    const trimmed = head.replace(/\s+/g, ' ').trim()
    return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed
  })()
  // Pull live task status so the header badge reflects the actual
  // server state (failed / processing / completed) instead of just
  // the local "did I click submit recently" flag. Same React Query
  // key as the rail so no extra network hop.
  const taskQuery = useMultiShotTask(taskId)
  const liveTaskStatus = taskQuery.data?.status ?? null
  const taskFailed = liveTaskStatus === 'failed' || liveTaskStatus === 'cancelled'
  const taskProcessing = liveTaskStatus === 'queued' || liveTaskStatus === 'processing'
  const taskCompleted = liveTaskStatus === 'completed'
  // Server-bound cast (what Kling actually anchored against). Lives
  // in the right column below the scene chips per user request —
  // the rail kept it directly below the player which made the left
  // half overcrowded vs the narrative pane on the right.
  const boundCharacters: MultiShotCharacterBinding[] =
    taskQuery.data?.result?.bindings?.characters ?? []

  // If the task ultimately failed but local regenState still says
  // "done" (we marked done on submit success, before Kling actually
  // ran), drop back to idle so the user can re-click.
  useEffect(() => {
    if (taskFailed && regenState.status === 'done') {
      setRegenState({ status: 'idle' })
    }
  }, [taskFailed, regenState.status])

  const statusLabel = (() => {
    if (regenState.status === 'submitting') return { text: '送出中…', tone: 'pending' }
    if (taskFailed) return { text: '失敗 · 點重新生成', tone: 'error' }
    if (taskProcessing) return { text: '生成中…', tone: 'pending' }
    if (taskCompleted) return { text: '已完成', tone: 'done' }
    if (taskId) return { text: '已送出', tone: 'done' }
    return { text: '尚未生成', tone: 'idle' }
  })()
  const statusToneClass =
    statusLabel.tone === 'done'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400'
      : statusLabel.tone === 'pending'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : statusLabel.tone === 'error'
          ? 'border-rose-500/50 bg-rose-500/10 text-rose-300'
          : 'border-stone-800/60 bg-stone-900/30 text-stone-500'

  return (
    <article
      className={`overflow-hidden rounded-sm border-y border-r border-l-4 border-stone-800/60 bg-stone-900/30 ${accentClass}`}
    >
      <header
        className="flex cursor-pointer select-none items-center justify-between gap-4 border-b border-amber-900/15 bg-stone-950/40 px-4 py-2.5 transition-colors hover:bg-stone-950/60"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex flex-1 items-center gap-3 overflow-hidden">
          <div className="flex-shrink-0 font-mono text-[14px] uppercase tracking-wider text-amber-500/80">
            {groupLabel}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1 rounded-sm border border-stone-800 bg-stone-900/60 px-1.5 py-0.5 font-mono text-[12px] tracking-wider text-stone-400">
            <AppIcon name="play" className="h-2.5 w-2.5" />
            {timeRangeLabel}
          </div>
          <div
            className={`flex-shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[12px] tracking-wider ${statusToneClass}`}
          >
            {statusLabel.tone === 'done' ? '✓ ' : statusLabel.tone === 'error' ? '⚠ ' : statusLabel.tone === 'pending' ? '↻ ' : ''}
            {statusLabel.text}
          </div>
          {!expanded && briefDescription ? (
            <div className="truncate font-serif-cn text-[12px] text-stone-300">
              {briefDescription}
            </div>
          ) : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {expanded ? (
            <button
              type="button"
              disabled={regenState.status === 'submitting' || panels.length < 2 || !canMultiShot}
              onClick={(e) => {
                e.stopPropagation()
                void handleRegenerate()
              }}
              title={
                !canMultiShot
                  ? '當前模型不支援多鏡頭 — 請從上方視頻模型 picker 切到 Kling 或 Seedance 2.0 720p (BobAPI)'
                  : videoFamily === 'seedance'
                    ? '把這個 group 的所有分鏡合成為一支 4-15s 影片(Seedance BobAPI 9-ref @N 合成)'
                    : '重新送這個 group 跑 Kling 多鏡頭'
              }
              className={`flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[12px] tracking-wider transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                regenState.status === 'submitting'
                  ? 'border-amber-400 bg-amber-500/30 text-amber-100 ring-2 ring-amber-500/40'
                  : regenState.status === 'done'
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                    : regenState.status === 'error'
                      ? 'border-rose-500/60 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                      : 'border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
              }`}
            >
              {regenState.status === 'submitting' ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-amber-400/40 border-t-amber-200" />
              ) : (
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
              )}
              {/* 2026-05-13 — label differentiates "no video yet" from
                  "have a video, regenerate it". `taskId` is the server-
                  side multi-shot task; null means this group has never
                  been submitted. The done/error states keep the literal
                  resubmit prompt because user just clicked once.
                  2026-05-18 — collapsed the seedance/kling label split:
                  both families now read "生成視頻" / "重新生成", per user
                  feedback that "合成此組" was unclear jargon. */}
              {regenState.status === 'submitting'
                ? '送出中…'
                : regenState.status === 'done'
                  ? '✓ 已送出'
                  : regenState.status === 'error'
                    ? '⚠ 失敗,點重試'
                    : taskId
                      ? '重新生成'
                      : '生成視頻'}
            </button>
          ) : null}
          <div className="font-mono text-[14px] tracking-wider text-stone-500">
            {expanded ? '▲' : '▼'}
          </div>
        </div>
      </header>

      {!expanded ? null : (
      <div className="space-y-3 p-4">
        {regenState.status === 'submitting' ? (
          <div className="flex items-center gap-2 rounded-sm border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-400/40 border-t-amber-200" />
            <div className="font-serif-cn text-[12px] text-amber-200">
              {videoFamily === 'seedance'
                ? '送 Seedance 中…task 已 queue,大約 30 秒進到 worker。BobAPI 合成大約 2-5 分鐘出影片,完成後左邊會自動刷新。'
                : '送 Kling 中…task 已 queue,大約 30 秒進到 worker。Kling Omni 算 3-5 分鐘出影片,完成後左邊會自動刷新。'}
            </div>
          </div>
        ) : regenState.status === 'done' ? (
          <div className="flex items-center gap-2 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
            <AppIcon name="check" className="h-3 w-3 text-emerald-300" />
            <div className="font-serif-cn text-[12px] text-emerald-200">
              {videoFamily === 'seedance'
                ? '✓ 已送出 — Seedance 合成大約 2-5 分鐘出影片,進度會顯示在左邊綁定區。可以同時去其他 group 編輯。'
                : '✓ 已送出 — Kling Omni 大約 3-5 分鐘出影片,進度會顯示在左邊綁定區。可以同時去其他 group 編輯。'}
            </div>
          </div>
        ) : regenState.status === 'error' ? (
          <div className="flex items-center gap-2 rounded-sm border border-rose-500/40 bg-rose-500/10 px-3 py-2">
            <AppIcon name="alert" className="h-3 w-3 text-rose-300" />
            <div className="flex-1 font-serif-cn text-[12px] text-rose-200">
              ⚠ 送出失敗:{regenState.message}
            </div>
            <button
              type="button"
              onClick={() => void handleRegenerate()}
              disabled={!canMultiShot}
              title={
                canMultiShot
                  ? undefined
                  : '當前模型不支援多鏡頭 — 請從上方視頻模型 picker 切到 Kling 或 Seedance 2.0 720p (BobAPI)'
              }
              className="rounded-sm border border-rose-500/50 bg-rose-500/15 px-2 py-0.5 font-mono text-[12px] tracking-wider text-rose-200 transition-colors hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              重試
            </button>
          </div>
        ) : null}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-3">
          <MultiShotBindingsRail
            taskId={taskId}
            groupLabel={null}
            projectId={projectId}
            downloadFilenameBase={(() => {
              const epPart = episodeNumber && episodeNumber > 0 ? `ep${episodeNumber}_` : ''
              return `${epPart}group${String(groupOrdinal).padStart(2, '0')}`
            })()}
            hideCastSection
            characterOverrideAppearanceById={characterOverrides}
            locationOverrideViewByLocationId={locationOverrides}
            onCharacterChipClick={(binding) => {
              const character = characterById.get(binding.id)
              if (!character) return
              const currentAppearanceId =
                characterOverrides[binding.id] !== undefined
                  ? characterOverrides[binding.id]
                  : binding.appearanceId
              setPickerCharacter({ character, currentAppearanceId })
            }}
            onSceneChipClick={(binding) => {
              const location = locationById.get(binding.id)
              if (!location) return
              const currentViewName =
                locationOverrides[binding.id] !== undefined
                  ? locationOverrides[binding.id]
                  : binding.viewName
              setPickerLocation({ location, currentViewName })
            }}
          />
          {overrideCount > 0 ? (
            <div className="mt-2 flex items-center justify-between rounded-sm border border-violet-500/30 bg-violet-500/5 px-2 py-1.5">
              <div className="font-mono text-[12px] tracking-wider text-violet-300">
                ✏ 已修改 {overrideCount} 個綁定 — 「重新生成」會套用
              </div>
              <button
                type="button"
                onClick={handleResetOverrides}
                className="font-mono text-[12px] tracking-wider text-stone-500 transition-colors hover:text-violet-300"
              >
                清空
              </button>
            </div>
          ) : null}
          {/* Banner moved to top of expanded body so it's not buried
              under the player. See above. */}
        </div>

        <div className="col-span-12 space-y-3 lg:col-span-9">
          {/* 2026-05-13 — Two-row header layout:
              Row 1: 叙事提示词 title (left) + ↻ 重生敘事 button (right) —
                     stays balanced even on narrow widths because it's
                     just two short elements.
              Row 2: 鉤子 / 鎖幀 / 时长 selects on their own dedicated row,
                     left-aligned, flex-wrap so they overflow cleanly on
                     tight viewports.
              Earlier single-row layout caused the 3 selects to push the
              重生敘事 button onto a third visual line, leaving 叙事提示词
              awkwardly alone. */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] uppercase tracking-wider text-amber-500/70">
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              叙事提示词
              <span className="text-stone-500">· {narrativeDraft.length} 字</span>
            </div>
            {/* ↻ 重生敘事 — pinned right of the title row so it stays on
                the SAME line as 叙事提示词 regardless of how wide the
                Row 2 selects get. */}
            <button
              type="button"
              disabled={!narrativeDirty}
              onClick={() => {
                const fresh = buildInitialNarrativeForFamily()
                setNarrativeDraft('')
                setNarrativeDirty(false)
                setNarrativeRegenFlash(true)
                window.requestAnimationFrame(() => {
                  setNarrativeDraft(fresh)
                  if (narrativeTextareaRef.current) {
                    narrativeTextareaRef.current.scrollTop = 0
                  }
                })
                window.setTimeout(() => setNarrativeRegenFlash(false), 1500)
              }}
              title={narrativeDirty
                ? '丟棄手動編輯,從分鏡描述+綁定角色/場景重新生成敘事'
                : '敘事目前已是預設值 — 沒有手動編輯,不需要重生'}
              className="whitespace-nowrap rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:border-amber-500/60 hover:bg-amber-500/20 hover:text-amber-200 disabled:cursor-not-allowed disabled:border-stone-800 disabled:bg-stone-900/40 disabled:text-stone-600 disabled:hover:bg-stone-900/40 disabled:hover:border-stone-800 disabled:hover:text-stone-600"
            >
              ↻ 重生敘事
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
              {/* 2026-05-13 — ReelShort 8-second cold-open hook toggle.
                  Default ON (auto) for Episode 1 / Group 1. See
                  docs/design/reelshort-cold-open-evaluation.md. */}
              <label
                className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] uppercase tracking-wider text-stone-400"
                title="冷開場鉤子模式 - 套用 ReelShort 4 鏡 × 2s 結構 (Wide → Medium → OTS → Slow push-in)。auto 模式由群組文字自動判斷風格。"
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                鉤子
                <select
                  value={coldOpenMode}
                  onChange={(e) => {
                    const next = e.target.value as ColdOpenMode
                    setColdOpenMode(next)
                    // Re-seed narrative so the new structure renders.
                    // Cold-open toggle overrides any pending dirty edits
                    // — switching modes is an explicit "give me the new
                    // template" gesture.
                    setNarrativeDirty(false)
                  }}
                  className="rounded-sm border border-stone-800 bg-stone-900 px-1.5 py-0.5 font-mono text-[14px] text-stone-200 outline-none focus:border-amber-500/40"
                >
                  <option value="off">Off (自由結構)</option>
                  <option value="auto">Auto (自動偵測)</option>
                  <option value="modern">Modern (現代劇)</option>
                  <option value="period">Period (古裝/仙俠)</option>
                  <option value="action">Action (動作/災劫)</option>
                </select>
              </label>
              {/* 2026-05-13 — Option B 首幀鎖定 toggle.
                  When ON, this group renders as Kling 3.0 i2v single-shot
                  (5-15s) using SHOT 01 image as FirstFrame, optionally
                  SHOT N image as LastFrame. Drops multi-shot pacing for
                  pixel-locked character/scene consistency.
                  Disabled when SHOT 01 has no generated image. */}
              <label
                className={`flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] uppercase tracking-wider ${
                  panels[0]?.imageUrl ? 'text-stone-400' : 'text-stone-700'
                }`}
                title={panels[0]?.imageUrl
                  ? '首幀鎖定 - 用 SHOT 01 圖當首幀，選「首尾」會再用最後一鏡圖當尾幀。Kling 3.0 i2v 單鏡頭模式 (5-15s)，犧牲多鏡頭換像素級角色/場景一致。'
                  : '首幀鎖定需要 SHOT 01 已產生圖片 — 先到時間軸/畫廊一鍵生圖'}
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                鎖幀
                <select
                  value={frameLockMode}
                  onChange={(e) => {
                    const next = e.target.value as FrameLockMode
                    setFrameLockMode(next)
                  }}
                  disabled={!panels[0]?.imageUrl}
                  className="rounded-sm border border-stone-800 bg-stone-900 px-1.5 py-0.5 font-mono text-[14px] text-stone-200 outline-none focus:border-amber-500/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <option value="off">Off · 多鏡頭(現在)</option>
                  <option value="first_frame">鎖首幀 · 用 SHOT 01 圖</option>
                  <option value="first_last_frame" disabled={!panels[panels.length - 1]?.imageUrl}>
                    {panels[panels.length - 1]?.imageUrl
                      ? `鎖首尾 · 用 SHOT 01 + SHOT ${panels.length}`
                      : `鎖首尾 · 需 SHOT ${panels.length} 也有圖`}
                  </option>
                </select>
              </label>
              <label className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] uppercase tracking-wider text-stone-400">
                <AppIcon name="play" className="h-3 w-3" />
                时长
                <select
                  value={totalDurationDraft}
                  onChange={(e) => {
                    // 0 = AUTO (worker dialogue-driven);
                    // 5/10/15 = explicit total seconds.
                    const next = Number.parseInt(e.target.value, 10)
                    setTotalDurationDraft(Number.isFinite(next) ? next : 0)
                    // Re-seed narrative so the time slices match the
                    // new total. Skipped when the user has dirty edits
                    // — protected by buildInitialNarrative guard.
                    setNarrativeDirty(false)
                  }}
                  title={
                    recommendedDurationSec !== null
                      ? `Auto = 從本組對白長度估算推薦 ${recommendedDurationSec}s` +
                        `(中文 ~4 字/秒、英文 ~2.3 詞/秒;無對白時用 max(10, 分鏡數×2.5))。` +
                        `選 5/10/15 會手動覆蓋。`
                      : 'AUTO 模式 worker 會用對白長度自動分配每鏡時長;選 5/10/15 則平均切到該秒數'
                  }
                  className="rounded-sm border border-stone-800 bg-stone-900 px-1.5 py-0.5 font-mono text-[14px] text-stone-200 outline-none focus:border-amber-500/40"
                >
                  <option value={0}>
                    {recommendedDurationSec !== null
                      ? `Auto (推薦 ${recommendedDurationSec}s)`
                      : 'Auto (對白驅動)'}
                  </option>
                  {/* 2026-05-22 — Seedance / Kling 全家族都支援 4-15 整數秒。
                      Phase O 原本只開 5/10/15 三檔,user 反映想要 6-14 中間
                      值。改成 5-15 全枚舉 (4s 太短捨去) 對齊 backend 已支援
                      範圍。Auto 仍為首選, recommendedDurationSec 走對白驅動。 */}
                  {Array.from({ length: 11 }, (_, i) => 5 + i).map((sec) => (
                    <option key={sec} value={sec}>{sec}s</option>
                  ))}
                </select>
              </label>
              <label
                className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[12px] uppercase tracking-wider text-stone-400"
                title="選一個風格會覆蓋此組的專案預設 (visualStyleId)。Worker 在 multi_prompt 每段 prompt 前後注入該風格的 styleAnchor + visualModifiers。"
              >
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                風格
                <select
                  value={visualStyleOverride}
                  onChange={(e) => setVisualStyleOverride(e.target.value)}
                  className="rounded-sm border border-stone-800 bg-stone-900 px-1.5 py-0.5 font-mono text-[14px] text-stone-200 outline-none focus:border-amber-500/40"
                >
                  <option value={STYLE_INHERIT}>依專案預設</option>
                  {sortedStyleOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.category} · {s.nameZh}
                    </option>
                  ))}
                </select>
                {/* Phase D-2 (2026-05-20) — inline preview of the currently
                    selected override. Renders thumbnail when populated; falls
                    back to the category letter so the rail stays informative
                    before generate-style-thumbnails runs. Hidden on INHERIT
                    so the toolbar stays compact when the user hasn't picked. */}
                {visualStyleOverride !== STYLE_INHERIT ? (
                  <StyleOverridePreview styleId={visualStyleOverride} />
                ) : null}
              </label>
              {/* 重生敘事 button moved to Row 1 (next to 叙事提示词 title)
                  to keep it visually anchored as the title's action,
                  not buried at the end of the selects row. */}
            </div>

          {/* 2026-05-13 — synced colored overlay so user can see which
              characters / scenes are referenced in the narrative.
              Technique: a <pre> with the same content + entity-coloring
              spans sits behind a transparent-text textarea so the user
              edits text on top and sees colors through. Both layers
              MUST share font, size, line-height, padding, and wrap
              behaviour or the overlay drifts. Tailwind classes are
              identical between layers below. */}
          <NarrativeHighlighter
            textareaRef={narrativeTextareaRef}
            value={narrativeDraft}
            onChange={(v) => {
              setNarrativeDraft(v)
              setNarrativeDirty(true)
            }}
            rows={panels.length >= 4 ? 14 : 9}
            placeholder="0-5 seconds: 角色 + 場景 + 動作 + 鏡頭 + 氛圍&#10;5-10 seconds: ...&#10;10-15 seconds: ..."
            characterNames={groupCast.map((c) => c.character.name)}
            sceneNames={groupScenes.map((s) => s.location.name)}
            flashing={narrativeRegenFlash}
          />
          {narrativeDirty ? (
            <div className="font-mono text-[12px] tracking-wider text-violet-300">
              ✏ 敘事已修改 — 「{taskId ? '重新生成' : '生成影片'}」會以這段為主 prompt(覆蓋分鏡描述,並關閉對白驅動時長)
            </div>
          ) : (
            <div className="font-mono text-[12px] tracking-wider text-stone-600">
              {totalDurationDraft === 0
                ? `預覽由 ${panels.length} 個分鏡拼接 · 送出時 worker 會用對白長度自動分配每鏡時長(${panels.length} 鏡)。直接編輯這段可改 prompt(會關閉對白驅動)。`
                : `預設由 ${panels.length} 個分鏡描述自動拼接,${totalDurationDraft}s 平均切。直接編輯這段即可,送出時會以你寫的為準。`}
            </div>
          )}

          {/* 2026-05-13 — 鎖幀模式狀態列 + 縮圖預覽。
              當 frameLockMode !== 'off' 時顯示這段，告訴 user
              到底用了哪張圖當首/尾幀，並提示「會犧牲多鏡頭」。
              SHOT 01 / SHOT N 沒圖時也顯示提示讓 user 知道下一步。 */}
          {frameLockMode !== 'off' ? (
            <div className="rounded-sm border border-amber-500/40 bg-amber-500/5 p-2">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-amber-300">
                <AppIcon name="sparklesAlt" className="h-3 w-3" />
                {frameLockMode === 'first_last_frame' ? '首尾鎖定' : '首幀鎖定'}模式
                <span className="font-serif-cn text-[11px] normal-case tracking-normal text-amber-400/70 italic">
                  · 此 group 將跑單鏡頭 i2v(5-15s)，多鏡頭暫停
                </span>
              </div>
              <div className="flex items-stretch gap-2">
                {/* SHOT 01 thumbnail */}
                <div className="flex flex-col items-center">
                  <div className="font-mono text-[10px] tracking-wider text-amber-400/80">首幀</div>
                  {panels[0]?.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={panels[0].imageUrl}
                      alt="首幀 SHOT 01"
                      className="mt-0.5 h-16 w-12 rounded-sm border border-amber-500/40 object-cover"
                    />
                  ) : (
                    <div className="mt-0.5 flex h-16 w-12 items-center justify-center rounded-sm border border-red-700/50 bg-red-900/20 text-center font-mono text-[9px] text-red-300">
                      SHOT 01<br />沒圖
                    </div>
                  )}
                  <div className="mt-0.5 font-mono text-[10px] text-stone-500">SHOT 01</div>
                </div>
                {frameLockMode === 'first_last_frame' ? (
                  <div className="flex flex-col items-center">
                    <div className="font-mono text-[10px] tracking-wider text-amber-400/80">尾幀</div>
                    {panels[panels.length - 1]?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={panels[panels.length - 1]!.imageUrl!}
                        alt={`尾幀 SHOT ${panels.length}`}
                        className="mt-0.5 h-16 w-12 rounded-sm border border-amber-500/40 object-cover"
                      />
                    ) : (
                      <div className="mt-0.5 flex h-16 w-12 items-center justify-center rounded-sm border border-red-700/50 bg-red-900/20 text-center font-mono text-[9px] text-red-300">
                        SHOT {panels.length}<br />沒圖
                      </div>
                    )}
                    <div className="mt-0.5 font-mono text-[10px] text-stone-500">SHOT {panels.length}</div>
                  </div>
                ) : null}
                <div className="flex-1 font-serif-cn text-[12px] leading-relaxed text-stone-400">
                  Kling 3.0 i2v 會以
                  <span className="text-amber-300">「首幀」</span>
                  {frameLockMode === 'first_last_frame' ? (
                    <>
                      和
                      <span className="text-amber-300">「尾幀」</span>
                      像素鎖死
                    </>
                  ) : (
                    '像素鎖死起點'
                  )}
                  ，中間 5-15 秒由上方敘事 prompt 推動。適合
                  <span className="text-stone-300">角色登場 / 反應鏡頭 / 轉場</span>
                  這種要求像素級一致的 group。要回到多鏡頭模式請把上面「鎖幀」改回 Off。
                </div>
              </div>
            </div>
          ) : !panels[0]?.imageUrl ? (
            <div className="rounded-sm border border-stone-800/60 bg-stone-950/40 px-2 py-1.5 font-mono text-[11px] italic tracking-wider text-stone-600">
              💡 想用「鎖幀」(Kling 3.0 i2v 像素鎖)? 先到時間軸/畫廊跑「一鍵生圖」幫 SHOT 01 產張圖,選單就會解鎖
            </div>
          ) : null}

          {(groupCast.length > 0 || groupScenes.length > 0 || boundCharacters.length > 0) ? (
            <div className="space-y-2 rounded-sm border border-stone-800/60 bg-stone-950/30 p-2">
              {groupCast.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center gap-1 font-mono text-[12px] uppercase tracking-wider text-amber-500/70">
                    <AppIcon name="user" className="h-3 w-3" />
                    出場角色 · {groupCast.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groupCast.map((c) => {
                      const overridden = characterOverrides[c.character.id] !== undefined
                        && characterOverrides[c.character.id] !== c.appearanceId
                      const stateClass = overridden
                        ? 'border-violet-500/60 bg-violet-500/10'
                        : 'border-amber-900/30 bg-stone-950/40'
                      // 2026-05-13 — chip refactored from single <button> to
                      // a <div> with two interactive children: main area
                      // opens the swap modal; the trailing × removes this
                      // character from EVERY panel.characters in this group
                      // (user-asked: 'every shot needs the ability to
                      // remove the character binding').
                      return (
                        <div
                          key={c.character.id}
                          className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-1 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10 ${stateClass}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPickerCharacter({
                                character: c.character,
                                currentAppearanceId: characterOverrides[c.character.id] !== undefined
                                  ? characterOverrides[c.character.id]
                                  : c.appearanceId,
                              })
                            }}
                            className="inline-flex items-center gap-1.5 pr-1"
                            title={`${c.character.name} · ${c.appearanceLabel ?? '默認造型'} — 點擊換造型`}
                          >
                            <div className="relative h-5 w-5 overflow-hidden rounded-full bg-stone-800">
                              {c.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={c.avatarUrl} alt={c.character.name} className="h-full w-full object-cover" />
                              ) : (
                                <AppIcon name="user" className="h-3 w-3 m-auto text-stone-600" />
                              )}
                            </div>
                            <span className="font-serif-cn text-[14px] text-stone-200">
                              {c.character.name}
                            </span>
                            <span className="font-mono text-[12px] tracking-wider text-amber-500/70">
                              {c.appearanceLabel ?? '默認造型'}
                            </span>
                            {overridden ? (
                              <span className="font-mono text-[12px] tracking-wider text-violet-300">
                                ✏ 已改
                              </span>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemoveCharacterFromGroup(c.character.id, c.character.name)}
                            disabled={removingCharId === c.character.id}
                            title={`從此 group 所有分鏡移除 ${c.character.name}（影響 DB,下次重生會生效）`}
                            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40"
                          >
                            {removingCharId === c.character.id ? (
                              <span className="font-mono text-[12px]">…</span>
                            ) : (
                              <span className="font-mono text-[14px] leading-none">×</span>
                            )}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {groupScenes.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center gap-1 font-mono text-[12px] uppercase tracking-wider text-emerald-500/70">
                    <AppIcon name="image" className="h-3 w-3" />
                    場景 · {groupScenes.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groupScenes.map((s) => {
                      const overridden = locationOverrides[s.location.id] !== undefined
                        && locationOverrides[s.location.id] !== s.viewName
                      const stateClass = overridden
                        ? 'border-violet-500/60 bg-violet-500/10'
                        : 'border-emerald-900/30 bg-stone-950/40'
                      // 2026-05-13 — same refactor as 出場角色: split into
                      // main button + × remove button. Removes scene
                      // from every panel.location in this group.
                      return (
                        <div
                          key={s.location.id}
                          className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-1 transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/10 ${stateClass}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPickerLocation({
                                location: s.location,
                                currentViewName: locationOverrides[s.location.id] !== undefined
                                  ? locationOverrides[s.location.id]
                                  : s.viewName,
                              })
                            }}
                            className="inline-flex items-center gap-1.5 pr-1"
                            title={`${s.location.name} · ${s.viewName ?? '主視角'} — 點擊換視角`}
                          >
                            <div className="relative h-5 w-8 overflow-hidden rounded-sm bg-stone-800">
                              {s.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={s.avatarUrl} alt={s.location.name} className="h-full w-full object-cover" />
                              ) : (
                                <AppIcon name="image" className="h-3 w-3 m-auto text-stone-600" />
                              )}
                            </div>
                            <span className="font-serif-cn text-[14px] text-stone-200">
                              {s.location.name}
                            </span>
                            <span className="font-mono text-[12px] tracking-wider text-emerald-500/70">
                              {s.viewName ?? '主視角'}
                            </span>
                            {overridden ? (
                              <span className="font-mono text-[12px] tracking-wider text-violet-300">
                                ✏ 已改
                              </span>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemoveSceneFromGroup(s.location.id, s.location.name)}
                            disabled={removingSceneId === s.location.id}
                            title={`從此 group 所有分鏡移除場景 ${s.location.name}（影響 DB,下次重生會生效）`}
                            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40"
                          >
                            {removingSceneId === s.location.id ? (
                              <span className="font-mono text-[12px]">…</span>
                            ) : (
                              <span className="font-mono text-[14px] leading-none">×</span>
                            )}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {boundCharacters.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center gap-1 font-mono text-[12px] uppercase tracking-wider text-amber-500/70">
                    <AppIcon name="user" className="h-3 w-3" />
                    演員綁定 · {boundCharacters.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {boundCharacters.map((c) => {
                      const overrideAppearanceId = characterOverrides[c.id]
                      const hasOverride =
                        overrideAppearanceId !== undefined
                        && overrideAppearanceId !== c.appearanceId
                      const stateClass = hasOverride
                        ? 'border-violet-500/60 bg-violet-500/10'
                        : 'border-amber-900/30 bg-stone-950/40'
                      const character = characterById.get(c.id) ?? null
                      const handleClick = () => {
                        if (!character) return
                        const currentAppearanceId =
                          characterOverrides[c.id] !== undefined
                            ? characterOverrides[c.id]
                            : c.appearanceId
                        setPickerCharacter({ character, currentAppearanceId })
                      }
                      const title = hasOverride
                        ? `${c.name} — 下次重生會改用新造型(尚未送出)`
                        : `${c.name} · ${c.appearanceLabel ?? '默認造型'}${character ? ' — 點擊換造型' : ''}`
                      // 2026-05-13 — 演員綁定 chip now also has × remove.
                      // Calls the same handleRemoveCharacterFromGroup as
                      // 出場角色 chip (single source of truth for removal).
                      return (
                        <div
                          key={c.id}
                          className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-1 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10 ${stateClass}`}
                        >
                          <button
                            type="button"
                            onClick={handleClick}
                            disabled={!character}
                            className={`inline-flex items-center gap-1.5 pr-1 ${character ? 'cursor-pointer' : 'cursor-default'}`}
                            title={title}
                          >
                            <div className="relative h-5 w-5 overflow-hidden rounded-full bg-stone-800">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={c.imageUrl}
                                alt={c.name}
                                className="h-full w-full object-cover"
                              />
                            </div>
                            <span className="font-serif-cn text-[14px] text-stone-200">
                              {c.name}
                            </span>
                            <span className="font-mono text-[12px] tracking-wider text-amber-500/70">
                              {c.appearanceLabel ?? '默認造型'}
                            </span>
                            {hasOverride ? (
                              <span className="font-mono text-[12px] tracking-wider text-violet-300">
                                ✏ 已改
                              </span>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemoveCharacterFromGroup(c.id, c.name)}
                            disabled={removingCharId === c.id}
                            title={`從此 group 所有分鏡移除 ${c.name}（影響 DB,下次重生會生效）`}
                            className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-40"
                          >
                            {removingCharId === c.id ? (
                              <span className="font-mono text-[12px]">…</span>
                            ) : (
                              <span className="font-mono text-[14px] leading-none">×</span>
                            )}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="border-t border-stone-800/60 pt-2">
            <button
              type="button"
              onClick={() => setShowAdvancedEditor((v) => !v)}
              className="flex items-center gap-1 font-mono text-[12px] tracking-wider text-stone-500 transition-colors hover:text-amber-400"
            >
              {showAdvancedEditor ? '▼' : '▶'} 進階分鏡編輯({panels.length} 鏡 · 編輯各分鏡描述 / 對白)
            </button>
            {showAdvancedEditor ? (
              <div className="mt-2 space-y-2">
                {panels.map((p, panelIdx) => {
                  const descValue = descDrafts[p.id] ?? ''
                  const dialValue = dialogueDrafts[p.id] ?? ''
                  const descOriginal = p.description ?? p.prompt ?? ''
                  const dialOriginal = p.srtSegment ?? ''
                  const descChanged = descValue !== descOriginal
                  const dialChanged = dialValue !== dialOriginal
                  const isSavingThis = savingPanelId === p.id
                  return (
                    <div
                      key={p.id}
                      className="rounded-sm border border-stone-800/60 bg-stone-950/40 p-2"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[12px] tracking-wider text-amber-500/60">
                            #{String(panelIdx + 1).padStart(2, '0')}
                          </span>
                          {Array.isArray(p.characters) && p.characters.length > 0 ? (
                            <span className="font-mono text-[12px] tracking-wider text-stone-500">
                              {p.characters.join(' / ')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <textarea
                        value={descValue}
                        onChange={(e) =>
                          setDescDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        rows={2}
                        placeholder="鏡頭描述"
                        className="w-full resize-none rounded-sm border border-stone-800 bg-stone-900/40 p-1.5 font-serif-cn text-[12px] leading-relaxed text-stone-200 outline-none focus:border-amber-500/40"
                      />
                      {descChanged ? (
                        <button
                          type="button"
                          disabled={isSavingThis}
                          onClick={() => handleSaveDescription(p.id)}
                          className="mt-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
                        >
                          {isSavingThis ? '儲存中…' : '儲存描述'}
                        </button>
                      ) : null}
                      <div className="mt-1.5">
                        <textarea
                          value={dialValue}
                          onChange={(e) =>
                            setDialogueDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          rows={1}
                          placeholder="對白(可空白)"
                          className="w-full resize-none rounded-sm border border-amber-500/15 bg-amber-500/5 p-1.5 font-serif-cn text-[11px] leading-relaxed italic text-amber-300/80 outline-none focus:border-amber-500/40"
                        />
                        {dialChanged ? (
                          <button
                            type="button"
                            disabled={isSavingThis}
                            onClick={() => handleSaveDialogue(p.id)}
                            className="mt-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:bg-amber-500/20 disabled:opacity-40"
                          >
                            {isSavingThis ? '儲存中…' : '儲存對白'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      </div>
      )}

      <CharacterAppearancePickerModal
        open={pickerCharacter !== null}
        onClose={() => setPickerCharacter(null)}
        character={pickerCharacter?.character ?? null}
        currentAppearanceId={pickerCharacter?.currentAppearanceId ?? null}
        onSelect={(appearanceId) => {
          if (!pickerCharacter) return
          const characterId = pickerCharacter.character.id
          setCharacterOverrides((prev) => ({ ...prev, [characterId]: appearanceId }))
        }}
      />

      <LocationViewPickerModal
        open={pickerLocation !== null}
        onClose={() => setPickerLocation(null)}
        location={pickerLocation?.location ?? null}
        currentViewName={pickerLocation?.currentViewName ?? null}
        onSelect={(viewName) => {
          if (!pickerLocation) return
          const locationId = pickerLocation.location.id
          setLocationOverrides((prev) => ({ ...prev, [locationId]: viewName }))
        }}
      />
    </article>
  )
}

function StyleOverridePreview({ styleId }: { styleId: string }) {
  const style = visualStyles.find((s) => s.id === styleId)
  if (!style) return null
  return style.thumbnailUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={style.thumbnailUrl}
      alt={style.nameZh}
      title={`${style.category} · ${style.nameZh}`}
      loading="lazy"
      className="h-10 w-8 rounded-sm border border-stone-800 object-cover"
    />
  ) : (
    <span
      title={`${style.category} · ${style.nameZh} (縮圖未生成)`}
      className="flex h-10 w-8 items-center justify-center rounded-sm border border-stone-800 bg-stone-900/60 font-mono text-[14px] tracking-wider text-stone-600"
    >
      {style.category}
    </span>
  )
}
