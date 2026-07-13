import path from 'node:path'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { bundle } from '@remotion/bundler'
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer'
import { webpackOverride } from '@/features/video-editor/remotion/webpack-override'
import { captureDirectChildPids, findNewChromiumChildPid, readProcessTreeRssBytes } from '@/lib/canvas/process-tree-rss'
import { stageStoryboardImages, type StagedStoryboardImages } from '@/lib/canvas/storyboard-image-stage'

const execFileAsync = promisify(execFile)
const fixtureDir = '/tmp/canvas-storyboard-real-4k'
const fixtureResponseDelayMs = 250

async function prepareReal4kImages(): Promise<string[]> {
  const sourceDir = path.resolve(process.cwd(), 'design-preview/images/styles')
  const sources = (await readdir(sourceDir)).filter((name) => name.endsWith('.jpg')).slice(0, 25)
  if (sources.length !== 25) throw new Error(`Expected 25 real JPEG sources, found ${sources.length}`)
  await rm(fixtureDir, { recursive: true, force: true })
  await mkdir(fixtureDir, { recursive: true })
  for (const [index, source] of sources.entries()) {
    const output = path.join(fixtureDir, `${String(index + 1).padStart(2, '0')}.jpg`)
    await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.join(sourceDir, source), '-vf', 'scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160', '-frames:v', '1', '-q:v', '3', '-y', output])
  }
  return sources
}

async function startFixtureServer() {
  const server = createServer((request, response) => {
    const name = path.basename(request.url ?? '')
    if (!/^\d{2}\.jpg$/.test(name)) { response.writeHead(404).end(); return }
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' })
      createReadStream(path.join(fixtureDir, name)).pipe(response)
    }, fixtureResponseDelayMs)
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server did not expose a TCP port')
  return { server, baseUrl: `http://127.0.0.1:${address.port}` }
}

async function main() {
  const sources = await prepareReal4kImages()
  const { server, baseUrl } = await startFixtureServer()
  const started = performance.now()
  const entryPoint = path.resolve(process.cwd(), 'src/features/canvas-storyboard/remotion-entry.tsx')
  const output = path.resolve('/tmp/canvas-storyboard-spike.jpg')
  let browser: Awaited<ReturnType<typeof openBrowser>> | null = null
  let peakBrowserTreeRssBytes = 0
  let monitor: ReturnType<typeof setTimeout> | null = null
  let activeSample: Promise<void> | null = null
  let monitoringStopped = false
  let stagedImages: StagedStoryboardImages | null = null
  try {
    const serveUrl = await bundle({ entryPoint, webpackOverride })
    stagedImages = await stageStoryboardImages(sources.map((source, index) => ({ title: `镜头 ${index + 1} · ${path.basename(source, '.jpg')}`, imageUrl: `${baseUrl}/${String(index + 1).padStart(2, '0')}.jpg` })), 'spike')
    const inputProps = { items: stagedImages.items, columns: 4 as const, showShotNumber: true }
    const previousChildren = await captureDirectChildPids()
    browser = await openBrowser('chrome', { chromiumOptions: { gl: 'swangle' } })
    const browserPid = await findNewChromiumChildPid(previousChildren)
    const sample = (): Promise<void> => {
      if (activeSample) return activeSample
      activeSample = readProcessTreeRssBytes(browserPid)
        .then((rssBytes) => { peakBrowserTreeRssBytes = Math.max(peakBrowserTreeRssBytes, rssBytes) })
        .finally(() => { activeSample = null })
      return activeSample
    }
    const scheduleSample = () => {
      monitor = setTimeout(() => { void sample().then(() => { if (!monitoringStopped) scheduleSample() }) }, 50)
    }
    await sample()
    scheduleSample()
    const composition = await selectComposition({ serveUrl, id: 'CanvasStoryboardStill', inputProps, puppeteerInstance: browser, timeoutInMilliseconds: 90_000 })
    await renderStill({ composition, serveUrl, inputProps, output, imageFormat: 'jpeg', jpegQuality: 88, puppeteerInstance: browser, timeoutInMilliseconds: 90_000 })
    monitoringStopped = true
    if (monitor) { clearTimeout(monitor); monitor = null }
    await sample()
    const file = await stat(output)
    const elapsedMs = Math.round(performance.now() - started)
    process.stdout.write(`${JSON.stringify({ output, width: composition.width, height: composition.height, items: 25, real4kInputCount: 25, fixtureResponseDelayMs, elapsedMs, outputBytes: file.size, browserPid, peakBrowserTreeRssBytes })}\n`)
  } finally {
    monitoringStopped = true
    if (monitor) clearTimeout(monitor)
    if (activeSample) await activeSample
    if (browser) await browser.close({ silent: false })
    if (stagedImages) await stagedImages.cleanup()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(fixtureDir, { recursive: true, force: true })
  }
}

void main()
