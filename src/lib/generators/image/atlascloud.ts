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
 * Reference image (img2img): AtlasCloud image endpoint does NOT accept
 * reference_images on text-to-image variants (404 on image-to-image
 * slugs at this time). When the model picker pairs a t2i model with
 * user-uploaded refs (Playground / character-image flow), the refs
 * are silently dropped — generator logs the count for diagnostics.
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
}

/** Logical id (the one stored in PRESET_MODELS / projectData.imageModel)
 *  → real AtlasCloud API slug. */
const ATLASCLOUD_IMAGE_MODEL_MAP: Record<string, string> = {
  'gpt-image-2': 'openai/gpt-image-2/text-to-image',
  'nano-banana-pro': 'google/nano-banana-pro/text-to-image',
  'nano-banana': 'google/nano-banana/text-to-image',
  'nano-banana-2': 'google/nano-banana-2/text-to-image',
}

function resolveAtlasCloudImageModel(modelId?: string): string {
  if (modelId && ATLASCLOUD_IMAGE_MODEL_MAP[modelId]) {
    return ATLASCLOUD_IMAGE_MODEL_MAP[modelId]
  }
  // If user passed the full slug already, accept it verbatim.
  if (modelId && modelId.includes('/text-to-image')) return modelId
  // Sane default.
  return ATLASCLOUD_IMAGE_MODEL_MAP['nano-banana-pro']
}

function isGptImage2Slug(slug: string): boolean {
  return slug.startsWith('openai/gpt-image-2')
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
    } = options as AtlasCloudImageOptions

    const atlasModel = resolveAtlasCloudImageModel(modelId)
    const logger = createScopedLogger({
      module: 'generator.atlascloud-image',
      action: 'atlascloud_image_submit',
    })

    // Build body per model family. Each family has its own schema (see
    // file-level doc). Sending fields that aren't in a model's schema
    // is silently dropped by the gateway, so we only set what each
    // variant actually consumes.
    const body: Record<string, unknown> = {
      model: atlasModel,
      prompt: paramPrompt,
    }

    if (isGptImage2Slug(atlasModel)) {
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
      // Resolution enum varies by model (1k/2k/4k); pass through verbatim
      // when set, gateway rejects unknowns with 400 + clear message.
      if (resolution) body.resolution = resolution
      if (outputFormat) body.output_format = outputFormat
      // nano-banana-pro supports web grounding; harmless on other variants.
      if (typeof enableWebSearch === 'boolean') body.enable_web_search = enableWebSearch
    }

    if (referenceImages.length > 0) {
      // Current AtlasCloud image schemas don't have image-to-image
      // variants exposed via CDN — only text-to-image. We log the drop
      // for diagnostics so we know if a caller relied on refs.
      logger.info({
        message: 'reference images dropped — AtlasCloud image gen is text-only for these slugs',
        details: { model: atlasModel, droppedCount: referenceImages.length },
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
