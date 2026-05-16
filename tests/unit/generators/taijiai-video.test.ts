import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiConfigMock = vi.hoisted(() => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'sk-taijiai-test' })),
}))

vi.mock('@/lib/api-config', () => apiConfigMock)

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import {
  TaijiaiSeedanceVideoGenerator,
  queryTaijiaiTaskStatus,
} from '@/lib/generators/video/taijiai'

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('TaijiaiSeedanceVideoGenerator.generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
  })

  it('POSTs to /v1/videos with multi-modal content and returns TAIJIAI:VIDEO:<id>', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'vid_001',
        object: 'video',
        status: 'queued',
        progress: 0,
        created_at: 1716000000,
      }),
    )

    const generator = new TaijiaiSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'A cinematic shot at golden hour',
      options: {
        duration: 8,
        aspectRatio: '16:9',
        generateAudio: true,
        lastFrameImageUrl: 'https://example.com/last.png',
      },
    })

    expect(result.success).toBe(true)
    expect(result.async).toBe(true)
    expect(result.externalId).toBe('TAIJIAI:VIDEO:vid_001')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://www.taijiai.online/v1/videos')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-taijiai-test')

    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.model).toBe('seedance-2.0')
    expect(body.duration).toBe(8)
    expect(body.ratio).toBe('16:9')
    expect(body.generate_audio).toBe(true)

    const content = body.content as Array<Record<string, unknown>>
    expect(content[0]).toMatchObject({ type: 'text', text: 'A cinematic shot at golden hour' })
    expect(content[1]).toMatchObject({
      type: 'image_url',
      role: 'first_frame',
      subject_type: 'generic',
      image_url: { url: 'https://example.com/first.png' },
    })
    expect(content[2]).toMatchObject({
      type: 'image_url',
      role: 'last_frame',
      subject_type: 'generic',
      image_url: { url: 'https://example.com/last.png' },
    })
  })

  it('clamps duration to [4, 15] and normalises invalid ratio to "auto"', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'vid_002', object: 'video', status: 'queued', progress: 0, created_at: 0 }),
    )

    const generator = new TaijiaiSeedanceVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'p',
      options: {
        duration: 999,
        aspectRatio: 'banana',
      },
    })

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>
    expect(body.duration).toBe(15)
    expect(body.ratio).toBe('auto')
  })

  it('marks first reference as subject_type="person" when isPersonReference=true', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'vid_003', object: 'video', status: 'queued', progress: 0, created_at: 0 }),
    )

    const generator = new TaijiaiSeedanceVideoGenerator()
    await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/real-person.png',
      prompt: 'a person waves',
      options: { isPersonReference: true },
    })

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as Record<string, unknown>
    const content = body.content as Array<Record<string, unknown>>
    const firstImage = content.find((item) => item.type === 'image_url' && item.role === 'first_frame')
    expect(firstImage?.subject_type).toBe('person')
  })

  it('surfaces TAIJIAI_AUTH_FAILED on 401', async () => {
    // BaseVideoGenerator retries twice — keep the mock returning 401
    // for every attempt so the final error is the auth error, not a
    // bookkeeping artefact.
    // Fresh Response per attempt — Response bodies are single-use,
    // and BaseVideoGenerator retries on throw.
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ detail: 'Invalid API key' }), { status: 401 }),
    )

    const generator = new TaijiaiSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: 'https://example.com/first.png',
      prompt: 'p',
      options: {},
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/TAIJIAI_AUTH_FAILED/)
  })

  it('surfaces TAIJIAI_VIDEO_PROMPT_OR_REFERENCE_REQUIRED when neither prompt nor imageUrl provided', async () => {
    const generator = new TaijiaiSeedanceVideoGenerator()
    const result = await generator.generate({
      userId: 'user-1',
      imageUrl: '',
      prompt: '',
      options: {},
    })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/TAIJIAI_VIDEO_PROMPT_OR_REFERENCE_REQUIRED/)
  })
})

describe('queryTaijiaiTaskStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
  })

  it('maps status="queued" / "processing" to pending', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 'v1', status: 'queued', progress: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'v1', status: 'processing', progress: 42 }))

    expect(await queryTaijiaiTaskStatus('v1', 'sk')).toEqual({ status: 'pending' })
    expect(await queryTaijiaiTaskStatus('v1', 'sk')).toEqual({ status: 'pending' })
  })

  it('returns videoUrl on completed', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'v1',
        status: 'completed',
        progress: 100,
        video_url: 'https://cdn.example.com/vid.mp4',
      }),
    )
    const result = await queryTaijiaiTaskStatus('v1', 'sk')
    expect(result).toEqual({
      status: 'completed',
      videoUrl: 'https://cdn.example.com/vid.mp4',
    })
  })

  it('returns failed with error.message on failed status', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'v1',
        status: 'failed',
        progress: 0,
        error: { message: '真人审核不通过', code: 'PERSON_REVIEW_FAILED' },
      }),
    )
    const result = await queryTaijiaiTaskStatus('v1', 'sk')
    expect(result.status).toBe('failed')
    expect(result.error).toBe('真人审核不通过')
  })

  it('returns failed when status=completed but video_url missing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'v1', status: 'completed', progress: 100, video_url: null }),
    )
    const result = await queryTaijiaiTaskStatus('v1', 'sk')
    expect(result.status).toBe('failed')
    expect(result.error).toContain('no video_url')
  })

  it('returns TAIJIAI_AUTH_FAILED on 401', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'Invalid API key' }), { status: 401 }),
    )
    const result = await queryTaijiaiTaskStatus('v1', 'sk')
    expect(result.status).toBe('failed')
    expect(result.error).toContain('TAIJIAI_AUTH_FAILED')
  })
})
