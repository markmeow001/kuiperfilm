import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { videoModelToleratesTextOnlyPanels } from '@/lib/video-models/multi-shot-text-only'
// Phase 2.5 Step 4-A — Skill primitive integration. The project may be
// anchored to a Skill that pins the video model + supplies defaults
// (aspectRatio / resolution / duration). When present, the picker on
// the front-end may opt to defer to the Skill model by sending
// `videoModelSource: 'skill-default'`. When absent or 'user-explicit'
// the payload's videoModel wins (current behavior). Loader returns
// null when the project has no anchored Skill — zero behavior change
// for legacy projects.
import { loadSkillConfigForProject } from '@/lib/skills/server'
import { applySkillDefaultsToPayload } from '@/lib/skills/apply-defaults'
import { resolveStageModel } from '@/lib/skills/resolve-stage-model'
import { createScopedLogger } from '@/lib/logging/core'

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

  // Optional intelligence-mode prompt style. Defaults to panel-numbered
  // in the worker when undefined (10s, best for action). Pass
  // 'auto-seedance' to opt into the 15s Seedance segment format.
  const promptStyle =
    body.promptStyle === 'auto-seedance' || body.promptStyle === 'panel-numbered'
      ? body.promptStyle
      : undefined

  // Optional entity overrides — UI's "swap costume / swap scene view"
  // affordance per multi-shot call. Shape validated here; existence
  // checks happen in the worker against project data.
  let characterOverrides: Array<{ characterId: string; appearanceId?: string }> | undefined
  if (body.characterOverrides !== undefined) {
    if (!Array.isArray(body.characterOverrides)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'CHARACTER_OVERRIDES_INVALID',
        field: 'characterOverrides',
      })
    }
    const arr: Array<{ characterId: string; appearanceId?: string }> = []
    for (const o of body.characterOverrides) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) {
        throw new ApiError('INVALID_PARAMS', { code: 'CHARACTER_OVERRIDES_INVALID', field: 'characterOverrides' })
      }
      const r = o as Record<string, unknown>
      if (typeof r.characterId !== 'string' || !r.characterId) {
        throw new ApiError('INVALID_PARAMS', { code: 'CHARACTER_OVERRIDES_INVALID', field: 'characterOverrides[].characterId' })
      }
      if (r.appearanceId !== undefined && typeof r.appearanceId !== 'string') {
        throw new ApiError('INVALID_PARAMS', { code: 'CHARACTER_OVERRIDES_INVALID', field: 'characterOverrides[].appearanceId' })
      }
      arr.push({
        characterId: r.characterId,
        ...(typeof r.appearanceId === 'string' ? { appearanceId: r.appearanceId } : {}),
      })
    }
    characterOverrides = arr.length > 0 ? arr : undefined
  }

  let locationOverrides: Array<{ locationId: string; viewName?: string }> | undefined
  if (body.locationOverrides !== undefined) {
    if (!Array.isArray(body.locationOverrides)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'LOCATION_OVERRIDES_INVALID',
        field: 'locationOverrides',
      })
    }
    const arr: Array<{ locationId: string; viewName?: string }> = []
    for (const o of body.locationOverrides) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) {
        throw new ApiError('INVALID_PARAMS', { code: 'LOCATION_OVERRIDES_INVALID', field: 'locationOverrides' })
      }
      const r = o as Record<string, unknown>
      if (typeof r.locationId !== 'string' || !r.locationId) {
        throw new ApiError('INVALID_PARAMS', { code: 'LOCATION_OVERRIDES_INVALID', field: 'locationOverrides[].locationId' })
      }
      if (r.viewName !== undefined && typeof r.viewName !== 'string') {
        throw new ApiError('INVALID_PARAMS', { code: 'LOCATION_OVERRIDES_INVALID', field: 'locationOverrides[].viewName' })
      }
      arr.push({
        locationId: r.locationId,
        ...(typeof r.viewName === 'string' ? { viewName: r.viewName } : {}),
      })
    }
    locationOverrides = arr.length > 0 ? arr : undefined
  }

  // 2026-05-13 — Option B "首幀鎖定" mode. When firstFrameImageUrl is
  // present the worker switches to Kling 3.0 i2v single-shot path.
  // Optional lastFrameImageUrl locks the ending pixel too. URLs must
  // be HTTP(S); we don't try to validate they exist (worker will fail
  // loudly if Tencent rejects them).
  let firstFrameImageUrl: string | undefined
  if (body.firstFrameImageUrl !== undefined) {
    if (typeof body.firstFrameImageUrl !== 'string' || !body.firstFrameImageUrl.trim()) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'FIRST_FRAME_IMAGE_URL_INVALID',
        field: 'firstFrameImageUrl',
        details: { message: 'firstFrameImageUrl must be a non-empty string when provided' },
      })
    }
    if (!/^https?:\/\//i.test(body.firstFrameImageUrl.trim())) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'FIRST_FRAME_IMAGE_URL_INVALID',
        field: 'firstFrameImageUrl',
        details: { message: 'firstFrameImageUrl must be an http(s) URL' },
      })
    }
    firstFrameImageUrl = body.firstFrameImageUrl.trim()
  }

  let lastFrameImageUrl: string | undefined
  if (body.lastFrameImageUrl !== undefined) {
    if (typeof body.lastFrameImageUrl !== 'string' || !body.lastFrameImageUrl.trim()) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'LAST_FRAME_IMAGE_URL_INVALID',
        field: 'lastFrameImageUrl',
        details: { message: 'lastFrameImageUrl must be a non-empty string when provided' },
      })
    }
    if (!/^https?:\/\//i.test(body.lastFrameImageUrl.trim())) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'LAST_FRAME_IMAGE_URL_INVALID',
        field: 'lastFrameImageUrl',
        details: { message: 'lastFrameImageUrl must be an http(s) URL' },
      })
    }
    if (!firstFrameImageUrl) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'LAST_FRAME_REQUIRES_FIRST_FRAME',
        field: 'lastFrameImageUrl',
        details: { message: 'lastFrameImageUrl requires firstFrameImageUrl (Tencent VOD constraint)' },
      })
    }
    lastFrameImageUrl = body.lastFrameImageUrl.trim()
  }

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

  // Phase P (2026-05-21) — totalDurationSeconds: user's intended TOTAL
  // duration as a single scalar. Forwarded by the frontend even when
  // panelDurations is omitted (sendRaw=true narrative edit path). Workers
  // use as tier-1.5 fallback between explicit panelDurations.sum and
  // dialogue-driven heuristic. Range mirrors panelDurations.sum: 5-15.
  let totalDurationSeconds: number | undefined
  if (body.totalDurationSeconds !== undefined) {
    const n = body.totalDurationSeconds
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'TOTAL_DURATION_INVALID',
        field: 'totalDurationSeconds',
        details: { message: 'totalDurationSeconds must be a finite number' },
      })
    }
    if (n < 5 || n > 15) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'TOTAL_DURATION_OUT_OF_RANGE',
        field: 'totalDurationSeconds',
        details: { value: n, min: 5, max: 15 },
      })
    }
    totalDurationSeconds = Math.round(n)
  }

  // Phase E (2026-05-15) — per-group curated style override.
  // Optional, sentinel by absence: when provided, wins over
  // project.visualStyleId in the worker's resolveProjectVisualStyle.
  // Cap at 64 chars to mirror the project-level zod schema; empty
  // strings ignored (treated as not-provided).
  function readOptionalStyleId(field: 'visualStyleId' | 'lightingPresetId'): string | undefined {
    const raw = body[field]
    if (raw === undefined) return undefined
    if (typeof raw !== 'string') {
      throw new ApiError('INVALID_PARAMS', {
        code: `${field.toUpperCase()}_INVALID`,
        field,
        details: { message: `${field} must be a string when provided` },
      })
    }
    const trimmed = raw.trim()
    if (trimmed.length === 0) return undefined
    if (trimmed.length > 64) {
      throw new ApiError('INVALID_PARAMS', {
        code: `${field.toUpperCase()}_TOO_LONG`,
        field,
        details: { length: trimmed.length, max: 64 },
      })
    }
    return trimmed
  }
  const visualStyleId = readOptionalStyleId('visualStyleId')
  const lightingPresetId = readOptionalStyleId('lightingPresetId')

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
  // Routes that anchor identity outside per-panel imageUrl (B-path
  // SubjectInfos.N, Seedance composite via taijiai/atlascloud/ark/fal which
  // pull from project character/scene catalog) tolerate text-only panels.
  // The single source of truth lives in videoModelToleratesTextOnlyPanels —
  // route + V2StoryboardClient + worker dispatcher all read from there to
  // prevent the "missed-one-list" regression that hit ARK + fal on 2026-05-22.
  if (!videoModelToleratesTextOnlyPanels(videoModel)) {
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

  // Phase 2.5 Step 4-A — resolve anchored Skill (if any).
  //
  // Loader returns null when the project has no originSkillId or the
  // Skill is archived. We swallow shape errors here as a soft fallback
  // (legacy generic flow) so a corrupted Skill row doesn't make every
  // submit explode. The loader's own throw paths are noisy enough for
  // ops via logger.warn — users still get their video.
  const skillLogger = createScopedLogger({
    module: 'api.multi-shot-video',
    action: 'skill.resolve',
    projectId,
    userId: session.user.id,
  })
  let resolvedSkill: Awaited<ReturnType<typeof loadSkillConfigForProject>> = null
  try {
    resolvedSkill = await loadSkillConfigForProject(projectId)
  } catch (skillErr) {
    skillLogger.warn({
      action: 'skill_config_invalid',
      message: 'Skill config invalid, falling back to generic flow',
      details: {
        error: skillErr instanceof Error ? skillErr.message : String(skillErr),
      },
    })
    resolvedSkill = null
  }

  // Build the user-supplied payload first so apply-defaults can fill
  // gaps only where the user didn't explicitly set a value.
  const userPayload: Record<string, unknown> = {
    panelIds,
    videoModel,
    mode: typeof body.mode === 'string' ? body.mode : undefined,
    sound: typeof body.sound === 'boolean' ? body.sound : undefined,
    aspectRatio: typeof body.aspectRatio === 'string' ? body.aspectRatio : undefined,
    ...(multiShotMode ? { multiShotMode } : {}),
    ...(panelDurations ? { panelDurations } : {}),
    ...(typeof totalDurationSeconds === 'number' ? { totalDurationSeconds } : {}),
    ...(rawPrompt ? { rawPrompt } : {}),
    ...(promptStyle ? { promptStyle } : {}),
    ...(characterOverrides ? { characterOverrides } : {}),
    ...(locationOverrides ? { locationOverrides } : {}),
    ...(firstFrameImageUrl ? { firstFrameImageUrl } : {}),
    ...(lastFrameImageUrl ? { lastFrameImageUrl } : {}),
    ...(visualStyleId ? { visualStyleId } : {}),
    ...(lightingPresetId ? { lightingPresetId } : {}),
  }

  // Resolve videoModel at submit time so billing freezes on the
  // correct model. Three sources, in priority order:
  //   1. user-explicit (front-end picker sent videoModelSource='user-explicit'
  //      or omitted the flag — current behavior; payload videoModel wins)
  //   2. skill-default (front-end sent videoModelSource='skill-default'
  //      because the locked picker wasn't overridden — use Skill's
  //      pinned generate_panel_video model)
  //   3. payload (final fallback)
  //
  // The picker UI lock affordance ships in a follow-up commit (Phase
  // 2.6). For now, the flag is accepted but defaults to user-explicit
  // so existing front-end calls keep their semantics.
  const videoModelSource =
    body.videoModelSource === 'skill-default' || body.videoModelSource === 'user-explicit'
      ? body.videoModelSource
      : 'user-explicit'
  let resolvedVideoModel = videoModel
  if (resolvedSkill && videoModelSource === 'skill-default') {
    const skillVideoModel = resolveStageModel(resolvedSkill.config, 'generate_panel_video')
    if (skillVideoModel) {
      resolvedVideoModel = skillVideoModel
    }
  }

  // Apply Skill defaults to gaps the user didn't explicitly set.
  const payloadWithSkillDefaults = resolvedSkill
    ? applySkillDefaultsToPayload({ ...userPayload, videoModel: resolvedVideoModel }, resolvedSkill.config)
    : { ...userPayload, videoModel: resolvedVideoModel }

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    episodeId: storyboard.episodeId,
    type: TASK_TYPE.VIDEO_MULTI_SHOT,
    targetType: 'NovelPromotionStoryboard',
    targetId: storyboard.id,
    skillId: resolvedSkill?.id ?? null,
    payload: payloadWithSkillDefaults,
    // 2026-05-01: include the panel set in the dedupe key. Without
    // this, every group on the same storyboard shared the same key
    // (`video_multi_shot:<storyboardId>`) and submitTask collapsed
    // them into a single in-flight task — user-reported all groups
    // showing the same video. Groups have non-overlapping panel sets,
    // so a stable hash of (panelIds, overrides, mode, durations,
    // prompt) gives each submission its own identity while still
    // deduping rapid double-clicks with identical inputs.
    //
    // Hashed (not raw) because dedupeKey is VARCHAR(191) and a
    // stringified override payload easily exceeds that — Prisma
    // P2000 the moment a user passes rawPrompt or even mid-size
    // characterOverrides. SHA-256 sliced to 16 hex chars = 64 bits
    // of entropy, plenty for collision-free dedupe within a
    // project's task set.
    dedupeKey: (() => {
      const fingerprint = JSON.stringify({
        ids: [...panelIds].sort(),
        c: characterOverrides ?? null,
        l: locationOverrides ?? null,
        d: panelDurations ?? null,
        m: multiShotMode ?? null,
        p: promptStyle ?? null,
        r: rawPrompt ?? null,
        f1: firstFrameImageUrl ?? null,
        f2: lastFrameImageUrl ?? null,
        vs: visualStyleId ?? null,
        lp: lightingPresetId ?? null,
      })
      const hash = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)
      return `video_multi_shot:${storyboard.id}:${hash}`
    })(),
  })

  return NextResponse.json(result)
})
