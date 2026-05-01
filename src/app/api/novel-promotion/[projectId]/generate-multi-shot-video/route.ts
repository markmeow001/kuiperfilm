import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
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
  if (!isRecord(body)) {
    throw new ApiError('INVALID_PARAMS')
  }

  const locale = resolveRequiredTaskLocale(request, body)

  // Validate panelIds
  const panelIds = body.panelIds
  if (!Array.isArray(panelIds) || panelIds.length < 2 || panelIds.length > 6) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PANEL_IDS_INVALID',
      field: 'panelIds',
      details: { message: 'panelIds must be an array of 2-6 panel IDs' },
    })
  }

  for (const id of panelIds) {
    if (typeof id !== 'string' || !id.trim()) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PANEL_IDS_INVALID',
        field: 'panelIds',
      })
    }
  }

  // Validate videoModel
  const videoModel = body.videoModel
  if (typeof videoModel !== 'string' || !videoModel.trim()) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_MODEL_REQUIRED',
      field: 'videoModel',
    })
  }

  // Optional multi-shot mode (B-path only). Defaults to model-decides
  // when omitted; passing it explicitly is required to send
  // panelDurations through with non-default behaviour.
  const multiShotMode =
    body.multiShotMode === 'customize' || body.multiShotMode === 'intelligence'
      ? body.multiShotMode
      : undefined

  // Optional intelligence-mode prompt style. Defaults to auto-seedance
  // in the worker when undefined; only the explicit opt-out value
  // 'panel-numbered' falls back to the legacy `镜头N:` concatenation.
  const promptStyle =
    body.promptStyle === 'auto-seedance' || body.promptStyle === 'panel-numbered'
      ? body.promptStyle
      : undefined

  // Optional caller-supplied prompt for intelligence mode (Seedance-style
  // 5-element 15s segment). Worker still appends matched dialogue.
  let rawPrompt: string | undefined
  if (body.rawPrompt !== undefined) {
    if (typeof body.rawPrompt !== 'string') {
      throw new ApiError('INVALID_PARAMS', {
        code: 'RAW_PROMPT_INVALID',
        field: 'rawPrompt',
        details: { message: 'rawPrompt must be a string' },
      })
    }
    const trimmed = body.rawPrompt.trim()
    if (trimmed.length === 0) {
      // Treat empty/whitespace as "not provided" rather than rejecting —
      // makes UI debouncing trivial.
      rawPrompt = undefined
    } else if (trimmed.length > 4000) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'RAW_PROMPT_TOO_LONG',
        field: 'rawPrompt',
        details: { length: trimmed.length, max: 4000 },
      })
    } else {
      rawPrompt = trimmed
    }
  }

  // Optional per-shot durations (B-path customize mode). Length must
  // match panelIds; each ≥1; sum 5-15s (Kling Omni constraint). Heavy
  // validation lives in the worker; route only screens the shape so
  // bad input fails fast with a clear field name.
  let panelDurations: number[] | undefined
  if (body.panelDurations !== undefined) {
    if (!Array.isArray(body.panelDurations)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PANEL_DURATIONS_INVALID',
        field: 'panelDurations',
        details: { message: 'panelDurations must be an array of numbers' },
      })
    }
    if (body.panelDurations.length !== panelIds.length) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PANEL_DURATIONS_LENGTH_MISMATCH',
        field: 'panelDurations',
        details: {
          expected: panelIds.length,
          got: body.panelDurations.length,
        },
      })
    }
    const arr: number[] = []
    for (const d of body.panelDurations) {
      if (typeof d !== 'number' || !Number.isFinite(d) || d < 1) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'PANEL_DURATION_INVALID',
          field: 'panelDurations',
          details: { message: 'each duration must be a finite number ≥1' },
        })
      }
      arr.push(d)
    }
    const total = arr.reduce((a, b) => a + b, 0)
    if (total < 5 || total > 15) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PANEL_DURATIONS_TOTAL_OUT_OF_RANGE',
        field: 'panelDurations',
        details: { total, min: 5, max: 15 },
      })
    }
    panelDurations = arr
  }

  // Verify all panels exist and have imageUrl
  const panels = await prisma.novelPromotionPanel.findMany({
    where: { id: { in: panelIds } },
    select: { id: true, imageUrl: true, storyboardId: true },
  })

  if (panels.length !== panelIds.length) {
    throw new ApiError('NOT_FOUND', {
      code: 'PANELS_NOT_FOUND',
      details: { expected: panelIds.length, found: panels.length },
    })
  }

  // Panel imageUrl is required only on the C path (KieAI / image-to-video).
  // On the B path (Tencent VOD Kling-3 / Omni with multi_shot=intelligence)
  // the model is text-to-video and SubjectInfos.N carries the per-character
  // reference, so we accept text-only panels. Detect by videoModel string —
  // mirrors shouldUseTencentBPath in the worker handler.
  const isBPath = /^tencent-vod::Kling-(3|O1)/i.test(videoModel)
  if (!isBPath) {
    const panelsWithoutImage = panels.filter((p) => !p.imageUrl)
    if (panelsWithoutImage.length > 0) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'PANELS_MISSING_IMAGE',
        details: {
          panelIds: panelsWithoutImage.map((p) => p.id),
          message: 'All panels must have a generated image before multi-shot video generation',
        },
      })
    }
  }

  // Use the storyboard of the first panel as target
  const storyboard = await prisma.novelPromotionStoryboard.findFirst({
    where: { id: panels[0].storyboardId },
    select: { id: true, episodeId: true },
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND', {
      code: 'STORYBOARD_NOT_FOUND',
    })
  }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: storyboard.episodeId,
    type: TASK_TYPE.VIDEO_MULTI_SHOT,
    targetType: 'NovelPromotionStoryboard',
    targetId: storyboard.id,
    payload: {
      panelIds,
      videoModel,
      mode: typeof body.mode === 'string' ? body.mode : undefined,
      sound: typeof body.sound === 'boolean' ? body.sound : undefined,
      aspectRatio: typeof body.aspectRatio === 'string' ? body.aspectRatio : undefined,
      ...(multiShotMode ? { multiShotMode } : {}),
      ...(panelDurations ? { panelDurations } : {}),
      ...(rawPrompt ? { rawPrompt } : {}),
      ...(promptStyle ? { promptStyle } : {}),
    },
    dedupeKey: `video_multi_shot:${storyboard.id}`,
  })

  return NextResponse.json(result)
})
