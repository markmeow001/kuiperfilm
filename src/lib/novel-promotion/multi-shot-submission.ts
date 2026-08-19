import { getVideoModelVariant } from '@/lib/video-models/variants'

export type MultiShotFamily = 'kling' | 'seedance' | null

export type MultiShotPanelSelection =
  | { ok: true; panelIds: string[]; maxPanels: number }
  | { ok: false; count: number; maxPanels: number }

export function resolveMultiShotPanelLimit(family: MultiShotFamily): number {
  return family === 'seedance' ? 9 : 6
}

export function resolveMultiShotPanelLimitForModel(videoModel: string | null | undefined): number {
  const family = getVideoModelVariant(videoModel)?.family ?? null
  return resolveMultiShotPanelLimit(family)
}

/**
 * Validate a complete multi-shot group without altering its cinematic order.
 * Callers must never truncate an oversized group because that silently changes
 * the story the user is paying to render.
 */
export function prepareMultiShotPanels(
  panels: ReadonlyArray<{ id: string }>,
  family: MultiShotFamily,
): MultiShotPanelSelection {
  const maxPanels = resolveMultiShotPanelLimit(family)
  if (panels.length > maxPanels) {
    return { ok: false, count: panels.length, maxPanels }
  }
  return {
    ok: true,
    panelIds: panels.map((panel) => panel.id),
    maxPanels,
  }
}
