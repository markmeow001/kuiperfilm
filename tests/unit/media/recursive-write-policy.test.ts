import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  mediaObject: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({
  extractCOSKey: (value: string | null | undefined) => {
    if (!value) return null
    const normalized = value.trim()
    if (/^https?:\/\//i.test(normalized)) {
      return decodeURIComponent(new URL(normalized).pathname).replace(/^\/+/, '')
    }
    return normalized.replace(/^\/+/, '')
  },
  getSignedUrl: (key: string) => `/signed/${encodeURIComponent(key)}`,
}))

import { ApiError } from '@/lib/api-errors'
import { assertNoVoiceLineTaskOutputReferences } from '@/lib/media/recursive-write-policy'

const TASK_OUTPUT = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`

function mediaRow(publicId: string) {
  return {
    id: `media-${publicId}`,
    publicId,
    storageKey: TASK_OUTPUT,
    sha256: null,
    mimeType: 'audio/wav',
    sizeBytes: null,
    width: null,
    height: null,
    durationMs: null,
    updatedAt: new Date('2026-08-12T00:00:00.000Z'),
    uploadedByUserId: null,
  }
}

describe('recursive VoiceLine task-output write policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.mediaObject.findUnique.mockImplementation(async (args: unknown) => {
      const publicId = (args as { where?: { publicId?: unknown } }).where?.publicId
      return publicId === 'reserved-audio' ? mediaRow('reserved-audio') : null
    })
  })

  it.each([
    ['raw key', TASK_OUTPUT],
    ['signed object URL', `HTTPS://cos.example/${TASK_OUTPUT}?sign=temporary`],
    ['relative /m alias', '/m/reserved-audio?download=1'],
    ['absolute /m alias', 'https://app.example/m/reserved-audio#player'],
  ])('[arbitrarily nested %s] -> [rejects the whole JSON value]', async (_label, reference) => {
    let nested: unknown = reference
    for (let depth = 0; depth < 12_000; depth += 1) {
      nested = { child: nested }
    }

    const rejection = assertNoVoiceLineTaskOutputReferences({ payload: [null, nested] })

    await expect(rejection).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: { code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN' },
    } satisfies Partial<ApiError>)
    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('[null, ordinary values, and missing /m text] -> [allows the JSON value without media writes]', async () => {
    const cyclic: Record<string, unknown> = {
      empty: null,
      text: 'ordinary note',
      missingAlias: '/m/missing-audio',
      number: 42,
      enabled: true,
    }
    cyclic.self = cyclic

    await expect(assertNoVoiceLineTaskOutputReferences(cyclic)).resolves.toBeUndefined()
    expect(prismaMock.mediaObject.findUnique).toHaveBeenCalledWith({
      where: { publicId: 'missing-audio' },
    })
    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  })

  it('[reserved output nested in a persisted JSON string] -> [rejects before it can be copied]', async () => {
    await expect(assertNoVoiceLineTaskOutputReferences(JSON.stringify([
      'ordinary.png',
      { previousAudio: TASK_OUTPUT },
    ]))).rejects.toMatchObject({
      code: 'INVALID_PARAMS',
      details: { code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN' },
    } satisfies Partial<ApiError>)
  })
})
