import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { stageStoryboardImages, type StagedStoryboardImages } from '@/lib/canvas/storyboard-image-stage'

const servers: Array<ReturnType<typeof createServer>> = []
const stages: StagedStoryboardImages[] = []

afterEach(async () => {
  await Promise.all(stages.splice(0).map((stage) => stage.cleanup()))
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

async function serve(contentType: string, body: Buffer, delayMs = 0): Promise<string> {
  const server = createServer((_request, response) => {
    setTimeout(() => { response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': String(body.length) }); response.end(body) }, delayMs)
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server address missing')
  return `http://127.0.0.1:${address.port}/image`
}

describe('storyboard image staging', () => {
  it('slow signed source -> fully downloads then serves stable local bytes with content length', async () => {
    const bytes = Buffer.from('complete-image-bytes')
    const url = await serve('image/jpeg', bytes, 50)
    const stage = await stageStoryboardImages([{ title: '镜一', imageUrl: url }], 'stage-test')
    stages.push(stage)
    const response = await fetch(stage.items[0].imageUrl)
    expect(response.headers.get('content-length')).toBe(String(bytes.length))
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(stage).toMatchObject({ totalBytes: bytes.length, items: [{ title: '镜一' }] })
  })

  it('source is not an image -> fails explicitly before renderer starts', async () => {
    const url = await serve('text/plain', Buffer.from('not image'))
    await expect(stageStoryboardImages([{ title: '坏图', imageUrl: url }], 'bad-stage')).rejects.toThrow('STORYBOARD_IMAGE_CONTENT_TYPE_INVALID:text/plain')
  })
})
