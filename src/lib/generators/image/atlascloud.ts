/**
 * Phase U (2026-05-28) — AtlasCloud image generator.
 *
 * AtlasCloud's image-generation endpoint is `/api/v1/model/generateImage`.
 * Body shape is **FLAT** (same convention as the video endpoint per
 * reference_atlascloud_openapi_cdn memory) with:
 *   - model: 'provider/model/text-to-image'   (e.g. openai/gpt-image-2/text-to-image)
 *   - prompt: string
 *   - [size | resolution | aspect_ratio]    per-model schema
 *   - [quality | output_format | ...]       per-model schema
 *
 * Bound model slugs (verified 2026-05-28 against static.atlascloud.ai
 * schema CDN — 4 confirmed live, the rest 404 and need user confirmation):
 *   - openai-gpt-image-2          → openai/gpt-image-2/text-to-image
 *                                   props: prompt + size enum + quality + output_format
 *   - google-nano-banana-pro      → google/nano-banana-pro/text-to-image
 *                                   ("Gemini 3 Pro Image" 推薦・高品質;
 *                                    props: prompt + aspect_ratio + resolution + output_format)
 *   - google-nano-banana          → google/nano-banana/text-to-image
 *                                   ("Gemini 3 Flash Image" 快速・高品質)
 *   - google-nano-banana-2        → google/nano-banana-2/text-to-image
 *                                   ("Gemini 3.1 Flash Image" 快速生成)
 *
 * Why the friendly UI names don't match the API slugs: AtlasCloud's
 * external branding shows Gemini family names but their API uses the
 * internal Google project codename "nano-banana". Our PRESET_MODELS
 * registers slugs as canonical and exposes friendly labels in the
 * picker.
 *
 * Async pattern: submit returns requestId, worker polls via the same
 * `/api/v1/model/prediction/{id}` endpoint as video. The poll handler
 * already accepts ATLASCLOUD:IMAGE:requestId (extended in async-poll.ts
 * Phase U). resultUrl in the poll response is the rendered image URL.
 *
 * Reference image (img2img): AtlasCloud exposes a separate **`/edit`**
 * slug per model family that accepts `images: string[]` (a list of input
 * image URLs). Verified 2026-06-29 against the schema CDN:
 *   - openai/gpt-image-2/edit        props: prompt + images + size + quality + output_format
 *   - google/nano-banana-pro/edit    props: prompt + images + aspect_ratio + resolution + output_format + enable_web_search
 *   - google/nano-banana/edit        props: prompt + images + aspect_ratio + output_format
 *   - google/nano-banana-2/edit      props: prompt + images + aspect_ratio + resolution + ...
 * When the caller supplies referenceImages we route to the matching
 * `/edit` slug and pass the (signed) URLs through `images` — AtlasCloud
 * fetches them server-side. The text-to-image slug is used only when no
 * reference is present. (Previously refs were silently dropped because we
 * always used the t2i slug — that produced unrelated images for the
 * canvas "720 from an uploaded photo" flow.)
 */

import { BaseImageGenerator, type ImageGenerateParams, type GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { createScopedLogger } from '@/lib/logging/core'

const ATLASCLOUD_BASE_URL = 'https://api.atlascloud.ai/api/v1'

interface AtlasCloudImageOptions {
  modelId?: string
  modelKey?: string
  provider?: string
  size?: string             // GPT Image 2: '1024x1024' / '1536x1024' / etc.
  resolution?: string       // Nano Banana: '1k' / '2k' / '4k'
  aspectRatio?: string      // Nano Banana: '1:1' / '16:9' / '9:16' / etc.
  quality?: string          // GPT Image 2: 'low' | 'medium' | 'high'
  outputFormat?: string     // 'jpeg' | 'png'
  enableWebSearch?: boolean // Nano Banana Pro: grounding with web search
  maskImage?: string        // 局部重绘遮罩 URL（透明区=重绘区；仅 gpt-image-1/edit）
}

/** Logical id (the one stored in PRESET_MODELS / projectData.imageModel)
 *  → real AtlasCloud API slug. */
const ATLASCLOUD_IMAGE_MODEL_MAP: Record<string, string> = {
  // gpt-image-1: 全家唯一带 mask_image 的 edit schema（2026-07-17 验证；
  // gpt-image-2/edit 与 nano-banana 系列均无 mask 字段）。t2i slug 也存在,
  // 但注册它主要为局部重绘 —— t2i 走这里只是避免隐式回退。
  'gpt-image-1': 'openai/gpt-image-1/text-to-image',
  'gpt-image-2': 'openai/gpt-image-2/text-to-image',
  'nano-banana-pro': 'google/nano-banana-pro/text-to-image',
  'nano-banana': 'google/nano-banana/text-to-image',
  'nano-banana-2': 'google/nano-banana-2/text-to-image',
  // 2026-07-02 — schema slugs verified via static.atlascloud.ai/model/schema/*
  // (see ~/canvas_ref/atlascloud-new-image-models-2026-07-02.md).
  'z-image-turbo': 'z-image/turbo',
  'grok-imagine-image': 'xai/grok-imagine-image/text-to-image',
  'grok-imagine-image-quality': 'xai/grok-imagine-image-quality/text-to-image',
}

/** img2img (`/edit`) counterparts — used when referenceImages are present.
 *  GPT/Nano accept `images: string[]`; Grok accepts `image_urls: string[]`.
 *  Z-Image Turbo has NO edit variant — doGenerate rejects refs explicitly
 *  (an entry here would silently reroute refs to another model's edit). */
const ATLASCLOUD_IMAGE_EDIT_MODEL_MAP: Record<string, string> = {
  'gpt-image-1': 'openai/gpt-image-1/edit',
  'gpt-image-2': 'openai/gpt-image-2/edit',
  'nano-banana-pro': 'google/nano-banana-pro/edit',
  'nano-banana': 'google/nano-banana/edit',
  'nano-banana-2': 'google/nano-banana-2/edit',
  'grok-imagine-image': 'xai/grok-imagine-image/edit',
  'grok-imagine-image-quality': 'xai/grok-imagine-image-quality/edit',
}

/** Logical ids that have no img2img variant at AtlasCloud. */
const ATLASCLOUD_NO_EDIT_MODELS = new Set(['z-image-turbo'])

/** Logical ids whose `/edit` schema declares `mask_image`（局部重绘）。
 *  Schema ground truth: static.atlascloud.ai/model/schema/openai-gpt-image-1-edit.json
 *  — "An additional image whose fully transparent areas indicate where image
 *  should be edited" (PNG). gpt-image-2 与 nano-banana 均不声明该字段。 */
const ATLASCLOUD_MASK_EDIT_MODELS = new Set(['gpt-image-1'])

/** Resolve the API slug. When `useEdit` (referenceImages present) we pick the
 *  `/edit` img2img variant so the references are actually consumed.
 *  Exported for unit testing (pure function). */
export function resolveAtlasCloudImageModel(modelId?: string, useEdit = false): string {
  const map = useEdit ? ATLASCLOUD_IMAGE_EDIT_MODEL_MAP : ATLASCLOUD_IMAGE_MODEL_MAP
  if (modelId && map[modelId]) {
    return map[modelId]
  }
  // If the user passed a full slug already, accept it — but swap the endpoint
  // suffix to match the requested mode so refs aren't dropped / forced.
  // Anchored to the END so a model name that merely contains "/edit" or
  // "/text-to-image" as a substring isn't corrupted.
  if (modelId && /\/(text-to-image|edit)$/.test(modelId)) {
    const base = modelId.replace(/\/(text-to-image|edit)$/, '')
    return `${base}/${useEdit ? 'edit' : 'text-to-image'}`
  }
  // Sane default.
  return map['nano-banana-pro']
}

function isGptImage2Slug(slug: string): boolean {
  return slug.startsWith('openai/gpt-image-2')
}

function isGptImage1Slug(slug: string): boolean {
  return slug.startsWith('openai/gpt-image-1')
}

/** gpt-image-1 declares a 3-value size enum (1024x1024 / 1024x1536 /
 *  1536x1024) — narrower than gpt-image-2's. Exported for unit testing. */
export function aspectRatioToGptImage1Size(aspectRatio: string | undefined): string {
  switch (aspectRatio) {
    case '16:9':
    case '2:1':
    case '21:9':
    case '4:3':
    case '3:2':
      return '1536x1024'
    case '9:16':
    case '3:4':
    case '2:3':
      return '1024x1536'
    case '1:1':
    default:
      return '1024x1024'
  }
}

function isNanoBananaSlug(slug: string): boolean {
  return slug.startsWith('google/nano-banana')
}

/** GPT Image 2 enum from the schema (verified 2026-05-28). */
const GPT_IMAGE_2_SIZE_ENUM = new Set([
  '1024x768',
  '768x1024',
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '2560x1440',
  '1440x2560',
  '3840x2160',
  '2160x3840',
])

/** Convert KuiperAI's aspectRatio convention ('9:16' / '16:9' / '1:1') to
 *  GPT Image 2's size enum, picking the largest standard size for the
 *  given ratio. Falls back to 1024×1024 on unknown ratios so we never
 *  send an out-of-enum value (the gateway 400s on those). */
function aspectRatioToGptImage2Size(aspectRatio: string | undefined): string {
  switch (aspectRatio) {
    case '2:1':
    case '21:9':
      // GPT Image 2 has no ≥2:1 size — use its widest (3:2) so a panorama
      // request still produces a wide image, not a square fallback.
      return '1536x1024'
    case '16:9':
      return '1536x1024'
    case '9:16':
      return '1024x1536'
    case '4:3':
      return '1024x768'
    case '3:4':
      return '768x1024'
    case '1:1':
    default:
      return '1024x1024'
  }
}

/** Nano Banana aspect_ratio enum (from schema). */
const NANO_BANANA_RATIO_ENUM = new Set([
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '21:9',
  '9:21',
  '2:3',
  '3:2',
])

function normaliseNanoBananaRatio(input: string | undefined): string | undefined {
  if (!input) return undefined
  if (NANO_BANANA_RATIO_ENUM.has(input)) return input
  // 2:1 (equirect panorama request) → Nano Banana's widest enum value 21:9.
  if (input === '2:1') return '21:9'
  return undefined // unknown → let the model pick default
}

function isZImageSlug(slug: string): boolean {
  return slug.startsWith('z-image/')
}

function isGrokImagineSlug(slug: string): boolean {
  return slug.startsWith('xai/grok-imagine-image')
}

/** Z-Image `size` uses a STAR separator (`1024*1024`), free-form W*H up to
 *  2048 per side. Map our aspectRatio convention to clean multiples; 2:1 maps
 *  exactly (2048*1024) — good for the 720全景 recipe.
 *  Exported for unit testing (pure). */
export function aspectRatioToZImageSize(aspectRatio: string | undefined): string {
  switch (aspectRatio) {
    case '2:1':
      return '2048*1024'
    case '21:9':
      return '2048*880'
    case '16:9':
      return '2048*1152'
    case '9:16':
      return '1152*2048'
    case '4:3':
      return '1600*1200'
    case '3:4':
      return '1200*1600'
    case '3:2':
      return '1536*1024'
    case '2:3':
      return '1024*1536'
    case '1:1':
    default:
      return '1024*1024'
  }
}

/** Grok Imagine aspect_ratio enum — LIVE schema values (re-verified in the
 *  2026-07-02 code review; the marketing "13 options" include 2:1/1:2 and
 *  9:19.5-style phone ratios, and notably do NOT include 21:9/9:21). */
const GROK_RATIO_ENUM = new Set([
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '2:3',
  '3:2',
  '9:19.5',
  '19.5:9',
  '9:20',
  '20:9',
  '1:2',
  '2:1',
])

/** Exported for unit testing (pure). Grok supports 2:1 natively (720全景
 *  recipes pass through untouched); our legacy widescreen values map to the
 *  closest schema value. */
export function normaliseGrokRatio(input: string | undefined): string | undefined {
  if (!input) return undefined
  if (GROK_RATIO_ENUM.has(input)) return input
  if (input === '21:9') return '2:1'
  if (input === '9:21') return '1:2'
  return undefined
}

/** Grok resolution is '1k' | '2k'. Accept those (case-insensitive) plus a
 *  couple of aliases from our video-style pickers; unknown → omit (model
 *  default = 1k). Exported for unit testing (pure). */
export function normaliseGrokResolution(input: string | undefined): string | undefined {
  if (!input) return undefined
  const v = input.toLowerCase()
  if (v === '1k' || v === '2k') return v
  if (v === '1080p') return '1k'
  if (v === '1440p' || v === '4k') return '2k'
  return undefined
}

interface AtlasCloudImageSubmitResponse {
  code?: number
  message?: string
  data?: {
    id?: string
    model?: string
    status?: string
  }
  id?: string
  status?: string
}

export class AtlasCloudImageGenerator extends BaseImageGenerator {
  protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
    const { userId, prompt: paramPrompt = '', referenceImages = [], options = {} } = params

    const { apiKey } = await getProviderConfig(userId, 'atlascloud')

    const {
      modelId,
      size,
      resolution,
      aspectRatio,
      quality,
      outputFormat,
      enableWebSearch,
      maskImage,
    } = options as AtlasCloudImageOptions

    // Reference images present → use the img2img `/edit` slug so AtlasCloud
    // actually consumes them (the t2i slug ignores `images`). Filter out any
    // empty/blank entries so we never POST an empty string as an image URL
    // (AtlasCloud 400s on those with an opaque message).
    const validRefs = referenceImages.filter(
      (u): u is string => typeof u === 'string' && u.trim().length > 0,
    )
    const useEdit = validRefs.length > 0
    // No-edit models: reject refs explicitly (不隐式回退) — the generic edit-map
    // fallback would silently reroute the request to another model's /edit.
    if (useEdit && modelId && ATLASCLOUD_NO_EDIT_MODELS.has(modelId)) {
      throw new Error(`${modelId} 不支持参考图（无 img2img 变体）：请移除参考图，或改用 Nano Banana / GPT Image 2 / Grok Imagine`)
    }
    // 局部重绘: a mask on a model whose schema has no mask_image would be
    // SILENTLY DROPPED by the gateway — the whole image would regenerate and
    // the user's 圈选 means nothing. Reject explicitly (不静默吞错).
    const trimmedMask = typeof maskImage === 'string' ? maskImage.trim() : ''
    if (trimmedMask) {
      if (!modelId || !ATLASCLOUD_MASK_EDIT_MODELS.has(modelId)) {
        throw new Error(`${modelId ?? '未知模型'} 不支持局部重绘遮罩：请改用 GPT Image 1 (局部重绘)`)
      }
      if (validRefs.length === 0) {
        throw new Error('局部重绘需要底图：请把要修补的原图作为参考图传入')
      }
    }
    const atlasModel = resolveAtlasCloudImageModel(modelId, useEdit)
    const logger = createScopedLogger({
      module: 'generator.atlascloud-image',
      action: 'atlascloud_image_submit',
    })

    // Build body per model family. Each family has its own schema (see
    // file-level doc). We only set fields a given variant's schema actually
    // declares — over-sending risks a 400 from the gateway, so don't rely on
    // silent drops.
    const body: Record<string, unknown> = {
      model: atlasModel,
      prompt: paramPrompt,
    }

    // img2img: pass the reference URLs the `/edit` slug consumes. AtlasCloud
    // fetches them server-side, so signed COS URLs work directly. Field name
    // is per-family: Grok declares `image_urls`, GPT/Nano declare `images`.
    // Per-family field naming (schema CDN ground truth): Grok declares
    // `image_urls`, gpt-image-1/edit declares `image` (1-4), GPT-2/Nano
    // declare `images`. Wrong name = gateway silently ignores the refs.
    if (useEdit) {
      if (isGrokImagineSlug(atlasModel)) body.image_urls = validRefs
      else if (isGptImage1Slug(atlasModel)) body.image = validRefs
      else body.images = validRefs
    }
    if (trimmedMask) {
      body.mask_image = trimmedMask
    }

    if (isGptImage1Slug(atlasModel)) {
      // gpt-image-1: 3-value size enum (narrower than gpt-image-2's).
      body.size = size && ['1024x1024', '1024x1536', '1536x1024'].includes(size)
        ? size
        : aspectRatioToGptImage1Size(aspectRatio)
      if (quality && ['low', 'medium', 'high'].includes(quality)) {
        body.quality = quality
      }
    } else if (isGptImage2Slug(atlasModel)) {
      // Pick a concrete size from the enum.
      const candidate = size && GPT_IMAGE_2_SIZE_ENUM.has(size)
        ? size
        : aspectRatioToGptImage2Size(aspectRatio)
      body.size = candidate
      if (quality && ['low', 'medium', 'high'].includes(quality)) {
        body.quality = quality
      }
      if (outputFormat && ['jpeg', 'png'].includes(outputFormat)) {
        body.output_format = outputFormat
      }
    } else if (isNanoBananaSlug(atlasModel)) {
      const ratio = normaliseNanoBananaRatio(aspectRatio)
      if (ratio) body.aspect_ratio = ratio
      // Only nano-banana-pro / nano-banana-2 declare `resolution` (1k/2k/4k).
      // The base nano-banana family (`google/nano-banana/...`) has no such
      // field, so don't send it there.
      const isBaseNanoBanana = atlasModel.startsWith('google/nano-banana/')
      if (resolution && !isBaseNanoBanana) body.resolution = resolution
      if (outputFormat) body.output_format = outputFormat
      // nano-banana-pro supports web grounding; harmless on other variants.
      if (typeof enableWebSearch === 'boolean') body.enable_web_search = enableWebSearch
    } else if (isZImageSlug(atlasModel)) {
      // Z-Image: free-form star-separated size (t2i only; refs rejected above).
      // Schema declares NO output_format on z-image/turbo — don't send one.
      body.size = aspectRatioToZImageSize(aspectRatio)
    } else if (isGrokImagineSlug(atlasModel)) {
      // Grok: aspect_ratio + resolution ('1k'/'2k') + num_images. The spine
      // bills per run (generationCount=1), so num_images is pinned to 1 —
      // canvas batch ×N fans out N runs instead.
      const ratio = normaliseGrokRatio(aspectRatio)
      if (ratio) body.aspect_ratio = ratio
      const grokRes = normaliseGrokResolution(resolution)
      if (grokRes) body.resolution = grokRes
      body.num_images = 1
    }

    if (useEdit) {
      logger.info({
        message: 'AtlasCloud image-to-image (edit) — references applied',
        details: { model: atlasModel, refCount: validRefs.length },
      })
    }

    const response = await fetch(`${ATLASCLOUD_BASE_URL}/model/generateImage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`AtlasCloud Image 提交失败 (${response.status}): ${errorText}`)
    }

    const responseBody = (await response.json()) as AtlasCloudImageSubmitResponse

    if (responseBody.code !== undefined && responseBody.code !== 200) {
      throw new Error(`AtlasCloud Image 错误 (code ${responseBody.code}): ${responseBody.message ?? ''}`)
    }

    const requestId = responseBody.data?.id ?? responseBody.id
    if (!requestId) {
      throw new Error(
        `AtlasCloud Image 未返回 prediction ID (response keys: ${Object.keys(responseBody).join(',')})`,
      )
    }

    logger.info({
      message: 'AtlasCloud Image task submitted',
      details: {
        requestId,
        model: atlasModel,
        status: responseBody.data?.status ?? responseBody.status,
      },
    })

    return {
      success: true,
      async: true,
      externalId: `ATLASCLOUD:IMAGE:${requestId}`,
    }
  }
}
