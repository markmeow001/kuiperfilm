import path from 'node:path'
import { readFile, rm, stat } from 'node:fs/promises'
import { makeCancelSignal, openBrowser, renderStill, selectComposition, type HeadlessBrowser } from '@remotion/renderer'
import { generateUniqueKey, uploadToCOS } from '@/lib/cos'
import { logError, logInfo } from '@/lib/logging/core'
import { captureDirectChildPids, findNewChromiumChildPid, readProcessTreeRssBytes } from './process-tree-rss'
import { stageStoryboardImages } from './storyboard-image-stage'
import { getCanvasStoryboardBundle } from './storyboard-bundle-cache'
import { STORYBOARD_EXPORT_LIMITS } from './storyboard-export-contract'

export interface StoryboardRenderInput {
  userId: string
  taskId: string
  items: Array<{ title: string; imageUrl: string }>
  columns: 2 | 3 | 4
  showShotNumber: boolean
}

export interface StoryboardRenderResult { resultKey: string; peakRssBytes: number; outputBytes: number }

function configuredMaxRssBytes(): number {
  const raw = process.env.CANVAS_STORYBOARD_MAX_RSS_BYTES
  if (raw === undefined) return STORYBOARD_EXPORT_LIMITS.defaultMaxRssBytes
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('STORYBOARD_RSS_BUDGET_INVALID')
  return parsed
}

export async function renderCanvasStoryboard(input: StoryboardRenderInput): Promise<StoryboardRenderResult> {
  if (input.items.length < 1 || input.items.length > STORYBOARD_EXPORT_LIMITS.maxItems) throw new Error('STORYBOARD_ITEM_COUNT_INVALID')
  const serveUrl = await getCanvasStoryboardBundle()
  const maxRssBytes = configuredMaxRssBytes()
  const stagedImages = await stageStoryboardImages(input.items, input.taskId)
  const inputProps = { items: stagedImages.items, columns: input.columns, showShotNumber: input.showShotNumber }
  const output = path.resolve('/tmp', `canvas-storyboard-${input.taskId}.jpg`)
  const startedAt = Date.now()
  const deadlineAt = startedAt + STORYBOARD_EXPORT_LIMITS.timeoutMs
  const { cancelSignal, cancel } = makeCancelSignal()
  let browser: HeadlessBrowser | null = null
  let monitorTimer: ReturnType<typeof setTimeout> | null = null
  let activeSample: Promise<void> | null = null
  let monitoringStopped = false
  let peakRssBytes = 0
  let budgetExceeded = false
  let timedOut = false
  const monitorState: { error: Error | null } = { error: null }
  const currentMonitorError = (): Error | null => monitorState.error

  const timeout = setTimeout(() => { timedOut = true; cancel() }, STORYBOARD_EXPORT_LIMITS.timeoutMs)
  const remainingMs = () => {
    const remaining = deadlineAt - Date.now()
    if (remaining <= 0) { timedOut = true; throw new Error(`STORYBOARD_RENDER_TIMEOUT:${STORYBOARD_EXPORT_LIMITS.timeoutMs}`) }
    return remaining
  }

  try {
    const previousChildren = await captureDirectChildPids()
    browser = await openBrowser('chrome', { chromiumOptions: { gl: 'swangle' } })
    const browserPid = await findNewChromiumChildPid(previousChildren)
    const sampleOnce = async () => {
      if (monitorState.error || budgetExceeded) return
      try {
        const rssBytes = await readProcessTreeRssBytes(browserPid)
        peakRssBytes = Math.max(peakRssBytes, rssBytes)
        if (rssBytes > maxRssBytes) { budgetExceeded = true; cancel(); return }
      } catch (error) {
        monitorState.error = error instanceof Error ? error : new Error('STORYBOARD_RSS_MONITOR_FAILED')
        cancel()
        return
      }
    }
    const sample = (): Promise<void> => {
      if (activeSample) return activeSample
      activeSample = sampleOnce().finally(() => { activeSample = null })
      return activeSample
    }
    const scheduleSample = () => {
      monitorTimer = setTimeout(() => {
        void sample().then(() => { if (!monitoringStopped && !monitorState.error && !budgetExceeded) scheduleSample() })
      }, 100)
    }
    await sample()
    const prepareMonitorError = currentMonitorError()
    if (prepareMonitorError) throw new Error(`STORYBOARD_RSS_MONITOR_FAILED:${prepareMonitorError.message}`)
    if (budgetExceeded) throw new Error(`STORYBOARD_RSS_BUDGET_EXCEEDED:${peakRssBytes}:${maxRssBytes}`)
    scheduleSample()
    const composition = await selectComposition({ serveUrl, id: 'CanvasStoryboardStill', inputProps, puppeteerInstance: browser, timeoutInMilliseconds: remainingMs() })
    const selectMonitorError = currentMonitorError()
    if (selectMonitorError) throw new Error(`STORYBOARD_RSS_MONITOR_FAILED:${selectMonitorError.message}`)
    if (budgetExceeded) throw new Error(`STORYBOARD_RSS_BUDGET_EXCEEDED:${peakRssBytes}:${maxRssBytes}`)
    await renderStill({ composition, serveUrl, inputProps, output, imageFormat: 'jpeg', jpegQuality: 90, puppeteerInstance: browser, cancelSignal, timeoutInMilliseconds: remainingMs() })
    monitoringStopped = true
    if (monitorTimer) { clearTimeout(monitorTimer); monitorTimer = null }
    await sample()
    const renderMonitorError = currentMonitorError()
    if (renderMonitorError) throw new Error(`STORYBOARD_RSS_MONITOR_FAILED:${renderMonitorError.message}`)
    if (budgetExceeded) throw new Error(`STORYBOARD_RSS_BUDGET_EXCEEDED:${peakRssBytes}:${maxRssBytes}`)
    if (timedOut) throw new Error(`STORYBOARD_RENDER_TIMEOUT:${STORYBOARD_EXPORT_LIMITS.timeoutMs}`)
    const file = await stat(output)
    const resultKey = generateUniqueKey(`canvas/storyboard/${input.userId}`, 'jpg')
    await uploadToCOS(await readFile(output), resultKey)
    logInfo(`[canvas.storyboard] taskId=${input.taskId} items=${input.items.length} stagedInputBytes=${stagedImages.totalBytes} browserPid=${browserPid} peakRssBytes=${peakRssBytes} maxRssBytes=${maxRssBytes} outputBytes=${file.size}`)
    return { resultKey, peakRssBytes, outputBytes: file.size }
  } catch (error) {
    logError(`[canvas.storyboard] taskId=${input.taskId} failed peakRssBytes=${peakRssBytes} maxRssBytes=${maxRssBytes} budgetExceeded=${budgetExceeded} timedOut=${timedOut} monitorFailed=${Boolean(monitorState.error)}`)
    if (monitorState.error) throw new Error(`STORYBOARD_RSS_MONITOR_FAILED:${monitorState.error.message}`)
    if (budgetExceeded) throw new Error(`STORYBOARD_RSS_BUDGET_EXCEEDED:${peakRssBytes}:${maxRssBytes}`)
    if (timedOut) throw new Error(`STORYBOARD_RENDER_TIMEOUT:${STORYBOARD_EXPORT_LIMITS.timeoutMs}`)
    throw error
  } finally {
    clearTimeout(timeout)
    monitoringStopped = true
    if (monitorTimer) clearTimeout(monitorTimer)
    if (activeSample) await activeSample
    try {
      if (browser) await browser.close({ silent: false })
    } finally {
      try { await rm(output, { force: true }) } finally { await stagedImages.cleanup() }
    }
  }
}
