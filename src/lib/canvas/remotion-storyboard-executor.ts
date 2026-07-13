import path from 'node:path'
import { readFile, rm, stat } from 'node:fs/promises'
import { makeCancelSignal, renderStill, selectComposition } from '@remotion/renderer'
import { generateUniqueKey, uploadToCOS } from '@/lib/cos'
import { logError, logInfo } from '@/lib/logging/core'
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

export async function renderCanvasStoryboard(input: StoryboardRenderInput): Promise<StoryboardRenderResult> {
  if (input.items.length < 1 || input.items.length > STORYBOARD_EXPORT_LIMITS.maxItems) throw new Error('STORYBOARD_ITEM_COUNT_INVALID')
  const serveUrl = await getCanvasStoryboardBundle()
  const inputProps = { items: input.items, columns: input.columns, showShotNumber: input.showShotNumber }
  const composition = await selectComposition({ serveUrl, id: 'CanvasStoryboardStill', inputProps, timeoutInMilliseconds: STORYBOARD_EXPORT_LIMITS.timeoutMs })
  const output = path.resolve('/tmp', `canvas-storyboard-${input.taskId}.jpg`)
  const maxRssBytes = Number(process.env.CANVAS_STORYBOARD_MAX_RSS_BYTES) || STORYBOARD_EXPORT_LIMITS.defaultMaxRssBytes
  const { cancelSignal, cancel } = makeCancelSignal()
  let peakRssBytes = process.memoryUsage().rss
  let budgetExceeded = false
  let timedOut = false
  const monitor = setInterval(() => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
    if (peakRssBytes > maxRssBytes) { budgetExceeded = true; cancel() }
  }, 100)
  const timeout = setTimeout(() => { timedOut = true; cancel() }, STORYBOARD_EXPORT_LIMITS.timeoutMs)
  try {
    await renderStill({ composition, serveUrl, inputProps, output, imageFormat: 'jpeg', jpegQuality: 90, chromiumOptions: { gl: 'swangle' }, cancelSignal, timeoutInMilliseconds: STORYBOARD_EXPORT_LIMITS.timeoutMs })
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
    if (budgetExceeded) throw new Error(`STORYBOARD_RSS_BUDGET_EXCEEDED:${peakRssBytes}:${maxRssBytes}`)
    if (timedOut) throw new Error(`STORYBOARD_RENDER_TIMEOUT:${STORYBOARD_EXPORT_LIMITS.timeoutMs}`)
    const file = await stat(output)
    const resultKey = generateUniqueKey(`canvas/storyboard/${input.userId}`, 'jpg')
    await uploadToCOS(await readFile(output), resultKey)
    logInfo(`[canvas.storyboard] taskId=${input.taskId} items=${input.items.length} peakRssBytes=${peakRssBytes} maxRssBytes=${maxRssBytes} outputBytes=${file.size}`)
    return { resultKey, peakRssBytes, outputBytes: file.size }
  } catch (error) {
    logError(`[canvas.storyboard] taskId=${input.taskId} failed peakRssBytes=${peakRssBytes} maxRssBytes=${maxRssBytes} budgetExceeded=${budgetExceeded} timedOut=${timedOut}`)
    if (budgetExceeded) throw new Error(`STORYBOARD_RSS_BUDGET_EXCEEDED:${peakRssBytes}:${maxRssBytes}`)
    if (timedOut) throw new Error(`STORYBOARD_RENDER_TIMEOUT:${STORYBOARD_EXPORT_LIMITS.timeoutMs}`)
    throw error
  } finally {
    clearInterval(monitor); clearTimeout(timeout); await rm(output, { force: true })
  }
}
