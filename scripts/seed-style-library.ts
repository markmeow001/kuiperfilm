/**
 * Style Library seeder — populates visual_styles + lighting_presets
 * from the in-tree TS source (src/lib/style-library/*).
 *
 * Idempotent: upsert by primary key. Safe to re-run after content edits.
 *
 * Usage:
 *   npx tsx scripts/seed-style-library.ts
 *
 * Pre-req:
 *   - DATABASE_URL points at a reachable MySQL
 *   - `prisma db push` has applied the VisualStyle / LightingPreset models
 *
 * Output: count of styles + lightings seeded, exits 0 on success.
 */

import { PrismaClient, type Prisma } from '@prisma/client'
import { visualStyles } from '../src/lib/style-library/visual-styles'
import { lightingPresets } from '../src/lib/style-library/lighting-presets'

const prisma = new PrismaClient()

async function seedVisualStyles() {
  for (const s of visualStyles) {
    const data: Prisma.VisualStyleUncheckedCreateInput = {
      id: s.id,
      nameZh: s.nameZh,
      nameEn: s.nameEn,
      category: s.category,
      categoryNameZh: s.categoryNameZh,
      thumbnailUrl: s.thumbnailUrl,
      styleAnchor: s.styleAnchor,
      visualModifiers: s.visualModifiers,
      negativePrompt: s.negativePrompt,
      referenceArtists: s.referenceArtists,
      bestForGenres: s.bestForGenres,
      recommendedKlingVersion: s.recommendedKlingVersion,
      tags: s.tags,
      displayOrder: s.displayOrder,
      isActive: s.isActive,
    }
    await prisma.visualStyle.upsert({
      where: { id: s.id },
      create: data,
      update: {
        nameZh: data.nameZh,
        nameEn: data.nameEn,
        category: data.category,
        categoryNameZh: data.categoryNameZh,
        thumbnailUrl: data.thumbnailUrl,
        styleAnchor: data.styleAnchor,
        visualModifiers: data.visualModifiers,
        negativePrompt: data.negativePrompt,
        referenceArtists: data.referenceArtists,
        bestForGenres: data.bestForGenres,
        recommendedKlingVersion: data.recommendedKlingVersion,
        tags: data.tags,
        displayOrder: data.displayOrder,
        isActive: data.isActive,
      },
    })
  }
}

async function seedLightingPresets() {
  for (const l of lightingPresets) {
    const data: Prisma.LightingPresetUncheckedCreateInput = {
      id: l.id,
      nameZh: l.nameZh,
      nameEn: l.nameEn,
      thumbnailUrl: l.thumbnailUrl,
      lightingOverride: l.lightingOverride,
      additionalNegative: l.additionalNegative,
      bestForMoods: l.bestForMoods,
      tags: l.tags,
      displayOrder: l.displayOrder,
      isActive: l.isActive,
    }
    await prisma.lightingPreset.upsert({
      where: { id: l.id },
      create: data,
      update: {
        nameZh: data.nameZh,
        nameEn: data.nameEn,
        thumbnailUrl: data.thumbnailUrl,
        lightingOverride: data.lightingOverride,
        additionalNegative: data.additionalNegative,
        bestForMoods: data.bestForMoods,
        tags: data.tags,
        displayOrder: data.displayOrder,
        isActive: data.isActive,
      },
    })
  }
}

async function main() {
  console.log(`Seeding ${visualStyles.length} visual styles + ${lightingPresets.length} lighting presets…`)
  await seedVisualStyles()
  await seedLightingPresets()
  // Sanity stats — matches README's expected output.
  const byCategory = visualStyles.reduce<Record<string, number>>((acc, s) => {
    acc[s.category] = (acc[s.category] ?? 0) + 1
    return acc
  }, {})
  console.log('=== Stats ===')
  console.log(JSON.stringify({ total: visualStyles.length, byCategory }, null, 2))
  console.log(`Seeded ${visualStyles.length} styles, ${lightingPresets.length} lightings`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
