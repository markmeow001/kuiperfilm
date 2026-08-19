import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { BILLING_CURRENCY, buildDefaultTaskBillingInfo } from '@/lib/billing'
import { BillingOperationError } from '@/lib/billing/errors'
import { hasPanelVideoOutput } from '@/lib/task/has-output'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { parseModelKeyStrict, type CapabilityValue } from '@/lib/model-config-contract'
import {
  resolveBuiltinCapabilitiesByModelKey,
} from '@/lib/model-capabilities/lookup'
import { resolveBuiltinPricing } from '@/lib/model-pricing/lookup'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import {
  findNovelPromotionEpisodeInProject,
  findNovelPromotionPanelByStoryboardIndexInProject,
  requireNovelPromotionPanelInProject,
} from '@/lib/novel-promotion/project-scope'
import {
  issueStoryboardBatchVideoQuote,
  verifyStoryboardBatchVideoQuote,
  type StoryboardBatchVideoJsonValue,
  type StoryboardBatchVideoQuoteClaims,
} from '@/lib/novel-promotion/storyboard-batch-video-quote'
import {
  buildStoryboardBatchVideoGenerationIdentity,
  buildStoryboardBatchVideoPanelSource,
  isStoryboardBatchVideoPanelSourceCurrent,
  readStoryboardBatchVideoTaskIdentity,
} from '@/lib/novel-promotion/storyboard-batch-video-source'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function toVideoRuntimeSelections(value: unknown): Record<string, CapabilityValue> {
  if (!isRecord(value)) return {}
  const selections: Record<string, CapabilityValue> = {}
  for (const [field, raw] of Object.entries(value)) {
    if (field === 'aspectRatio' || field === 'includeDialogue') continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      selections[field] = raw
    }
  }
  return selections
}

function resolveVideoGenerationMode(payload: unknown): 'normal' | 'firstlastframe' {
  if (!isRecord(payload)) return 'normal'
  return isRecord(payload.firstLastFrame) ? 'firstlastframe' : 'normal'
}

function resolveVideoModelKeyFromPayload(payload: Record<string, unknown>): string | null {
  const firstLast = isRecord(payload.firstLastFrame) ? payload.firstLastFrame : null
  if (firstLast && typeof firstLast.flModel === 'string' && parseModelKeyStrict(firstLast.flModel)) {
    return firstLast.flModel
  }
  if (typeof payload.videoModel === 'string' && parseModelKeyStrict(payload.videoModel)) {
    return payload.videoModel
  }
  return null
}

function requireVideoModelKeyFromPayload(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.videoModel !== 'string' || !parseModelKeyStrict(payload.videoModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_MODEL_REQUIRED',
      field: 'videoModel',
    })
  }
  return payload.videoModel
}

function validateFirstLastFrameModel(input: unknown) {
  if (input === undefined || input === null) return
  if (!isRecord(input)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_PAYLOAD_INVALID',
      field: 'firstLastFrame',
    })
  }

  const flModel = input.flModel
  if (typeof flModel !== 'string' || !parseModelKeyStrict(flModel)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_MODEL_INVALID',
      field: 'firstLastFrame.flModel',
    })
  }

  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', flModel)
  if (capabilities?.video?.firstlastframe !== true) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIRSTLASTFRAME_MODEL_UNSUPPORTED',
      field: 'firstLastFrame.flModel',
    })
  }
}

async function validateVideoCapabilityCombination(input: {
  payload: unknown
  projectId: string
  userId: string
}) {
  const payload = input.payload
  if (!isRecord(payload)) return
  const modelKey = resolveVideoModelKeyFromPayload(payload)
  if (!modelKey) return

  // Skip validation for models not in the built-in capability catalog
  const builtinCaps = resolveBuiltinCapabilitiesByModelKey('video', modelKey)
  if (!builtinCaps) return

  const runtimeSelections = toVideoRuntimeSelections(payload.generationOptions)
  runtimeSelections.generationMode = resolveVideoGenerationMode(payload)

  let resolvedOptions: Record<string, CapabilityValue>
  try {
    resolvedOptions = await resolveProjectModelCapabilityGenerationOptions({
      projectId: input.projectId,
      userId: input.userId,
      modelType: 'video',
      modelKey,
      runtimeSelections,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[generate-video] capability resolution failed:', { modelKey, runtimeSelections, message })
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
      field: 'generationOptions',
      details: {
        model: modelKey,
        selections: runtimeSelections,
        message,
      },
    })
  }

  const resolution = resolveBuiltinPricing({
    apiType: 'video',
    model: modelKey,
    selections: resolvedOptions,
  })
  if (resolution.status === 'missing_capability_match') {
    console.error('[generate-video] pricing resolution failed:', { modelKey, resolvedOptions, status: resolution.status })
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
      field: 'generationOptions',
      details: {
        model: modelKey,
        selections: resolvedOptions,
      },
    })
  }
}

function buildVideoPanelBillingInfoOrThrow(payload: unknown) {
  try {
    return buildDefaultTaskBillingInfo(TASK_TYPE.VIDEO_PANEL, isRecord(payload) ? payload : null)
  } catch (error) {
    if (
      error instanceof BillingOperationError
      && (
        error.code === 'BILLING_UNKNOWN_VIDEO_CAPABILITY_COMBINATION'
        || error.code === 'BILLING_UNKNOWN_VIDEO_RESOLUTION'
      )
    ) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_CAPABILITY_COMBINATION_UNSUPPORTED',
        field: 'generationOptions',
      })
    }
    // Model not in built-in pricing catalog — allow task to proceed;
    // actual billing will be resolved downstream where billing mode is checked.
    if (
      error instanceof BillingOperationError
      && error.code === 'BILLING_UNKNOWN_MODEL'
    ) {
      return null
    }
    throw error
  }
}

type BatchVideoIntent = 'estimate' | 'submit'

function resolveBatchVideoIntent(value: unknown): BatchVideoIntent {
  if (value === 'estimate' || value === 'submit') return value
  throw new ApiError('INVALID_PARAMS', {
    code: value === undefined || value === null
      ? 'BATCH_VIDEO_INTENT_REQUIRED'
      : 'BATCH_VIDEO_INTENT_INVALID',
    field: 'intent',
  })
}

const BATCH_VIDEO_PRICING_VERSION = 'storyboard-video-v1'

function normalizeBatchVideoSettings(body: Record<string, unknown>): StoryboardBatchVideoQuoteClaims['settings'] {
  const videoModel = requireVideoModelKeyFromPayload(body)
  const generationOptions = body.generationOptions
  if (generationOptions !== undefined && !isRecord(generationOptions)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'VIDEO_GENERATION_OPTIONS_INVALID',
      field: 'generationOptions',
    })
  }
  const normalizedOptions: Record<string, StoryboardBatchVideoJsonValue> = {}
  for (const [key, value] of Object.entries(generationOptions || {})) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_GENERATION_OPTIONS_INVALID',
        field: `generationOptions.${key}`,
      })
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'VIDEO_GENERATION_OPTIONS_INVALID',
        field: `generationOptions.${key}`,
      })
    }
    normalizedOptions[key] = value
  }
  return {
    videoModel,
    ...(Object.keys(normalizedOptions).length > 0
      ? { generationOptions: normalizedOptions }
      : {}),
  }
}

function quoteConflict(code: string, message: string): never {
  throw new ApiError('CONFLICT', { code, message })
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize)
    if (!isRecord(value)) return value
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalize(value[key])]),
    )
  }
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}

function estimatedCostFromBillingInfo(value: unknown): number | null {
  if (!isRecord(value)) return null
  if (value.billable === false) return 0
  const cost = value.maxFrozenCost
  return typeof cost === 'number' && Number.isFinite(cost) && cost >= 0
    ? cost
    : null
}

function hasCanonicalPanelVideoOutput(panel: {
  videoUrl: string | null
  videoMediaId: string | null
}): boolean {
  return (
    (typeof panel.videoUrl === 'string' && panel.videoUrl.trim().length > 0)
    || (typeof panel.videoMediaId === 'string' && panel.videoMediaId.trim().length > 0)
  )
}

function submissionError(error: unknown): { code: string; message: string } {
  const code = isRecord(error) && typeof error.code === 'string'
    ? error.code
    : 'SUBMIT_FAILED'
  const message = error instanceof Error ? error.message : String(error)
  return { code, message }
}

type BatchSubmissionItem = {
  panelId: string
  outcome: 'accepted' | 'deduped' | 'rejected'
  taskId: string | null
  status: string | null
  error: { code: string; message: string } | null
}

function batchSubmissionResponse(input: {
  batchRunId: string
  quoteFingerprint: string
  items: BatchSubmissionItem[]
}) {
  const accepted = input.items.filter((item) => item.outcome === 'accepted').length
  const deduped = input.items.filter((item) => item.outcome === 'deduped').length
  const rejected = input.items.filter((item) => item.outcome === 'rejected').length
  const outcome = rejected === 0
    ? 'accepted' as const
    : accepted + deduped === 0
      ? 'failed' as const
      : 'partial' as const
  return NextResponse.json({
    kind: 'submission',
    batchRunId: input.batchRunId,
    quoteFingerprint: input.quoteFingerprint,
    total: input.items.length,
    accepted,
    deduped,
    rejected,
    outcome,
    items: input.items,
  })
}

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const rawBody: unknown = await request.json()
  if (!isRecord(rawBody)) throw new ApiError('INVALID_PARAMS')
  const body = rawBody
  requireVideoModelKeyFromPayload(body)
  const locale = resolveRequiredTaskLocale(request, body)
  const isBatch = body?.all === true
  const batchIntent: BatchVideoIntent | null = isBatch
    ? resolveBatchVideoIntent(body.intent)
    : null

  const episodeId = isBatch && typeof body?.episodeId === 'string' ? body.episodeId : null
  const storyboardId = !isBatch && typeof body?.storyboardId === 'string' ? body.storyboardId : null
  const panelIndex = !isBatch ? body?.panelIndex : undefined

  let ownedPanel: Awaited<ReturnType<typeof findNovelPromotionPanelByStoryboardIndexInProject>> = null
  if (isBatch) {
    if (!episodeId) {
      throw new ApiError('INVALID_PARAMS')
    }
    const ownedEpisode = await findNovelPromotionEpisodeInProject(projectId, episodeId)
    if (!ownedEpisode) {
      throw new ApiError('NOT_FOUND')
    }
  } else {
    if (!storyboardId || panelIndex === undefined) {
      throw new ApiError('INVALID_PARAMS')
    }
    ownedPanel = await findNovelPromotionPanelByStoryboardIndexInProject(
      projectId,
      storyboardId,
      Number(panelIndex),
    )
    if (!ownedPanel) {
      throw new ApiError('NOT_FOUND')
    }
  }

  validateFirstLastFrameModel(body?.firstLastFrame)

  const firstLastFrame = isRecord(body?.firstLastFrame) ? body.firstLastFrame : null
  if (
    firstLastFrame
    && typeof firstLastFrame.lastFrameStoryboardId === 'string'
    && firstLastFrame.lastFrameStoryboardId
    && firstLastFrame.lastFramePanelIndex !== undefined
  ) {
    const lastFramePanel = await findNovelPromotionPanelByStoryboardIndexInProject(
      projectId,
      firstLastFrame.lastFrameStoryboardId,
      Number(firstLastFrame.lastFramePanelIndex),
    )
    const targetEpisodeId = isBatch ? episodeId : ownedPanel?.storyboard.episodeId
    if (!lastFramePanel || lastFramePanel.storyboard.episodeId !== targetEpisodeId) {
      throw new ApiError('NOT_FOUND')
    }
  }

  await validateVideoCapabilityCombination({
    payload: body,
    projectId,
    userId: session.user.id,
  })

  if (isBatch) {
    const settings = normalizeBatchVideoSettings(body)
    let signedQuote: ReturnType<typeof verifyStoryboardBatchVideoQuote> | null = null
    let quoteFingerprint = ''
    let batchRunId = ''

    if (batchIntent === 'submit') {
      if (typeof body.batchRunId !== 'string' || !body.batchRunId.trim()) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'BATCH_RUN_ID_REQUIRED',
          field: 'batchRunId',
        })
      }
      if (typeof body.quoteFingerprint !== 'string' || !body.quoteFingerprint.trim()) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'QUOTE_FINGERPRINT_REQUIRED',
          field: 'quoteFingerprint',
        })
      }
      batchRunId = body.batchRunId.trim()
      quoteFingerprint = body.quoteFingerprint.trim()
      try {
        signedQuote = verifyStoryboardBatchVideoQuote(quoteFingerprint, {
          userId: session.user.id,
          projectId,
          episodeId: episodeId!,
        })
      } catch (error) {
        const code = error instanceof Error ? error.message : 'BATCH_VIDEO_QUOTE_INVALID'
        quoteConflict(
          code === 'BATCH_VIDEO_QUOTE_EXPIRED' ? 'QUOTE_EXPIRED' : 'QUOTE_INVALID',
          code === 'BATCH_VIDEO_QUOTE_EXPIRED'
            ? 'Batch video quote expired; request a fresh estimate.'
            : 'Batch video quote is invalid for this project or episode.',
        )
      }
      if (
        signedQuote.batchRunId !== batchRunId
        || !sameCanonicalValue(signedQuote.settings, settings)
      ) {
        quoteConflict('QUOTE_CONTEXT_CHANGED', 'Batch video settings changed; request a fresh estimate.')
      }

      const replayTasks = await prisma.task.findMany({
        where: {
          userId: session.user.id,
          projectId,
          episodeId: episodeId!,
          type: TASK_TYPE.VIDEO_PANEL,
          targetType: 'NovelPromotionPanel',
          payload: { path: '$.batchRunId', equals: batchRunId },
        },
        select: { id: true, targetId: true, status: true, payload: true },
        orderBy: { createdAt: 'desc' },
      })
      if (replayTasks.length > 0) {
        const replayByPanelId = new Map<string, typeof replayTasks[number]>()
        for (const task of replayTasks) {
          if (!replayByPanelId.has(task.targetId)) replayByPanelId.set(task.targetId, task)
        }
        const items: BatchSubmissionItem[] = signedQuote.targets.map((target) => {
          const replay = replayByPanelId.get(target.panelId)
          if (replay) {
            return {
              panelId: target.panelId,
              outcome: 'deduped',
              taskId: replay.id,
              status: replay.status,
              error: null,
            }
          }
          if (target.disposition === 'already_active') {
            return {
              panelId: target.panelId,
              outcome: 'deduped',
              taskId: target.taskId,
              status: target.status,
              error: null,
            }
          }
          return {
            panelId: target.panelId,
            outcome: 'rejected',
            taskId: null,
            status: null,
            error: {
              code: 'BATCH_REPLAY_TASK_MISSING',
              message: 'The original batch did not create a durable task for this panel.',
            },
          }
        })
        return batchSubmissionResponse({ batchRunId, quoteFingerprint, items })
      }
    }

    const foundPanels = await prisma.novelPromotionPanel.findMany({
      where: {
        storyboard: {
          episodeId: episodeId!,
          episode: { novelPromotionProject: { projectId } },
        },
      },
      select: {
        id: true,
        imageUrl: true,
        imageMediaId: true,
        videoUrl: true,
        videoMediaId: true,
        description: true,
        videoPrompt: true,
        firstLastFramePrompt: true,
        srtSegment: true,
        updatedAt: true,
      },
    })

    const orderedPanels = foundPanels
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
    const panels = orderedPanels.filter((panel) =>
      typeof panel.imageUrl === 'string' &&
      panel.imageUrl.trim().length > 0 &&
      !hasCanonicalPanelVideoOutput(panel),
    )
    const skippedHasVideo = orderedPanels.filter((panel) =>
      hasCanonicalPanelVideoOutput(panel),
    ).length
    const skippedMissingImage = orderedPanels.filter((panel) =>
      !hasCanonicalPanelVideoOutput(panel) &&
      !(typeof panel.imageUrl === 'string' && panel.imageUrl.trim().length > 0),
    ).length
    const activeTasks = panels.length > 0
      ? await prisma.task.findMany({
        where: {
          projectId,
          episodeId: episodeId!,
          type: TASK_TYPE.VIDEO_PANEL,
          targetType: 'NovelPromotionPanel',
          targetId: { in: panels.map((panel) => panel.id) },
          status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
        },
        select: { id: true, targetId: true, status: true, payload: true },
        orderBy: { createdAt: 'desc' },
      })
      : []
    const activeTaskByPanelId = new Map<string, {
      id: string
      status: string
      payload: unknown
    }>()
    for (const task of activeTasks) {
      if (!activeTaskByPanelId.has(task.targetId)) {
        activeTaskByPanelId.set(task.targetId, {
          id: task.id,
          status: task.status,
          payload: task.payload,
        })
      }
    }
    const targets = panels.map((panel) => {
      const source = buildStoryboardBatchVideoPanelSource(panel)
      const activeTask = activeTaskByPanelId.get(panel.id)
      const expectedIdentity = buildStoryboardBatchVideoGenerationIdentity({ settings, source })
      if (activeTask && readStoryboardBatchVideoTaskIdentity(activeTask.payload) !== expectedIdentity) {
        quoteConflict(
          'ACTIVE_VIDEO_IDENTITY_CONFLICT',
          'A different video generation is already active for one of these panels.',
        )
      }
      return activeTask
        ? {
          panelId: panel.id,
          disposition: 'already_active' as const,
          taskId: activeTask.id,
          status: activeTask.status,
          source,
        }
        : {
          panelId: panel.id,
          disposition: 'new' as const,
          taskId: null,
          status: null,
          source,
        }
    })
    if (batchIntent === 'estimate') batchRunId = randomUUID()
    const billingInfo = buildVideoPanelBillingInfoOrThrow(body)
    const estimatedCostPerTask = estimatedCostFromBillingInfo(billingInfo)
    const newTasks = targets.filter((target) => target.disposition === 'new').length
    const alreadyActive = targets.length - newTasks
    const skipped = skippedMissingImage + skippedHasVideo
    const estimatedTotalCost = newTasks === 0
      ? 0
      : estimatedCostPerTask === null
        ? null
        : estimatedCostPerTask * newTasks

    if (newTasks > 0 && estimatedTotalCost === null) {
      quoteConflict(
        'QUOTE_PRICE_UNAVAILABLE',
        'A reliable maximum batch video cost is unavailable; no tasks were created.',
      )
    }

    if (batchIntent === 'estimate') {
      const quotedAt = new Date().toISOString()
      quoteFingerprint = issueStoryboardBatchVideoQuote({
        userId: session.user.id,
        projectId,
        episodeId: episodeId!,
        batchRunId,
        settings,
        pricing: {
          version: BATCH_VIDEO_PRICING_VERSION,
          currency: BILLING_CURRENCY,
          estimatedCostPerTask,
          estimatedTotalCost,
        },
        targets,
      })
      return NextResponse.json({
        kind: 'quote',
        batchRunId,
        quotedAt,
        quoteFingerprint,
        episodeId: episodeId!,
        videoModel: settings.videoModel,
        currency: BILLING_CURRENCY,
        estimatedCostPerTask,
        estimatedTotalCost,
        targets: targets.map(({ source: _source, ...target }) => target),
        total: targets.length,
        newTasks,
        alreadyActive,
        skipped,
        skippedMissingImage,
        skippedHasVideo,
      })
    }

    if (
      !signedQuote
      || !sameCanonicalValue(signedQuote.pricing, {
        version: BATCH_VIDEO_PRICING_VERSION,
        currency: BILLING_CURRENCY,
        estimatedCostPerTask,
        estimatedTotalCost,
      })
    ) {
      quoteConflict('QUOTE_STALE_PRICE', 'Batch video pricing changed; request a fresh estimate.')
    }
    if (!sameCanonicalValue(signedQuote.targets, targets)) {
      quoteConflict('QUOTE_STALE_SOURCE', 'Batch video sources changed; request a fresh estimate.')
    }

    const requestId = getRequestId(request)
    const newPanels = panels.filter((panel) =>
      !activeTaskByPanelId.has(panel.id),
    )
    const settled = await Promise.allSettled(
      newPanels.map(async (panel) => {
        const quotedTarget = signedQuote.targets.find((target) => target.panelId === panel.id)
        if (!quotedTarget || quotedTarget.disposition !== 'new') {
          throw Object.assign(new Error('Quoted panel target is missing.'), { code: 'QUOTE_TARGET_MISSING' })
        }
        const currentPanel = await requireNovelPromotionPanelInProject(projectId, panel.id)
        if (
          currentPanel.storyboard.episodeId !== episodeId
          || currentPanel.videoUrl
          || currentPanel.videoMediaId
          || !isStoryboardBatchVideoPanelSourceCurrent(quotedTarget.source, currentPanel)
        ) {
          throw Object.assign(
            new Error('Panel source changed after the batch quote.'),
            { code: 'QUOTE_STALE_SOURCE' },
          )
        }
        const batchGenerationIdentity = buildStoryboardBatchVideoGenerationIdentity({
          settings,
          source: quotedTarget.source,
        })
        const taskPayload = {
          all: true,
          episodeId: episodeId!,
          ...settings,
          batchRunId,
          panelSourceSnapshot: quotedTarget.source,
          batchGenerationIdentity,
        }
        const result = await submitTask({
          userId: session.user.id,
          locale,
          requestId,
          projectId,
          episodeId: episodeId!,
          type: TASK_TYPE.VIDEO_PANEL,
          targetType: 'NovelPromotionPanel',
          targetId: panel.id,
          payload: withTaskUiPayload(taskPayload, {
            hasOutputAtStart: await hasPanelVideoOutput(panel.id),
          }),
          dedupeKey: `video_panel:${panel.id}`,
          billingInfo,
        })
        if (!isRecord(result) || typeof result.taskId !== 'string' || !result.taskId) {
          throw Object.assign(
            new Error('Task submission returned no taskId'),
            { code: 'TASK_ID_MISSING' },
          )
        }
        if (result.deduped === true) {
          const durableTask = await prisma.task.findFirst({
            where: {
              id: result.taskId,
              userId: session.user.id,
              projectId,
              episodeId: episodeId!,
              type: TASK_TYPE.VIDEO_PANEL,
              targetType: 'NovelPromotionPanel',
              targetId: panel.id,
            },
            select: { id: true, status: true, payload: true },
          })
          if (
            !durableTask
            || readStoryboardBatchVideoTaskIdentity(durableTask.payload) !== batchGenerationIdentity
          ) {
            throw Object.assign(
              new Error('A different video generation won the active-task race.'),
              { code: 'ACTIVE_VIDEO_IDENTITY_CONFLICT' },
            )
          }
          return {
            panelId: panel.id,
            outcome: 'deduped' as const,
            taskId: durableTask.id,
            status: durableTask.status,
            error: null,
          }
        }
        return {
          panelId: panel.id,
          outcome: 'accepted' as const,
          taskId: result.taskId,
          status: typeof result.status === 'string' ? result.status : 'queued',
          error: null,
        }
      }),
    )

    const settledByPanelId = new Map(settled.map((entry, index) => {
      const panelId = newPanels[index].id
      return [
        panelId,
        entry.status === 'fulfilled'
          ? entry.value
          : {
            panelId,
            outcome: 'rejected' as const,
            taskId: null,
            status: null,
            error: submissionError(entry.reason),
          },
      ] as const
    }))
    const items = targets.map((target) => {
      if (target.disposition === 'already_active') {
        return {
          panelId: target.panelId,
          outcome: 'deduped' as const,
          taskId: target.taskId,
          status: target.status,
          error: null,
        }
      }
      const item = settledByPanelId.get(target.panelId)
      if (!item) {
        return {
          panelId: target.panelId,
          outcome: 'rejected' as const,
          taskId: null,
          status: null,
          error: {
            code: 'SUBMIT_RESULT_MISSING',
            message: 'Task submission result is missing.',
          },
        }
      }
      return item
    })
    return batchSubmissionResponse({ batchRunId, quoteFingerprint, items })
  }

  const panel = ownedPanel!

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: panel.storyboard.episodeId,
    type: TASK_TYPE.VIDEO_PANEL,
    targetType: 'NovelPromotionPanel',
    targetId: panel.id,
    payload: withTaskUiPayload(body, {
      hasOutputAtStart: await hasPanelVideoOutput(panel.id),
    }),
    dedupeKey: `video_panel:${panel.id}`,
    billingInfo: buildVideoPanelBillingInfoOrThrow(body),
  })

  return NextResponse.json(result)
})
