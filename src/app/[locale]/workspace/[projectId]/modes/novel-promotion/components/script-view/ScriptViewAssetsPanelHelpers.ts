import type { CharacterAppearance } from '@/types/project'

export function setsEqual<T>(left: Set<T>, right: Set<T>): boolean {
  if (left.size !== right.size) return false
  for (const item of left) {
    if (!right.has(item)) return false
  }
  return true
}

export function parseAppearanceKey(key: string): { characterId: string; appearanceName: string } | null {
  const separatorIndex = key.indexOf('::')
  if (separatorIndex <= 0) return null
  const characterId = key.slice(0, separatorIndex)
  const appearanceName = key.slice(separatorIndex + 2)
  if (!characterId || !appearanceName) return null
  return { characterId, appearanceName }
}

export function parseLocationNames(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => !!item)
    }
  } catch {
    // fallback to comma-separated format
  }
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => !!item)
}

export function fuzzyMatchLocationName(clipLocName: string, libraryLocName: string): boolean {
  const clipLower = clipLocName.toLowerCase().trim()
  const libraryLower = libraryLocName.toLowerCase().trim()
  if (!clipLower || !libraryLower) return false
  if (clipLower === libraryLower) return true
  if (clipLower.includes(libraryLower)) return true
  if (libraryLower.includes(clipLower)) return true
  return false
}

export function readTrimmedLabel(value: string | undefined, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || fallback
}

export function getAppearancePreviewUrl(appearance: CharacterAppearance): string | null {
  if (appearance.imageUrl) return appearance.imageUrl

  const selectedIndex = appearance.selectedIndex
  if (
    typeof selectedIndex === 'number' &&
    selectedIndex >= 0 &&
    selectedIndex < appearance.imageUrls.length
  ) {
    const selectedUrl = appearance.imageUrls[selectedIndex]
    if (selectedUrl) return selectedUrl
  }

  const firstAvailable = appearance.imageUrls.find((url) => !!url)
  return firstAvailable || null
}
