import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'

/**
 * 火山方舟 asset 注册触发 API.
 *
 * POST /api/novel-promotion/[projectId]/ark-asset/register
 *
 * Body: { targetType: 'CharacterAppearance' | 'LocationImage' | 'NovelPromotionProp', targetId: string }
 *
 * Behaviour:
 *   1. Verifies the subject belongs to this project (security gate —
 *      a member with project access shouldn't be able to register
 *      arbitrary IDs from other projects).
 *   2. Verifies the subject has an imageUrl (no point registering an
 *      asset that doesn't exist yet — caller should generate the image
 *      first).
 *   3. Idempotent guard: if the subject already has arkAssetStatus =
 *      'active' AND arkAssetSourceUrl matches the current imageUrl,
 *      returns the existing asset_id without re-queuing — saves quota.
 *   4. Marks the row arkAssetStatus='pending' before enqueueing so the
 *      UI can flip immediately.
 *   5. Enqueues REGISTER_ARK_ASSET task to the text queue.
 *
 * Returns:
 *   - { reused: true, arkAssetId, status: 'active' }  — when guard hit
 *   - { taskId, status: 'pending' }                   — when enqueued
 */
type SubjectTargetType = 'CharacterAppearance' | 'LocationImage' | 'NovelPromotionProp'

function isSubjectTargetType(value: unknown): value is SubjectTargetType {
  return value === 'CharacterAppearance' || value === 'LocationImage' || value === 'NovelPromotionProp'
}

/** Verify subject belongs to project + return current imageUrl + cached arkAsset state. */
async function loadSubjectForRegister(
  targetType: SubjectTargetType,
  targetId: string,
  projectId: string,
): Promise<{
  imageUrl: string | null
  arkAssetId: string | null
  arkAssetStatus: string | null
  arkAssetSourceUrl: string | null
} | null> {
  if (targetType === 'CharacterAppearance') {
    const row = await prisma.characterAppearance.findUnique({
      where: { id: targetId },
      select: {
        imageUrl: true,
        arkAssetId: true,
        arkAssetStatus: true,
        arkAssetSourceUrl: true,
        character: { select: { novelPromotionProjectId: true } },
      },
    })
    if (!row || row.character?.novelPromotionProjectId !== projectId) return null
    return {
      imageUrl: row.imageUrl,
      arkAssetId: row.arkAssetId,
      arkAssetStatus: row.arkAssetStatus,
      arkAssetSourceUrl: row.arkAssetSourceUrl,
    }
  }
  if (targetType === 'LocationImage') {
    const row = await prisma.locationImage.findUnique({
      where: { id: targetId },
      select: {
        imageUrl: true,
        arkAssetId: true,
        arkAssetStatus: true,
        arkAssetSourceUrl: true,
        location: { select: { novelPromotionProjectId: true } },
      },
    })
    if (!row || row.location?.novelPromotionProjectId !== projectId) return null
    return {
      imageUrl: row.imageUrl,
      arkAssetId: row.arkAssetId,
      arkAssetStatus: row.arkAssetStatus,
      arkAssetSourceUrl: row.arkAssetSourceUrl,
    }
  }
  // NovelPromotionProp
  const row = await prisma.novelPromotionProp.findUnique({
    where: { id: targetId },
    select: {
      imageUrl: true,
      arkAssetId: true,
      arkAssetStatus: true,
      arkAssetSourceUrl: true,
      novelPromotionProjectId: true,
    },
  })
  if (!row || row.novelPromotionProjectId !== projectId) return null
  return {
    imageUrl: row.imageUrl,
    arkAssetId: row.arkAssetId,
    arkAssetStatus: row.arkAssetStatus,
    arkAssetSourceUrl: row.arkAssetSourceUrl,
  }
}

async function markSubjectPending(
  targetType: SubjectTargetType,
  targetId: string,
): Promise<void> {
  const data = {
    arkAssetStatus: 'pending',
    arkAssetError: null,
  }
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

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId, { action: 'write' })
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const locale = resolveRequiredTaskLocale(request, body)

  const targetType = body.targetType
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : ''
  if (!isSubjectTargetType(targetType) || !targetId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ARK_REGISTER_BAD_INPUT',
      details: { message: 'targetType must be CharacterAppearance / LocationImage / NovelPromotionProp; targetId required' },
    })
  }

  // Cross-project access guard. loadSubjectForRegister also checks
  // projectId ownership so a user who somehow forges an unrelated
  // targetId can't burn another tenant's ARK quota.
  const subject = await loadSubjectForRegister(targetType, targetId, projectId)
  if (!subject) {
    throw new ApiError('NOT_FOUND', {
      code: 'ARK_REGISTER_SUBJECT_NOT_FOUND',
      details: { targetType, targetId },
    })
  }

  if (!subject.imageUrl) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ARK_REGISTER_NO_IMAGE',
      details: { message: '此素材尚未生成图片，请先生成图片再报备火山' },
    })
  }

  // Idempotent guard: if already active AND imageUrl unchanged since
  // last register, no-op. Caller-side UI will show the existing chip.
  if (
    subject.arkAssetStatus === 'active'
    && subject.arkAssetId
    && subject.arkAssetSourceUrl === subject.imageUrl
  ) {
    return NextResponse.json({
      reused: true,
      arkAssetId: subject.arkAssetId,
      status: 'active',
    })
  }

  // Mark pending so the UI chip flips immediately (no blank period
  // while we wait for the worker to pick up the queued job).
  await markSubjectPending(targetType, targetId)

  const payload = {
    targetType,
    targetId,
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.REGISTER_ARK_ASSET,
    targetType,
    targetId,
    payload,
    // Dedupe per (type, targetId): two clicks of "报备火山" inside
    // a few seconds collapse into one job. Matches the submitTask
    // pattern used by VOICE_DESIGN / VIDEO_MULTI_SHOT etc.
    dedupeKey: `${TASK_TYPE.REGISTER_ARK_ASSET}:${targetType}:${targetId}`,
  })

  return NextResponse.json({
    reused: false,
    taskId: result.taskId,
    status: 'pending',
  })
})
