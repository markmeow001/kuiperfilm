import path from 'node:path'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { STORYBOARD_EXPORT_LIMITS } from './storyboard-export-contract'

interface StagedFile {
  path: string
  contentType: string
  bytes: number
}

export interface StagedStoryboardImages {
  items: Array<{ title: string; imageUrl: string }>
  totalBytes: number
  cleanup: () => Promise<void>
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

async function downloadImage(url: string, outputPath: string, total: { bytes: number }, abortController: AbortController): Promise<StagedFile> {
  const timeout = setTimeout(() => abortController.abort(new Error('STORYBOARD_IMAGE_FETCH_TIMEOUT')), STORYBOARD_EXPORT_LIMITS.imageDownloadTimeoutMs)
  try {
    const response = await fetch(url, { signal: abortController.signal })
    if (!response.ok || !response.body) throw new Error(`STORYBOARD_IMAGE_FETCH_FAILED:${response.status}`)
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? ''
    if (!contentType.startsWith('image/')) throw new Error(`STORYBOARD_IMAGE_CONTENT_TYPE_INVALID:${contentType || 'missing'}`)
    const declared = Number(response.headers.get('content-length') ?? 0)
    if (declared > STORYBOARD_EXPORT_LIMITS.maxSingleImageBytes) throw new Error('STORYBOARD_IMAGE_TOO_LARGE')
    let fileBytes = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        fileBytes += chunk.byteLength
        total.bytes += chunk.byteLength
        if (fileBytes > STORYBOARD_EXPORT_LIMITS.maxSingleImageBytes || total.bytes > STORYBOARD_EXPORT_LIMITS.maxInputBytes) throw new Error('STORYBOARD_IMAGES_TOO_LARGE')
        controller.enqueue(chunk)
      },
    })
    await pipeline(Readable.fromWeb(response.body.pipeThrough(counter) as never), createWriteStream(outputPath))
    if (fileBytes === 0) throw new Error('STORYBOARD_IMAGE_EMPTY')
    return { path: outputPath, contentType, bytes: fileBytes }
  } finally {
    clearTimeout(timeout)
  }
}

export async function stageStoryboardImages(items: Array<{ title: string; imageUrl: string }>, taskId: string): Promise<StagedStoryboardImages> {
  const dir = await mkdtemp(path.join(tmpdir(), `canvas-storyboard-images-${taskId}-`))
  const abortController = new AbortController()
  const total = { bytes: 0 }
  const downloads = items.map((item, index) => downloadImage(item.imageUrl, path.join(dir, `${index}.image`), total, abortController))
  let files: StagedFile[]
  try {
    files = await Promise.all(downloads)
  } catch (error) {
    abortController.abort()
    await Promise.allSettled(downloads)
    await rm(dir, { recursive: true, force: true })
    throw error
  }

  const server = createServer(async (request, response) => {
    const match = request.url?.match(/^\/(\d+)$/)
    const file = match ? files[Number(match[1])] : undefined
    if (!file) { response.writeHead(404).end(); return }
    try {
      const actual = await stat(file.path)
      if (actual.size !== file.bytes) throw new Error('STORYBOARD_STAGED_IMAGE_SIZE_DRIFT')
      response.writeHead(200, { 'Content-Type': file.contentType, 'Content-Length': String(file.bytes), 'Cache-Control': 'no-store' })
      const stream = createReadStream(file.path)
      stream.on('error', (error) => response.destroy(error))
      stream.pipe(response)
    } catch (error) {
      response.destroy(error instanceof Error ? error : new Error('STORYBOARD_STAGED_IMAGE_READ_FAILED'))
    }
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  const address = server.address()
  if (!address || typeof address === 'string') { await closeServer(server); await rm(dir, { recursive: true, force: true }); throw new Error('STORYBOARD_IMAGE_SERVER_ADDRESS_INVALID') }
  let cleaned = false
  return {
    items: items.map((item, index) => ({ title: item.title, imageUrl: `http://127.0.0.1:${address.port}/${index}` })),
    totalBytes: total.bytes,
    cleanup: async () => {
      if (cleaned) return
      cleaned = true
      await closeServer(server)
      await rm(dir, { recursive: true, force: true })
    },
  }
}
