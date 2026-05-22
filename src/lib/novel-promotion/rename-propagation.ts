/**
 * Phase R-2 (2026-05-22) — propagate character / scene / prop rename
 * across all panel references in a project.
 *
 * Problem: panel.characters / panel.location / panel.props store the
 * referenced entity by NAME (not by id). When the user renames a
 * character from "Karrug" to "Khoda" in the project subjects page,
 * the catalog row updates BUT every panel that referenced "Karrug"
 * still has the old name. Multi-shot worker's findCharacterByName()
 * lookup then returns undefined → the ref image is silently dropped
 * → user's renamed character no longer anchors any shot.
 *
 * Fix: when name changes, also UPDATE every panel in the project that
 * references the old name, swapping it to the new name. Done in the
 * same prisma transaction as the catalog row update so a partial
 * failure never leaves names out of sync.
 *
 * Why we don't use a raw SQL REPLACE() on the whole row:
 *   - panel.characters is JSON. A naive string REPLACE would catch
 *     "Karrug" inside the value of an unrelated field if the LLM ever
 *     wrote it there.
 *   - Substring collisions: renaming "王" to "王玄" would corrupt
 *     "王國". JSON-parse + structured rewrite avoids this entirely.
 *   - panel.location is a string ("Name" or "Name#viewHint"). We do
 *     a structured prefix match instead of REPLACE so "Name" doesn't
 *     match "Renamed".
 */

import type { PrismaClient } from '@prisma/client'

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

interface PanelCharacterEntry {
  name?: unknown
  appearance?: unknown
  [key: string]: unknown
}

interface PanelPropEntry {
  name?: unknown
  [key: string]: unknown
}

function tryParseJsonArray(value: string | null): unknown[] | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function rewriteCharacterRefName(value: string, oldName: string, newName: string): string {
  const parsed = tryParseJsonArray(value)
  if (!parsed) {
    // Legacy / malformed entries — fall through. The lookup will fail
    // anyway with bad JSON, so leaving it alone is no worse than what
    // was already happening.
    return value
  }
  let changed = false
  const rewritten = parsed.map((item): unknown => {
    if (typeof item === 'string') {
      if (item === oldName) {
        changed = true
        return newName
      }
      return item
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const entry = item as PanelCharacterEntry
      if (typeof entry.name === 'string' && entry.name === oldName) {
        changed = true
        return { ...entry, name: newName }
      }
    }
    return item
  })
  return changed ? JSON.stringify(rewritten) : value
}

function rewritePropRefName(value: string, oldName: string, newName: string): string {
  // Prop JSON has the same shape as characters; reuse logic.
  const parsed = tryParseJsonArray(value)
  if (!parsed) return value
  let changed = false
  const rewritten = parsed.map((item): unknown => {
    if (typeof item === 'string') {
      if (item === oldName) {
        changed = true
        return newName
      }
      return item
    }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const entry = item as PanelPropEntry
      if (typeof entry.name === 'string' && entry.name === oldName) {
        changed = true
        return { ...entry, name: newName }
      }
    }
    return item
  })
  return changed ? JSON.stringify(rewritten) : value
}

function rewriteLocationString(value: string, oldName: string, newName: string): string | null {
  // Format: "Name" or "Name#viewHint". Only rewrite when the segment
  // BEFORE the optional # matches oldName exactly. Substring matches
  // don't propagate ("Renamed" doesn't get touched when renaming "Name").
  const hashIdx = value.indexOf('#')
  const head = hashIdx === -1 ? value : value.slice(0, hashIdx)
  const tail = hashIdx === -1 ? '' : value.slice(hashIdx) // includes the # char
  if (head.trim() !== oldName) return null
  return `${newName}${tail}`
}

/**
 * Propagate a character rename across every panel in the project.
 * Caller MUST pass a prisma transaction object so the panel updates
 * land atomically with the catalog row update — partial state where
 * the catalog has the new name but panels have the old name (or vice
 * versa) silently breaks worker ref lookup.
 */
export async function propagateCharacterRename(
  tx: Tx,
  projectId: string,
  oldName: string,
  newName: string,
): Promise<{ panelsScanned: number; panelsRewritten: number }> {
  if (oldName === newName || !oldName.trim() || !newName.trim()) {
    return { panelsScanned: 0, panelsRewritten: 0 }
  }
  // Only fetch panels that actually contain the old name in characters
  // JSON. A LIKE %name% prefilter cuts the rewrite set to a few rows
  // even on large projects.
  const candidates = await tx.novelPromotionPanel.findMany({
    where: {
      storyboard: { episode: { novelPromotionProject: { projectId } } },
      characters: { contains: oldName },
    },
    select: { id: true, characters: true },
  })
  let rewritten = 0
  for (const panel of candidates) {
    if (!panel.characters) continue
    const next = rewriteCharacterRefName(panel.characters, oldName, newName)
    if (next !== panel.characters) {
      await tx.novelPromotionPanel.update({
        where: { id: panel.id },
        data: { characters: next },
      })
      rewritten += 1
    }
  }
  return { panelsScanned: candidates.length, panelsRewritten: rewritten }
}

/** Same as propagateCharacterRename but for prop JSON. */
export async function propagatePropRename(
  tx: Tx,
  projectId: string,
  oldName: string,
  newName: string,
): Promise<{ panelsScanned: number; panelsRewritten: number }> {
  if (oldName === newName || !oldName.trim() || !newName.trim()) {
    return { panelsScanned: 0, panelsRewritten: 0 }
  }
  const candidates = await tx.novelPromotionPanel.findMany({
    where: {
      storyboard: { episode: { novelPromotionProject: { projectId } } },
      props: { contains: oldName },
    },
    select: { id: true, props: true },
  })
  let rewritten = 0
  for (const panel of candidates) {
    if (!panel.props) continue
    const next = rewritePropRefName(panel.props, oldName, newName)
    if (next !== panel.props) {
      await tx.novelPromotionPanel.update({
        where: { id: panel.id },
        data: { props: next },
      })
      rewritten += 1
    }
  }
  return { panelsScanned: candidates.length, panelsRewritten: rewritten }
}

/** Propagate a location rename. panel.location is a plain string. */
export async function propagateLocationRename(
  tx: Tx,
  projectId: string,
  oldName: string,
  newName: string,
): Promise<{ panelsScanned: number; panelsRewritten: number }> {
  if (oldName === newName || !oldName.trim() || !newName.trim()) {
    return { panelsScanned: 0, panelsRewritten: 0 }
  }
  // Match on the head segment (before #) to avoid clobbering location
  // strings whose viewHint happens to contain oldName as substring.
  // We can't easily do this filter in SQL with structured semantics so
  // we LIKE %oldName% first and structurally validate per row.
  const candidates = await tx.novelPromotionPanel.findMany({
    where: {
      storyboard: { episode: { novelPromotionProject: { projectId } } },
      location: { contains: oldName },
    },
    select: { id: true, location: true },
  })
  let rewritten = 0
  for (const panel of candidates) {
    if (!panel.location) continue
    const next = rewriteLocationString(panel.location, oldName, newName)
    if (next === null) continue // head segment didn't match exactly — substring hit, leave it
    await tx.novelPromotionPanel.update({
      where: { id: panel.id },
      data: { location: next },
    })
    rewritten += 1
  }
  return { panelsScanned: candidates.length, panelsRewritten: rewritten }
}
