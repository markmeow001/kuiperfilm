import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { hasPanelLipSyncOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { composeModelKey, parseModelKeyStrict } from '@/lib/model-config-contract'
import {
  findNovelPromotionPanelByStoryboardIndexInProject,
  findNovelPromotionVoiceLineInProject,
} from '@/lib/novel-promotion/project-scope'

const DEFAULT_LIPSYNC_MODEL_KEY = composeModelKey('fal', 'fal-ai/kling-video/lipsync/audio-to-video')

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
  const storyboardId = body?.storyboardId
  const panelIndex = body?.panelIndex
  const voiceLineId = body?.voiceLineId
  const requestedLipSyncModel = typeof body?.lipSyncModel === 'string' ? body.lipSyncModel.trim() : ''

  if (
    typeof storyboardId !== 'string'
    || !storyboardId
    || panelIndex === undefined
    || typeof voiceLineId !== 'string'
    || !voiceLineId
  ) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (requestedLipSyncModel && !parseModelKeyStrict(requestedLipSyncModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: 'lipSyncModel',
    })
  }

  const panel = await findNovelPromotionPanelByStoryboardIndexInProject(
    projectId,
    storyboardId,
    Number(panelIndex),
  )
  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  const voiceLine = await findNovelPromotionVoiceLineInProject(projectId, voiceLineId)
  if (!voiceLine || voiceLine.episodeId !== panel.storyboard.episodeId) {
    throw new ApiError('NOT_FOUND')
  }

  const pref = await prisma.userPreference.findUnique({
    where: { userId: session.user.id },
    select: { lipSyncModel: true },
  })
  const preferredLipSyncModel = typeof pref?.lipSyncModel === 'string' ? pref.lipSyncModel.trim() : ''
  const resolvedLipSyncModel = requestedLipSyncModel || preferredLipSyncModel || DEFAULT_LIPSYNC_MODEL_KEY
  if (!parseModelKeyStrict(resolvedLipSyncModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'MODEL_KEY_INVALID',
      field: 'lipSyncModel',
    })
  }

  const payload = {
    ...body,
    voiceLineId: voiceLine.id,
    lipSyncModel: resolvedLipSyncModel,
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: panel.storyboard.episodeId,
    type: TASK_TYPE.LIP_SYNC,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload: withTaskUiPayload(payload, {
      hasOutputAtStart: await hasPanelLipSyncOutput(panel.id),
    }),
    dedupeKey: `lip_sync:${panel.id}:${voiceLine.id}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.LIP_SYNC, payload),
  })

  return NextResponse.json(result)
})
