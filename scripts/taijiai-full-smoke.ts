/**
 * BobAPI (taijiai.online) full end-to-end smoke.
 *
 * Step 1: GET /v1/models           — does BobAPI recognize the token at all?
 * Step 2: POST /v1/videos          — does the token have permission to SUBMIT a video?
 * Step 3: GET /v1/videos/<id>      — does the task poll endpoint work for a real id?
 * Step 4: Repeat poll 2 more times — confirm polling cadence works.
 *
 * The point: we go through the EXACT same code path the production worker
 * uses (TaijiaiSeedanceVideoGenerator + queryTaijiaiTaskStatus), so any
 * failure here is what the worker would hit too. If every step passes we
 * also report the resulting video URL.
 *
 * Run inside the prod container:
 *   docker exec kuiper-app npx tsx scripts/taijiai-full-smoke.ts
 */

import { getProviderConfig } from '@/lib/api-config'
import { prisma } from '@/lib/prisma'
import {
  TaijiaiSeedanceVideoGenerator,
  queryTaijiaiTaskStatus,
} from '@/lib/generators/video/taijiai'

function maskKey(value: string): string {
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 6)}${'•'.repeat(8)}${value.slice(-4)}`
}

async function resolveAdminId(): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) {
    console.error('[FAIL] No admin user in DB.')
    process.exit(2)
  }
  console.log(`[smoke] admin user: ${admin.name} (${admin.id})`)
  return admin.id
}

function bar(): void {
  console.log('─'.repeat(70))
}

async function step1ListModels(apiKey: string): Promise<void> {
  bar()
  console.log('[STEP 1] GET /v1/models — does BobAPI recognize the token?')
  const t0 = Date.now()
  const response = await fetch('https://www.taijiai.online/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const ms = Date.now() - t0
  const text = await response.text()
  console.log(`  → HTTP ${response.status} in ${ms}ms`)
  if (response.ok) {
    try {
      const json = JSON.parse(text) as { data?: Array<{ id?: string }> }
      const ids = (json.data || []).map((m) => m.id).filter(Boolean)
      const hasSeedance = ids.some((id) => typeof id === 'string' && id.includes('seedance'))
      console.log(`  → ${ids.length} models listed`)
      console.log(`  → seedance present in catalog? ${hasSeedance ? 'YES' : 'NO'}`)
      if (hasSeedance) {
        const seedanceIds = ids.filter((id) => id?.includes('seedance'))
        console.log(`  → seedance variants: ${seedanceIds.join(', ')}`)
      }
      console.log('  [PASS] token recognised at metadata level')
    } catch {
      console.log(`  → raw body: ${text.slice(0, 300)}`)
      console.log('  [PASS] response 200 but body not JSON (still considered OK for auth)')
    }
  } else {
    console.error(`  → body: ${text.slice(0, 300)}`)
    console.error('  [FAIL] token rejected even at /v1/models — key is fundamentally invalid')
  }
}

async function step2SubmitVideo(adminId: string): Promise<string | null> {
  bar()
  console.log('[STEP 2] POST /v1/videos — does token have permission to submit Seedance 2.0?')
  console.log('  (uses production TaijiaiSeedanceVideoGenerator)')

  const generator = new TaijiaiSeedanceVideoGenerator()
  const t0 = Date.now()
  const result = await generator.generate({
    userId: adminId,
    imageUrl: 'https://picsum.photos/seed/kuiperai-smoke/1280/720',
    prompt: 'A cinematic close-up of a coffee cup on a wooden table, soft morning light, no movement.',
    options: {
      duration: 4,
      aspectRatio: '16:9',
      generateAudio: false,
    },
  })
  const ms = Date.now() - t0
  console.log(`  → completed in ${ms}ms`)
  console.log(`  → success=${result.success}, async=${result.async}`)
  if (result.externalId) console.log(`  → externalId=${result.externalId}`)
  if (result.error) console.log(`  → error=${result.error}`)

  if (!result.success) {
    console.error('  [FAIL] submit rejected — see error message above')
    return null
  }
  if (!result.externalId?.startsWith('TAIJIAI:VIDEO:')) {
    console.error('  [FAIL] submit succeeded but externalId format unexpected')
    return null
  }

  const videoId = result.externalId.replace('TAIJIAI:VIDEO:', '')
  console.log(`  [PASS] BobAPI accepted submit, videoId=${videoId}`)
  return videoId
}

async function step3PollOnce(videoId: string, apiKey: string, label: string): Promise<{
  status: string
  videoUrl?: string
  error?: string
}> {
  bar()
  console.log(`[STEP 3 ${label}] GET /v1/videos/${videoId}`)
  const t0 = Date.now()
  const result = await queryTaijiaiTaskStatus(videoId, apiKey)
  const ms = Date.now() - t0
  console.log(`  → status=${result.status} in ${ms}ms`)
  if (result.videoUrl) console.log(`  → videoUrl=${result.videoUrl}`)
  if (result.error) console.log(`  → error=${result.error}`)
  return result
}

async function main(): Promise<void> {
  const adminId = await resolveAdminId()
  const { apiKey } = await getProviderConfig(adminId, 'taijiai')
  console.log(`[smoke] apiKey=${maskKey(apiKey)} (len=${apiKey.length})\n`)

  await step1ListModels(apiKey)
  const videoId = await step2SubmitVideo(adminId)
  if (!videoId) {
    bar()
    console.error('[STOP] cannot continue without a videoId from step 2')
    process.exit(1)
  }

  // Poll up to 3 times with 6s gap. Seedance 2.0 typically completes in
  // 30-90s but the point is to confirm the poll path works.
  let lastStatus = 'pending'
  for (let i = 1; i <= 3; i++) {
    const result = await step3PollOnce(videoId, apiKey, `poll ${i}/3`)
    lastStatus = result.status
    if (lastStatus !== 'pending') break
    if (i < 3) {
      console.log('  → sleeping 6s before next poll...')
      await new Promise((resolve) => setTimeout(resolve, 6000))
    }
  }

  bar()
  console.log(`[smoke] final status after 3 polls: ${lastStatus}`)
  if (lastStatus === 'completed') {
    console.log('[PASS] full end-to-end works — submit, poll, completion all green')
  } else if (lastStatus === 'pending') {
    console.log('[PASS] submit + poll plumbing works; video still processing (normal for Seedance 2.0)')
  } else {
    console.log('[INFO] task ended in non-completed state, see error above')
  }
}

main()
  .catch((err) => {
    console.error('\n[CRASH] smoke crashed:', err)
    process.exit(99)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
