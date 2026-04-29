/**
 * Phase 11.5 — 把既有 NovelPromotionProject.artStyle / artStylePrompt 迁移到
 * styleProfile 三栏（stylePositivePrompt / styleNegativePrompt / styleReferenceImages）。
 *
 * 邏輯：
 *  - 若 row 已有 stylePositivePrompt（非 null）-> 視為 user 已自定義或已遷移過 -> skip
 *  - 否則查 STYLE_PROFILE_PRESETS[artStyle]，找不到 preset -> log warn + skip
 *  - 否則
 *      stylePositivePrompt = preset.positivePrompt + '\n\n' + (existing artStylePrompt || '')
 *      styleNegativePrompt = preset.negativePrompt
 *
 * Idempotent — 第二次跑時所有 row 都已有 stylePositivePrompt，會全部 skip。
 *
 * 用法：
 *   npx tsx scripts/migrations/migrate-artstyle-to-style-profile.ts                # dry-run
 *   npx tsx scripts/migrations/migrate-artstyle-to-style-profile.ts --apply        # 实际写入
 */

import { prisma } from '@/lib/prisma'
import { logInfo, logWarn } from '@/lib/logging/core'
import { STYLE_PROFILE_PRESETS, type PresetKey } from '@/lib/style-profile/presets'
import { getArtStylePrompt } from '@/lib/constants'

export interface MigrateOptions {
  apply: boolean
}

interface MigrationStats {
  total: number
  migrated: number
  skippedAlreadySet: number
  skippedUnknownArtStyle: number
  fallbackMigrated: number
  dryRun: number
}

interface ProjectRow {
  id: string
  artStyle: string
  artStylePrompt: string | null
  stylePositivePrompt: string | null
  styleNegativePrompt: string | null
  styleReferenceImages: string | null
}

function isPresetKey(value: string): value is PresetKey {
  return Object.prototype.hasOwnProperty.call(STYLE_PROFILE_PRESETS, value)
}

function buildStylePositivePrompt(presetPositive: string, existingArtStylePrompt: string | null): string {
  if (!existingArtStylePrompt || existingArtStylePrompt.trim().length === 0) {
    return presetPositive
  }
  return `${presetPositive}\n\n${existingArtStylePrompt}`
}

export async function migrateArtStyleToStyleProfile(options: MigrateOptions): Promise<MigrationStats> {
  const stats: MigrationStats = {
    total: 0,
    migrated: 0,
    skippedAlreadySet: 0,
    skippedUnknownArtStyle: 0,
    fallbackMigrated: 0,
    dryRun: 0,
  }

  const rows = (await prisma.novelPromotionProject.findMany({
    select: {
      id: true,
      artStyle: true,
      artStylePrompt: true,
      stylePositivePrompt: true,
      styleNegativePrompt: true,
      styleReferenceImages: true,
    },
  })) as unknown as ProjectRow[]

  stats.total = rows.length
  logInfo(`[migrate-artstyle] scan total ${rows.length} project(s)`)

  for (const row of rows) {
    if (row.stylePositivePrompt !== null) {
      stats.skippedAlreadySet += 1
      continue
    }

    let stylePositivePrompt: string
    let styleNegativePrompt: string | null
    let usedFallback = false

    if (isPresetKey(row.artStyle)) {
      const preset = STYLE_PROFILE_PRESETS[row.artStyle]
      stylePositivePrompt = buildStylePositivePrompt(preset.positivePrompt, row.artStylePrompt)
      styleNegativePrompt = preset.negativePrompt
    } else {
      // Q-007 B: fallback — use legacy `getArtStylePrompt` string for unmapped artStyle values.
      // This is a one-time migration, NOT a runtime fallback (handlers no longer read artStyle).
      const fallbackPositive = getArtStylePrompt(row.artStyle, 'zh')
      if (!fallbackPositive || fallbackPositive.trim().length === 0) {
        logWarn(
          `[migrate-artstyle] no preset and no getArtStylePrompt for project ${row.id} artStyle="${row.artStyle}", skipping`,
          { projectId: row.id, artStyle: row.artStyle },
        )
        stats.skippedUnknownArtStyle += 1
        continue
      }
      stylePositivePrompt = buildStylePositivePrompt(fallbackPositive, row.artStylePrompt)
      styleNegativePrompt = null
      usedFallback = true
      logInfo(
        `[migrate-artstyle] fallback migration for project ${row.id} artStyle="${row.artStyle}" (no preset; using getArtStylePrompt)`,
        { projectId: row.id, artStyle: row.artStyle },
      )
    }

    if (!options.apply) {
      stats.dryRun += 1
      logInfo(
        `[migrate-artstyle] would ${usedFallback ? 'fallback-migrate' : 'migrate'} project ${row.id} artStyle="${row.artStyle}"`,
        {
          projectId: row.id,
          artStyle: row.artStyle,
          stylePositivePromptPreview: stylePositivePrompt.slice(0, 80),
          fallback: usedFallback,
        },
      )
      continue
    }

    await prisma.novelPromotionProject.update({
      where: { id: row.id },
      data: {
        stylePositivePrompt,
        styleNegativePrompt,
      },
    })
    if (usedFallback) {
      stats.fallbackMigrated += 1
    } else {
      stats.migrated += 1
    }
    logInfo(
      `[migrate-artstyle] ${usedFallback ? 'fallback-migrated' : 'migrated'} project ${row.id} artStyle="${row.artStyle}"`,
      { projectId: row.id, artStyle: row.artStyle },
    )
  }

  logInfo(
    `[migrate-artstyle] done — total=${stats.total} migrated=${stats.migrated} ` +
      `fallbackMigrated=${stats.fallbackMigrated} ` +
      `skippedAlreadySet=${stats.skippedAlreadySet} ` +
      `skippedUnknownArtStyle=${stats.skippedUnknownArtStyle} dryRun=${stats.dryRun}`,
  )

  return stats
}

async function main() {
  const apply = process.argv.includes('--apply')
  const dryRun = process.argv.includes('--dry-run') || !apply
  if (dryRun && !apply) {
    logInfo('[migrate-artstyle] running in DRY-RUN mode. Use --apply to write changes.')
  }
  await migrateArtStyleToStyleProfile({ apply })
}

if (require.main === module) {
  main().catch((err) => {
    logWarn('[migrate-artstyle] fatal error', { error: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  })
}
