import { describe, expect, it } from 'vitest'
import { buildWindow, composeMetrics, resolveDeliveryPricePerMinute } from '@/lib/admin/production-economics'

describe('composeMetrics', () => {
  it('computes ratios + derived rates from primitive inputs', () => {
    const m = composeMetrics({
      generatedSeconds: 1000,
      deliveredSeconds: 750,
      totalTokens: 5_000_000,
      totalCost: 12.5,
      deliveryPricePerMinute: 50,
    })
    expect(m.generatedSeconds).toBe(1000)
    expect(m.deliveredSeconds).toBe(750)
    expect(m.deliveredRatio).toBeCloseTo(0.75, 5)
    expect(m.wasteRatio).toBeCloseTo(0.25, 5)
    expect(m.totalTokens).toBe(5_000_000)
    expect(m.totalCost).toBe(12.5)
    expect(m.tokensPerGenSecond).toBe(5000)
    expect(m.tokensPerFinalSecond).toBeCloseTo(6666.666, 1)
    // 12.5 cost / (750/60 min) = 12.5 / 12.5 = 1.0
    expect(m.realCostPerMinute).toBeCloseTo(1.0, 5)
    expect(m.deliveryPricePerMinute).toBe(50)
    // (50 - 1.0) / 50 = 0.98
    expect(m.grossMargin).toBeCloseTo(0.98, 5)
    expect(m.currency).toBe('RMB')
  })

  it('returns null derivatives when divisor is zero', () => {
    const m = composeMetrics({
      generatedSeconds: 0,
      deliveredSeconds: 0,
      totalTokens: 0,
      totalCost: 0,
      deliveryPricePerMinute: null,
    })
    expect(m.deliveredRatio).toBeNull()
    expect(m.wasteRatio).toBeNull()
    expect(m.tokensPerGenSecond).toBeNull()
    expect(m.tokensPerFinalSecond).toBeNull()
    expect(m.realCostPerMinute).toBeNull()
    expect(m.grossMargin).toBeNull()
  })

  it('grossMargin null when price unset even if cost known', () => {
    const m = composeMetrics({
      generatedSeconds: 100,
      deliveredSeconds: 100,
      totalTokens: 1000,
      totalCost: 1.0,
      deliveryPricePerMinute: null,
    })
    expect(m.realCostPerMinute).toBeCloseTo(0.6, 3)
    expect(m.deliveryPricePerMinute).toBeNull()
    expect(m.grossMargin).toBeNull()
  })

  it('handles 100% waste (no deliveries)', () => {
    const m = composeMetrics({
      generatedSeconds: 600,
      deliveredSeconds: 0,
      totalTokens: 10000,
      totalCost: 5,
      deliveryPricePerMinute: 50,
    })
    expect(m.deliveredRatio).toBe(0)
    expect(m.wasteRatio).toBe(1)
    expect(m.tokensPerFinalSecond).toBeNull() // div by 0
    expect(m.realCostPerMinute).toBeNull() // div by 0 (delivered=0 minutes)
    expect(m.grossMargin).toBeNull() // depends on cost
  })

  it('clamps wasteRatio to >= 0 when delivered > generated (data anomaly)', () => {
    const m = composeMetrics({
      generatedSeconds: 100,
      deliveredSeconds: 150, // shouldn't happen but guard against it
      totalTokens: 0,
      totalCost: 0,
      deliveryPricePerMinute: null,
    })
    expect(m.deliveredRatio).toBe(1.5)
    expect(m.wasteRatio).toBe(0) // max(0, 1 - 1.5) = 0, not negative
  })

  it('respects custom currency', () => {
    const m = composeMetrics({
      generatedSeconds: 100,
      deliveredSeconds: 100,
      totalTokens: 0,
      totalCost: 0,
      deliveryPricePerMinute: null,
      currency: 'USD',
    })
    expect(m.currency).toBe('USD')
  })
})

describe('buildWindow', () => {
  it('returns a window of N*7 days ending at tomorrow 00:00 UTC', () => {
    const { start, end } = buildWindow(4)
    const diffMs = end.getTime() - start.getTime()
    const diffDays = diffMs / (1000 * 60 * 60 * 24)
    expect(diffDays).toBe(28)
    // end should be midnight UTC
    expect(end.getUTCHours()).toBe(0)
    expect(end.getUTCMinutes()).toBe(0)
    expect(end.getUTCSeconds()).toBe(0)
  })

  it('clamps weeks to [1, 12]', () => {
    expect(buildWindow(0).end.getTime() - buildWindow(0).start.getTime()).toBe(1 * 7 * 86400_000)
    expect(buildWindow(99).end.getTime() - buildWindow(99).start.getTime()).toBe(12 * 7 * 86400_000)
    expect(buildWindow(-5).end.getTime() - buildWindow(-5).start.getTime()).toBe(1 * 7 * 86400_000)
  })

  it('coerces non-integer weeks via floor', () => {
    const diff = buildWindow(2.9).end.getTime() - buildWindow(2.9).start.getTime()
    expect(diff).toBe(2 * 7 * 86400_000) // Math.floor(2.9) = 2
  })
})

describe('resolveDeliveryPricePerMinute', () => {
  const ORIG = process.env.DELIVERY_PRICE_PER_MINUTE

  afterEachReset()

  it('returns null when env var unset', () => {
    delete process.env.DELIVERY_PRICE_PER_MINUTE
    expect(resolveDeliveryPricePerMinute()).toBeNull()
  })

  it('returns the parsed number when env var set', () => {
    process.env.DELIVERY_PRICE_PER_MINUTE = '50.00'
    expect(resolveDeliveryPricePerMinute()).toBe(50)
  })

  it('returns null on negative / zero / NaN', () => {
    process.env.DELIVERY_PRICE_PER_MINUTE = '-5'
    expect(resolveDeliveryPricePerMinute()).toBeNull()
    process.env.DELIVERY_PRICE_PER_MINUTE = '0'
    expect(resolveDeliveryPricePerMinute()).toBeNull()
    process.env.DELIVERY_PRICE_PER_MINUTE = 'banana'
    expect(resolveDeliveryPricePerMinute()).toBeNull()
  })

  function afterEachReset(): void {
    afterEach(() => {
      if (ORIG === undefined) delete process.env.DELIVERY_PRICE_PER_MINUTE
      else process.env.DELIVERY_PRICE_PER_MINUTE = ORIG
    })
  }
})

// vitest's afterEach has to be imported
import { afterEach } from 'vitest'
