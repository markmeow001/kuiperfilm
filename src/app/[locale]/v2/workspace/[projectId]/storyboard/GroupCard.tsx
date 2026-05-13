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
import {
  useMultiShotTask,
  type MultiShotCharacterBinding,
} from '@/lib/query/hooks/useMultiShotTask'
import type { UseMutationResult } from '@tanstack/react-query'

interface PanelCharacterRef {
  name: string
  appearance?: string
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
  { panelId: string; description?: string; srtSegment?: string }
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
   * Approximate per-group runtime in seconds. Used to compute a
   * cumulative time range badge in the collapsed header so the
   * editor reads like the Seedance 2.0 video plan UI the user
   * referenced. Defaults to 15s when not provided.
   */
  segmentDurationSeconds?: number
  /**
   * Episode number (1-indexed) — folded into the download filename
   * as `ep{N}_group{NN}.mp4` so user keeps a sane archive across
   * multi-episode projects.
   */
  episodeNumber?: number | null
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
  segmentDurationSeconds = 15,
  episodeNumber,
  onRegenerate,
}: GroupCardProps) {
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
        if (!name) continue
        const lower = name.trim().toLowerCase()
        if (!lower || seen.has(lower)) continue
        const char = (characterRoster ?? []).find(
          (c) => c.name.toLowerCase().trim() === lower,
        )
        if (!char) continue
        seen.add(lower)
        const appearances = char.appearances ?? []
        const overrideId = characterOverrides[char.id]
        const chosen = overrideId
          ? appearances.find((a) => a.id === overrideId) ?? appearances[0]
          : appearances[0]
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
  }, [panels, characterRoster, characterOverrides])
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
  const [totalDurationDraft, setTotalDurationDraft] = useState<number>(15)

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
  // Photorealistic preset — matches lib/style-profile/presets.ts
  // 'realistic' positivePrompt. If the project ever uses a different
  // preset (anime / 3D / etc.) the user can edit this block out.
  const STYLE_FOOTER_REALISTIC = [
    '整体视觉风格：',
    'photorealistic, hyperrealistic, cinematic lighting, volumetric lighting,',
    'realistic subsurface scattering, film grain, 8K detail, real skin texture,',
    'real fabric physics, dramatic yet natural lighting, shot on Arri Alexa 65,',
    'IMAX quality, no cartoonish glow, no plastic look, no 3D render feel,',
    'no text, no subtitles, no letters, no words, no on-screen text of any kind,',
    'clean visual only',
  ].join('\n')
  const ANTI_TEXT_LINE = '严格无任何字幕、文字、logo或屏幕信息。'

  const buildInitialNarrative = (): string => {
    const count = panels.length
    if (count === 0) return ''
    const total = totalDurationDraft
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

    // 2026-05-13 — IMPORTANT: Tencent VOD AIGC 接入指南 §3.9.4 says Kling
    // 3.0-Omni parses `<<<image_N>>>` as the LITERAL binding marker;
    // Chinese phrases like 「参考图片1的[王玄]」 are treated as natural
    // language and do NOT bind. Emit the binding tokens directly so the
    // textarea is WYSIWYG for Kling, with the human name in parens for
    // user readability.
    //
    //   header  → "<<<image_1>>>（即[王玄]，角色锚点，高度一致）"
    //   shotbind → "[出场：<<<image_1>>>（即王玄），<<<image_2>>>（即李四）]"
    //   desc    → 「王玄」 substring is pre-substituted to "<<<image_1>>>"
    //              (defensive — worker also does this, but emitting it
    //               here makes the textarea match what Kling actually sees)
    //   dialog  → NEVER substituted. Tencent doc explicitly says
    //              "Dialogue speakers 不能替換，Kling TTS parser 不認
    //               `<<<image_N>>>说："..."`"
    const charNameToRefSlot = new Map<string, number>()
    for (const cast of charsToAnchor) {
      header.push(`<<<image_${refSlot}>>>（即[${cast.character.name}]，角色锚点，高度一致）`)
      charNameToRefSlot.set(cast.character.name.trim().toLowerCase(), refSlot)
      refSlot++
    }
    const sceneNameToRefSlot = new Map<string, number>()
    for (const scene of scenesToAnchor) {
      const sceneLabel = scene.viewName ? `${scene.location.name}·${scene.viewName}` : scene.location.name
      header.push(`<<<image_${refSlot}>>>（即${sceneLabel}，场景锚点，高度一致）`)
      sceneNameToRefSlot.set(scene.location.name.trim().toLowerCase(), refSlot)
      refSlot++
    }

    // Build a sorted name list (longest first) for substring substitution
    // inside descriptions. Mirrors the worker's substituteImageRefs order
    // so frontend and worker produce identical output.
    const nameSlotPairs: Array<{ name: string; slot: number }> = []
    for (const [name, slot] of charNameToRefSlot.entries()) {
      nameSlotPairs.push({ name, slot })
    }
    for (const [name, slot] of sceneNameToRefSlot.entries()) {
      nameSlotPairs.push({ name, slot })
    }
    nameSlotPairs.sort((a, b) => b.name.length - a.name.length)

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const substituteRefsInDesc = (text: string): string => {
      if (!text || nameSlotPairs.length === 0) return text
      let out = text
      for (const { name, slot } of nameSlotPairs) {
        out = out.replace(new RegExp(escapeRegex(name), 'gi'), `<<<image_${slot}>>>`)
      }
      return out
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
      const dialog = (p.srtSegment ?? '').trim()

      // Derive framing from panel.shotType when available, else 'shot N'
      const shotTypeRaw = p.shotType?.trim() ?? ''
      const framing = SHOT_TYPE_TO_FRAMING[shotTypeRaw] ?? '场景'

      // Derive camera move
      const cameraMoveRaw = p.cameraMove?.trim() ?? ''
      const cameraMoveEn = CAMERA_MOVE_TO_EN[cameraMoveRaw] ?? cameraMoveRaw

      // Per-shot binding line: explicit `<<<image_N>>>` literal tokens
      // for characters/scenes present in this panel. Kling 3.0-Omni
      // parses these as binding markers; the chinese-name parens are
      // for the user reading the textarea. Names NOT in the cap (>3)
      // fall through to the worker's "另一人" anonymization.
      const shotCharBindings: string[] = []
      const seenInShot = new Set<string>()
      for (const charName of extractPanelCharNames(p)) {
        const lower = charName.toLowerCase()
        if (seenInShot.has(lower)) continue
        seenInShot.add(lower)
        const slot = charNameToRefSlot.get(lower)
        if (slot !== undefined) shotCharBindings.push(`<<<image_${slot}>>>（即${charName}）`)
      }
      const shotBindingFragments: string[] = []
      if (shotCharBindings.length > 0) {
        shotBindingFragments.push(`出场：${shotCharBindings.join('，')}`)
      }
      const panelLocRaw = (p as { location?: string | null }).location ?? ''
      const panelLocName = panelLocRaw.includes('#')
        ? panelLocRaw.slice(0, panelLocRaw.indexOf('#')).trim()
        : panelLocRaw.trim()
      if (panelLocName) {
        const slot = sceneNameToRefSlot.get(panelLocName.toLowerCase())
        if (slot !== undefined) {
          shotBindingFragments.push(`场景：<<<image_${slot}>>>（即${panelLocName}）`)
        } else {
          shotBindingFragments.push(`场景：${panelLocName}`)
        }
      }

      // Pre-substitute character/scene names INSIDE the description
      // prose so the textarea matches Kling's view. Dialogue line is
      // left untouched (TTS speaker parser requires bare name).
      const descSubstituted = desc ? substituteRefsInDesc(desc) : ''

      const blockLines: string[] = []
      blockLines.push(`镜头${i + 1}（${start}-${end} seconds）·${framing}`)
      if (shotBindingFragments.length > 0) {
        blockLines.push(`[${shotBindingFragments.join('] [')}]`)
      }
      if (descSubstituted) blockLines.push(descSubstituted)
      if (dialog) blockLines.push(dialog)
      if (cameraMoveEn) blockLines.push(`镜头：${cameraMoveEn}`)
      blockLines.push(ANTI_TEXT_LINE)
      shotBlocks.push(blockLines.join('\n'))
    }

    const sections: string[] = []
    if (header.length > 0) sections.push(header.join('\n'))
    sections.push(shotBlocks.join('\n\n'))
    sections.push(STYLE_FOOTER_REALISTIC)
    return sections.join('\n\n')
  }
  const [narrativeDraft, setNarrativeDraft] = useState<string>('')
  const [narrativeDirty, setNarrativeDirty] = useState<boolean>(false)
  const [narrativeRegenFlash, setNarrativeRegenFlash] = useState<boolean>(false)
  const narrativeTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  // Re-seed the narrative when panels, duration, cast, or scenes change AND
  // the user hasn't edited it locally — avoids clobbering an in-progress edit.
  // groupCast/groupScenes are included so chip overrides re-trigger seed.
  useEffect(() => {
    if (narrativeDirty) return
    setNarrativeDraft(buildInitialNarrative())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels, totalDurationDraft, groupCast, groupScenes])

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
  async function handleRegenerate() {
    if (panels.length < 2) {
      setRegenState({ status: 'error', message: '至少需要 2 鏡才能跑多鏡頭' })
      return
    }
    if (panels.length > 6) {
      setRegenState({ status: 'error', message: '一組最多 6 鏡(會送前 6 個)' })
    } else {
      setRegenState({ status: 'submitting' })
    }
    const ids = panels.slice(0, 6).map((p) => p.id)
    // Phase 2: distribute the segment's total duration evenly across
    // its panel slices. Worker enters customize mode when
    // panelDurations is present so each multi_prompt[] entry gets the
    // right per-shot anchor in Kling Omni.
    const panelDurations: number[] = (() => {
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
    // 2026-05-13 — two coordinated changes from the original gate:
    //
    // 1. Drop narrativeDirty check. The auto-seeded cinematic
    //    narrative (五要素導演法) IS the desired baseline submit —
    //    silently discarding it when user hasn't typed defeats the
    //    whole point of having a strong default. Always send rawPrompt
    //    when there's content.
    //
    // 2. When sending rawPrompt, OMIT panelDurations. Worker line 820
    //    promotes to customize mode whenever panelDurations is set,
    //    and customize mode reads per-shot prompts from panel.description
    //    (NOT from rawPrompt) — Tencent treats the top-level Prompt
    //    as semantically ignored in customize mode. So sending both
    //    would silently ignore rawPrompt and use the bare panel desc.
    //    Letting worker run intelligence mode means it actually feeds
    //    our cinematic narrative to Kling Omni's parser, which respects
    //    embedded time markers like "镜头1（0-8 seconds）".
    const sendRaw = trimmedNarrative.length > 0
    const overrides: GroupRegenOverrides = {
      ...(sendRaw ? { rawPrompt: trimmedNarrative } : { panelDurations }),
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

  // Cumulative time range for the segment header. groupOrdinal is
  // 1-indexed and we model each segment as `segmentDurationSeconds`
  // long until the user customises panelDurations (Phase 2).
  const segmentStart = (groupOrdinal - 1) * segmentDurationSeconds
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
              disabled={regenState.status === 'submitting' || panels.length < 2}
              onClick={(e) => {
                e.stopPropagation()
                void handleRegenerate()
              }}
              title="重新送這個 group 跑 Kling 多鏡頭"
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
              {regenState.status === 'submitting'
                ? '送出中…'
                : regenState.status === 'done'
                  ? '✓ 已送出'
                  : regenState.status === 'error'
                    ? '⚠ 失敗,點重試'
                    : '重新生成'}
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
              送 Kling 中…task 已 queue,大約 30 秒進到 worker。Kling Omni 算 3-5 分鐘出影片,完成後左邊會自動刷新。
            </div>
          </div>
        ) : regenState.status === 'done' ? (
          <div className="flex items-center gap-2 rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
            <AppIcon name="check" className="h-3 w-3 text-emerald-300" />
            <div className="font-serif-cn text-[12px] text-emerald-200">
              ✓ 已送出 — Kling Omni 大約 3-5 分鐘出影片,進度會顯示在左邊綁定區。可以同時去其他 group 編輯。
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
              className="rounded-sm border border-rose-500/50 bg-rose-500/15 px-2 py-0.5 font-mono text-[12px] tracking-wider text-rose-200 transition-colors hover:bg-rose-500/25"
            >
              重試
            </button>
          </div>
        ) : null}

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-5">
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

        <div className="col-span-12 space-y-3 lg:col-span-7">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-amber-500/70">
              <AppIcon name="sparklesAlt" className="h-3 w-3" />
              叙事提示词
              <span className="text-stone-500">· {narrativeDraft.length} 字</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 font-mono text-[12px] uppercase tracking-wider text-stone-400">
                <AppIcon name="play" className="h-3 w-3" />
                时长
                <select
                  value={totalDurationDraft}
                  onChange={(e) => {
                    setTotalDurationDraft(Number.parseInt(e.target.value, 10) || 15)
                    // Re-seed narrative so the time slices match the
                    // new total. Skipped when the user has dirty edits
                    // — protected by buildInitialNarrative guard.
                    setNarrativeDirty(false)
                  }}
                  className="rounded-sm border border-stone-800 bg-stone-900 px-1.5 py-0.5 font-mono text-[14px] text-stone-200 outline-none focus:border-amber-500/40"
                >
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                  <option value={15}>15s</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  // Force a visible refresh even when the regenerated string
                  // is byte-identical: clear first, then set on next tick so
                  // React doesn't bail out via Object.is equality check.
                  const fresh = buildInitialNarrative()
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
                title="從分鏡描述+綁定角色/場景重新生成這段敘事"
                className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-[12px] tracking-wider text-amber-300 transition-colors hover:border-amber-500/60 hover:bg-amber-500/20 hover:text-amber-200"
              >
                ↻ 重生敘事
              </button>
            </div>
          </div>

          <textarea
            ref={narrativeTextareaRef}
            value={narrativeDraft}
            onChange={(e) => {
              setNarrativeDraft(e.target.value)
              setNarrativeDirty(true)
            }}
            rows={panels.length >= 4 ? 14 : 9}
            placeholder="0-5 seconds: 角色 + 場景 + 動作 + 鏡頭 + 氛圍&#10;5-10 seconds: ...&#10;10-15 seconds: ..."
            className={`w-full resize-none rounded-sm border bg-stone-900/40 p-2.5 font-serif-cn text-[12px] leading-relaxed text-stone-200 outline-none focus:border-amber-500/40 transition-colors ${
              narrativeRegenFlash ? 'border-emerald-500 ring-2 ring-emerald-500/40' : 'border-stone-800'
            }`}
          />
          {narrativeDirty ? (
            <div className="font-mono text-[12px] tracking-wider text-violet-300">
              ✏ 敘事已修改 — 「重新生成」會以這段為主 prompt(覆蓋分鏡描述)
            </div>
          ) : (
            <div className="font-mono text-[12px] tracking-wider text-stone-600">
              預設由 {panels.length} 個分鏡描述自動拼接。直接編輯這段即可,送出時會以你寫的為準。
            </div>
          )}

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
                      return (
                        <button
                          key={c.character.id}
                          type="button"
                          onClick={() => {
                            setPickerCharacter({
                              character: c.character,
                              currentAppearanceId: characterOverrides[c.character.id] !== undefined
                                ? characterOverrides[c.character.id]
                                : c.appearanceId,
                            })
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10 ${stateClass}`}
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
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {groupScenes.length > 0 ? (
                <div>
                  <div className="mb-1 flex items-center gap-1 font-mono text-[12px] uppercase tracking-wider text-amber-500/70">
                    <AppIcon name="image" className="h-3 w-3" />
                    場景 · {groupScenes.length}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groupScenes.map((s) => {
                      const overridden = locationOverrides[s.location.id] !== undefined
                        && locationOverrides[s.location.id] !== s.viewName
                      const stateClass = overridden
                        ? 'border-violet-500/60 bg-violet-500/10'
                        : 'border-amber-900/30 bg-stone-950/40'
                      return (
                        <button
                          key={s.location.id}
                          type="button"
                          onClick={() => {
                            setPickerLocation({
                              location: s.location,
                              currentViewName: locationOverrides[s.location.id] !== undefined
                                ? locationOverrides[s.location.id]
                                : s.viewName,
                            })
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 transition-colors hover:border-amber-500/60 hover:bg-amber-500/10 ${stateClass}`}
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
                          <span className="font-mono text-[12px] tracking-wider text-amber-500/70">
                            {s.viewName ?? '主視角'}
                          </span>
                          {overridden ? (
                            <span className="font-mono text-[12px] tracking-wider text-violet-300">
                              ✏ 已改
                            </span>
                          ) : null}
                        </button>
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
                      const className = `inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 transition-colors ${
                        character ? 'cursor-pointer hover:border-amber-500/60 hover:bg-amber-500/10' : ''
                      } ${stateClass}`
                      const inner = (
                        <>
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
                        </>
                      )
                      return character ? (
                        <button
                          key={c.id}
                          type="button"
                          onClick={handleClick}
                          className={className}
                          title={title}
                        >
                          {inner}
                        </button>
                      ) : (
                        <div key={c.id} className={className} title={title}>
                          {inner}
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
