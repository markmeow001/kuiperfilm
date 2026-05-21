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

/**
 * Phase J (2026-05-21) — default style for projects that haven't picked
 * one explicitly. Per the realism-first feedback (saved as
 * feedback_style_priority_realism_first memory), `cinematic_realism`
 * carries the strongest cinematic anchor for the realism-driven
 * short-drama use case the project is targeting.
 *
 * This constant is the SINGLE source of truth for the default. The
 * Prisma schema's `visualStyleId` default mirrors it (set at the same
 * commit) so new rows land here without needing this fallback.
 */
export const DEFAULT_PROJECT_VISUAL_STYLE_ID = 'cinematic_realism'

export async function resolveProjectVisualStyle(
  prisma: Pick<PrismaClient, 'novelPromotionProject'>,
  projectId: string,
): Promise<ResolvedProjectStyle | null> {
  const row = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { visualStyleId: true, lightingPresetId: true },
  })
  // Phase J — when the row exists but visualStyleId is NULL (legacy
  // projects, projects created before the schema default was added,
  // or projects where the user explicitly cleared the style), fall
  // back to DEFAULT_PROJECT_VISUAL_STYLE_ID. This makes the realism
  // default reach the model immediately for the entire NULL cohort
  // without needing a backfill UPDATE on the production DB.
  //
  // We DO NOT override a non-NULL visualStyleId — user choice wins.
  // The only path to this fallback is row missing OR row.visualStyleId
  // is null/empty/unknown-string. Unknown-string (typo or removed
  // style id) is caught by the getStyle try/catch and ALSO falls
  // back to the default rather than returning null, so the AVOID
  // suppressor list and prefix/suffix always ship.
  const effectiveStyleId = row?.visualStyleId || DEFAULT_PROJECT_VISUAL_STYLE_ID
  try {
    const style = getStyle(effectiveStyleId)
    const lighting = row?.lightingPresetId ? getLighting(row.lightingPresetId) : null
    return { style, lighting }
  } catch {
    // The DB-stored id is unknown (e.g. user picked a style we later
    // removed). Try the default — if that ALSO fails, the seed data
    // is broken and returning null is the only safe response.
    try {
      const fallback = getStyle(DEFAULT_PROJECT_VISUAL_STYLE_ID)
      return { style: fallback, lighting: null }
    } catch {
      return null
    }
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
