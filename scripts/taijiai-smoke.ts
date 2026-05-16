/**
 * BobAPI (taijiai.online) credential smoke test.
 *
 * Reads the user's encrypted taijiai provider config from the DB, decrypts
 * it, and hits GET /v1/videos/<probe-id> with that key. The expected
 * outcome is a 404 "not found" / "Invalid id" — that means authentication
 * succeeded and the gateway only refuses because the probe id doesn't
 * exist. A 401 means the key itself is bad.
 *
 * Costs: zero — looking up a non-existent video id is free.
 *
 * Usage (on the droplet):
 *   docker exec kuiper-app npx tsx scripts/taijiai-smoke.ts
 */

import { getProviderConfig } from '@/lib/api-config'
import { prisma } from '@/lib/prisma'

interface ParsedArgs {
  userId: string | null
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2)
  let userId: string | null = null
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--user' || argv[i] === '-u') && argv[i + 1]) {
      userId = argv[i + 1]
      i++
    }
  }
  return { userId }
}

async function resolveUserId(explicit: string | null): Promise<string> {
  if (explicit) return explicit
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) {
    console.error('\n[FAIL] No admin user found in DB and no --user supplied.')
    process.exit(2)
  }
  console.log(`[taijiai-smoke] no --user given, defaulting to admin: ${admin.name} (${admin.id})`)
  return admin.id
}

function maskKey(value: string): string {
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 6)}${'•'.repeat(8)}${value.slice(-4)}`
}

async function main(): Promise<void> {
  const args = parseArgs()
  const userId = await resolveUserId(args.userId)

  let apiKey: string
  try {
    const config = await getProviderConfig(userId, 'taijiai')
    apiKey = config.apiKey
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`\n[FAIL] Could not load taijiai provider config: ${message}`)
    console.error('   Make sure the user has filled in the BobAPI key at /profile → API Config → 视频模型.')
    process.exit(3)
  }

  if (!apiKey) {
    console.error('\n[FAIL] taijiai apiKey is empty in DB.')
    process.exit(3)
  }

  console.log(`[taijiai-smoke] apiKey loaded: ${maskKey(apiKey)} (len=${apiKey.length})`)

  const probeId = `smoke-${Math.random().toString(36).slice(2, 10)}`
  const url = `https://www.taijiai.online/v1/videos/${probeId}`
  console.log(`[taijiai-smoke] probing GET ${url}`)
  const t0 = Date.now()
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const elapsedMs = Date.now() - t0
  const text = await response.text()

  console.log(`[taijiai-smoke] HTTP ${response.status} in ${elapsedMs}ms`)
  console.log(`[taijiai-smoke] body: ${text.slice(0, 300)}`)

  if (response.status === 401) {
    console.error('\n[FAIL] AUTH FAILED — BobAPI rejected the key.')
    console.error('   Check key was copied without whitespace and the group is "banana Pro 官转".')
    process.exit(1)
  }

  if (response.status === 404 || response.status === 422 || response.status === 400) {
    console.log('\n[PASS] AUTH OK — BobAPI accepted the key, refused only because probe id does not exist.')
    process.exit(0)
  }

  if (response.status >= 200 && response.status < 300) {
    console.log('\n[PASS] Got 2xx (unexpected but key works).')
    process.exit(0)
  }

  console.error(`\n[FAIL] Unexpected HTTP ${response.status}.`)
  process.exit(1)
}

main()
  .catch((err) => {
    console.error('\n[FAIL] Smoke test crashed:', err)
    process.exit(99)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
