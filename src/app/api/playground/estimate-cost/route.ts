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
import { calcImage, calcVideo } from '@/lib/billing/cost'

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

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const modelKey = searchParams.get('modelKey') || ''
  const outputType = (searchParams.get('outputType') || 'image') as 'image' | 'video'
  const durationParam = searchParams.get('durationSec')
  const durationSec = durationParam ? Number(durationParam) : undefined
  const resolution = searchParams.get('resolution') || undefined
  const generationMode = searchParams.get('generationMode') || undefined
  const countParam = searchParams.get('count')
  const count = countParam ? Number.parseInt(countParam, 10) : 1

  const parsed = parseModelKey(modelKey)
  if (!parsed) {
    const empty: EstimateResult = { amountUsd: null, unit: 'unknown', detail: 'invalid modelKey' }
    return NextResponse.json(empty)
  }

  if (outputType !== 'image' && outputType !== 'video') {
    const empty: EstimateResult = { amountUsd: null, unit: 'unknown', detail: 'invalid outputType' }
    return NextResponse.json(empty)
  }
  if (!Number.isFinite(count) || count < 1 || count > 4) {
    const empty: EstimateResult = { amountUsd: null, unit: 'unknown', detail: 'invalid count' }
    return NextResponse.json(empty)
  }

  // Both preview and billing freeze call the MONEY layer. Keeping all catalog
  // resolution, capability matching and markup here prevents the image and
  // video UI estimates from drifting away from the amount actually frozen.
  try {
    const amountUsd = outputType === 'video'
      ? calcVideo(parsed.modelId, resolution || '720p', count, {
        ...(typeof durationSec === 'number' && durationSec > 0 ? { duration: durationSec } : {}),
        ...(generationMode ? { generationMode } : {}),
      })
      : calcImage(parsed.modelId, count, resolution ? { resolution } : undefined)
    const result: EstimateResult = {
      amountUsd,
      unit: 'capability',
      detail: `與凍結計價同源 (${outputType === 'video' ? 'calcVideo' : 'calcImage'}${typeof durationSec === 'number' ? ` · ${durationSec}s` : ''})`,
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
})
