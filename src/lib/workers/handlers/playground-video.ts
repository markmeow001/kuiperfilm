/**
 * Phase T-2 (2026-05-27) — Playground video generation worker handler.
 *
 * Reads a PlaygroundRun row, dispatches to whichever video generator
 * the user picked (fal / atlascloud / bobapi / ark), polls for the
 * external task to finish, uploads the result mp4 to COS, and persists
 * the result URL back to the PlaygroundRun row.
 *
 * Why this bypasses the Task table:
 *   The Task table is project-scoped (Task.projectId is required NOT
 *   NULL by schema). Playground is project-independent — we don't want
 *   to force a synthetic project just to satisfy that FK. The job-level
 *   tracking is on PlaygroundRun itself (status / errorMessage /
 *   resultUrls / externalTaskId), so we skip withTaskLifecycle and
 *   write directly.
 *
 * Cancellation / retry: a PlaygroundRun's lifecycle is owned by this
 * row. If the worker crashes mid-generation, BullMQ's standard
 * retry/backoff applies (3 attempts by default). On final failure the
 * row's status flips to 'failed' with errorMessage.
 *
 * Concurrent dispatch: Playground jobs share the video queue (concurrency
 * 2 per QUEUE_CONCURRENCY_VIDEO env). Multi-shot project tasks queue
 * alongside them; no priority distinction for now.
 */

import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { generateVideo } from '@/lib/generator-api'
import { parseModelKeyStrict } from '@/lib/model-config-contract'
import { captureForPlayground, refundForPlayground } from '@/lib/playground/billing'
import { uploadVideoSourceToCos, waitExternalResult, toSignedUrlIfCos } from '../utils'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

/**
 * Job data shape for Playground video generation. Deliberately disjoint
 * from TaskJobData — different lifecycle, different tracking table.
 */
export interface PlaygroundVideoJobData {
  type: 'playground_video'
  playgroundRunId: string
  userId: string
}

export async function handlePlaygroundVideoTask(job: Job<PlaygroundVideoJobData>): Promise<void> {
  const { playgroundRunId, userId } = job.data

  // Fetch the row up front. If it's gone (cancelled / cleaned up), bail
  // silently — no Task row to update.
  const run = await prisma.playgroundRun.findUnique({
    where: { id: playgroundRunId },
  })
  if (!run) {
    _ulogError(`[playground-video] run ${playgroundRunId} not found, abandoning job`)
    return
  }
  if (run.outputType !== 'video') {
    _ulogError(`[playground-video] run ${playgroundRunId} is outputType=${run.outputType}, expected video`)
    return
  }
  if (run.status === 'succeeded' || run.status === 'failed') {
    _ulogInfo(`[playground-video] run ${playgroundRunId} already terminal (${run.status}), skipping`)
    return
  }

  // Mark running. Already 'pending' from API; bump to 'running' so the
  // client sees the worker picked it up.
  await prisma.playgroundRun.update({
    where: { id: playgroundRunId },
    data: { status: 'running' },
  })

  // Parse JSON ref arrays (stored as strings).
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
  const refVideoKeys = parseJsonArray(run.referenceVideos)

  // Sign keys for the generator. Image refs go as URLs; the single video
  // ref goes as `referenceVideos` array (vendor-specific generator routes
  // it into the right slot — fal video_urls / AtlasCloud reference_videos /
  // BobAPI content[] video_url / ARK content[] video_url).
  const signedImageUrls = refImageKeys.map((k) => toSignedUrlIfCos(k, 7200) ?? k)
  const signedVideoUrls = refVideoKeys
    .map((k) => toSignedUrlIfCos(k, 7200))
    .filter((u): u is string => Boolean(u))

  // Compose effective prompt (prompt + optional reference text footer).
  const effectivePrompt = run.referenceText
    ? `${run.prompt}\n\n[參考文字 / Style hint] ${run.referenceText}`
    : run.prompt

  // i2v / r2v vendors take a leading image. For now we pass the first
  // reference image (if any) as the imageUrl arg; pure t2v generators
  // ignore it. Picking the first matches the Phase T-1 UI where the
  // user numbered images in upload order.
  const leadImageUrl = signedImageUrls[0] ?? ''

  _ulogInfo(
    `[playground-video] start runId=${playgroundRunId} model=${run.modelKey} refImages=${refImageKeys.length} refVideos=${refVideoKeys.length}`,
  )

  try {
    // generateVideo's options interface is typed for scalar values
    // (string | number | boolean) but the underlying generators accept
    // array fields like referenceImages / referenceVideos for r2v
    // endpoints. We pass the arrays through as additional options;
    // each generator's switch unpacks them into its vendor-specific
    // schema (fal video_urls / AtlasCloud reference_videos / BobAPI
    // content[] / ARK content[]). Cast bypasses the index signature
    // mismatch — the generators handle the runtime shape correctly.
    const result = await generateVideo(userId, run.modelKey, leadImageUrl, {
      prompt: effectivePrompt,
      ...(run.durationSec ? { duration: run.durationSec } : {}),
      ...(run.aspectRatio ? { aspectRatio: run.aspectRatio } : {}),
      ...(run.resolution ? { resolution: run.resolution } : {}),
      ...(signedImageUrls.length > 1
        ? { referenceImages: signedImageUrls.slice(1) as unknown as string }
        : {}),
      ...(signedVideoUrls.length > 0
        ? { referenceVideos: signedVideoUrls as unknown as string }
        : {}),
    })

    if (!result.success || !result.externalId) {
      const errMsg = result.error ?? 'video generation failed (no externalId)'
      await prisma.playgroundRun.update({
        where: { id: playgroundRunId },
        data: {
          status: 'failed',
          errorMessage: errMsg,
          completedAt: new Date(),
        },
      })
      _ulogError(`[playground-video] failed early runId=${playgroundRunId} err=${errMsg}`)
      throw new Error(`PLAYGROUND_VIDEO_SUBMIT_FAILED: ${errMsg}`)
    }

    // Persist externalId for visibility while polling.
    await prisma.playgroundRun.update({
      where: { id: playgroundRunId },
      data: { externalTaskId: result.externalId },
    })

    // waitExternalResult does the long poll loop, reports progress to
    // BullMQ (which doesn't surface here because we have no Task row,
    // but the call signature requires the job). 15-min timeout matches
    // multi-shot paths.
    const polled = await waitExternalResult(job as unknown as Job, result.externalId, userId, {
      timeoutMs: 15 * 60 * 1000,
      progressStart: 30,
      progressEnd: 90,
    })

    if (!polled.url) {
      throw new Error('PLAYGROUND_VIDEO_NO_RESULT_URL')
    }

    // Upload to our COS bucket so the URL has predictable lifetime.
    const cosKey = await uploadVideoSourceToCos(
      polled.url,
      `playground-runs/${playgroundRunId}`,
      playgroundRunId,
      polled.downloadHeaders,
    )

    // PR-A2 billing — capture the freeze on success. costEstimate was
    // computed at submit time using model + resolution + durationSec, so
    // for now actualCost === costEstimate. Phase 9.1 will replace this
    // with usage-based settlement (real seconds, real resolution).
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
          outputType: 'video',
          durationSec: run.durationSec,
          resolution: run.resolution,
          actualCost,
        })
        chargedCost = actualCost
      } catch (captureErr) {
        const captureMsg = captureErr instanceof Error ? captureErr.message : String(captureErr)
        _ulogError(
          `[playground-video] capture FAILED runId=${playgroundRunId} freezeId=${run.freezeId} err=${captureMsg} — refunding`,
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

    _ulogInfo(`[playground-video] success runId=${playgroundRunId} cosKey=${cosKey} charged=${chargedCost}`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    try {
      await prisma.playgroundRun.update({
        where: { id: playgroundRunId },
        data: {
          status: 'failed',
          errorMessage: errMsg,
          completedAt: new Date(),
        },
      })
    } catch (updateErr) {
      // Secondary failure flipping row to 'failed'. We can't surface this to
      // the user (BullMQ will re-throw the primary), but ops needs to know
      // the row state is stuck out-of-band with the job state. Per
      // CLAUDE.md §3 (不靜默吞錯) — log explicitly instead of `.catch(() => {})`.
      const updateMsg = updateErr instanceof Error ? updateErr.message : String(updateErr)
      _ulogError(
        `[playground-video] FAILED to mark row failed runId=${playgroundRunId} primary=${errMsg} secondary=${updateMsg}`,
      )
    }
    // PR-A2 billing — refund the freeze on failure.
    if (run.freezeId) {
      await refundForPlayground({
        freezeId: run.freezeId,
        playgroundRunId,
        reason: `generation_failed:${errMsg}`,
      })
    }
    _ulogError(`[playground-video] threw runId=${playgroundRunId} err=${errMsg}`)
    // Re-throw so BullMQ marks the job failed (and may retry per
    // backoff policy). The PlaygroundRun row already reflects the
    // failure state — duplicate row update on retry is fine.
    throw err
  }
}
