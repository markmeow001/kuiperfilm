import path from 'node:path'
import { stat } from 'node:fs/promises'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { webpackOverride } from '@/features/video-editor/remotion/webpack-override'

async function main() {
  const started = performance.now()
  const rssBefore = process.memoryUsage().rss
  const entryPoint = path.resolve(process.cwd(), 'src/features/canvas-storyboard/remotion-entry.tsx')
  const serveUrl = await bundle({ entryPoint, webpackOverride })
  const inputProps = { items: Array.from({ length: 12 }, (_, index) => ({ title: `镜头 ${index + 1} · 4K Storyboard Spike` })), columns: 4 as const, showShotNumber: true }
  const composition = await selectComposition({ serveUrl, id: 'CanvasStoryboardStill', inputProps })
  const output = path.resolve('/tmp/canvas-storyboard-spike.jpg')
  await renderStill({ composition, serveUrl, inputProps, output, imageFormat: 'jpeg', jpegQuality: 88, chromiumOptions: { gl: 'swangle' } })
  const file = await stat(output)
  const elapsedMs = Math.round(performance.now() - started)
  const rssAfter = process.memoryUsage().rss
  const maxRssBytes = process.resourceUsage().maxRSS * 1024
  process.stdout.write(`${JSON.stringify({ output, width: composition.width, height: composition.height, items: 12, elapsedMs, outputBytes: file.size, rssBefore, rssAfter, maxRssBytes })}\n`)
}

void main()
