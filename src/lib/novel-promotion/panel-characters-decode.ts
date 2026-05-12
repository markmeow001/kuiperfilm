/**
 * Decoder for `NovelPromotionPanel.characters` (DB TEXT column storing
 * a JSON array of references).
 *
 * Historical shapes (both must remain readable):
 *   - Legacy bare strings:   `["王玄","沈冰雪"]`
 *   - Post-2026-05-04 form:  `[{"name":"王玄","appearance":"初始形象"}]`
 *
 * The V2 storyboard UI was reading `panel.characters` from the API as
 * an already-parsed array; in practice the API returned the raw JSON
 * string, so `Array.isArray()` evaluated to false and the chip rail
 * silently rendered empty. Centralising the decode here keeps every
 * surface (API responses, hooks, worker code) on the same shape.
 *
 * Worker code already had its own decoder
 * (`parsePanelCharacterReferences` in image-task-handler-shared.ts);
 * that function is server-only because of co-located Prisma deps. This
 * module is intentionally dependency-free so it can be imported from
 * client components, hooks, and API routes alike.
 */
export interface PanelCharacterRef {
    name: string
    appearance?: string
}

export function decodePanelCharacters(raw: string | null | undefined): PanelCharacterRef[] {
    if (!raw || typeof raw !== 'string') return []
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return []
    }
    if (!Array.isArray(parsed)) return []
    const out: PanelCharacterRef[] = []
    for (const item of parsed) {
        if (typeof item === 'string') {
            const name = item.trim()
            if (name) out.push({ name })
            continue
        }
        if (item && typeof item === 'object') {
            const candidate = item as { name?: unknown; appearance?: unknown }
            if (typeof candidate.name === 'string' && candidate.name.trim()) {
                out.push({
                    name: candidate.name.trim(),
                    appearance:
                        typeof candidate.appearance === 'string' && candidate.appearance.trim()
                            ? candidate.appearance.trim()
                            : undefined,
                })
            }
        }
    }
    return out
}
