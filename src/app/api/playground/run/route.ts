/**
 * Phase 9.1 (2026-06-20) — Playground run submission, now on the Task spine.
 *
 * POST /api/playground/run
 *   body: { prompt, referenceImages?, referenceVideos?, referenceText?,
 *           outputType: 'image'|'video', modelKey, resolution?, aspectRatio?,
 *           durationSec?, workspaceId?, locale? }
 *   → submitTask({ projectId: 'playground', type: PLAYGROUND_IMAGE|VIDEO, ... })
 *
 * submitTask owns the whole lifecycle: billing quote+freeze (402 on
 * insufficient balance), createRun + Task row, enqueue, and rollback on
 * enqueue failure. The worker handler (withTaskLifecycle) settles billing
 * and writes the result. No bespoke PlaygroundRun row, no billing sidecar.
 *
 * projectId='playground' is a synthetic sentinel — Task.projectId has no FK,
 * and billing VIRTUAL_PROJECT_IDS already whitelists it (skips UsageCost,
 * still writes BalanceTransaction).
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveModelSelection } from '@/lib/api-config'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import { mapTaskStatusToPlayground } from '@/lib/playground/run-view'
import { filterAuthorizedReferences } from '@/lib/playground/reference-guard'
import { VIDEO_PROMPT_HARD_LIMIT } from '@/lib/playground/video-prompt-limits'
import type { Locale } from '@/i18n/routing'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

const PLAYGROUND_PROJECT_ID = 'playground'
const MAX_REFERENCE_IMAGES = 9
const MAX_REFERENCE_VIDEOS = 1 // Per feedback_kuiperfilm_ref_video_lowest_common_denominator

function parseStringArray(value: unknown, fieldName: string, cap: number): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new ApiError('INVALID_PARAMS', {
      code: `${fieldName.toUpperCase()}_INVALID`,
      details: { message: `${fieldName} must be a string array` },
    })
  }
  if (value.length > cap) {
    throw new ApiError('INVALID_PARAMS', {
      code: `${fieldName.toUpperCase()}_OVER_LIMIT`,
      details: { got: value.length, max: cap },
    })
  }
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string' || !v.trim()) {
      throw new ApiError('INVALID_PARAMS', {
        code: `${fieldName.toUpperCase()}_ENTRY_INVALID`,
      })
    }
    out.push(v.trim())
  }
  return out
}

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  // Per CLAUDE.md §3 (不靜默吞錯): a malformed JSON body is a contract
  // violation, not "an empty object" — return INVALID_PARAMS explicitly.
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    _ulogError(`[playground.run] invalid JSON body userId=${userId} err=${errMsg}`)
    throw new ApiError('INVALID_PARAMS', {
      code: 'INVALID_JSON_BODY',
      details: { message: 'request body must be valid JSON' },
    })
  }
  const {
    prompt,
    referenceImages: rawImages,
    referenceVideos: rawVideos,
    referenceText,
    lastFrameUrl: rawLastFrame,
    outputType,
    preserveSourceAudio,
    modelKey,
    resolution,
    aspectRatio,
    durationSec,
    workspaceId,
    locale: rawLocale,
    elements: rawElements,
    referenceImageNames: rawRefImageNames,
    generateAudio: rawGenerateAudio,
    maskImage: rawMaskImage,
  } = body as {
    prompt?: unknown
    referenceImages?: unknown
    referenceVideos?: unknown
    referenceText?: unknown
    lastFrameUrl?: unknown
    outputType?: unknown
    preserveSourceAudio?: unknown
    modelKey?: unknown
    resolution?: unknown
    aspectRatio?: unknown
    durationSec?: unknown
    workspaceId?: unknown
    locale?: unknown
    elements?: unknown
    referenceImageNames?: unknown
    generateAudio?: unknown
    maskImage?: unknown
  }

  // Validate. Every reject carries a human-readable `message` — ApiError falls
  // back to the generic "Invalid parameters" otherwise, which is what users
  // saw in the 6/30 生视频 bug report and could not act on.
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new ApiError('INVALID_PARAMS', { code: 'PROMPT_REQUIRED', message: '请输入提示词' })
  }
  if (outputType !== 'image' && outputType !== 'video') {
    throw new ApiError('INVALID_PARAMS', { code: 'OUTPUT_TYPE_INVALID', message: '输出类型无效（image/video）' })
  }
  if (preserveSourceAudio !== undefined && typeof preserveSourceAudio !== 'boolean') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PRESERVE_SOURCE_AUDIO_INVALID',
      message: '保留原始音軌設定無效',
    })
  }
  const promptHardLimit = outputType === 'video' ? VIDEO_PROMPT_HARD_LIMIT : 4000
  if (prompt.length > promptHardLimit) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROMPT_TOO_LONG',
      message: `提示词过长（${prompt.length}/${promptHardLimit} 字符），请精简后重试`,
      details: { max: promptHardLimit, got: prompt.length },
    })
  }
  if (typeof modelKey !== 'string' || !modelKey.trim()) {
    throw new ApiError('INVALID_PARAMS', { code: 'MODEL_KEY_REQUIRED', message: '请先选择模型' })
  }
  const trimmedModelKey = modelKey.trim()

  // Verify the model is in the user's enabled catalog AND matches outputType.
  // resolveModelSelection threads admin-inheritance + type validation, so a
  // video modelKey + outputType=image (or vice-versa) is rejected here with a
  // clear code instead of failing deep in the generator. Mirrors the picker.
  let resolvedModelId: string
  try {
    const selection = await resolveModelSelection(userId, trimmedModelKey, outputType)
    resolvedModelId = selection.modelId
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    _ulogError(
      `[playground.run] model rejected userId=${userId} modelKey=${trimmedModelKey} outputType=${outputType} err=${errMsg}`,
    )
    throw new ApiError('FORBIDDEN', {
      code: 'MODEL_NOT_ENABLED',
      details: { modelKey: trimmedModelKey, outputType, message: errMsg },
    })
  }

  const rawRefImages = parseStringArray(rawImages, 'referenceImages', MAX_REFERENCE_IMAGES)
  const rawRefVideos = parseStringArray(rawVideos, 'referenceVideos', MAX_REFERENCE_VIDEOS)
  // Optional last-frame image (首尾帧 / first-last-frame video). Single ref,
  // guarded with the same safety filter as the others.
  const rawLastFrameArr = typeof rawLastFrame === 'string' && rawLastFrame.trim()
    ? [rawLastFrame.trim()]
    : []
  // Reject foreign COS keys (cross-user read) + internal/non-https URLs (SSRF).
  // Fail explicitly rather than silently drop (CLAUDE.md §3 不静默吞错).
  const [imgGuard, vidGuard, lastFrameGuard] = await Promise.all([
    filterAuthorizedReferences(rawRefImages, userId),
    filterAuthorizedReferences(rawRefVideos, userId),
    filterAuthorizedReferences(rawLastFrameArr, userId),
  ])
  if (imgGuard.rejected.length > 0 || vidGuard.rejected.length > 0 || lastFrameGuard.rejected.length > 0) {
    _ulogError(
      `[playground.run] rejected unsafe references userId=${userId} images=${JSON.stringify(imgGuard.rejected)} videos=${JSON.stringify(vidGuard.rejected)} lastFrame=${JSON.stringify(lastFrameGuard.rejected)}`,
    )
    throw new ApiError('FORBIDDEN', {
      code: 'REFERENCE_NOT_ALLOWED',
      details: { message: 'reference must be your own uploaded key or an https storage URL' },
    })
  }
  const referenceImages = imgGuard.safe
  const lastFrameSafe = lastFrameGuard.safe[0] ?? null
  const referenceVideos = vidGuard.safe
  if (preserveSourceAudio === true && (outputType !== 'video' || referenceVideos.length !== 1)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PRESERVE_SOURCE_AUDIO_REQUIRES_VIDEO',
      message: '保留原始對白需要且只能綁定一支參考影片',
    })
  }

  // 局部重绘 (inpainting, 2026-07-17): maskImage = 客户端栅格化的遮罩 PNG
  // （透明区=重绘区）。只对 image 输出有意义；底图 = referenceImages[0]。
  // 模型必须在 capability catalog 声明 supportMaskEdit —— 不支持的模型静默
  // 忽略 mask 等于把整图重画（CLAUDE.md §3 不静默吞错），显式拒绝。
  let maskImageSafe: string | null = null
  if (rawMaskImage !== undefined && rawMaskImage !== null) {
    if (typeof rawMaskImage !== 'string' || !rawMaskImage.trim()) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MASK_IMAGE_INVALID',
        message: '遮罩图格式不正确',
      })
    }
    if (outputType !== 'image') {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MASK_IMAGE_OUTPUT_TYPE',
        message: '局部重绘仅支持图片生成',
      })
    }
    if (referenceImages.length < 1) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MASK_IMAGE_NEEDS_SOURCE',
        message: '局部重绘需要一张底图（referenceImages[0]）',
      })
    }
    const maskCaps = resolveBuiltinCapabilitiesByModelKey('image', trimmedModelKey)
    if (maskCaps?.image?.supportMaskEdit !== true) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'MASK_MODEL_UNSUPPORTED',
        message: '该模型不支持局部重绘，请改用 GPT Image 1 (局部重绘)',
        details: { modelKey: trimmedModelKey },
      })
    }
    const maskGuard = await filterAuthorizedReferences([rawMaskImage.trim()], userId)
    if (maskGuard.rejected.length > 0 || maskGuard.safe.length === 0) {
      _ulogError(
        `[playground.run] rejected unsafe mask image userId=${userId} rejected=${JSON.stringify(maskGuard.rejected)}`,
      )
      throw new ApiError('FORBIDDEN', {
        code: 'REFERENCE_NOT_ALLOWED',
        details: { message: 'mask image must be your own uploaded key or an https storage URL' },
      })
    }
    maskImageSafe = maskGuard.safe[0]
  }

  // Kling O3 named-subject bindings (2026-07-10). Shape:
  //   elements: [{ name: string, imageKeys: string[] (1-4) }]  ≤6 items
  // Only the Kling O3 models consume these — any other model getting an
  // elements payload is a client bug; reject explicitly rather than
  // silently dropping the binding (CLAUDE.md §3 不静默吞错).
  const KLING_ELEMENTS_MAX = 6
  const KLING_ELEMENT_IMAGES_MAX = 4
  let elements: Array<{ name: string; imageKeys: string[] }> = []
  if (rawElements !== undefined && rawElements !== null) {
    if (!Array.isArray(rawElements) || rawElements.length > KLING_ELEMENTS_MAX) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'ELEMENTS_INVALID',
        message: `主体绑定最多 ${KLING_ELEMENTS_MAX} 个`,
      })
    }
    const seenNames = new Set<string>()
    for (const entry of rawElements) {
      const name = typeof (entry as { name?: unknown })?.name === 'string'
        ? ((entry as { name: string }).name).trim()
        : ''
      const imageKeys = parseStringArray(
        (entry as { imageKeys?: unknown })?.imageKeys, 'elementImageKeys', KLING_ELEMENT_IMAGES_MAX,
      )
      if (!name || name.length > 80) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'ELEMENT_NAME_INVALID',
          message: '每个主体需要 1-80 字符的名称',
        })
      }
      if (seenNames.has(name)) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'ELEMENT_NAME_DUPLICATE',
          message: `主体名称重复：${name}`,
        })
      }
      seenNames.add(name)
      if (imageKeys.length < 1) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'ELEMENT_IMAGES_REQUIRED',
          message: `主体「${name}」需要 1-${KLING_ELEMENT_IMAGES_MAX} 张参考图`,
        })
      }
      const elGuard = await filterAuthorizedReferences(imageKeys, userId)
      if (elGuard.rejected.length > 0) {
        _ulogError(
          `[playground.run] rejected unsafe element refs userId=${userId} element=${name} rejected=${JSON.stringify(elGuard.rejected)}`,
        )
        throw new ApiError('FORBIDDEN', {
          code: 'REFERENCE_NOT_ALLOWED',
          details: { message: 'element reference must be your own uploaded key or an https storage URL' },
        })
      }
      elements = [...elements, { name, imageKeys: elGuard.safe }]
    }
    if (elements.length > 0 && !/^kling-o3-/.test(resolvedModelId)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'ELEMENTS_MODEL_MISMATCH',
        message: '主体绑定目前仅 Kling O3 模型支持，请切换模型或移除主体',
        details: { modelId: resolvedModelId },
      })
    }
  }

  // Kling O3 plain-image caps (schema: ≤7, ≤4 with a reference video) —
  // enforced here so an API-direct call fails fast instead of async in the
  // worker. (2026-07-12 review MEDIUM; UI blocks this pre-submit already.)
  if (/^kling-o3-/.test(resolvedModelId)) {
    const klingImagesCap = referenceVideos.length > 0 ? 4 : 7
    if (referenceImages.length > klingImagesCap) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'KLING_IMAGES_OVER_LIMIT',
        message: `Kling O3 参考图最多 ${klingImagesCap} 张${referenceVideos.length > 0 ? '（绑参考影片时）' : ''}，当前 ${referenceImages.length} 张`,
        details: { got: referenceImages.length, max: klingImagesCap },
      })
    }
  }

  // Named plain reference images（參考圖命名 → 參考圖對應 textual map，
  // 2026-07-10). Aligned with referenceImages by index; null = unnamed.
  let referenceImageNames: Array<string | null> = []
  if (rawRefImageNames !== undefined && rawRefImageNames !== null) {
    if (!Array.isArray(rawRefImageNames) || rawRefImageNames.length > MAX_REFERENCE_IMAGES) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'REFERENCE_IMAGE_NAMES_INVALID',
        message: '参考图命名格式不正确',
      })
    }
    referenceImageNames = rawRefImageNames.map((v) => {
      if (v === null || v === undefined) return null
      if (typeof v !== 'string' || v.trim().length === 0) return null
      if (v.trim().length > 80) {
        throw new ApiError('INVALID_PARAMS', {
          code: 'REFERENCE_IMAGE_NAME_TOO_LONG',
          message: '参考图命名最长 80 字符',
        })
      }
      return v.trim()
    })
    if (referenceImageNames.length > referenceImages.length) {
      // trailing names for images that no longer exist — truncate to align.
      referenceImageNames = referenceImageNames.slice(0, referenceImages.length)
    }
  }
  const refText = typeof referenceText === 'string' ? referenceText.trim() : ''
  const wsId = typeof workspaceId === 'string' && workspaceId.length > 0 ? workspaceId : null
  const locale = (typeof rawLocale === 'string' && rawLocale ? rawLocale : 'zh') as Locale

  // If workspaceId provided, verify membership (light check).
  if (wsId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId: wsId, userId },
      select: { workspaceId: true },
    })
    const owned = await prisma.workspace.findFirst({
      where: { id: wsId, ownerEditorId: userId },
      select: { id: true },
    })
    if (!member && !owned) {
      throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_MEMBER' })
    }
  }

  let normalizedResolution = typeof resolution === 'string' ? resolution : null
  // Image models with tiered (per-resolution) pricing REQUIRE a resolution to
  // quote — a missing one used to bubble BILLING_CAPABILITY_PRICE_NOT_FOUND
  // as an opaque 500. Default to the model's first declared option (mirrors
  // resolveGenerationOptionsForModel's auto-fill on the project paths, and
  // matches the provider default, e.g. Grok 1k).
  if (!normalizedResolution && outputType === 'image') {
    const caps = resolveBuiltinCapabilitiesByModelKey('image', trimmedModelKey)
    const opts = caps?.image?.resolutionOptions
    if (opts && opts.length > 0) normalizedResolution = opts[0]
  }
  const normalizedDuration = typeof durationSec === 'number' && Number.isFinite(durationSec)
    ? Math.round(durationSec)
    : null

  const type = outputType === 'video' ? TASK_TYPE.PLAYGROUND_VIDEO : TASK_TYPE.PLAYGROUND_IMAGE
  const targetId = crypto.randomUUID()

  // payload carries everything the worker handler + billing policy need.
  // modelId (bare, resolved) feeds buildImage/VideoTaskInfo; modelKey (full)
  // feeds the generator. duration/resolution drive both billing and gen.
  const payload: Record<string, unknown> = {
    prompt: prompt.trim(),
    modelKey: trimmedModelKey,
    modelId: resolvedModelId,
    outputType,
    referenceImages,
    referenceVideos,
    ...(preserveSourceAudio === true ? { preserveSourceAudio: true } : {}),
    ...(refText ? { referenceText: refText } : {}),
    ...(lastFrameSafe ? { lastFrameUrl: lastFrameSafe } : {}),
    ...(maskImageSafe ? { maskImage: maskImageSafe } : {}),
    ...(elements.length > 0 ? { elements } : {}),
    ...(referenceImageNames.some(Boolean) ? { referenceImageNames } : {}),
    // 🔊 audio toggle (2026-07-12) — only a literal boolean passes through;
    // anything else falls back to the generator default (on).
    ...(typeof rawGenerateAudio === 'boolean' ? { generateAudio: rawGenerateAudio } : {}),
    ...(normalizedResolution ? { resolution: normalizedResolution } : {}),
    ...(typeof aspectRatio === 'string' ? { aspectRatio } : {}),
    ...(normalizedDuration ? { duration: normalizedDuration } : {}),
    generationCount: 1,
    // meta.* 是 payload 里唯一在 worker 进度更新时会被合并保留的命名空间
    //(tryUpdateTaskProgress → mergePayloadMetaWithExisting;顶层字段会被
    // 进度 payload 整包覆写)。原始描述词/模型放这里,历史记录的「描述
    // 词面板 / tooltip」才能在任务跑起来之后仍然读到。
    meta: {
      originPrompt: prompt.trim(),
      originModelKey: trimmedModelKey,
      ...(wsId ? { workspaceId: wsId } : {}),
    },
  }

  // submitTask owns billing freeze (402), createRun, enqueue + rollback.
  const submitted = await submitTask({
    userId,
    locale,
    projectId: PLAYGROUND_PROJECT_ID,
    type,
    targetType: 'playground',
    targetId,
    payload,
  })

  _ulogInfo(
    `[playground.run] submitted taskId=${submitted.taskId} runId=${submitted.runId ?? 'none'} userId=${userId} type=${type} model=${trimmedModelKey}`,
  )

  return NextResponse.json({
    success: true,
    run: {
      id: submitted.taskId,
      status: mapTaskStatusToPlayground(submitted.status),
      resultUrl: null,
      outputType,
      modelKey: trimmedModelKey,
      createdAt: new Date(),
      completedAt: null,
    },
  })
})
