/**
 * 2026-06-12 PR-A2 — Playground billing sidecar.
 *
 * Patch (not a Phase 9.1 solution): Playground bypasses the Task table
 * (Task.projectId NOT NULL), so it can't use prepareTaskBilling /
 * settleTaskBilling. To stop the bleeding (silent provider charges with
 * no app-side ledger entry → user "燒錢沒圖" 6/02 incident), wire the
 * low-level freezeBalance / confirmChargeWithRecord / rollbackFreeze
 * primitives directly to PlaygroundRun lifecycle.
 *
 * Phase 9.1 (Playground → createRun + Task lifecycle) will delete this
 * file and replace the call sites with the standard task-bound helpers.
 * Until then, keep all Playground-specific billing math + low-level
 * ledger plumbing in one module so the migration is mechanical.
 *
 * Synthetic projectId: 'playground' is registered in
 * src/lib/billing/reporting.ts:VIRTUAL_PROJECT_IDS — this skips UsageCost
 * (no project to aggregate against) while still writing BalanceTransaction
 * so admin sees the spend in the off-project ledger view.
 */

import { calcImage, calcVideo } from '@/lib/billing/cost'
import { BillingOperationError } from '@/lib/billing/errors'
import {
  confirmChargeWithRecord,
  freezeBalance,
  rollbackFreeze,
} from '@/lib/billing/ledger'
import { getBillingMode } from '@/lib/billing/mode'
import { BUILTIN_PRICING_VERSION } from '@/lib/model-pricing/version'
import { logError as _ulogError, logInfo as _ulogInfo } from '@/lib/logging/core'

export type PlaygroundOutputType = 'image' | 'video'

export interface PlaygroundQuoteInput {
  outputType: PlaygroundOutputType
  /** Bare modelId, NOT 'provider::modelId'. Caller resolves via resolveModelSelection. */
  modelId: string
  /** Video only — seconds. Image ignores. */
  durationSec?: number | null
  /** Optional resolution selector — passed to capability pricing tier match. */
  resolution?: string | null
  /** Defaults to 1 — Playground generation count. */
  generationCount?: number
}

export interface PlaygroundQuoteResult {
  quotedCost: number
  pricingVersion: string
}

export interface PlaygroundFreezeArgs {
  userId: string
  playgroundRunId: string
  modelId: string
  outputType: PlaygroundOutputType
  durationSec?: number | null
  resolution?: string | null
  quotedCost: number
}

export interface PlaygroundCaptureArgs {
  freezeId: string
  playgroundRunId: string
  modelId: string
  outputType: PlaygroundOutputType
  durationSec?: number | null
  resolution?: string | null
  /** Actual cost charged (may be less than quoted; capped at quoted by ledger). */
  actualCost: number
}

/**
 * Compute the quoted (max) cost for a Playground submission. Returns 0
 * when billing mode is OFF or the model has no pricing entry (fail-open
 * matches buildDefaultTaskBillingInfo's BILLING_UNKNOWN_MODEL handling —
 * Phase 9.1 will tighten this).
 *
 * Throws BillingOperationError only when capability selections are
 * structurally invalid (so the caller can surface 400 INVALID_PARAMS
 * instead of mis-quoting).
 */
export async function quotePlaygroundCost(input: PlaygroundQuoteInput): Promise<PlaygroundQuoteResult> {
  const mode = await getBillingMode()
  if (mode === 'OFF') {
    return { quotedCost: 0, pricingVersion: BUILTIN_PRICING_VERSION }
  }

  const count = Math.max(1, input.generationCount ?? 1)
  const resolution = input.resolution || undefined

  try {
    if (input.outputType === 'image') {
      const metadata: Record<string, unknown> = {}
      if (resolution) metadata.resolution = resolution
      const cost = calcImage(input.modelId, count, metadata)
      return { quotedCost: cost, pricingVersion: BUILTIN_PRICING_VERSION }
    }

    const metadata: Record<string, unknown> = {}
    if (resolution) metadata.resolution = resolution
    if (typeof input.durationSec === 'number' && input.durationSec > 0) {
      metadata.duration = input.durationSec
    }
    const cost = calcVideo(input.modelId, resolution || '720p', count, metadata)
    return { quotedCost: cost, pricingVersion: BUILTIN_PRICING_VERSION }
  } catch (error) {
    if (error instanceof BillingOperationError && error.code === 'BILLING_UNKNOWN_MODEL') {
      // Model in user catalog but no pricing entry — fail open (charge 0)
      // rather than block submission. Matches buildDefaultTaskBillingInfo.
      // Logged so admin can audit untracked spend.
      _ulogInfo(
        `[playground.billing] unknown pricing — charging 0 modelId=${input.modelId} outputType=${input.outputType}`,
      )
      return { quotedCost: 0, pricingVersion: BUILTIN_PRICING_VERSION }
    }
    throw error
  }
}

/**
 * Freeze the quoted cost against the user's balance. Returns null when:
 *   - billing mode is OFF
 *   - quoted is 0 (no pricing or admin-disabled)
 *   - balance is insufficient (caller surfaces 402)
 *
 * Idempotency-key is the playgroundRunId so retries from the route layer
 * collapse onto the same freeze.
 */
export async function freezeForPlayground(args: PlaygroundFreezeArgs): Promise<string | null> {
  const mode = await getBillingMode()
  if (mode === 'OFF' || args.quotedCost <= 0) {
    return null
  }

  const metadata: Record<string, unknown> = {
    playgroundRunId: args.playgroundRunId,
    outputType: args.outputType,
    modelId: args.modelId,
    pricingVersion: BUILTIN_PRICING_VERSION,
  }
  if (args.resolution) metadata.resolution = args.resolution
  if (typeof args.durationSec === 'number' && args.durationSec > 0) {
    metadata.duration = args.durationSec
  }

  const freezeId = await freezeBalance(args.userId, args.quotedCost, {
    source: 'playground',
    taskId: args.playgroundRunId,
    idempotencyKey: `playground:${args.playgroundRunId}`,
    metadata,
  })

  if (!freezeId) {
    _ulogInfo(
      `[playground.billing] freeze failed userId=${args.userId} runId=${args.playgroundRunId} amount=${args.quotedCost} (insufficient balance or ledger error)`,
    )
  }
  return freezeId
}

/**
 * Confirm the freeze with the post-generation actual cost. Caller must
 * compute actualCost from the same inputs that produced quotedCost; the
 * ledger caps charged at the frozen amount, refunding the difference
 * back to balance.
 *
 * Idempotent — if freeze was already confirmed, succeeds quietly.
 */
export async function captureForPlayground(args: PlaygroundCaptureArgs): Promise<boolean> {
  const metadata: Record<string, unknown> = {
    playgroundRunId: args.playgroundRunId,
    outputType: args.outputType,
    modelId: args.modelId,
    pricingVersion: BUILTIN_PRICING_VERSION,
  }
  if (args.resolution) metadata.resolution = args.resolution
  if (typeof args.durationSec === 'number' && args.durationSec > 0) {
    metadata.duration = args.durationSec
  }

  return await confirmChargeWithRecord(
    args.freezeId,
    {
      projectId: 'playground', // VIRTUAL_PROJECT_IDS — skips UsageCost row
      action: `playground_${args.outputType}`,
      apiType: args.outputType === 'video' ? 'video' : 'image',
      model: args.modelId,
      quantity: args.outputType === 'video' && typeof args.durationSec === 'number'
        ? Math.max(1, args.durationSec)
        : 1,
      unit: args.outputType === 'video' ? 'second' : 'image',
      metadata,
      taskType: `playground_${args.outputType}`,
    },
    { chargedAmount: args.actualCost },
  )
}

/**
 * Roll back a freeze on failure or cancellation. Idempotent — returns
 * true even if the freeze was already rolled back.
 *
 * Errors are logged and swallowed: the caller already has a primary
 * failure to surface (the generation failure); a secondary rollback
 * failure should be visible to ops but not mask the primary.
 */
export async function refundForPlayground(args: {
  freezeId: string
  playgroundRunId: string
  reason: string
}): Promise<boolean> {
  try {
    const ok = await rollbackFreeze(args.freezeId)
    if (ok) {
      _ulogInfo(
        `[playground.billing] refund OK freezeId=${args.freezeId} runId=${args.playgroundRunId} reason=${args.reason}`,
      )
    }
    return ok
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    _ulogError(
      `[playground.billing] refund FAILED freezeId=${args.freezeId} runId=${args.playgroundRunId} primary=${args.reason} secondary=${errMsg}`,
    )
    return false
  }
}
