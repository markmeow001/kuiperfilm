/**
 * Phase 11.1: 純函式工具 — 挑劇集縮圖。
 *
 * 純函式：只看資料、不做 IO、不 mutate 入參。
 *
 * 規則（依優先順序）：
 *   1. 第一個 storyboard 的第一個 panel.imageUrl（如果非空）
 *   2. 第一個 shot.imageUrl（如果非空）
 *   3. null
 */

export interface ThumbnailInput {
  storyboards: ReadonlyArray<{
    panels: ReadonlyArray<{ imageUrl: string | null }>
  }>
  shots: ReadonlyArray<{ imageUrl: string | null }>
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function pickEpisodeThumbnail(input: ThumbnailInput): string | null {
  for (const storyboard of input.storyboards) {
    for (const panel of storyboard.panels) {
      const url = nonEmpty(panel.imageUrl)
      if (url) return url
    }
  }

  for (const shot of input.shots) {
    const url = nonEmpty(shot.imageUrl)
    if (url) return url
  }

  return null
}
