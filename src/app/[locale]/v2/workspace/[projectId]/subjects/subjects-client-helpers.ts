/**
 * Phase 1 step 2 — pure, closure-independent pieces hoisted out of
 * V2SubjectsClient.tsx (same convention as storyboard-client-helpers.ts).
 *
 * Holds the tab union, the local data-shape types (Character* / Location*),
 * the SubjectGrid card model (SubjectItem), and the two pure image-pickers.
 * Nothing here touches component state / closures / hooks, so the relocation
 * is fully verified by tsc with zero behaviour change.
 */

export type Tab = 'character' | 'scene' | 'prop'

export interface V2SubjectsClientProps {
  projectId: string
  locale: string
}

export interface CharacterAppearanceLike {
  id: string
  appearanceIndex?: number
  description?: string | null
  changeReason?: string | null
  imageUrl?: string | null
  // After /api/.../assets the server has already signed each entry and
  // converted the field from a JSON-string to an array. The raw DB shape
  // is JSON-string, so accept both forms here defensively.
  imageUrls?: string | string[] | null
  arkAssetId?: string | null
  arkAssetStatus?: string | null
  arkAssetSourceUrl?: string | null
  arkAssetError?: string | null
}

export interface CharacterLike {
  id: string
  name?: string | null
  role?: string | null
  description?: string | null
  // Character.introduction (身份/關係/稱呼映射) is the human-readable
  // role description produced by analyze-novel. Used as the primary
  // source for the card's role text now that it's persisted again.
  introduction?: string | null
  imageUrl?: string | null
  profileConfirmed?: boolean | null
  appearances?: CharacterAppearanceLike[] | null
  // Voice reference + LLM-extracted profile JSON. Surfaced in the
  // V2CharacterEditModal as the audio uploader and the tag chips.
  customVoiceUrl?: string | null
  voiceId?: string | null
  voiceType?: string | null
  profileData?: string | null
}

export interface LocationLike {
  id: string
  name?: string | null
  summary?: string | null
  description?: string | null
  imageUrl?: string | null
  images?: Array<{
    id?: string
    imageIndex?: number | null
    viewName?: string | null
    description?: string | null
    imageUrl?: string | null
  }> | null
}

export function pickCharacterImage(c: CharacterLike): string | null {
  // Character itself doesn't carry imageUrl in the schema, but the legacy
  // payload sometimes attached one — keep the fallback for safety.
  if (c.imageUrl) return c.imageUrl
  const first = c.appearances?.[0]
  if (!first) return null
  // Prefer the appearance's singular imageUrl (already signed by attach).
  if (first.imageUrl) return first.imageUrl
  // Else read from imageUrls. The API returns an Array<string> after
  // signing; the raw DB shape is a JSON-string. Handle both.
  const raw = first.imageUrls
  if (!raw) return null
  if (Array.isArray(raw)) {
    return raw.find((u) => typeof u === 'string' && u.length > 0) || null
  }
  try {
    const parsed = JSON.parse(raw) as string[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null
  } catch {
    return null
  }
}

export function pickCharacterAppearanceImage(
  appearance: CharacterAppearanceLike | null | undefined,
): string | null {
  if (!appearance) return null
  if (appearance.imageUrl) return appearance.imageUrl
  const raw = appearance.imageUrls
  if (!raw) return null
  if (Array.isArray(raw)) {
    return raw.find((url) => typeof url === 'string' && url.length > 0) ?? null
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.find((url): url is string => typeof url === 'string' && url.length > 0) ?? null
      : null
  } catch {
    return raw.length > 0 ? raw : null
  }
}

export function pickLocationImage(l: LocationLike): string | null {
  if (l.imageUrl) return l.imageUrl
  const found = l.images?.find((img) => Boolean(img.imageUrl))
  return found?.imageUrl ?? null
}

export interface SubjectItem {
  id: string
  targetId: string
  name: string
  caption: string
  // Role/identity description (Character.introduction). User-friendly,
  // shown as a subtitle under the name.
  description: string | null
  // Image-generation prompt (Appearance.description). What the inline
  // editor mutates and what the regen worker feeds to the image model.
  visualPrompt?: string | null
  imageUrl: string | null
  appearanceStatus?: {
    label: string
    tone: 'info' | 'warning' | 'error'
  }
  onRegenerate?: () => void
  isRegenerating?: boolean
  isLocked?: boolean
  onLock?: () => void
  isLocking?: boolean
  lockError?: string | null
  onUpload?: (file: File) => void
  isUploading?: boolean
  onZoom?: (url: string) => void
  // Open the full edit modal (character cards only).
  onOpenEditor?: () => void
  // Visual-prompt editor (character cards only).
  onEditDescription?: () => void
  isEditingDescription?: boolean
  descriptionDraft?: string
  onDescriptionDraftChange?: (next: string) => void
  onDescriptionSave?: () => void
  onDescriptionCancel?: () => void
  isSavingDescription?: boolean
  // Vision-rewrite description from current uploaded image (character only).
  // For legacy appearances whose description was written before the
  // upload-time auto-rewrite path landed.
  onRedescribe?: () => void
  isRedescribing?: boolean
  // 2026-05-23 Phase 3 — 火山方舟 asset registration state for the
  // primary appearance (character cards) / primary image (scene/prop).
  // When ark hooks resolve, the SubjectGrid renders ArkAssetRegisterChip
  // in the card footer so the user sees status without diving into the
  // edit modal. arkTargetType / arkTargetId identify which row to mutate
  // when the chip's register button is clicked.
  arkTargetType?: 'CharacterAppearance' | 'LocationImage' | 'NovelPromotionProp'
  arkTargetId?: string | null
  arkAssetId?: string | null
  arkAssetStatus?: string | null
  arkAssetSourceUrl?: string | null
  arkAssetError?: string | null
  onArkRegister?: (args: {
    targetType: 'CharacterAppearance' | 'LocationImage' | 'NovelPromotionProp'
    targetId: string
  }) => Promise<void> | void
}
