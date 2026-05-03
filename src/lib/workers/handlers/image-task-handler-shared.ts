import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import {
  resolveImageSourceFromGeneration,
  toSignedUrlIfCos,
  uploadImageSourceToCos,
  withLabelBar,
} from '../utils'
import type { StyleProfile } from '@/lib/style-profile/loader'

export type AnyObj = Record<string, unknown>

interface CharacterAppearanceLike {
  // Phase 11.4 / multi-appearance: id required so the episode-binding
  // override (EpisodeCharacter.appearanceId) can resolve to a concrete
  // appearance row.
  id: string
  appearanceIndex?: number
  changeReason: string | null
  description?: string | null
  descriptions?: string | null
  imageUrls: string | null
  imageUrl: string | null
  selectedIndex: number | null
}

interface CharacterLike {
  // Phase 11.4 / multi-appearance: id required so we can key the
  // episode-binding lookup by characterId.
  id: string
  name: string
  appearances?: CharacterAppearanceLike[]
}

interface LocationImageLike {
  description?: string | null
  imageIndex?: number
  isSelected: boolean
  imageUrl: string | null
}

interface LocationLike {
  name: string
  images?: LocationImageLike[]
}

// Phase 11.3 Stage 2 — props as first-class generation refs.
// PropLike mirrors the slimmed-down view of NovelPromotionProp the
// worker actually needs:imageUrl for reference image collection,
// description (the prompt-friendly visual summary produced by
// extract_props), and name for matching against panel.props.
interface PropLike {
  name: string
  imageUrl: string | null
  description?: string | null
  summary?: string | null
}

interface NovelProjectData {
  videoRatio?: string | null
  characters?: CharacterLike[]
  locations?: LocationLike[]
  props?: PropLike[]
}

interface PanelLike {
  sketchImageUrl?: string | null
  characters?: string | null
  location?: string | null
  // Phase 11.3 Stage 2 — JSON-encoded string array of prop names
  // referenced by this panel. parsePanelPropReferences() parses it.
  props?: string | null
}

export interface PanelCharacterReference {
  name: string
  appearance?: string
}

export interface PanelPropReference {
  name: string
}

interface NovelDataDb {
  novelPromotionProject: {
    findUnique(args: Record<string, unknown>): Promise<NovelProjectData | null>
  }
}

export function parseJsonStringArray(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function parseImageUrls(value: string | null | undefined, fieldName: string): string[] {
  return decodeImageUrlsFromDb(value, fieldName)
}

export function clampCount(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

export async function generateLabeledImageToCos(params: {
  job: Job<TaskJobData>
  userId: string
  modelId: string
  prompt: string
  label: string
  targetId: string
  keyPrefix: string
  options?: {
    referenceImages?: string[]
    aspectRatio?: string
    size?: string
    negativePrompt?: string | null
  }
  // Phase 11.5 / Bug-4: pass raw styleProfile; chokepoint owns prepend + capability filter.
  styleProfile?: StyleProfile | null
}) {
  const source = await resolveImageSourceFromGeneration(params.job, {
    userId: params.userId,
    modelId: params.modelId,
    prompt: params.prompt,
    options: params.options,
    styleProfile: params.styleProfile ?? null,
  })

  const labeled = await withLabelBar(source, params.label)
  const cosKey = await uploadImageSourceToCos(labeled, params.keyPrefix, params.targetId)
  return cosKey
}

export async function resolveNovelData(projectId: string) {
  const db = prisma as unknown as NovelDataDb
  const data = await db.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: { include: { appearances: { orderBy: { appearanceIndex: 'asc' } } } },
      locations: { include: { images: { orderBy: { imageIndex: 'asc' } } } },
      // Phase 11.3 Stage 2 — load props so collectPanelReferenceImages
      // and buildSceneDescription can match panel.props names against
      // the project prop catalog.
      props: true,
    },
  })

  if (!data) {
    throw new Error(`NovelPromotionProject not found: ${projectId}`)
  }

  return data
}

/**
 * Phase 11.3 Stage 2 — parse panel.props JSON.
 *
 * Accepts the same shapes as parsePanelCharacterReferences for consistency:
 *   - string[]                       → [{name}, {name}, ...]
 *   - { name: string }[]             → [{name}, ...]
 *
 * Future-proofed:`appearance` analogue isn't supported here because props
 * don't have appearance variants (a knife is a knife). If we ever add prop
 * variants (knife clean / knife bloody), extend this then.
 *
 * Defensive parse:malformed JSON returns []. Non-string names skipped.
 */
export function parsePanelPropReferences(value: string | null | undefined): PanelPropReference[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return { name: item }
        if (!item || typeof item !== 'object') return null
        const candidate = item as { name?: unknown }
        if (typeof candidate.name === 'string') return { name: candidate.name }
        return null
      })
      .filter(Boolean) as PanelPropReference[]
  } catch {
    return []
  }
}

/**
 * Match a prop reference name to a NovelPromotionProp row by name.
 * Case-insensitive exact match — props don't have "/" alias splitting
 * because their names are object nouns, not character aliases. Returns
 * undefined when nothing matches; caller is expected to skip silently
 * (a panel can list a prop that's been renamed/deleted in the catalog).
 */
export function findPropByName<T extends { name: string }>(props: T[], referenceName: string): T | undefined {
  const refLower = referenceName.toLowerCase().trim()
  if (!refLower) return undefined
  return props.find((p) => p.name.toLowerCase().trim() === refLower)
}

export function parsePanelCharacterReferences(value: string | null | undefined): PanelCharacterReference[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return { name: item }
        if (!item || typeof item !== 'object') return null
        const candidate = item as { name?: unknown; appearance?: unknown }
        if (typeof candidate.name === 'string') {
          return {
            name: candidate.name,
            appearance: typeof candidate.appearance === 'string' ? candidate.appearance : undefined,
          }
        }
        return null
      })
      .filter(Boolean) as PanelCharacterReference[]
  } catch {
    return []
  }
}

/**
 * 按角色名查找角色（支持别名匹配）
 * 优先级：1. 精确全名匹配  2. 按 '/' 拆分后别名精确匹配
 * 例：引用名 "顾娘子" 可匹配角色 "顾娘子/顾盼之"
 */
export function findCharacterByName<T extends { name: string }>(characters: T[], referenceName: string): T | undefined {
  const refLower = referenceName.toLowerCase().trim()
  if (!refLower) return undefined

  // 优先级 1：精确全名匹配
  const exact = characters.find((c) => c.name.toLowerCase().trim() === refLower)
  if (exact) return exact

  // 优先级 2：别名匹配 — 按 '/' 拆分后任一别名精确匹配
  const refAliases = refLower.split('/').map((s) => s.trim()).filter(Boolean)
  for (const character of characters) {
    const charAliases = character.name.toLowerCase().split('/').map((s) => s.trim()).filter(Boolean)
    const hasOverlap = refAliases.some((refAlias) => charAliases.includes(refAlias))
    if (hasOverlap) return character
  }

  return undefined
}

/**
 * For image-editing models (Flux Kontext): use sketch or location image as the base image.
 * Character portraits are NOT included — they would be treated as the base image to edit,
 * producing character-only outputs instead of scenes.
 */
/**
 * Approach B-Standard 場景多視角:把 panel.location 拆成
 *   <locationName>             → 主視角(imageIndex=0)
 *   <locationName>#<viewName>  → 找這個 location 下 viewName 命中的 image
 *
 * panel.location 是 panel 自己的位置欄位。LLM 預設只填 locationName,
 * 但用戶或進階流程可以手動把 panel.location 改成「客廳#窗邊」之類的
 * 帶 view 註記字串。worker 看到 # 就會切。
 *
 * 沒有 # 或 # 後 viewName 沒命中時,fallback 主視角(legacy 行為)。
 */
function parseLocationViewHint(raw: string | null | undefined): { name: string; view: string | null } {
  const text = (raw || '').trim()
  if (!text) return { name: '', view: null }
  const hashIdx = text.indexOf('#')
  if (hashIdx === -1) return { name: text, view: null }
  return {
    name: text.slice(0, hashIdx).trim(),
    view: text.slice(hashIdx + 1).trim() || null,
  }
}

interface LocationImageWithView {
  imageUrl?: string | null
  isSelected?: boolean | null
  viewName?: string | null
}

function pickLocationImageRef(
  images: LocationImageWithView[],
  viewHint: string | null,
): LocationImageWithView | null {
  if (viewHint) {
    const match = images.find((img) => (img.viewName || '').toLowerCase() === viewHint.toLowerCase())
    if (match) return match
  }
  return images.find((img) => img.isSelected) || images[0] || null
}

export async function collectPanelSceneBase(projectData: NovelProjectData, panel: PanelLike) {
  const refs: string[] = []

  // Sketch takes priority as the composition guide
  const sketch = toSignedUrlIfCos(panel.sketchImageUrl, 3600)
  if (sketch) {
    refs.push(sketch)
    return refs
  }

  // Fall back to location/scene image as the base for editing
  if (panel.location) {
    const { name: locName, view: viewHint } = parseLocationViewHint(panel.location)
    const location = (projectData.locations || []).find(
      (loc) => loc.name.toLowerCase() === locName.toLowerCase(),
    )
    if (location) {
      const images = (location.images || []) as LocationImageWithView[]
      const picked = pickLocationImageRef(images, viewHint)
      const signed = toSignedUrlIfCos(picked?.imageUrl, 3600)
      if (signed) refs.push(signed)
    }
  }

  return refs
}

export async function collectPanelReferenceImages(
  projectData: NovelProjectData,
  panel: PanelLike,
  // Phase 11.4 / multi-appearance: when an episodeId is supplied, look
  // up EpisodeCharacter.appearanceId for each character ref and use
  // that appearance instead of appearances[0]. Lets users say
  // "ep1-10 use appearance A, ep11+ use appearance B" without
  // changing the panel character refs themselves.
  episodeId?: string | null,
) {
  const refs: string[] = []

  const sketch = toSignedUrlIfCos(panel.sketchImageUrl, 3600)
  if (sketch) refs.push(sketch)

  // Pre-load EpisodeCharacter bindings for this episode once. Keyed by
  // characterId so the per-character loop below can do a flat lookup.
  let episodeBindings: Map<string, string> = new Map()
  if (episodeId) {
    const rows = await prisma.episodeCharacter.findMany({
      where: { episodeId, appearanceId: { not: null } },
      select: { characterId: true, appearanceId: true },
    })
    for (const row of rows) {
      if (row.appearanceId) episodeBindings.set(row.characterId, row.appearanceId)
    }
  }

  const panelCharacters = parsePanelCharacterReferences(panel.characters)
  for (const item of panelCharacters) {
    const character = findCharacterByName(projectData.characters || [], item.name)
    if (!character) continue

    const appearances = character.appearances || []
    let appearance = appearances[0]
    // Episode-level override wins over both panel-level appearance ref
    // and the default first appearance — UI lets the user fix per-episode
    // costume without rewriting every panel's character reference.
    const boundAppearanceId = episodeBindings.get(character.id)
    if (boundAppearanceId) {
      const bound = appearances.find((a) => a.id === boundAppearanceId)
      if (bound) appearance = bound
    } else if (item.appearance) {
      const matched = appearances.find((a) => (a.changeReason || '').toLowerCase() === item.appearance!.toLowerCase())
      if (matched) appearance = matched
    }

    if (!appearance) continue

    const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
    const selectedIndex = appearance.selectedIndex
    const selectedUrl = selectedIndex !== null && selectedIndex !== undefined ? imageUrls[selectedIndex] : null
    const key = selectedUrl || imageUrls[0] || appearance.imageUrl
    const signed = toSignedUrlIfCos(key, 3600)
    if (signed) refs.push(signed)
  }

  if (panel.location) {
    const { name: locName, view: viewHint } = parseLocationViewHint(panel.location)
    const location = (projectData.locations || []).find((loc) => loc.name.toLowerCase() === locName.toLowerCase())
    if (location) {
      const images = (location.images || []) as LocationImageWithView[]
      const picked = pickLocationImageRef(images, viewHint)
      const signed = toSignedUrlIfCos(picked?.imageUrl, 3600)
      if (signed) refs.push(signed)
    }
  }

  // Phase 11.3 Stage 2 — props as generation references.
  // Same shape as character refs:look up each panel.props name in the
  // project prop catalog, sign the prop's imageUrl if it's a COS key,
  // and append. Missing props are silently skipped (catalog mutation
  // can outpace panel data — a deleted prop shouldn't kill the gen).
  // Order:characters → location → props matches the prompt order
  // buildSceneDescription emits, so the AI sees refs in the same
  // sequence it reads them about.
  const panelProps = parsePanelPropReferences(panel.props)
  for (const item of panelProps) {
    const prop = findPropByName(projectData.props || [], item.name)
    if (!prop?.imageUrl) continue
    const signed = toSignedUrlIfCos(prop.imageUrl, 3600)
    if (signed) refs.push(signed)
  }

  return refs
}
