import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { getProjectModelConfig, buildImageBillingPayload } from '@/lib/config-service'
import {
  hasCharacterAppearanceOutput,
  hasLocationImageOutput
} from '@/lib/task/has-output'

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const locale = resolveRequiredTaskLocale(request, body)
  const type = body?.type
  const id = body?.id
  const appearanceId = body?.appearanceId

  if (!type || !id) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (type !== 'character' && type !== 'location' && type !== 'prop') {
    throw new ApiError('INVALID_PARAMS')
  }

  const taskType =
    type === 'character' ? TASK_TYPE.IMAGE_CHARACTER
    : type === 'location' ? TASK_TYPE.IMAGE_LOCATION
    : TASK_TYPE.IMAGE_PROP
  const targetType =
    type === 'character' ? 'CharacterAppearance'
    : type === 'location' ? 'LocationImage'
    : 'NovelPromotionProp'
  const targetId = type === 'character' ? (appearanceId || id) : id

  if (!targetId) {
    throw new ApiError('INVALID_PARAMS')
  }
  const imageIndex = toNumber(body?.imageIndex)
  // Props don't have an existing-output detector (no per-prop image
  // index — at most one image per prop). Treat as "no prior output"
  // for the billing UI hint.
  const hasOutputAtStart = type === 'character'
    ? await hasCharacterAppearanceOutput({
      appearanceId: targetId,
      characterId: id,
      appearanceIndex: toNumber(body?.appearanceIndex)
    })
    : type === 'location'
      ? await hasLocationImageOutput({
        locationId: id,
        imageIndex
      })
      : false

  const projectModelConfig = await getProjectModelConfig(projectId, session.user.id)
  const imageModel = type === 'character'
    ? projectModelConfig.characterModel
    : projectModelConfig.locationModel  // prop reuses locationModel — same visual style class

  let billingPayload: Record<string, unknown>
  try {
    billingPayload = await buildImageBillingPayload({
      projectId,
      userId: session.user.id,
      imageModel,
      basePayload: body,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image model capability not configured'
    throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }
  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: taskType,
    targetType,
    targetId,
    payload: withTaskUiPayload(billingPayload, { hasOutputAtStart }),
    dedupeKey: `${taskType}:${targetId}`,
    billingInfo: buildDefaultTaskBillingInfo(taskType, billingPayload)
  })

  return NextResponse.json(result)
})

