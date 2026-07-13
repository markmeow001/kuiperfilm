import { describe, expect, it, vi, beforeEach } from 'vitest'
import { STORYBOARD_EXPORT_LIMITS, storyboardExportRequestSchema } from '@/lib/canvas/storyboard-export-contract'

const bundleMock = vi.hoisted(() => vi.fn())
vi.mock('@remotion/bundler', () => ({ bundle: bundleMock }))
vi.mock('@/features/video-editor/remotion/webpack-override', () => ({ webpackOverride: vi.fn() }))

import { getCanvasStoryboardBundle, resetCanvasStoryboardBundleForTest } from '@/lib/canvas/storyboard-bundle-cache'

beforeEach(() => { resetCanvasStoryboardBundleForTest(); bundleMock.mockReset(); bundleMock.mockResolvedValue('/tmp/remotion-bundle') })

describe('storyboard export limits and bundle cache', () => {
  it('hard limits -> max 25, 90s timeout, 4K, 2.25GiB RSS default', () => {
    expect(STORYBOARD_EXPORT_LIMITS).toEqual(expect.objectContaining({ maxItems: 25, timeoutMs: 90_000, width: 3840, height: 2160, defaultMaxRssBytes: 2304 * 1024 * 1024 }))
    expect(storyboardExportRequestSchema.safeParse({ taskIds: Array.from({ length: 26 }, () => crypto.randomUUID()), titles: Array.from({ length: 26 }, () => 'x') }).success).toBe(false)
  })

  it('same worker process -> bundles once and reuses promise across tasks', async () => {
    const [a, b] = await Promise.all([getCanvasStoryboardBundle(), getCanvasStoryboardBundle()])
    expect(a).toBe('/tmp/remotion-bundle'); expect(b).toBe('/tmp/remotion-bundle')
    expect(bundleMock).toHaveBeenCalledTimes(1)
  })

  it('failed bundle -> cache resets so next task can retry', async () => {
    bundleMock.mockRejectedValueOnce(new Error('bundle failed')).mockResolvedValueOnce('/tmp/recovered')
    await expect(getCanvasStoryboardBundle()).rejects.toThrow('bundle failed')
    await expect(getCanvasStoryboardBundle()).resolves.toBe('/tmp/recovered')
    expect(bundleMock).toHaveBeenCalledTimes(2)
  })
})
