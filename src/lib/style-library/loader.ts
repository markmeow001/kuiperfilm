// Phase C (2026-05-13) — resolve a project's VisualStyle + LightingPreset.
//
// Reads visualStyleId / lightingPresetId from NovelPromotionProject and
// returns the in-memory definitions from the curated library. The library
// arrays (visual-styles.ts / lighting-presets.ts) are the source of truth
// for shape; the DB rows mirror them so future UIs can paginate without
// shipping the TS bundle to the browser.
//
// Returns null when the project has no library selection — caller should
// fall back to existing styleProfile / styleRefBinding behaviour.

import type { PrismaClient } from '@prisma/client'
import type { LightingPreset, VisualStyle } from './types'
import { getLighting, getStyle } from './prompt-builder'
import { visualStyles } from './visual-styles'
import { lightingPresets } from './lighting-presets'

// Phase E — null-returning lookups for callers that already have an
// id from user input and don't want the throw-on-unknown ergonomics
// of getStyle / getLighting.
export function getStyleSafe(styleId: string): VisualStyle | null {
  return visualStyles.find((s) => s.id === styleId) ?? null
}
export function getLightingSafe(lightingId: string): LightingPreset | null {
  return lightingPresets.find((l) => l.id === lightingId) ?? null
}

export interface ResolvedProjectStyle {
  style: VisualStyle
  lighting: LightingPreset | null
}

export async function resolveProjectVisualStyle(
  prisma: Pick<PrismaClient, 'novelPromotionProject'>,
  projectId: string,
): Promise<ResolvedProjectStyle | null> {
  const row = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { visualStyleId: true, lightingPresetId: true },
  })
  if (!row?.visualStyleId) return null
  try {
    const style = getStyle(row.visualStyleId)
    const lighting = row.lightingPresetId ? getLighting(row.lightingPresetId) : null
    return { style, lighting }
  } catch {
    return null
  }
}

// Build the prefix string that gets prepended to every per-shot prompt.
// Order follows Kling 3.0 official guidance: style anchor → user content
// → lighting → visual modifiers. We split: this helper produces the
// prefix (styleAnchor + lighting), and the caller appends the suffix
// (visualModifiers + style ref binding).
export function buildVisualStylePrefix(resolved: ResolvedProjectStyle | null): string {
  if (!resolved) return ''
  const parts = [resolved.style.styleAnchor, resolved.lighting?.lightingOverride]
    .filter(Boolean)
    .join('. ')
  return parts ? `${parts}. ` : ''
}

export function buildVisualStyleSuffix(resolved: ResolvedProjectStyle | null): string {
  if (!resolved) return ''
  return resolved.style.visualModifiers ? ` ${resolved.style.visualModifiers}.` : ''
}

export function buildVisualStyleNegative(resolved: ResolvedProjectStyle | null): string {
  if (!resolved) return ''
  return [resolved.style.negativePrompt, resolved.lighting?.additionalNegative]
    .filter(Boolean)
    .join(', ')
}
