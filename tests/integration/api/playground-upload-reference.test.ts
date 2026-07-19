import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

installAuthMocks()

const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(async () => undefined),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `${prefix}-test.${ext}`),
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))
vi.mock('@/lib/cos', () => cosMock)

type RouteModule = typeof import('@/app/api/playground/upload-reference/route')
let routePost: RouteModule['POST']

beforeAll(async () => {
  ;({ POST: routePost } = await import('@/app/api/playground/upload-reference/route'))
})

function imageRequest(bytes: Buffer, reportedMime: string) {
  const formData = new FormData()
  formData.append('type', 'image')
  formData.append('file', new File([Uint8Array.from(bytes)], 'reference.jpg', { type: reportedMime }))
  return new NextRequest('http://localhost:3000/api/playground/upload-reference', {
    method: 'POST',
    body: formData,
  })
}

describe('POST /api/playground/upload-reference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthMockState()
    mockAuthenticated('user-1')
  })

  it('stores PNG bytes as PNG even when the browser reports image/jpeg', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    const response = await routePost(imageRequest(png, 'image/jpeg'), {} as never)

    expect(response.status).toBe(200)
    expect(cosMock.generateUniqueKey).toHaveBeenCalledWith(
      'images/playground-ref/user-1/ref',
      'png',
    )
    expect(cosMock.uploadToCOS).toHaveBeenCalledWith(png, expect.stringMatching(/\.png$/))
  })

  it('rejects spoofed image content before storage', async () => {
    const response = await routePost(
      imageRequest(Buffer.from('not-an-image'), 'image/jpeg'),
      {} as never,
    )

    expect(response.status).toBe(400)
    expect(JSON.stringify(await response.json())).toContain('IMAGE_CONTENT_INVALID')
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })
})
