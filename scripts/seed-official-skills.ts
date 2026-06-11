/**
 * Phase 2.5 (2026-06-10) — Official Skill seeder.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/seed-official-skills.ts
 *   npx tsx --env-file=.env scripts/seed-official-skills.ts --dry-run
 *
 * Reads src/lib/skills/official-skills.ts and upserts each Skill into
 * the `skills` table. Idempotent — running multiple times converges
 * to the same state. Existing Skills update in place (config / name /
 * description / thumbnail / isFeatured all refresh); installation
 * counts and popularity scores are preserved.
 *
 * authorType is always 'official' for these. authorDisplay is fixed
 * to '@KuiperAI'. Community Skills NEVER go through this seeder.
 *
 * To delete a retired official Skill: remove it from OFFICIAL_SKILLS
 * array, then run this script. It will NOT auto-delete — manual SQL
 * (or admin UI in Phase 3.5) handles deletion to keep an audit trail.
 */

import { Prisma, PrismaClient } from '@prisma/client'
import { OFFICIAL_SKILLS } from '../src/lib/skills/official-skills'

const prisma = new PrismaClient()

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log(`[seed-official-skills] ${DRY_RUN ? 'DRY RUN — no DB writes' : 'EXECUTING'} — ${OFFICIAL_SKILLS.length} skills to upsert`)

  let created = 0
  let updated = 0

  for (const def of OFFICIAL_SKILLS) {
    const existing = await prisma.skill.findUnique({ where: { slug: def.slug } })

    if (DRY_RUN) {
      console.log(`  ${existing ? 'UPDATE' : 'CREATE'} ${def.slug} — "${def.name}"`)
      if (existing) updated++
      else created++
      continue
    }

    if (existing) {
      await prisma.skill.update({
        where: { slug: def.slug },
        data: {
          name: def.name,
          nameEn: def.nameEn,
          description: def.description,
          descriptionEn: def.descriptionEn,
          thumbnailUrl: def.thumbnailUrl,
          isFeatured: def.isFeatured,
          config: def.config as unknown as Prisma.InputJsonValue,
          // status / popularityScore / installCount preserved
        },
      })
      updated++
      console.log(`  UPDATED ${def.slug}`)
    } else {
      await prisma.skill.create({
        data: {
          slug: def.slug,
          name: def.name,
          nameEn: def.nameEn,
          description: def.description,
          descriptionEn: def.descriptionEn,
          thumbnailUrl: def.thumbnailUrl,
          authorType: 'official',
          authorDisplay: '@KuiperAI',
          status: 'published',
          isFeatured: def.isFeatured,
          config: def.config as unknown as Prisma.InputJsonValue,
        },
      })
      created++
      console.log(`  CREATED ${def.slug}`)
    }
  }

  console.log(`[seed-official-skills] DONE — created=${created} updated=${updated}`)
}

main()
  .catch((err) => {
    console.error('[seed-official-skills] FAILED:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
