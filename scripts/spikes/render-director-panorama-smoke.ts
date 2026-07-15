import path from 'node:path'
import { bundle } from '@remotion/bundler'
import { openBrowser, renderStill, selectComposition } from '@remotion/renderer'
import sharp from 'sharp'

async function main() {
  const entryPoint = path.resolve(process.cwd(), 'scripts/spikes/director-panorama-smoke-entry.tsx')
  const output = path.resolve('/tmp/director-panorama-smoke.png')
  const serveUrl = await bundle({ entryPoint })
  const browser = await openBrowser('chrome', { chromiumOptions: { gl: 'swangle' } })
  try {
    const composition = await selectComposition({ serveUrl, id: 'DirectorPanoramaSmoke', inputProps: {}, puppeteerInstance: browser, timeoutInMilliseconds: 60_000 })
    await renderStill({ composition, serveUrl, inputProps: {}, output, imageFormat: 'png', puppeteerInstance: browser, timeoutInMilliseconds: 60_000 })
    const stats = await sharp(output).stats()
    const means = stats.channels.slice(0, 3).map((channel) => Math.round(channel.mean))
    const spread = Math.max(...means) - Math.min(...means)
    if (Math.max(...means) < 20 || stats.entropy < 1 || spread < 5) {
      throw new Error(`Panorama rendered blank or near-monochrome: means=${means.join(',')} entropy=${stats.entropy.toFixed(2)}`)
    }
    process.stdout.write(`${JSON.stringify({ output, width: composition.width, height: composition.height, means, entropy: Number(stats.entropy.toFixed(2)), status: 'ok' })}\n`)
  } finally {
    await browser.close({ silent: false })
  }
}

void main()
