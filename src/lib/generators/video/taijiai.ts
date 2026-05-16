/**
 * BobAPI (taijiai.online) — Seedance 2.0 video generator.
 *
 * Provider docs (Feishu wiki, 2026-05-16):
 *   - 域名: https://www.taijiai.online/
 *   - 创建: POST /v1/videos     → {id, status, progress}
 *   - 查询: GET  /v1/videos/{id} → 轮询 3-5s,status: queued|processing|completed|failed
 *   - 认证: Authorization: Bearer <api-key>
 *
 * Model: seedance-2.0-720p (the only Seedance variant on this gateway;
 * the BobAPI catalog currently only carries the 720p binding).
 *
 * Reference shape — content[] multi-modal (vs. flat ARK Seedance):
 *   {
 *     "model": "seedance-2.0",
 *     "duration": 4-15,
 *     "ratio": "auto|16:9|4:3|1:1|3:4|9:16|21:9",
 *     "generate_audio": bool,
 *     "prompt": "(ignored — content[0].text is the real prompt)",
 *     "content": [
 *       {type: "text", text: "@1 wearing @2 outfit, choreography matches @3"},
 *       {type: "image_url", role: "reference_image"|"first_frame"|"last_frame",
 *        subject_type: "generic"|"person", image_url: {url}},
 *       {type: "video_url", role: "reference_video", video_url: {url}},
 *       {type: "audio_url", role: "reference_audio", audio_url: {url}},
 *     ]
 *   }
 *
 * Reference caps: 9 image / 3 video / 3 audio. First/last-frame mode
 * caps image at 2.
 *
 * subject_type='person' triggers BobAPI's 真人审核 flow (max 10 min,
 * fails with 真人过白审核不通过 on timeout). Callers must opt in.
 *
 * Our integration intent: ARK Seedance 1.x stays unchanged; Seedance 2.0
 * is wired through this generator with first-frame i2v as the default
 * path (mirrors how the b-path video worker uses panel images). Multi-
 * modal video/audio refs are scaffolded but not surfaced in the UI yet.
 */

import { BaseVideoGenerator, type VideoGenerateParams, type GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { createScopedLogger } from '@/lib/logging/core'

const TAIJIAI_BASE_URL = 'https://www.taijiai.online'

const ALLOWED_RATIOS = new Set([
  'auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9',
])

const MIN_DURATION = 4
const MAX_DURATION = 15

interface TaijiaiContentItem {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url'
  text?: string
  role?: 'reference_image' | 'first_frame' | 'last_frame' | 'reference_video' | 'reference_audio'
  subject_type?: 'generic' | 'person'
  image_url?: { url: string }
  video_url?: { url: string }
  audio_url?: { url: string }
}

interface TaijiaiOptions {
  modelId?: string
  duration?: number
  aspectRatio?: string
  generateAudio?: boolean
  lastFrameImageUrl?: string
  /** Additional reference images beyond the first/last frame slots (up to 7 more). */
  referenceImages?: string[]
  /** Optional reference videos (up to 3). */
  referenceVideos?: string[]
  /** Optional reference audios (up to 3). */
  referenceAudios?: string[]
  /** When true the FIRST reference image is marked subject_type='person' → 真人审核. */
  isPersonReference?: boolean
}

interface CreateVideoResponse {
  id: string
  object: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  created_at: number
}

interface QueryVideoResponse {
  id: string
  object: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  created_at: number
  completed_at: number | null
  expires_at: number | null
  video_url: string | null
  error: { message: string; code: string } | null
}

function clampDuration(d: number): number {
  if (!Number.isFinite(d)) return 5
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, Math.round(d)))
}

function normaliseRatio(input?: string): string {
  if (!input) return 'auto'
  return ALLOWED_RATIOS.has(input) ? input : 'auto'
}

export class TaijiaiSeedanceVideoGenerator extends BaseVideoGenerator {
  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const { userId, imageUrl, prompt: paramPrompt = '', options = {} } = params

    const { apiKey } = await getProviderConfig(userId, 'taijiai')

    const {
      duration = 5,
      aspectRatio = '16:9',
      generateAudio = false,
      lastFrameImageUrl,
      referenceImages = [],
      referenceVideos = [],
      referenceAudios = [],
      isPersonReference = false,
    } = options as TaijiaiOptions

    const logger = createScopedLogger({
      module: 'worker.taijiai-video',
      action: 'taijiai_video_generate',
    })

    const content: TaijiaiContentItem[] = []
    if (paramPrompt) {
      content.push({ type: 'text', text: paramPrompt })
    }

    if (imageUrl) {
      // First-frame i2v path mirrors our existing b-path's Option-B mode.
      content.push({
        type: 'image_url',
        role: 'first_frame',
        ...(isPersonReference ? { subject_type: 'person' as const } : { subject_type: 'generic' as const }),
        image_url: { url: imageUrl },
      })
      if (lastFrameImageUrl) {
        content.push({
          type: 'image_url',
          role: 'last_frame',
          subject_type: 'generic',
          image_url: { url: lastFrameImageUrl },
        })
      }
    }

    // Extra reference images (capped at 7 so first/last + extras ≤ 9 total
    // per BobAPI's "最多9张图". When first/last mode is active the spec
    // capn drops to 2, so caller is responsible for not over-supplying.)
    const extraImageCap = imageUrl && lastFrameImageUrl ? 0 : (imageUrl ? 1 : 9) - (imageUrl ? 1 : 0)
    for (const url of referenceImages.slice(0, Math.max(0, extraImageCap))) {
      content.push({
        type: 'image_url',
        role: 'reference_image',
        subject_type: 'generic',
        image_url: { url },
      })
    }
    for (const url of referenceVideos.slice(0, 3)) {
      content.push({
        type: 'video_url',
        role: 'reference_video',
        video_url: { url },
      })
    }
    for (const url of referenceAudios.slice(0, 3)) {
      content.push({
        type: 'audio_url',
        role: 'reference_audio',
        audio_url: { url },
      })
    }

    if (content.length === 0) {
      throw new Error('TAIJIAI_VIDEO_PROMPT_OR_REFERENCE_REQUIRED')
    }

    const body = {
      model: 'seedance-2.0',
      duration: clampDuration(duration),
      generate_audio: generateAudio,
      ratio: normaliseRatio(aspectRatio),
      prompt: paramPrompt || '',  // BobAPI ignores this but new-api compat keeps it
      content,
    }

    logger.info({
      message: 'BobAPI Seedance 2.0 video task submit',
      details: {
        duration: body.duration,
        ratio: body.ratio,
        generateAudio: body.generate_audio,
        contentCount: content.length,
        hasFirstFrame: !!imageUrl,
        hasLastFrame: !!lastFrameImageUrl,
        promptLength: paramPrompt.length,
      },
    })

    const response = await fetch(`${TAIJIAI_BASE_URL}/v1/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      // BobAPI returns {"detail":"Invalid API key"} on 401
      if (response.status === 401) {
        throw new Error(`TAIJIAI_AUTH_FAILED: ${errorText}`)
      }
      throw new Error(`BobAPI Seedance 2.0 提交失败 (${response.status}): ${errorText}`)
    }

    const responseBody = (await response.json()) as CreateVideoResponse
    const videoId = responseBody.id
    if (!videoId) {
      throw new Error(`BobAPI Seedance 2.0 未返回 video id (response: ${JSON.stringify(responseBody)})`)
    }

    logger.info({
      message: 'BobAPI Seedance 2.0 task submitted',
      details: { videoId, status: responseBody.status, progress: responseBody.progress },
    })

    return {
      success: true,
      async: true,
      externalId: `TAIJIAI:VIDEO:${videoId}`,
    }
  }
}

/**
 * Poll a Seedance 2.0 task. Returns the shape async-poll expects.
 */
export async function queryTaijiaiTaskStatus(
  videoId: string,
  apiKey: string,
): Promise<{
  status: 'pending' | 'completed' | 'failed'
  videoUrl?: string
  error?: string
}> {
  const response = await fetch(`${TAIJIAI_BASE_URL}/v1/videos/${encodeURIComponent(videoId)}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  })

  const logger = createScopedLogger({
    module: 'worker.taijiai-seedance',
    action: 'taijiai_seedance_poll',
  })

  if (!response.ok) {
    const text = await response.text()
    if (response.status === 401) {
      return { status: 'failed', error: `TAIJIAI_AUTH_FAILED: ${text}` }
    }
    return { status: 'failed', error: `TAIJIAI_QUERY_FAILED (${response.status}): ${text}` }
  }

  const data = (await response.json()) as QueryVideoResponse

  logger.info({
    message: 'BobAPI Seedance 2.0 poll',
    details: {
      videoId,
      status: data.status,
      progress: data.progress,
    },
  })

  if (data.status === 'completed') {
    if (!data.video_url) {
      return { status: 'failed', error: `BobAPI status=completed but no video_url for ${videoId}` }
    }
    return { status: 'completed', videoUrl: data.video_url }
  }
  if (data.status === 'failed') {
    return {
      status: 'failed',
      error: data.error?.message ?? `BobAPI Seedance 2.0 task failed (${videoId})`,
    }
  }
  // queued / processing
  return { status: 'pending' }
}
