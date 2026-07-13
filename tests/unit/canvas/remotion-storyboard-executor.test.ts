import { beforeEach, describe, expect, it, vi } from 'vitest'

const rendererMock = vi.hoisted(() => ({
  browser: { close: vi.fn(async () => undefined) },
  cancel: vi.fn(),
  openBrowser: vi.fn(),
  selectComposition: vi.fn(),
  renderStill: vi.fn(),
}))
const rssMock = vi.hoisted(() => ({ capture: vi.fn(), findPid: vi.fn(), read: vi.fn() }))
const cosMock = vi.hoisted(() => ({ upload: vi.fn(), key: vi.fn() }))

vi.mock('@remotion/renderer', () => ({
  makeCancelSignal: () => ({ cancelSignal: { cancel: rendererMock.cancel }, cancel: rendererMock.cancel }),
  openBrowser: rendererMock.openBrowser,
  selectComposition: rendererMock.selectComposition,
  renderStill: rendererMock.renderStill,
}))
vi.mock('@/lib/canvas/process-tree-rss', () => ({ captureDirectChildPids: rssMock.capture, findNewChromiumChildPid: rssMock.findPid, readProcessTreeRssBytes: rssMock.read }))
vi.mock('@/lib/canvas/storyboard-bundle-cache', () => ({ getCanvasStoryboardBundle: vi.fn(async () => '/tmp/bundle') }))
vi.mock('@/lib/cos', () => ({ uploadToCOS: cosMock.upload, generateUniqueKey: cosMock.key }))
vi.mock('@/lib/logging/core', () => ({ logInfo: vi.fn(), logError: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(async () => Buffer.from('jpeg')), rm: vi.fn(async () => undefined), stat: vi.fn(async () => ({ size: 4 })) }))

import { renderCanvasStoryboard } from '@/lib/canvas/remotion-storyboard-executor'

const input = { userId: 'user-1', taskId: 'task-1', items: [{ title: '镜一', imageUrl: 'file:///tmp/one.jpg' }], columns: 4 as const, showShotNumber: true }

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CANVAS_STORYBOARD_MAX_RSS_BYTES
  rendererMock.openBrowser.mockResolvedValue(rendererMock.browser)
  rendererMock.selectComposition.mockResolvedValue({ id: 'CanvasStoryboardStill', width: 3840, height: 2160, fps: 1, durationInFrames: 1 })
  rendererMock.renderStill.mockResolvedValue({ buffer: null, contentType: 'image/jpeg' })
  rssMock.capture.mockResolvedValue(new Set([10]))
  rssMock.findPid.mockResolvedValue(20)
  rssMock.read.mockResolvedValue(700_000_000)
  cosMock.key.mockReturnValue('images/canvas/storyboard/result.jpg')
})

describe('Remotion storyboard executor resource guard', () => {
  it('render -> select and render reuse one browser, measure its tree, close in finally', async () => {
    await expect(renderCanvasStoryboard(input)).resolves.toEqual({ resultKey: 'images/canvas/storyboard/result.jpg', peakRssBytes: 700_000_000, outputBytes: 4 })
    expect(rendererMock.selectComposition).toHaveBeenCalledWith(expect.objectContaining({ puppeteerInstance: rendererMock.browser }))
    expect(rendererMock.renderStill).toHaveBeenCalledWith(expect.objectContaining({ puppeteerInstance: rendererMock.browser, imageFormat: 'jpeg' }))
    expect(rssMock.findPid).toHaveBeenCalledWith(new Set([10]))
    expect(rssMock.read).toHaveBeenCalledWith(20)
    expect(rendererMock.browser.close).toHaveBeenCalledWith({ silent: false })
  })

  it('Chromium tree exceeds budget -> cancels before selection and fails explicitly', async () => {
    process.env.CANVAS_STORYBOARD_MAX_RSS_BYTES = '600000000'
    rssMock.read.mockResolvedValue(700_000_000)
    await expect(renderCanvasStoryboard(input)).rejects.toThrow('STORYBOARD_RSS_BUDGET_EXCEEDED:700000000:600000000')
    expect(rendererMock.cancel).toHaveBeenCalled()
    expect(rendererMock.selectComposition).not.toHaveBeenCalled()
    expect(rendererMock.browser.close).toHaveBeenCalledWith({ silent: false })
  })

  it('RSS monitor cannot resolve process -> cancels and refuses unguarded render', async () => {
    rssMock.read.mockRejectedValue(new Error('process disappeared'))
    await expect(renderCanvasStoryboard(input)).rejects.toThrow('STORYBOARD_RSS_MONITOR_FAILED:process disappeared')
    expect(rendererMock.cancel).toHaveBeenCalled()
    expect(rendererMock.renderStill).not.toHaveBeenCalled()
  })
})
