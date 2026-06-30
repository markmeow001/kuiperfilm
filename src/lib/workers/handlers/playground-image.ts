/**
 * Phase 9.1 (2026-06-20) — Playground IMAGE generation worker handler.
 *
 * Now a standard Task-spine handler: wrapped by withTaskLifecycle in
 * image.worker.ts, it reads its params from the Task payload, generates,
 * polls slow async providers, uploads the result to COS, and RETURNS the
 * result. Lifecycle (status transitions, COMPLETED/FAILED events) and
 * billing (settleTaskBilling on success / rollbackTaskBilling on failure)
 * are owned by withTaskLifecycle — this handler holds none of it.
 *
 * Pre-9.1 this bypassed the Task table and wrote a bespoke PlaygroundRun
 * row + a billing sidecar. The synthetic projectId='playground' (no FK on
 * Task.projectId; already whitelisted in billing VIRTUAL_PROJECT_IDS) lets
 * Playground ride the same spine as every other AI task — one path, not two.
 */

import type { Job } from 'bullmq'
import { generateImage } from '@/lib/generator-api'
import type { TaskJobData } from '@/lib/task/types'
import { uploadImageSourceToCos, waitExternalResult, toSignedUrlIfCos } from '../utils'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
  }
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === 'string' && v.length > 0)
        : []
    } catch {
      return []
    }
  }
  return []
}

export async function handlePlaygroundImageTask(
  job: Job<TaskJobData>,
): Promise<Record<string, unknown>> {
  const { taskId, userId } = job.data
  const payload = (job.data.payload || {}) as Record<string, unknown>

  const prompt = typeof payload.prompt === 'string' ? payload.prompt : ''
  const modelKey = typeof payload.modelKey === 'string' ? payload.modelKey : ''
  if (!prompt) throw new Error('PLAYGROUND_IMAGE_PROMPT_REQUIRED')
  if (!modelKey) throw new Error('PLAYGROUND_IMAGE_MODEL_REQUIRED')

  const referenceText = typeof payload.referenceText === 'string' ? payload.referenceText : ''
  const resolution = typeof payload.resolution === 'string' ? payload.resolution : null
  const aspectRatio = typeof payload.aspectRatio === 'string' ? payload.aspectRatio : null

  const refImageKeys = parseStringArray(payload.referenceImages)
  const signedImageUrls = refImageKeys.map((k) => toSignedUrlIfCos(k, 7200) ?? k)

  const effectivePrompt = referenceText
    ? `${prompt}\n\n[參考文字 / Style hint] ${referenceText}`
    : prompt

  _ulogInfo(
    `[playground-image] start taskId=${taskId} model=${modelKey} refImages=${refImageKeys.length}`,
  )

  const result = await generateImage(userId, modelKey, effectivePrompt, {
    ...(signedImageUrls.length > 0 ? { referenceImages: signedImageUrls } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(resolution ? { resolution } : {}),
  })

  if (!result.success) {
    const errMsg = result.error ?? 'image generation failed'
    _ulogError(`[playground-image] submit failed taskId=${taskId} err=${errMsg}`)
    throw new Error(`PLAYGROUND_IMAGE_SUBMIT_FAILED: ${errMsg}`)
  }

  // Sync providers return a url/imageUrl immediately; async providers
  // (AtlasCloud / fal / KieAI) return an externalId we poll to completion.
  let sourceUrl = (result as { url?: string; imageUrl?: string }).url
    ?? (result as { url?: string; imageUrl?: string }).imageUrl
    ?? null

  if (!sourceUrl && result.externalId) {
    const polled = await waitExternalResult(job as unknown as Job, result.externalId, userId, {
      timeoutMs: 15 * 60 * 1000,
      progressStart: 30,
      progressEnd: 90,
    })
    sourceUrl = polled.url
  }

  if (!sourceUrl) {
    throw new Error('PLAYGROUND_IMAGE_NO_RESULT_URL')
  }

  // Download + persist to our COS/R2 so the client loads it from our own
  // (CSP-allowed) storage with a predictable lifetime.
  const cosKey = await uploadImageSourceToCos(sourceUrl, `playground-runs/${taskId}`, taskId)

  _ulogInfo(`[playground-image] success taskId=${taskId} cosKey=${cosKey}`)

  return { resultUrls: [cosKey] }
}
