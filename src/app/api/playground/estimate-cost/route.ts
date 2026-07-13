/**
 * Phase T-3 (2026-05-27) — Playground cost estimate.
 *
 * GET /api/playground/estimate-cost?modelKey=...&outputType=...&durationSec=...&resolution=...&generationMode=normal
 *   → { amountUsd: number | null, unit: 'flat' | 'per_second' | 'capability', detail?: string }
 *
 * Reads from the same standards/pricing/image-video.pricing.json catalog
 * the worker uses for actual billing, so estimate ≈ actual.
 *
 * Returns null amount + a `detail` string when:
 *   - model has no pricing entry (admin-defined model without billing config)
 *   - capability tier doesn't match the requested params
 *   - modelKey format is invalid
 *
 * The client displays "≈ $1.20" / "≈ $0.96/秒 × 10s = $9.60" / "—" based on
 * what comes back. No throwing — UI degrades gracefully when pricing is
 * unknown.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { calcVideo } from '@/lib/billing/cost'
import {
  findBuiltinPricingCatalogEntry,
  type BuiltinPricingCatalogEntry,
  type PricingApiType,
} from '@/lib/model-pricing/catalog'

interface EstimateResult {
  amountUsd: number | null
  unit: 'flat' | 'per_second' | 'capability' | 'unknown'
  detail?: string
  perSecond?: number
  perGeneration?: number
}

function parseModelKey(modelKey: string): { provider: string; modelId: string } | null {
  const idx = modelKey.indexOf('::')
  if (idx < 0) return null
  return {
    provider: modelKey.slice(0, idx),
    modelId: modelKey.slice(idx + 2),
  }
}

function resolveCapabilityTier(
  entry: BuiltinPricingCatalogEntry,
  params: { resolution?: string; generationMode?: string; duration?: number },
): { amount: number; matched: Record<string, unknown> } | null {
  const tiers = (entry.pricing.mode === 'capability' && entry.pricing.tiers) ? entry.pricing.tiers : []
  for (const tier of tiers) {
    const when = tier.when ?? {}
    // All `when` clauses must match for the tier to apply.
    let allMatch = true
    for (const [key, expected] of Object.entries(when)) {
      const actual = (params as Record<string, unknown>)[key]
      if (actual !== expected) {
        allMatch = false
        break
      }
    }
    if (allMatch) {
      return { amount: tier.amount, matched: when as Record<string, unknown> }
    }
  }
  return null
}

function computeEstimate(
  entry: BuiltinPricingCatalogEntry,
  outputType: 'image' | 'video',
  durationSec: number | undefined,
  resolution: string | undefined,
  generationMode: string | undefined,
): EstimateResult {
  if (entry.pricing.mode === 'flat') {
    const flat = entry.pricing.flatAmount
    if (typeof flat !== 'number') {
      return { amountUsd: null, unit: 'unknown', detail: 'flat mode but no flatAmount' }
    }
    // (video estimates no longer flow through here — see the calcVideo
    // call in the GET handler; this function now serves image only)
    // Image flat = per generation.
    return {
      amountUsd: flat,
      unit: 'flat',
      perGeneration: flat,
      detail: 'per generation',
    }
  }

  if (entry.pricing.mode === 'capability') {
    const tier = resolveCapabilityTier(entry, {
      ...(resolution ? { resolution } : {}),
      ...(generationMode ? { generationMode } : {}),
      ...(durationSec ? { duration: durationSec } : {}),
    })
    if (!tier) {
      return {
        amountUsd: null,
        unit: 'capability',
        detail: '無匹配計費階層 (model 有計費但需特定 resolution/mode 組合)',
      }
    }
    if (outputType === 'video' && typeof durationSec === 'number' && durationSec > 0) {
      // Many capability tiers for video are per-second too. If `when`
      // already specified `duration` we trust the absolute amount; if
      // not, multiply by duration.
      const hasDurationInWhen = 'duration' in tier.matched
      if (hasDurationInWhen) {
        return {
          amountUsd: tier.amount,
          unit: 'capability',
          detail: `flat @ ${JSON.stringify(tier.matched)}`,
        }
      }
      return {
        amountUsd: tier.amount * durationSec,
        unit: 'per_second',
        perSecond: tier.amount,
        detail: `${tier.amount.toFixed(4)}/秒 × ${durationSec}s @ ${JSON.stringify(tier.matched)}`,
      }
    }
    return {
      amountUsd: tier.amount,
      unit: 'capability',
      detail: `@ ${JSON.stringify(tier.matched)}`,
    }
  }

  return { amountUsd: null, unit: 'unknown', detail: 'unknown pricing mode' }
}

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const modelKey = searchParams.get('modelKey') || ''
  const outputType = (searchParams.get('outputType') || 'image') as 'image' | 'video'
  const durationParam = searchParams.get('durationSec')
  const durationSec = durationParam ? Number.parseInt(durationParam, 10) : undefined
  const resolution = searchParams.get('resolution') || undefined
  const generationMode = searchParams.get('generationMode') || undefined

  const parsed = parseModelKey(modelKey)
  if (!parsed) {
    const empty: EstimateResult = { amountUsd: null, unit: 'unknown', detail: 'invalid modelKey' }
    return NextResponse.json(empty)
  }

  if (outputType !== 'image' && outputType !== 'video') {
    const empty: EstimateResult = { amountUsd: null, unit: 'unknown', detail: 'invalid outputType' }
    return NextResponse.json(empty)
  }

  const apiType: PricingApiType = outputType
  const entry = findBuiltinPricingCatalogEntry(apiType, parsed.provider, parsed.modelId)
  if (!entry) {
    const empty: EstimateResult = {
      amountUsd: null,
      unit: 'unknown',
      detail: `no pricing entry for ${apiType}::${parsed.provider}::${parsed.modelId}`,
    }
    return NextResponse.json(empty)
  }

  // Video estimates call the MONEY layer directly (2026-07-12). The old
  // local math treated flat as a per-second rate while calcVideo treats it
  // as a base-duration (5s) package scaled by duration/5 — a constant 5x
  // drift surfaced by the kling-o3 entries. Delegating to calcVideo makes
  // estimate ≡ freeze quote by construction (same entry resolution, same
  // capability validation, same duration scaling).
  if (outputType === 'video') {
    try {
      const amountUsd = calcVideo(parsed.modelId, resolution || '720p', 1, {
        ...(typeof durationSec === 'number' && durationSec > 0 ? { duration: durationSec } : {}),
        ...(generationMode ? { generationMode } : {}),
      })
      const result: EstimateResult = {
        amountUsd,
        unit: 'capability',
        detail: `與凍結計價同源 (calcVideo${typeof durationSec === 'number' ? ` · ${durationSec}s` : ''})`,
      }
      return NextResponse.json(result)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      const result: EstimateResult = {
        amountUsd: null,
        unit: 'unknown',
        detail: `估價失敗: ${errMsg.slice(0, 160)}`,
      }
      return NextResponse.json(result)
    }
  }

  return NextResponse.json(
    computeEstimate(entry, outputType, durationSec, resolution, generationMode),
  )
})
