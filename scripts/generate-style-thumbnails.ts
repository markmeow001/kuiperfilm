/**
 * Phase D — generate the 29-style thumbnail set via Tencent VOD AIGC
 * (Kling Image O1) and write the URLs back to visual_styles.thumbnail_url.
 *
 * Idempotent: by default skips styles that already have a thumbnailUrl.
 * Pass --force to re-render every style.
 *
 * Usage (inside the prod app container):
 *   npx tsx scripts/generate-style-thumbnails.ts          # missing only
 *   npx tsx scripts/generate-style-thumbnails.ts --force  # all 29
 *   npx tsx scripts/generate-style-thumbnails.ts --only=cinematic_realism,kdrama_romance
 *   npx tsx scripts/generate-style-thumbnails.ts --user=<userId>
 *
 * The script resolves the admin user from DB by default (first user
 * with role='admin') so it picks up the org's tencent-vod credentials
 * without needing env passthrough. Override with --user when running
 * for a non-admin tenant's catalog (won't typically happen — visual_styles
 * is global).
 *
 * Cost: ~$0.028 USD per Kling Image O1 call → ~$0.81 for the full 29.
 */

import { PrismaClient } from '@prisma/client'
import { generateImage } from '../src/lib/generator-api'
import { pollAsyncTask } from '../src/lib/async-poll'
import { downloadAndUploadToCOS } from '../src/lib/cos'
import { visualStyles } from '../src/lib/style-library/visual-styles'
import {
  STYLE_THUMBNAIL_NEGATIVE,
  STYLE_THUMBNAIL_PROMPTS,
} from '../src/lib/style-library/thumbnail-prompts'

const prisma = new PrismaClient()

const POLL_TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 4_000
const SLEEP_BETWEEN_STYLES_MS = 1_500
const MODEL_KEY = 'tencent-vod::Kling-O1'

interface CliFlags {
  force: boolean
  only: Set<string> | null
  userIdOverride: string | null
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2)
  const flags: CliFlags = { force: false, only: null, userIdOverride: null }
  for (const a of args) {
    if (a === '--force') flags.force = true
    else if (a.startsWith('--only=')) {
      flags.only = new Set(a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean))
    } else if (a.startsWith('--user=')) {
      flags.userIdOverride = a.slice('--user='.length).trim() || null
    }
  }
  return flags
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function resolveAdminUserId(): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { role: 'admin', isActive: true },
    select: { id: true, email: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) {
    throw new Error('No active admin user found in DB — pass --user=<id> to override')
  }
  console.log(`Using admin user ${admin.email ?? admin.id} for tencent-vod credentials`)
  return admin.id
}

async function pollUntilDone(externalId: string, userId: string): Promise<string> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const status = await pollAsyncTask(externalId, userId)
    if (status.status === 'completed') {
      const url = status.resultUrl || status.imageUrl
      if (!url) throw new Error(`completed but no URL: ${externalId}`)
      return url
    }
    if (status.status === 'failed') {
      throw new Error(status.error || `task failed: ${externalId}`)
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`poll timeout after ${POLL_TIMEOUT_MS}ms: ${externalId}`)
}

async function generateAndPersist(styleId: string, userId: string): Promise<string> {
  const prompt = STYLE_THUMBNAIL_PROMPTS[styleId]
  if (!prompt) throw new Error(`No prompt for style ${styleId}`)

  // Fire the AIGC image task
  const result = await generateImage(userId, MODEL_KEY, prompt, {
    aspectRatio: '1:1',
    resolution: '1k',
    negativePrompt: STYLE_THUMBNAIL_NEGATIVE,
  })

  // Synchronous result (rare for tencent-vod) — short-circuit
  if (result.imageUrl && !result.async) {
    return result.imageUrl
  }
  if (!result.async || !result.externalId) {
    throw new Error(`unexpected generator result: ${JSON.stringify(result)}`)
  }

  // Poll until tencent reports completed
  const tencentUrl = await pollUntilDone(result.externalId, userId)

  // Persist to our own CDN — Tencent's StorageMode=Temporary URLs expire
  // within 24h, so we MUST mirror to COS/R2 before returning the link.
  const cdnUrl = await downloadAndUploadToCOS(tencentUrl, `style-thumbs/${styleId}.jpg`)
  return cdnUrl
}

async function main() {
  const flags = parseFlags()
  const userId = flags.userIdOverride ?? await resolveAdminUserId()

  // Refresh DB rows so we know who already has a thumbnail
  const dbRows = await prisma.visualStyle.findMany({
    select: { id: true, thumbnailUrl: true },
  })
  const dbThumbMap = new Map(dbRows.map((r) => [r.id, r.thumbnailUrl]))

  const todo = visualStyles.filter((s) => {
    if (flags.only && !flags.only.has(s.id)) return false
    if (!flags.force && dbThumbMap.get(s.id)) return false
    return true
  })

  if (todo.length === 0) {
    console.log('Nothing to do — all selected styles already have thumbnailUrl. Use --force to regenerate.')
    return
  }

  console.log(`\nGenerating ${todo.length} thumbnail(s)…`)
  console.log(`  Model:    ${MODEL_KEY}`)
  console.log(`  Aspect:   1:1, 1K`)
  console.log(`  Negative: ${STYLE_THUMBNAIL_NEGATIVE.slice(0, 60)}…`)
  console.log(`  Sleep:    ${SLEEP_BETWEEN_STYLES_MS}ms between calls\n`)

  let okCount = 0
  let failCount = 0
  const failures: Array<{ id: string; error: string }> = []

  for (let i = 0; i < todo.length; i++) {
    const style = todo[i]
    const prefix = `[${i + 1}/${todo.length}] ${style.id} (${style.nameZh})`
    process.stdout.write(`${prefix} … `)
    try {
      const cdnUrl = await generateAndPersist(style.id, userId)
      await prisma.visualStyle.update({
        where: { id: style.id },
        data: { thumbnailUrl: cdnUrl },
      })
      okCount++
      console.log(`OK ${cdnUrl}`)
    } catch (err) {
      failCount++
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ id: style.id, error: message })
      console.log(`FAIL ${message}`)
    }
    if (i < todo.length - 1) await sleep(SLEEP_BETWEEN_STYLES_MS)
  }

  console.log(`\n=== Summary ===`)
  console.log(`OK:    ${okCount}`)
  console.log(`FAIL:  ${failCount}`)
  if (failures.length > 0) {
    console.log(`\nFailed styles (re-run with --only=<csv> to retry):`)
    for (const f of failures) {
      console.log(`  ${f.id}: ${f.error}`)
    }
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
