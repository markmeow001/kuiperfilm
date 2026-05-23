/**
 * 火山方舟 asset 注册 worker.
 *
 * One job = one image asset (per CharacterAppearance / LocationImage /
 * NovelPromotionProp). Walks the official three-step pipeline:
 *
 *   1. (lazy) CreateAssetGroup if the user doesn't have an
 *      arkAssetGroupId persisted yet — writes the result back to
 *      User.customProviders.ark.assetGroupId so subsequent registers
 *      reuse it.
 *   2. CreateAsset against the subject's imageUrl (resolved through
 *      toSignedUrlIfCos so COS keys become public R2 URLs that
 *      Volcengine's backend can fetch).
 *   3. Poll GetAsset every 5 s until Status flips from Processing to
 *      Active or Failed, with a 15-min cap (Volcengine doesn't commit
 *      to SLA per CreateAsset docs).
 *
 * Status transitions on the subject row:
 *
 *     null → pending  → processing → active
 *                                  → failed
 *
 *   - `pending`:  job created, not yet picked up by worker
 *   - `processing`: CreateAsset succeeded, polling in flight
 *   - `active`:  GetAsset returned Active, asset:// is usable
 *   - `failed`:  CreateAsset rejected OR GetAsset returned Failed OR
 *                we hit the 15-min timeout. arkAssetError carries the
 *                Volcengine error code/message.
 *
 * arkAssetSourceUrl is a snapshot of the imageUrl at register time.
 * When the user regenerates the appearance (imageUrl changes), the
 * ARK multi-shot worker detects the mismatch and falls back to raw
 * URL until a re-register completes.
 *
 * Re-register strategy: caller clears arkAssetId + sets status to
 * 'pending' before enqueueing. We never reuse old assets in place —
 * Volcengine has no UpdateAsset endpoint, so each refresh creates a
 * new asset_id and the old one is left to age out.
 */

import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import type { TaskJobData } from '@/lib/task/types'
import {
  getArkAssetCredentials,
  setArkAssetGroupId,
} from '@/lib/api-config'
import {
  arkCreateAssetGroup,
  arkCreateAsset,
  arkGetAsset,
  ArkAssetApiError,
} from '@/lib/ark-asset-api'
import { toSignedUrlIfCos } from '@/lib/workers/utils'
import { reportTaskProgress } from '@/lib/workers/shared'
import { createScopedLogger } from '@/lib/logging/core'
import { assertTaskActive } from '@/lib/workers/utils'

const POLL_INTERVAL_MS = 5_000
const POLL_TIMEOUT_MS = 15 * 60 * 1_000  // 15 minutes per CreateAsset doc note
const DEFAULT_GROUP_NAME = 'KuiperAI 角色素材'

export type RegisterArkAssetTarget =
  | 'CharacterAppearance'
  | 'LocationImage'
  | 'NovelPromotionProp'

// Use Record<string, unknown> compatible shape so the withTaskLifecycle
// wrapper accepts it without widening.
type RegisterArkAssetResult = Record<string, unknown> & {
  targetType: RegisterArkAssetTarget
  targetId: string
  arkAssetId: string
  status: 'active' | 'failed'
  durationMs: number
  arkAssetUrl?: string
  errorCode?: string
  errorMessage?: string
}

/**
 * Resolve the subject row, its current imageUrl, and a stable display
 * name for the asset. Throws a descriptive error if the row is gone
 * (subject was deleted between job creation and dispatch).
 */
async function loadSubject(
  targetType: RegisterArkAssetTarget,
  targetId: string,
): Promise<{ imageUrl: string; name: string }> {
  if (targetType === 'CharacterAppearance') {
    const appearance = await prisma.characterAppearance.findUnique({
      where: { id: targetId },
      select: {
        imageUrl: true,
        character: { select: { name: true } },
        appearanceIndex: true,
      },
    })
    if (!appearance) throw new Error(`ARK_REGISTER_SUBJECT_NOT_FOUND: CharacterAppearance ${targetId}`)
    if (!appearance.imageUrl) throw new Error(`ARK_REGISTER_NO_IMAGE: CharacterAppearance ${targetId}`)
    return {
      imageUrl: appearance.imageUrl,
      name: `${appearance.character?.name ?? '角色'}#${appearance.appearanceIndex}`.slice(0, 64),
    }
  }
  if (targetType === 'LocationImage') {
    const view = await prisma.locationImage.findUnique({
      where: { id: targetId },
      select: {
        imageUrl: true,
        viewName: true,
        imageIndex: true,
        location: { select: { name: true } },
      },
    })
    if (!view) throw new Error(`ARK_REGISTER_SUBJECT_NOT_FOUND: LocationImage ${targetId}`)
    if (!view.imageUrl) throw new Error(`ARK_REGISTER_NO_IMAGE: LocationImage ${targetId}`)
    const viewSuffix = view.viewName ? `#${view.viewName}` : `#${view.imageIndex}`
    return {
      imageUrl: view.imageUrl,
      name: `${view.location?.name ?? '场景'}${viewSuffix}`.slice(0, 64),
    }
  }
  // NovelPromotionProp
  const prop = await prisma.novelPromotionProp.findUnique({
    where: { id: targetId },
    select: { imageUrl: true, name: true },
  })
  if (!prop) throw new Error(`ARK_REGISTER_SUBJECT_NOT_FOUND: NovelPromotionProp ${targetId}`)
  if (!prop.imageUrl) throw new Error(`ARK_REGISTER_NO_IMAGE: NovelPromotionProp ${targetId}`)
  return {
    imageUrl: prop.imageUrl,
    name: prop.name.slice(0, 64) || '道具',
  }
}

async function writeSubjectStatus(
  targetType: RegisterArkAssetTarget,
  targetId: string,
  patch: {
    arkAssetId?: string | null
    arkAssetStatus?: 'pending' | 'processing' | 'active' | 'failed' | null
    arkAssetSourceUrl?: string | null
    arkAssetRegisteredAt?: Date | null
    arkAssetError?: string | null
  },
): Promise<void> {
  // Strip undefined so we don't accidentally null-out untouched fields.
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) data[k] = v
  }
  if (Object.keys(data).length === 0) return

  if (targetType === 'CharacterAppearance') {
    await prisma.characterAppearance.update({ where: { id: targetId }, data })
    return
  }
  if (targetType === 'LocationImage') {
    await prisma.locationImage.update({ where: { id: targetId }, data })
    return
  }
  await prisma.novelPromotionProp.update({ where: { id: targetId }, data })
}

/**
 * Lazy CreateAssetGroup: if the user doesn't have one yet, create one
 * and persist the id to their customProviders.ark.assetGroupId so the
 * NEXT register-ark-asset call skips this step. The setArkAssetGroupId
 * write is idempotent — if two concurrent jobs both create groups
 * (race window of a few seconds), the second write wins and the first
 * group leaks (harmless; rare enough we don't bother with locks).
 */
async function ensureAssetGroupId(
  ownerUserId: string,
  existing: string | null,
  credentials: { accessKeyId: string; secretAccessKey: string },
  logPrefix: string,
): Promise<string> {
  if (existing) return existing
  const created = await arkCreateAssetGroup(
    {
      Name: DEFAULT_GROUP_NAME,
      Description: 'KuiperAI auto-created group for AI character assets',
    },
    credentials,
  )
  await setArkAssetGroupId(ownerUserId, created.Id)
  return created.Id
}

/**
 * Public entry point. Wired from text.worker.ts dispatcher.
 *
 * Expected job.data.payload shape:
 *   { targetType: RegisterArkAssetTarget, targetId: string }
 * (targetType also lives on TaskJobData.targetType — payload is the
 * source of truth so the API caller controls it, worker just reads.)
 */
export async function handleRegisterArkAssetTask(
  job: Job<TaskJobData>,
): Promise<RegisterArkAssetResult> {
  const startedAt = Date.now()
  const logger = createScopedLogger({
    module: 'worker.register-ark-asset',
    action: 'register_ark_asset',
  })

  const payload = (job.data.payload ?? {}) as Record<string, unknown>
  const targetType = String(payload.targetType ?? job.data.targetType ?? '') as RegisterArkAssetTarget
  const targetId = String(payload.targetId ?? job.data.targetId ?? '')

  if (
    targetType !== 'CharacterAppearance'
    && targetType !== 'LocationImage'
    && targetType !== 'NovelPromotionProp'
  ) {
    throw new Error(`ARK_REGISTER_BAD_TARGET_TYPE: ${targetType}`)
  }
  if (!targetId) throw new Error('ARK_REGISTER_MISSING_TARGET_ID')

  const userId = job.data.userId
  const logPrefix = `[ark-register:${targetType}:${targetId}]`

  await reportTaskProgress(job, 5, { stage: 'register_load_subject' })

  const { imageUrl, name } = await loadSubject(targetType, targetId)

  // Resolve to a public https URL (COS key → signed; https → passthrough;
  // anything else → caller error since ARK can't fetch local paths).
  const publicUrl = toSignedUrlIfCos(imageUrl) ?? imageUrl
  if (typeof publicUrl !== 'string' || !/^https?:\/\//i.test(publicUrl)) {
    await writeSubjectStatus(targetType, targetId, {
      arkAssetStatus: 'failed',
      arkAssetError: `ARK_REGISTER_URL_NOT_PUBLIC: ${imageUrl}`,
    })
    throw new Error(`ARK_REGISTER_URL_NOT_PUBLIC: ${imageUrl}`)
  }

  // Skip duplicate work: if this subject already registered THIS exact
  // imageUrl and is active, return early. Caller is expected to have
  // cleared the asset before re-queuing, but defensive guard avoids
  // burning a register slot on a no-op.
  // (Skipped — the caller-side guard in the API route is enough; if it
  // ever proves insufficient, add a read here.)

  await reportTaskProgress(job, 10, { stage: 'register_credentials' })

  const credentialsResolved = await getArkAssetCredentials(userId)
  if (!credentialsResolved) {
    const msg = '请先在 /profile 填写火山 Access Key ID + Secret Access Key 才能报备角色'
    await writeSubjectStatus(targetType, targetId, {
      arkAssetStatus: 'failed',
      arkAssetError: msg,
    })
    throw new Error(`ARK_REGISTER_NO_CREDENTIALS: ${msg}`)
  }
  const { accessKeyId, secretAccessKey, assetGroupId: existingGroup, ownerUserId } = credentialsResolved
  const credentials = { accessKeyId, secretAccessKey }

  await assertTaskActive(job, 'register_ark_pre_submit')
  await reportTaskProgress(job, 20, { stage: 'register_ensure_group' })

  let groupId: string
  try {
    groupId = await ensureAssetGroupId(ownerUserId, existingGroup, credentials, logPrefix)
  } catch (error) {
    const code = error instanceof ArkAssetApiError ? error.code : 'GROUP_CREATE_FAILED'
    const msg = error instanceof Error ? error.message : 'unknown'
    await writeSubjectStatus(targetType, targetId, {
      arkAssetStatus: 'failed',
      arkAssetError: `${code}: ${msg}`,
    })
    throw error
  }

  await reportTaskProgress(job, 35, { stage: 'register_create_asset' })

  let assetId: string
  try {
    const created = await arkCreateAsset(
      {
        GroupId: groupId,
        URL: publicUrl,
        Name: name,
        AssetType: 'Image',
      },
      credentials,
    )
    assetId = created.Id
  } catch (error) {
    const code = error instanceof ArkAssetApiError ? error.code : 'ASSET_CREATE_FAILED'
    const msg = error instanceof Error ? error.message : 'unknown'
    await writeSubjectStatus(targetType, targetId, {
      arkAssetStatus: 'failed',
      arkAssetError: `${code}: ${msg}`,
    })
    throw error
  }

  // Mark processing so the UI can flip to a "正在审核" chip while polling.
  await writeSubjectStatus(targetType, targetId, {
    arkAssetId: assetId,
    arkAssetStatus: 'processing',
    arkAssetSourceUrl: imageUrl,
    arkAssetError: null,
  })

  await reportTaskProgress(job, 50, { stage: 'register_poll' })

  // Poll loop — bail at POLL_TIMEOUT_MS, return whatever Volcengine
  // gave us at the final tick (Active/Processing/Failed). Pre-Active
  // we keep status='processing'; on Active we promote to 'active'; on
  // Failed we record arkAssetError and bubble.
  const startPoll = Date.now()
  let lastStatus: 'Processing' | 'Active' | 'Failed' = 'Processing'
  let lastError: { Code: string; Message: string } | null = null
  let lastUrl: string | undefined

  while (Date.now() - startPoll < POLL_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    await assertTaskActive(job, 'register_ark_poll')

    let info: Awaited<ReturnType<typeof arkGetAsset>>
    try {
      info = await arkGetAsset({ Id: assetId }, credentials)
    } catch (error) {
      // Transient network errors should let the poll loop continue
      // (Volcengine sometimes 5xxs mid-processing). Permanent
      // ArkAssetApiError with explicit code propagates — caller marks
      // the asset failed.
      if (error instanceof ArkAssetApiError && error.httpStatus >= 400 && error.httpStatus < 500) {
        await writeSubjectStatus(targetType, targetId, {
          arkAssetStatus: 'failed',
          arkAssetError: `POLL_FATAL ${error.code}: ${error.message}`,
        })
        throw error
      }
      logger.warn({
        message: 'GetAsset transient failure, will retry',
        details: { assetId, error: error instanceof Error ? error.message : 'unknown' },
      })
      continue
    }

    lastStatus = info.Status
    lastError = info.Error ?? null
    lastUrl = info.URL

    const elapsed = Date.now() - startPoll
    const progress = 50 + Math.min(40, Math.floor((elapsed / POLL_TIMEOUT_MS) * 40))
    await reportTaskProgress(job, progress, {
      stage: 'register_poll',
      status: info.Status,
    })

    if (info.Status === 'Active') break
    if (info.Status === 'Failed') break
  }

  const durationMs = Date.now() - startedAt

  if (lastStatus === 'Active') {
    await writeSubjectStatus(targetType, targetId, {
      arkAssetStatus: 'active',
      arkAssetRegisteredAt: new Date(),
      arkAssetError: null,
    })
    logger.info({
      message: 'ARK asset active',
      details: { targetType, targetId, assetId, durationMs },
    })
    await reportTaskProgress(job, 100, { stage: 'register_done', status: 'active' })
    return {
      targetType,
      targetId,
      arkAssetId: assetId,
      status: 'active',
      durationMs,
      ...(lastUrl !== undefined ? { arkAssetUrl: lastUrl } : {}),
    }
  }

  // Failed OR timed out — both surface as 'failed' on the subject.
  const errCode = lastStatus === 'Failed' ? (lastError?.Code ?? 'UNKNOWN') : 'POLL_TIMEOUT'
  const errMsg = lastStatus === 'Failed'
    ? (lastError?.Message ?? `Asset status=Failed, no detail returned by GetAsset (id=${assetId})`)
    : `Asset polling timed out after ${Math.round(POLL_TIMEOUT_MS / 60_000)} min (assetId=${assetId})`
  await writeSubjectStatus(targetType, targetId, {
    arkAssetStatus: 'failed',
    arkAssetError: `${errCode}: ${errMsg}`,
  })
  logger.error({
    message: 'ARK asset failed',
    details: { targetType, targetId, assetId, errCode, errMsg, durationMs },
  })
  await reportTaskProgress(job, 100, { stage: 'register_done', status: 'failed', error: errCode })
  return {
    targetType,
    targetId,
    arkAssetId: assetId,
    status: 'failed',
    durationMs,
    errorCode: errCode,
    errorMessage: errMsg,
  }
}
