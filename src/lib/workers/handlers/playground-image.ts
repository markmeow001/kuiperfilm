/**
 * 2026-06-02 — Playground IMAGE generation worker handler.
 *
 * Mirrors playground-video.ts. The original Playground image flow ran
 * SYNCHRONOUSLY inside POST /api/playground/run with an inline 120s poll.
 * That breaks for async providers whose generation exceeds 120s — e.g.
 * AtlasCloud google/nano-banana-pro on complex prompts polled `processing`
 * for the full 120s, then the route threw "External task polling timeout"
 * and surfaced "External service failed" to the user, even though AtlasCloud
 * kept generating (and billing) in the background.
 *
 * Moving image to the same async worker path as video fixes it:
 *   - the worker polls with a 15-min budget (matches multi-shot paths), so
 *     slow high-quality models complete instead of timing out at 120s
 *   - the result is downloaded and persisted to our COS/R2, so the browser
 *     loads it from our own (CSP-allowed) storage instead of the remote
 *     provider URL (which the client can't render)
 *   - no synchronous HTTP request is held open for minutes
 *
 * Tracking lives on the PlaygroundRun row (status / errorMessage /
 * resultUrls / externalTaskId); the frontend already polls
 * GET /api/playground/runs every 3s while a row is pending/running.
 */

import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { generateImage } from '@/lib/generator-api'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { captureForPlayground, refundForPlayground } from '@/lib/playground/billing'
import { uploadImageSourceToCos, waitExternalResult, toSignedUrlIfCos } from '../utils'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

/** Job data shape for Playground image generation. Disjoint from
 *  TaskJobData (different lifecycle + tracking table), mirrors
 *  PlaygroundVideoJobData. */
export interface PlaygroundImageJobData {
  type: 'playground_image'
  playgroundRunId: string
  userId: string
}

export async function handlePlaygroundImageTask(job: Job<PlaygroundImageJobData>): Promise<void> {
  const { playgroundRunId, userId } = job.data

  const run = await prisma.playgroundRun.findUnique({ where: { id: playgroundRunId } })
  if (!run) {
    _ulogError(`[playground-image] run ${playgroundRunId} not found, abandoning job`)
    return
  }
  if (run.outputType !== 'image') {
    _ulogError(`[playground-image] run ${playgroundRunId} is outputType=${run.outputType}, expected image`)
    return
  }
  if (run.status === 'succeeded' || run.status === 'failed') {
    _ulogInfo(`[playground-image] run ${playgroundRunId} already terminal (${run.status}), skipping`)
    return
  }

  await prisma.playgroundRun.update({
    where: { id: playgroundRunId },
    data: { status: 'running' },
  })

  function parseJsonArray(value: string | null): string[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    } catch {
      return []
    }
  }
  const refImageKeys = parseJsonArray(run.referenceImages)
  const signedImageUrls = refImageKeys.map((k) => toSignedUrlIfCos(k, 7200) ?? k)

  const effectivePrompt = run.referenceText
    ? `${run.prompt}\n\n[參考文字 / Style hint] ${run.referenceText}`
    : run.prompt

  _ulogInfo(
    `[playground-image] start runId=${playgroundRunId} model=${run.modelKey} refImages=${refImageKeys.length}`,
  )

  try {
    const result = await generateImage(userId, run.modelKey, effectivePrompt, {
      ...(signedImageUrls.length > 0 ? { referenceImages: signedImageUrls } : {}),
      ...(run.aspectRatio ? { aspectRatio: run.aspectRatio } : {}),
      ...(run.resolution ? { resolution: run.resolution } : {}),
    })

    if (!result.success) {
      const errMsg = result.error ?? 'image generation failed'
      await prisma.playgroundRun.update({
        where: { id: playgroundRunId },
        data: { status: 'failed', errorMessage: errMsg, completedAt: new Date() },
      })
      _ulogError(`[playground-image] failed early runId=${playgroundRunId} err=${errMsg}`)
      throw new Error(`PLAYGROUND_IMAGE_SUBMIT_FAILED: ${errMsg}`)
    }

    // Sync providers return a url/imageUrl immediately; async providers
    // (AtlasCloud / fal / KieAI) return an externalId we poll to completion.
    let sourceUrl = (result as { url?: string; imageUrl?: string }).url
      ?? (result as { url?: string; imageUrl?: string }).imageUrl
      ?? null

    if (!sourceUrl && result.externalId) {
      await prisma.playgroundRun.update({
        where: { id: playgroundRunId },
        data: { externalTaskId: result.externalId },
      })
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
    const cosKey = await uploadImageSourceToCos(sourceUrl, `playground-runs/${playgroundRunId}`, playgroundRunId)

    // PR-A2 billing — capture the freeze on success. costEstimate was
    // computed at submit time using the same params (model + resolution),
    // so for now actualCost === costEstimate. Phase 9.1 will replace
    // this with usage-based settlement (e.g. real seconds generated).
    const actualCost = run.costEstimate ?? 0
    let chargedCost = 0
    if (run.freezeId && actualCost > 0) {
      const parsed = parseModelKeyStrict(run.modelKey)
      const modelId = parsed?.modelKey ?? run.modelKey
      try {
        await captureForPlayground({
          freezeId: run.freezeId,
          playgroundRunId,
          modelId,
          outputType: 'image',
          resolution: run.resolution,
          actualCost,
        })
        chargedCost = actualCost
      } catch (captureErr) {
        // Capture failure on the success path is a billing-side bug, not
        // a generation failure. Log loudly + refund so the user isn't
        // double-jeopardized. Image content was produced and persisted
        // either way — surface the row succeeded.
        const captureMsg = captureErr instanceof Error ? captureErr.message : String(captureErr)
        _ulogError(
          `[playground-image] capture FAILED runId=${playgroundRunId} freezeId=${run.freezeId} err=${captureMsg} — refunding`,
        )
        await refundForPlayground({
          freezeId: run.freezeId,
          playgroundRunId,
          reason: `capture_failed:${captureMsg}`,
        })
      }
    }

    await prisma.playgroundRun.update({
      where: { id: playgroundRunId },
      data: {
        status: 'succeeded',
        resultUrls: JSON.stringify([cosKey]),
        completedAt: new Date(),
        costActual: chargedCost > 0 ? chargedCost : null,
      },
    })

    _ulogInfo(`[playground-image] success runId=${playgroundRunId} cosKey=${cosKey} charged=${chargedCost}`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    try {
      await prisma.playgroundRun.update({
        where: { id: playgroundRunId },
        data: { status: 'failed', errorMessage: errMsg, completedAt: new Date() },
      })
    } catch (updateErr) {
      // Secondary failure flipping row to 'failed'. Log explicitly per
      // CLAUDE.md §3 (不靜默吞錯) instead of `.catch(() => {})`. Ops needs
      // to know the row is stuck out-of-band with the job state.
      const updateMsg = updateErr instanceof Error ? updateErr.message : String(updateErr)
      _ulogError(
        `[playground-image] FAILED to mark row failed runId=${playgroundRunId} primary=${errMsg} secondary=${updateMsg}`,
      )
    }
    // PR-A2 billing — refund the freeze on failure. refundForPlayground
    // logs+swallows secondary rollback errors so the primary surfaces.
    if (run.freezeId) {
      await refundForPlayground({
        freezeId: run.freezeId,
        playgroundRunId,
        reason: `generation_failed:${errMsg}`,
      })
    }
    _ulogError(`[playground-image] threw runId=${playgroundRunId} err=${errMsg}`)
    throw err
  }
}
