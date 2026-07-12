/**
 * previz 导出 route — 校验分支 + happy path。
 * ffmpeg（previz-transcode）与存储（cos）皆 mock；transcode mock 会真写
 * 输出文件，route 的 readFile→upload 流程走真实路径。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { NextRequest } from 'next/server'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

installAuthMocks()

const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(async () => undefined),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `${prefix}-test.${ext}`),
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))
vi.mock('@/lib/cos', () => cosMock)

const transcodeMock = vi.hoisted(() => ({
  transcodePrevizClip: vi.fn(async ({ outPath }: { outPath: string }) => {
    await writeFile(outPath, Buffer.from('fake-mp4'))
  }),
  extractPrevizFrame: vi.fn(async (_in: string, outPath: string) => {
    await writeFile(outPath, Buffer.from('fake-jpg'))
  }),
}))
vi.mock('@/lib/canvas/previz-transcode', () => transcodeMock)

// vi.doMock（installAuthMocks）不做 hoist —— route 必须在其后动态 import
type RouteModule = typeof import('@/app/api/canvas/previz-export/route')
let routePost: RouteModule['POST']
beforeAll(async () => {
  ;({ POST: routePost } = await import('@/app/api/canvas/previz-export/route'))
})
const POST = (req: NextRequest) => routePost(req, {} as never)

const META = { aspect: '9:16', durationSec: 10, crop: { x: 100, y: 0, w: 607, h: 1080 } }

function makeRequest(parts: { file?: File; meta?: unknown }) {
  const fd = new FormData()
  if (parts.file) fd.append('file', parts.file)
  if (parts.meta !== undefined) fd.append('meta', typeof parts.meta === 'string' ? parts.meta : JSON.stringify(parts.meta))
  return new NextRequest('http://localhost:3000/api/canvas/previz-export', { method: 'POST', body: fd })
}

const webmFile = () => new File([Buffer.from('webm-bytes')], 'clip.webm', { type: 'video/webm' })

describe('POST /api/canvas/previz-export', () => {
  beforeEach(() => {
    resetAuthMockState()
    mockAuthenticated('user-1')
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a missing file', async () => {
    const res = await POST(makeRequest({ meta: META }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(JSON.stringify(body)).toContain('FILE_FIELD_MISSING')
  })

  it('rejects a non-video mime', async () => {
    const res = await POST(makeRequest({ file: new File([Buffer.from('x')], 'x.gif', { type: 'image/gif' }), meta: META }))
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('MIME_NOT_ALLOWED')
  })

  it('rejects duration over the R2V 15.2s ceiling with REFERENCE_VIDEO_TOO_LONG', async () => {
    const res = await POST(makeRequest({ file: webmFile(), meta: { ...META, durationSec: 20 } }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(JSON.stringify(body)).toContain('REFERENCE_VIDEO_TOO_LONG')
    expect(transcodeMock.transcodePrevizClip).not.toHaveBeenCalled()
  })

  it('rejects a malformed crop', async () => {
    const res = await POST(makeRequest({ file: webmFile(), meta: { ...META, crop: { x: 0, y: 0, w: 0, h: 1080 } } }))
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('CROP_INVALID')
  })

  it('rejects an absurdly large crop (ffmpeg arg hardening)', async () => {
    const res = await POST(makeRequest({ file: webmFile(), meta: { ...META, crop: { x: 0, y: 0, w: 1e9, h: 1080 } } }))
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('CROP_INVALID')
    expect(transcodeMock.transcodePrevizClip).not.toHaveBeenCalled()
  })

  it('sanitizes ffmpeg failures — no command line / tmp path leaks to the client', async () => {
    transcodeMock.transcodePrevizClip.mockRejectedValueOnce(
      new Error('Command failed: ffmpeg -y -i /tmp/previz-abc123/in.webm ...\nffmpeg version 8.1.2 stderr blah'),
    )
    const res = await POST(makeRequest({ file: webmFile(), meta: META }))
    expect(res.status).toBeGreaterThanOrEqual(500)
    const raw = JSON.stringify(await res.json())
    expect(raw).toContain('FFMPEG_FAILED')
    expect(raw).not.toContain('/tmp/')
    expect(raw).not.toContain('Command failed')
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('happy path: transcodes 9:16 → 1080x1920, uploads video + 2 frames, returns keys', async () => {
    const res = await POST(makeRequest({ file: webmFile(), meta: META }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.videoKey).toContain('video/playground-ref/user-1/previz')
    expect(body.firstFrameKey).toContain('previz-first')
    expect(body.lastFrameKey).toContain('previz-last')
    expect(body.videoUrl).toContain('https://signed.example/')

    expect(transcodeMock.transcodePrevizClip).toHaveBeenCalledWith(
      expect.objectContaining({ outWidth: 1080, outHeight: 1920, crop: expect.objectContaining({ w: 606 }) }), // 607 → even 606
    )
    expect(transcodeMock.extractPrevizFrame).toHaveBeenCalledTimes(2)
    expect(cosMock.uploadToCOS).toHaveBeenCalledTimes(3)
  })

  it('unauthenticated → 401, nothing uploaded', async () => {
    resetAuthMockState() // clears the session
    const { mockUnauthenticated } = await import('../../helpers/auth')
    mockUnauthenticated()
    const res = await POST(makeRequest({ file: webmFile(), meta: META }))
    expect(res.status).toBe(401)
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })
})
