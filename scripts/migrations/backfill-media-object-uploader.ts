/**
 * Q-005 — Backfill MediaObject.uploadedByUserId from existing relations.
 *
 * MediaObject has been retro-fitted with `uploadedByUserId` (nullable). New
 * uploads tag the column at write time. This script back-fills historical rows
 * by walking known relation chains until a project owner / global asset owner
 * is found:
 *
 *   1. CharacterAppearance.imageMediaId → Character → NovelPromotionProject → Project.userId
 *   2. LocationImage.imageMediaId      → Location → NovelPromotionProject → Project.userId
 *   3. NovelPromotionPanel.imageMediaId / videoMediaId / sketchImageMediaId /
 *      previousImageMediaId / lipSyncVideoMediaId → Storyboard → NovelPromotionProject → Project.userId
 *   4. NovelPromotionShot.imageMediaId  → Storyboard → NovelPromotionProject → Project.userId
 *   5. NovelPromotionVoiceLine.audioMediaId → NovelPromotionEpisode → NovelPromotionProject → Project.userId
 *   6. NovelPromotionEpisode.audioMediaId → NovelPromotionProject → Project.userId
 *   7. NovelPromotionCharacter.customVoiceMediaId → NovelPromotionProject → Project.userId
 *   8. SupplementaryPanel.imageMediaId → NovelPromotionStoryboard → NovelPromotionEpisode → NovelPromotionProject → Project.userId
 *   9. GlobalCharacterAppearance.imageMediaId / previousImageMediaId → GlobalCharacter.userId
 *  10. GlobalLocationImage.imageMediaId / previousImageMediaId → GlobalLocation.userId
 *  11. GlobalCharacter.customVoiceMediaId → GlobalCharacter.userId
 *  12. GlobalVoice.customVoiceMediaId → GlobalVoice.userId
 *  13. VoicePreset.audioMediaId → (no owner — skip)
 *
 * Rows that cannot be resolved through any chain stay NULL; subsequent owner
 * checks (style-profile route + loader) treat NULL as "not owned" so the leak
 * path stays closed even before backfill runs.
 *
 * Idempotent — re-running on already-backfilled rows is a no-op.
 *
 * Usage:
 *   npx tsx scripts/migrations/backfill-media-object-uploader.ts             # dry-run
 *   npx tsx scripts/migrations/backfill-media-object-uploader.ts --apply     # write
 */

import { prisma } from '@/lib/prisma'
import { logInfo, logWarn } from '@/lib/logging/core'

export interface BackfillOptions {
  apply: boolean
}

export interface BackfillStats {
  totalNullRows: number
  resolved: number
  unresolved: number
  byChain: Record<string, number>
  dryRun: boolean
}

interface MediaObjectIdRow {
  id: string
}

/**
 * Bulk-build a map of mediaId → userId by querying every known relation chain.
 * One pass per relation table; uses include-style joins to fold in the owner.
 *
 * Each helper returns `[mediaId, userId][]`. Caller dedupes (first hit wins).
 */
async function chainCharacterAppearance(): Promise<Array<[string, string]>> {
  const rows = await prisma.characterAppearance.findMany({
    where: { imageMediaId: { not: null } },
    select: {
      imageMediaId: true,
      character: {
        select: {
          novelPromotionProject: { select: { project: { select: { userId: true } } } },
        },
      },
    },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const userId = row.character?.novelPromotionProject?.project?.userId
    if (row.imageMediaId && userId) out.push([row.imageMediaId, userId])
  }
  return out
}

async function chainLocationImage(): Promise<Array<[string, string]>> {
  const rows = await prisma.locationImage.findMany({
    where: { imageMediaId: { not: null } },
    select: {
      imageMediaId: true,
      location: {
        select: {
          novelPromotionProject: { select: { project: { select: { userId: true } } } },
        },
      },
    },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const userId = row.location?.novelPromotionProject?.project?.userId
    if (row.imageMediaId && userId) out.push([row.imageMediaId, userId])
  }
  return out
}

async function chainNovelPromotionPanel(): Promise<Array<[string, string]>> {
  const rows = await prisma.novelPromotionPanel.findMany({
    select: {
      imageMediaId: true,
      videoMediaId: true,
      lipSyncVideoMediaId: true,
      sketchImageMediaId: true,
      previousImageMediaId: true,
      storyboard: {
        select: {
          episode: {
            select: {
              novelPromotionProject: { select: { project: { select: { userId: true } } } },
            },
          },
        },
      },
    },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const userId = row.storyboard?.episode?.novelPromotionProject?.project?.userId
    if (!userId) continue
    for (const id of [
      row.imageMediaId,
      row.videoMediaId,
      row.lipSyncVideoMediaId,
      row.sketchImageMediaId,
      row.previousImageMediaId,
    ]) {
      if (id) out.push([id, userId])
    }
  }
  return out
}

async function chainNovelPromotionShot(): Promise<Array<[string, string]>> {
  // Shot relates to episode (not storyboard) per schema.
  const rows = await prisma.novelPromotionShot.findMany({
    where: { imageMediaId: { not: null } },
    select: {
      imageMediaId: true,
      episode: {
        select: {
          novelPromotionProject: { select: { project: { select: { userId: true } } } },
        },
      },
    },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const userId = row.episode?.novelPromotionProject?.project?.userId
    if (row.imageMediaId && userId) out.push([row.imageMediaId, userId])
  }
  return out
}

async function chainVoiceLine(): Promise<Array<[string, string]>> {
  const rows = await prisma.novelPromotionVoiceLine.findMany({
    where: { audioMediaId: { not: null } },
    select: {
      audioMediaId: true,
      episode: {
        select: {
          novelPromotionProject: { select: { project: { select: { userId: true } } } },
        },
      },
    },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const userId = row.episode?.novelPromotionProject?.project?.userId
    if (row.audioMediaId && userId) out.push([row.audioMediaId, userId])
  }
  return out
}

async function chainEpisodeAudio(): Promise<Array<[string, string]>> {
  const rows = await prisma.novelPromotionEpisode.findMany({
    where: { audioMediaId: { not: null } },
    select: {
      audioMediaId: true,
      novelPromotionProject: { select: { project: { select: { userId: true } } } },
    },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const userId = row.novelPromotionProject?.project?.userId
    if (row.audioMediaId && userId) out.push([row.audioMediaId, userId])
  }
  return out
}

async function chainNovelPromotionCharacterVoice(): Promise<Array<[string, string]>> {
  const rows = await prisma.novelPromotionCharacter.findMany({
    where: { customVoiceMediaId: { not: null } },
    select: {
      customVoiceMediaId: true,
      novelPromotionProject: { select: { project: { select: { userId: true } } } },
    },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const userId = row.novelPromotionProject?.project?.userId
    if (row.customVoiceMediaId && userId) out.push([row.customVoiceMediaId, userId])
  }
  return out
}

async function chainSupplementaryPanel(): Promise<Array<[string, string]>> {
  const rows = await prisma.supplementaryPanel.findMany({
    where: { imageMediaId: { not: null } },
    select: {
      imageMediaId: true,
      storyboard: {
        select: {
          episode: {
            select: {
              novelPromotionProject: { select: { project: { select: { userId: true } } } },
            },
          },
        },
      },
    },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const userId = row.storyboard?.episode?.novelPromotionProject?.project?.userId
    if (row.imageMediaId && userId) out.push([row.imageMediaId, userId])
  }
  return out
}

async function chainGlobalCharacterAppearance(): Promise<Array<[string, string]>> {
  const rows = await prisma.globalCharacterAppearance.findMany({
    select: {
      imageMediaId: true,
      previousImageMediaId: true,
      character: { select: { userId: true } },
    },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const userId = row.character?.userId
    if (!userId) continue
    if (row.imageMediaId) out.push([row.imageMediaId, userId])
    if (row.previousImageMediaId) out.push([row.previousImageMediaId, userId])
  }
  return out
}

async function chainGlobalLocationImage(): Promise<Array<[string, string]>> {
  const rows = await prisma.globalLocationImage.findMany({
    select: {
      imageMediaId: true,
      previousImageMediaId: true,
      location: { select: { userId: true } },
    },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const userId = row.location?.userId
    if (!userId) continue
    if (row.imageMediaId) out.push([row.imageMediaId, userId])
    if (row.previousImageMediaId) out.push([row.previousImageMediaId, userId])
  }
  return out
}

async function chainGlobalCharacterVoice(): Promise<Array<[string, string]>> {
  const rows = await prisma.globalCharacter.findMany({
    where: { customVoiceMediaId: { not: null } },
    select: { customVoiceMediaId: true, userId: true },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    if (row.customVoiceMediaId && row.userId) out.push([row.customVoiceMediaId, row.userId])
  }
  return out
}

async function chainGlobalVoiceCustomVoice(): Promise<Array<[string, string]>> {
  const rows = await prisma.globalVoice.findMany({
    where: { customVoiceMediaId: { not: null } },
    select: { customVoiceMediaId: true, userId: true },
  })
  const out: Array<[string, string]> = []
  for (const row of rows) {
    if (row.customVoiceMediaId && row.userId) out.push([row.customVoiceMediaId, row.userId])
  }
  return out
}

const RESOLVERS: Array<{ name: string; run: () => Promise<Array<[string, string]>> }> = [
  { name: 'character_appearance', run: chainCharacterAppearance },
  { name: 'location_image', run: chainLocationImage },
  { name: 'novel_promotion_panel', run: chainNovelPromotionPanel },
  { name: 'novel_promotion_shot', run: chainNovelPromotionShot },
  { name: 'novel_promotion_voice_line', run: chainVoiceLine },
  { name: 'novel_promotion_episode_audio', run: chainEpisodeAudio },
  { name: 'novel_promotion_character_voice', run: chainNovelPromotionCharacterVoice },
  { name: 'supplementary_panel', run: chainSupplementaryPanel },
  { name: 'global_character_appearance', run: chainGlobalCharacterAppearance },
  { name: 'global_location_image', run: chainGlobalLocationImage },
  { name: 'global_character_voice', run: chainGlobalCharacterVoice },
  { name: 'global_voice_custom_voice', run: chainGlobalVoiceCustomVoice },
]

export async function backfillMediaObjectUploader(options: BackfillOptions): Promise<BackfillStats> {
  const stats: BackfillStats = {
    totalNullRows: 0,
    resolved: 0,
    unresolved: 0,
    byChain: {},
    dryRun: !options.apply,
  }

  // 1. find every null row up-front so we know the universe.
  const nullRows = (await prisma.mediaObject.findMany({
    where: { uploadedByUserId: null },
    select: { id: true },
  })) as MediaObjectIdRow[]
  stats.totalNullRows = nullRows.length
  const nullSet = new Set(nullRows.map((row) => row.id))

  if (stats.totalNullRows === 0) {
    logInfo('[backfill-media-object-uploader] no null rows; nothing to do.')
    return stats
  }

  logInfo(`[backfill-media-object-uploader] scanning ${stats.totalNullRows} row(s) with null uploadedByUserId...`)

  // 2. walk every chain. First match wins (Map.set never overwrites because we
  //    skip ids already present).
  const resolved = new Map<string, { userId: string; chain: string }>()

  for (const resolver of RESOLVERS) {
    const pairs = await resolver.run()
    let chainHits = 0
    for (const [mediaId, userId] of pairs) {
      if (!nullSet.has(mediaId)) continue
      if (resolved.has(mediaId)) continue
      resolved.set(mediaId, { userId, chain: resolver.name })
      chainHits += 1
    }
    stats.byChain[resolver.name] = chainHits
    logInfo(`[backfill-media-object-uploader] ${resolver.name}: ${chainHits} matched`)
  }

  stats.resolved = resolved.size
  stats.unresolved = stats.totalNullRows - stats.resolved

  if (!options.apply) {
    logInfo(
      `[backfill-media-object-uploader] DRY-RUN: would update ${stats.resolved} row(s); ${stats.unresolved} unresolved.`,
    )
    return stats
  }

  // 3. apply updates. Use a per-row update for clarity (small dataset; this is
  //    a one-time migration, not a hot path).
  let written = 0
  for (const [mediaId, { userId }] of resolved) {
    try {
      await prisma.mediaObject.update({
        where: { id: mediaId },
        data: { uploadedByUserId: userId },
      })
      written += 1
    } catch (err) {
      logWarn(`[backfill-media-object-uploader] failed to update mediaObject ${mediaId}`, {
        mediaId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  logInfo(
    `[backfill-media-object-uploader] applied: wrote ${written}/${stats.resolved} row(s); ${stats.unresolved} remain null.`,
  )
  return stats
}

async function main() {
  const apply = process.argv.includes('--apply')
  if (!apply) {
    logInfo('[backfill-media-object-uploader] DRY-RUN mode. Use --apply to write.')
  }
  await backfillMediaObjectUploader({ apply })
}

if (require.main === module) {
  main().catch((err) => {
    logWarn('[backfill-media-object-uploader] fatal', { error: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}
