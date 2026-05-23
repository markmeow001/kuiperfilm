/**
 * ARK video generator: URL-first reference resolution.
 *
 * Locks the 2026-05-22 cross-border timeout fix in place. Prior behavior
 * unconditionally base64-encoded every reference image, producing 10-30 MB
 * POST bodies that consistently timed out on the NYC1→cn-beijing link
 * (verified: invalid-key POST returns 401 in ~800ms; real multi-ref POST
 * never completed a single 60s attempt).
 *
 * After the fix, COS-key inputs flow through toSignedUrlIfCos → https URL;
 * the generator passes the URL to ARK which fetches it server-side. Local
 * paths and data: URLs still base64-fallback for STORAGE_TYPE=local devs.
 *
 * We test the generator end-to-end by mocking the wire layer + cos /
 * worker utils, then asserting the outgoing arkCreateVideoTask body shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const arkCreateVideoTaskMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'task_test_id',
})))
const imageUrlToBase64Mock = vi.hoisted(() => vi.fn(async (input: string) => {
  // Return a stable, recognizable data URL so assertions can spot fallback.
  return `data:image/png;base64,FAKE_BASE64_FOR(${input})`
}))
const toSignedUrlIfCosMock = vi.hoisted(() => vi.fn((input: string | null | undefined) => {
  if (!input) return null
  // Mirror real behavior: cos-key prefixes get signed; other strings pass through.
  if (input.startsWith('images/') || input.startsWith('video/') || input.startsWith('voice/')) {
    return `https://r2.example.com/${input}?sig=fake`
  }
  return input
}))
const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  apiKey: 'fake-ark-key',
})))

vi.mock('@/lib/ark-api', () => ({
  arkImageGeneration: vi.fn(),
  arkCreateVideoTask: arkCreateVideoTaskMock,
}))
vi.mock('@/lib/cos', () => ({
  imageUrlToBase64: imageUrlToBase64Mock,
}))
vi.mock('@/lib/workers/utils', () => ({
  toSignedUrlIfCos: toSignedUrlIfCosMock,
}))
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

import { ArkVideoGenerator } from '@/lib/generators/ark'

function lastRequestBody() {
  expect(arkCreateVideoTaskMock).toHaveBeenCalled()
  return arkCreateVideoTaskMock.mock.calls[arkCreateVideoTaskMock.mock.calls.length - 1]![0]
}

describe('ArkVideoGenerator URL-first reference resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({ apiKey: 'fake-ark-key' })
    arkCreateVideoTaskMock.mockResolvedValue({ id: 'task_test_id' })
  })

  it('passes COS-key first_frame as signed URL (no base64 upload)', async () => {
    const generator = new ArkVideoGenerator()
    await generator.generate({
      userId: 'u1',
      imageUrl: 'images/character/abc.png',
      prompt: 'test',
      options: { modelId: 'doubao-seedance-2-0-260128', duration: 5 },
    })

    expect(imageUrlToBase64Mock).not.toHaveBeenCalled()
    const body = lastRequestBody()
    const imageEntry = body.content.find((c: { type: string }) => c.type === 'image_url')
    expect(imageEntry).toBeDefined()
    expect(imageEntry!.image_url.url).toBe('https://r2.example.com/images/character/abc.png?sig=fake')
    expect(imageEntry!.image_url.url).not.toMatch(/^data:/)
  })

  it('passes already-https first_frame through unchanged', async () => {
    const generator = new ArkVideoGenerator()
    await generator.generate({
      userId: 'u1',
      imageUrl: 'https://cdn.example.com/already-public.png',
      prompt: 'test',
      options: { modelId: 'doubao-seedance-2-0-260128', duration: 5 },
    })

    expect(imageUrlToBase64Mock).not.toHaveBeenCalled()
    const body = lastRequestBody()
    const imageEntry = body.content.find((c: { type: string }) => c.type === 'image_url')
    expect(imageEntry!.image_url.url).toBe('https://cdn.example.com/already-public.png')
  })

  it('falls back to base64 for local file paths (STORAGE_TYPE=local dev)', async () => {
    const generator = new ArkVideoGenerator()
    await generator.generate({
      userId: 'u1',
      imageUrl: '/uploads/local/dev-only.png',
      prompt: 'test',
      options: { modelId: 'doubao-seedance-2-0-260128', duration: 5 },
    })

    expect(imageUrlToBase64Mock).toHaveBeenCalledWith('/uploads/local/dev-only.png')
    const body = lastRequestBody()
    const imageEntry = body.content.find((c: { type: string }) => c.type === 'image_url')
    expect(imageEntry!.image_url.url).toMatch(/^data:image\/png;base64,FAKE_BASE64_FOR/)
  })

  it('passes all multi-modal reference_images as URLs when COS-keyed', async () => {
    const generator = new ArkVideoGenerator()
    await generator.generate({
      userId: 'u1',
      imageUrl: '',
      prompt: 'pure t2v with refs',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        duration: 5,
        referenceImages: [
          'images/character/c1.png',
          'images/scene/s1.png',
        ],
      },
    })

    expect(imageUrlToBase64Mock).not.toHaveBeenCalled()
    const body = lastRequestBody()
    const refEntries = body.content.filter(
      (c: { type: string; role?: string }) => c.type === 'image_url' && c.role === 'reference_image',
    )
    expect(refEntries).toHaveLength(2)
    for (const ref of refEntries) {
      expect(ref.image_url.url).toMatch(/^https:\/\//)
      expect(ref.image_url.url).not.toMatch(/^data:/)
    }
  })

  it('mixes URL refs + base64 fallback per-ref (heterogeneous inputs)', async () => {
    const generator = new ArkVideoGenerator()
    await generator.generate({
      userId: 'u1',
      imageUrl: '',
      prompt: 'mixed',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        duration: 5,
        referenceImages: [
          'images/character/url-ok.png',          // → URL
          '/uploads/local/legacy.png',            // → base64 fallback
          'https://cdn.example.com/passthru.png', // → URL
        ],
      },
    })

    expect(imageUrlToBase64Mock).toHaveBeenCalledTimes(1)
    expect(imageUrlToBase64Mock).toHaveBeenCalledWith('/uploads/local/legacy.png')

    const body = lastRequestBody()
    const refEntries = body.content.filter(
      (c: { type: string; role?: string }) => c.type === 'image_url' && c.role === 'reference_image',
    )
    expect(refEntries).toHaveLength(3)
    const urls = refEntries.map((r: { image_url: { url: string } }) => r.image_url.url)
    expect(urls[0]).toMatch(/^https:\/\/r2/)
    expect(urls[1]).toMatch(/^data:image/)
    expect(urls[2]).toBe('https://cdn.example.com/passthru.png')
  })

  it('first_last_frame mode uses URLs for both anchor slots', async () => {
    const generator = new ArkVideoGenerator()
    await generator.generate({
      userId: 'u1',
      imageUrl: 'images/character/first.png',
      prompt: 'first to last',
      options: {
        modelId: 'doubao-seedance-2-0-260128',
        duration: 5,
        lastFrameImageUrl: 'images/character/last.png',
      },
    })

    expect(imageUrlToBase64Mock).not.toHaveBeenCalled()
    const body = lastRequestBody()
    const firstFrame = body.content.find((c: { role?: string }) => c.role === 'first_frame')
    const lastFrame = body.content.find((c: { role?: string }) => c.role === 'last_frame')
    expect(firstFrame.image_url.url).toMatch(/^https:\/\/r2.*first\.png/)
    expect(lastFrame.image_url.url).toMatch(/^https:\/\/r2.*last\.png/)
  })
})
