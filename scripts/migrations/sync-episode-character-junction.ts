/**
 * Phase 11.2 — backfill EpisodeCharacter / EpisodeLocation junction rows
 * from existing panels.characters / panels.location text fields.
 *
 * Uses the same Q-2 B three-layer match logic as the bridge:
 *   1. exact name (case-sensitive)
 *   2. name (case-insensitive)
 *   3. aliases JSON (case-sensitive then case-insensitive)
 *
 * Default mode: dry-run (no DB writes). Pass `--commit` to apply.
 * Pass `--projectId=<id>` to scope to a single Project.id.
 */

import { prisma } from '@/lib/prisma'
import { _internal } from '@/lib/episode-asset-bridge'

const COMMIT = process.argv.includes('--commit')

function getProjectIdArg(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--projectId='))
  if (!arg) return null
  const value = arg.slice('--projectId='.length).trim()
  return value.length > 0 ? value : null
}

interface Summary {
  projectsScanned: number
  panelsScanned: number
  charactersLinked: number
  locationsLinked: number
  unmatched: { kind: 'character' | 'location'; episodeId: string; name: string }[]
  ambiguous: { kind: 'character' | 'location'; episodeId: string; name: string; candidates: string[] }[]
  charactersInsertedRows: number
  locationsInsertedRows: number
  mode: 'dry-run' | 'commit'
}

function parsePanelCharacterNames(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'string' ? item : (item && typeof item === 'object' && 'name' in item ? String((item as Record<string, unknown>).name) : '')))
      .filter((s) => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim())
  } catch {
    return []
  }
}

async function main(): Promise<void> {
  const scopedProjectId = getProjectIdArg()
  const summary: Summary = {
    mode: COMMIT ? 'commit' : 'dry-run',
    projectsScanned: 0,
    panelsScanned: 0,
    charactersLinked: 0,
    locationsLinked: 0,
    unmatched: [],
    ambiguous: [],
    charactersInsertedRows: 0,
    locationsInsertedRows: 0,
  }

  const projectWhere = scopedProjectId ? { projectId: scopedProjectId } : {}
  const novelProjects = await prisma.novelPromotionProject.findMany({
    where: projectWhere,
    select: { id: true, projectId: true },
  })

  for (const np of novelProjects) {
    summary.projectsScanned += 1

    const characters = await prisma.novelPromotionCharacter.findMany({
      where: { novelPromotionProjectId: np.id },
      select: { id: true, name: true, aliases: true },
    })
    const locations = await prisma.novelPromotionLocation.findMany({
      where: { novelPromotionProjectId: np.id },
      select: { id: true, name: true },
    })

    const episodes = await prisma.novelPromotionEpisode.findMany({
      where: { novelPromotionProjectId: np.id },
      select: { id: true },
    })

    for (const ep of episodes) {
      // Pull all panels via storyboards belonging to this episode.
      const storyboards = await prisma.novelPromotionStoryboard.findMany({
        where: { episodeId: ep.id },
        select: {
          id: true,
          panels: { select: { characters: true, location: true } },
        },
      })

      const characterIdsForEp = new Set<string>()
      const locationIdsForEp = new Set<string>()

      for (const sb of storyboards) {
        for (const panel of sb.panels) {
          summary.panelsScanned += 1

          // Characters.
          for (const name of parsePanelCharacterNames(panel.characters)) {
            const matches = _internal.matchByName(name, characters)
            if (matches.length === 0) {
              summary.unmatched.push({ kind: 'character', episodeId: ep.id, name })
              continue
            }
            if (matches.length > 1) {
              summary.ambiguous.push({
                kind: 'character',
                episodeId: ep.id,
                name,
                candidates: matches.map((m) => m.id),
              })
              continue
            }
            characterIdsForEp.add(matches[0].id)
          }

          // Location (single string).
          const locName = typeof panel.location === 'string' ? panel.location.trim() : ''
          if (locName) {
            const matches = _internal.matchByName(
              locName,
              locations.map((l) => ({ ...l, aliases: null })),
            )
            if (matches.length === 0) {
              summary.unmatched.push({ kind: 'location', episodeId: ep.id, name: locName })
            } else if (matches.length > 1) {
              summary.ambiguous.push({
                kind: 'location',
                episodeId: ep.id,
                name: locName,
                candidates: matches.map((m) => m.id),
              })
            } else {
              locationIdsForEp.add(matches[0].id)
            }
          }
        }
      }

      summary.charactersLinked += characterIdsForEp.size
      summary.locationsLinked += locationIdsForEp.size

      if (COMMIT) {
        if (characterIdsForEp.size > 0) {
          const result = await prisma.episodeCharacter.createMany({
            data: Array.from(characterIdsForEp).map((characterId) => ({
              episodeId: ep.id,
              characterId,
              role: 'auto-from-panel',
            })),
            skipDuplicates: true,
          })
          summary.charactersInsertedRows += result.count
        }
        if (locationIdsForEp.size > 0) {
          const result = await prisma.episodeLocation.createMany({
            data: Array.from(locationIdsForEp).map((locationId) => ({
              episodeId: ep.id,
              locationId,
              role: 'auto-from-panel',
            })),
            skipDuplicates: true,
          })
          summary.locationsInsertedRows += result.count
        }
      }
    }
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[sync-episode-character-junction] FAILED: ${message}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
