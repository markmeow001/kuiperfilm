/**
 * Tencent VOD AIGC credential smoke test.
 *
 * Reads the user's encrypted tencent-vod provider config from the DB,
 * decrypts it, and pings Tencent's DescribeTaskDetail with a fake TaskId.
 * The expected outcome is a "NotFoundTaskId" style error — that means
 * authentication succeeded but the task doesn't exist (because it never
 * existed). Any other error pattern points at a specific credential issue.
 *
 * Costs: zero — DescribeTaskDetail on a non-existent task does not bill.
 *
 * Usage (on the droplet):
 *   ssh root@137.184.64.179
 *   cd /opt/kuiperAI
 *   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
 *     exec app sh -c 'cd /app && pnpm tsx --env-file=deploy/.env.prod scripts/tencent-vod-smoke.ts'
 *
 * --user <userId> is optional. When omitted, the first admin user is used.
 */

import { getProviderConfig } from '@/lib/api-config'
import { prisma } from '@/lib/prisma'
import { vod } from 'tencentcloud-sdk-nodejs-vod'

const VodClient = vod.v20180717.Client

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

/** When --user is omitted, fall back to the first admin user. */
async function resolveUserId(explicit: string | null): Promise<string> {
  if (explicit) return explicit
  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!admin) {
    console.error('\n❌ No admin user found in DB and no --user supplied.')
    console.error('   Run scripts/bootstrap-admin.ts first, or pass --user <userId> explicitly.')
    process.exit(2)
  }
  console.log(`[tencent-vod-smoke] no --user given, defaulting to admin: ${admin.name} (${admin.id})`)
  return admin.id
}

interface TencentVODCredentials {
  secretId: string
  secretKey: string
  subAppId: number
  region: string
}

function parseCredentials(apiKey: string): TencentVODCredentials {
  const parsed = JSON.parse(apiKey) as Record<string, unknown>
  const secretId = typeof parsed.secretId === 'string' ? parsed.secretId : ''
  const secretKey = typeof parsed.secretKey === 'string' ? parsed.secretKey : ''
  const subAppIdRaw = parsed.subAppId
  const subAppId = typeof subAppIdRaw === 'number' ? subAppIdRaw : Number(subAppIdRaw)
  const region = typeof parsed.region === 'string' && parsed.region ? parsed.region : 'ap-guangzhou'
  if (!secretId) throw new Error('secretId missing in stored credentials')
  if (!secretKey) throw new Error('secretKey missing in stored credentials')
  if (!Number.isFinite(subAppId) || subAppId <= 0) {
    throw new Error('subAppId missing or invalid in stored credentials')
  }
  return { secretId, secretKey, subAppId, region }
}

function maskSecret(value: string, keepStart = 4, keepEnd = 4): string {
  if (value.length <= keepStart + keepEnd) return '••••'
  return `${value.slice(0, keepStart)}${'•'.repeat(8)}${value.slice(-keepEnd)}`
}

interface InterpretedResult {
  ok: boolean
  verdict: string
  hint?: string
}

/**
 * Map a raw Tencent error message/code to an actionable verdict.
 * Tencent SDK errors carry a `code` field on the thrown object.
 */
function interpretError(err: unknown): InterpretedResult {
  const code = (err as { code?: string }).code || ''
  const message = err instanceof Error ? err.message : String(err)

  // The "good" failure path — authenticated, just no such task.
  if (code === 'InvalidParameter.NotFoundTaskId' || /NotFound.*Task/i.test(message)) {
    return {
      ok: true,
      verdict: 'AUTH OK — Tencent accepted the credentials and reported "task not found" (which is what we expected for a fake taskId).',
    }
  }

  if (code.startsWith('AuthFailure.SignatureFailure') || /Signature/i.test(message)) {
    return {
      ok: false,
      verdict: 'AUTH FAILED: Signature mismatch.',
      hint: 'SecretKey is wrong or has trailing whitespace. Double-check you copied the FULL key without truncation.',
    }
  }

  if (code === 'AuthFailure.SecretIdNotFound' || /SecretId.*Not.*Found/i.test(message)) {
    return {
      ok: false,
      verdict: 'AUTH FAILED: SecretId not found.',
      hint: 'The SecretId does not exist in Tencent CAM. Verify it at https://console.cloud.tencent.com/cam/capi',
    }
  }

  if (code === 'AuthFailure.UnauthorizedOperation' || /Unauthorized/i.test(message)) {
    return {
      ok: false,
      verdict: 'AUTH FAILED: Account lacks permission for VOD AIGC.',
      hint: 'The CAM key authenticated but is not authorised to call vod.DescribeTaskDetail. Confirm the key has VOD full-access policy attached.',
    }
  }

  if (code === 'FailedOperation.InvalidVodUser' || /InvalidVodUser/i.test(message)) {
    return {
      ok: false,
      verdict: 'VOD APPLICATION ISSUE: SubAppId is wrong, or the application is not enabled for AIGC.',
      hint: 'Check the SubAppId at https://console.cloud.tencent.com/vod/app-manage and confirm AIGC whitelist with your Tencent BD.',
    }
  }

  if (code === 'RequestLimitExceeded' || /RequestLimit/i.test(message)) {
    return {
      ok: false,
      verdict: 'RATE LIMIT: Tencent throttled this request. Try again in a moment.',
    }
  }

  return {
    ok: false,
    verdict: `UNRECOGNISED ERROR: ${code || '(no code)'} — ${message}`,
    hint: 'Run again with DEBUG=1 to see the full SDK response.',
  }
}

async function main() {
  const { userId: explicitUserId } = parseArgs()
  const userId = await resolveUserId(explicitUserId)

  console.log(`\n[tencent-vod-smoke] user=${userId}`)
  console.log('[tencent-vod-smoke] step 1/3: loading encrypted provider config…')

  let config: { apiKey: string }
  try {
    config = await getProviderConfig(userId, 'tencent-vod')
  } catch (err) {
    console.error('\n❌ FAILED to load tencent-vod config from DB.')
    console.error(`   Reason: ${err instanceof Error ? err.message : String(err)}`)
    console.error('   Check: did you save credentials in the admin UI for this user?')
    process.exit(1)
  }

  let creds: TencentVODCredentials
  try {
    creds = parseCredentials(config.apiKey)
  } catch (err) {
    console.error('\n❌ Decrypted apiKey is not valid JSON or missing fields.')
    console.error(`   Reason: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  console.log(`[tencent-vod-smoke] step 2/3: credentials decoded`)
  console.log(`   SecretId : ${maskSecret(creds.secretId)}`)
  console.log(`   SecretKey: ${maskSecret(creds.secretKey, 0, 4)}`)
  console.log(`   SubAppId : ${creds.subAppId}`)
  console.log(`   Region   : ${creds.region}`)
  console.log(`[tencent-vod-smoke] step 3/3: calling DescribeTaskDetail with a probe task id…`)

  const client = new VodClient({
    credential: { secretId: creds.secretId, secretKey: creds.secretKey },
    region: creds.region,
    profile: { httpProfile: { endpoint: 'vod.tencentcloudapi.com' } },
  })

  // Use a deterministically invalid TaskId — Tencent task ids look like
  // "<subAppId>-<TaskType>-<sha>" so anything else is guaranteed not to
  // collide with a real task.
  const probeTaskId = `kuiperai-smoke-${Date.now()}`

  try {
    const resp = await client.DescribeTaskDetail({
      TaskId: probeTaskId,
      SubAppId: creds.subAppId,
    } as never)
    // If we got here without throwing, Tencent silently returned an empty
    // response for a non-existent task — also a sign auth worked.
    console.log('\n✅ AUTH OK — DescribeTaskDetail returned a response (task not found, as expected).')
    if (process.env.DEBUG === '1') {
      console.log('   Response:', JSON.stringify(resp, null, 2))
    }
    process.exit(0)
  } catch (err) {
    if (process.env.DEBUG === '1') {
      console.error('\n[tencent-vod-smoke] raw error:', err)
    }
    const result = interpretError(err)
    console.log()
    console.log(result.ok ? `✅ ${result.verdict}` : `❌ ${result.verdict}`)
    if (result.hint) console.log(`   hint: ${result.hint}`)
    process.exit(result.ok ? 0 : 1)
  }
}

main().catch((err) => {
  console.error('\n[tencent-vod-smoke] unexpected crash:', err)
  process.exit(99)
})
