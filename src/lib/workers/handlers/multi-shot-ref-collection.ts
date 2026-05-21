/**
 * Shared multi-shot reference collection helpers.
 *
 * Both the BobAPI Seedance composite path and the AtlasCloud Seedance 2.0
 * composite path need to walk a panel group and resolve:
 *   - Character refs (panel.characters → projectData.characters[].appearances)
 *   - Scene refs    (panel.location  → projectData.locations[].images)
 *   - Prop refs     (panel.props     → projectData.props[].imageUrl)
 *
 * Originally this lived inside multi-shot-video-seedance-path.ts as
 * private helpers; multi-shot-video-atlascloud-path.ts re-implemented
 * the first two and missed props entirely. Pulling them into a shared
 * module guarantees both worker paths see the same dedup, capacity, and
 * appearance-resolution rules — so the chip rail bindings and the
 * actual API request stay in lockstep.
 *
 * The caller decides how to *use* the refs (BobAPI dumps them into a
 * content[] array with @N markers; AtlasCloud routes char→scene→prop
 * into a flat reference_images[] for r2v, or inlines their descriptions
 * into the prompt for t2v/i2v).
 */

import {
  findCharacterByName,
  parsePanelCharacterReferences,
  parsePanelPropReferences,
  findPropByName,
  parseImageUrls,
  resolveNovelData,
} from './image-task-handler-shared'
import { toSignedUrlIfCos } from '../utils'

/** Panel shape the collectors need. Loosely typed so both worker paths
 *  can pass their own panel projections (which select different field
 *  sets from prisma but all include these). */
export interface RefCollectionPanel {
  id: string
  description: string | null
  videoPrompt: string | null
  characters: string | null
  /** Panel.props JSON — parsed via parsePanelPropReferences(). */
  props?: string | null
  location: string | null
}

export interface CharacterRef {
  id: string
  name: string
  imageUrl: string
}

export interface SceneRef {
  id: string
  name: string
  imageUrl: string
}

export interface PropRef {
  id: string
  name: string
  imageUrl: string
}

/** Default caps — callers can override but matching the existing
 *  BobAPI seedance-path defaults keeps behavior consistent. */
export const DEFAULT_MAX_CHARACTER_REFS = 4
export const DEFAULT_MAX_SCENE_REFS = 2
export const DEFAULT_MAX_PROP_REFS = 3

type NovelData = Awaited<ReturnType<typeof resolveNovelData>>

interface LocationImageRow {
  id?: string
  imageIndex?: number
  isSelected?: boolean
  imageUrl?: string | null
  viewName?: string | null
}
interface LocationRow {
  id: string
  name: string
  images?: LocationImageRow[]
}

/**
 * Collect unique character refs.
 *
 * Two-pass priority (matches BobAPI seedance-path's behavior):
 *   1. Pass 1 — panel.characters JSON references with explicit name +
 *      optional appearance hint. Episode-level appearance bindings +
 *      per-call overrides win when present.
 *   2. Pass 2 — description-mining fallback. For panels where
 *      panel.characters is empty but the description / videoPrompt
 *      mentions a project character by name (with `/`-separated
 *      aliases respected), pull them in so identity still anchors
 *      even when the storyboard parser missed the cast field.
 */
export function collectCharacterRefs(
  panels: RefCollectionPanel[],
  projectData: NovelData,
  episodeBindings: Map<string, string>,
  maxRefs: number = DEFAULT_MAX_CHARACTER_REFS,
): CharacterRef[] {
  const refs: CharacterRef[] = []
  const seenIds = new Set<string>()

  // Pass 1: explicit panel.characters references.
  for (const panel of panels) {
    if (refs.length >= maxRefs) break
    const charRefs = parsePanelCharacterReferences(panel.characters)
    for (const ref of charRefs) {
      if (refs.length >= maxRefs) break
      const character = findCharacterByName(projectData.characters || [], ref.name)
      if (!character) continue
      if (seenIds.has(character.id)) continue
      const appearances = character.appearances || []
      let appearance = appearances[0]
      const boundAppearanceId = episodeBindings.get(character.id)
      if (ref.appearance) {
        const matched = appearances.find(
          (a) => (a.changeReason || '').toLowerCase() === ref.appearance!.toLowerCase(),
        )
        if (matched) appearance = matched
        else if (boundAppearanceId) {
          const bound = appearances.find((a) => a.id === boundAppearanceId)
          if (bound) appearance = bound
        }
      } else if (boundAppearanceId) {
        const bound = appearances.find((a) => a.id === boundAppearanceId)
        if (bound) appearance = bound
      }
      if (!appearance) continue
      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl =
        selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      const imageKey = selectedUrl || imageUrls[0] || appearance.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)
      if (!publicUrl) continue
      seenIds.add(character.id)
      refs.push({ id: character.id, name: ref.name, imageUrl: publicUrl })
    }
  }

  // Pass 2: description-mining fallback.
  for (const panel of panels) {
    if (refs.length >= maxRefs) break
    const desc = `${panel.description ?? ''}\n${panel.videoPrompt ?? ''}`.trim()
    if (!desc) continue
    for (const character of projectData.characters ?? []) {
      if (refs.length >= maxRefs) break
      if (seenIds.has(character.id)) continue
      const aliases = character.name.split('/').map((s) => s.trim()).filter(Boolean)
      const hit = aliases.some((alias) => alias && desc.includes(alias))
      if (!hit) continue
      const appearances = character.appearances || []
      let appearance = appearances[0]
      const boundAppearanceId = episodeBindings.get(character.id)
      if (boundAppearanceId) {
        const bound = appearances.find((a) => a.id === boundAppearanceId)
        if (bound) appearance = bound
      }
      if (!appearance) continue
      const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
      const selectedIndex = appearance.selectedIndex
      const selectedUrl =
        selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
      const imageKey = selectedUrl || imageUrls[0] || appearance.imageUrl
      const publicUrl = toSignedUrlIfCos(imageKey, 7200)
      if (!publicUrl) continue
      seenIds.add(character.id)
      refs.push({ id: character.id, name: character.name, imageUrl: publicUrl })
    }
  }
  return refs
}

/**
 * Collect unique scene refs from panel.location strings.
 *
 * panel.location format: `<name>` or `<name>#<viewHint>`. viewHint
 * picks a specific image inside the location's images[]; per-call
 * locOverrideById wins over the hint.
 */
export function collectSceneRefs(
  panels: RefCollectionPanel[],
  projectData: NovelData,
  locOverrideById: Map<string, string>,
  maxRefs: number = DEFAULT_MAX_SCENE_REFS,
): SceneRef[] {
  const refs: SceneRef[] = []
  const seenIds = new Set<string>()
  const locations = (projectData.locations as unknown as LocationRow[] | undefined) ?? []
  if (locations.length === 0) return refs
  for (const panel of panels) {
    if (refs.length >= maxRefs) break
    if (!panel.location) continue
    const hashIdx = panel.location.indexOf('#')
    const locName = (hashIdx === -1 ? panel.location : panel.location.slice(0, hashIdx)).trim()
    if (!locName) continue
    const loc = locations.find((l) => l.name.toLowerCase() === locName.toLowerCase())
    if (!loc) continue
    if (seenIds.has(loc.id)) continue
    const panelViewHint = hashIdx === -1 ? null : panel.location.slice(hashIdx + 1).trim()
    const overrideViewName = locOverrideById.get(loc.id)
    const effectiveView = (overrideViewName ?? panelViewHint) || null
    const images = loc.images ?? []
    const viewMatch = effectiveView
      ? images.find((img) => (img.viewName || '').trim().toLowerCase() === effectiveView.toLowerCase())
      : null
    const selected = images.find((img) => img.isSelected === true)
    const primary = images.find((img) => (img.imageIndex ?? 0) === 0) ?? images[0]
    const pickedImg = viewMatch || selected || primary
    const pickedRaw = pickedImg?.imageUrl
    const publicUrl = toSignedUrlIfCos(pickedRaw, 7200)
    if (!publicUrl) continue
    seenIds.add(loc.id)
    refs.push({ id: loc.id, name: loc.name, imageUrl: publicUrl })
  }
  return refs
}

/**
 * Collect unique prop refs from panel.props JSON.
 *
 * Mirrors b-path's prop pipeline (multi-shot-video-b-path.ts:1538+):
 * dedup by prop.id, skip props without imageUrl (catalog entry exists
 * but image not yet generated), sign COS keys.
 */
interface PropRow {
  id: string
  name: string
  imageUrl?: string | null
}

export function collectPropRefs(
  panels: RefCollectionPanel[],
  projectData: NovelData,
  maxRefs: number = DEFAULT_MAX_PROP_REFS,
): PropRef[] {
  const refs: PropRef[] = []
  const seenIds = new Set<string>()
  // Shared NovelData.PropLike is narrow (only `name` surfaced for image
  // handlers); the prisma include carries id + imageUrl at runtime —
  // cast through unknown to PropRow, same pattern multi-shot-video-handler
  // uses for locations.
  const propsCatalog = (projectData.props as unknown as PropRow[] | undefined) ?? []
  if (propsCatalog.length === 0) return refs
  for (const panel of panels) {
    if (refs.length >= maxRefs) break
    if (!panel.props) continue
    const propRefs = parsePanelPropReferences(panel.props)
    for (const ref of propRefs) {
      if (refs.length >= maxRefs) break
      const prop = findPropByName(propsCatalog, ref.name)
      if (!prop) continue
      if (seenIds.has(prop.id)) continue
      if (!prop.imageUrl) continue
      const publicUrl = toSignedUrlIfCos(prop.imageUrl, 7200)
      if (!publicUrl) continue
      seenIds.add(prop.id)
      refs.push({ id: prop.id, name: prop.name, imageUrl: publicUrl })
    }
  }
  return refs
}
