import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockRole,
  resetAuthMockState,
} from '../../helpers/auth'

const IMMUTABLE_VOICE_LINE_KEY =
  'voice/project-a/episode-a/line-a/0123456789abcdef0123456789abcdef-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.wav'
const MEDIA_ALIAS = '/m/existing-voice-line-output'
const SIGNED_VOICE_LINE_URL =
  `https://example-1250000000.cos.ap-vancouver.myqcloud.com/${IMMUTABLE_VOICE_LINE_KEY}?q-sign-algorithm=sha1&q-sign-time=1%3B2&q-signature=fake`

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  globalAssetFolder: {
    findUnique: vi.fn(),
  },
  globalVoice: {
    create: vi.fn(),
  },
  globalCharacter: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  globalCharacterAppearance: {
    create: vi.fn(),
  },
  mediaObject: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
}))

const attachMock = vi.hoisted(() => ({
  attachMediaFieldsToProject: vi.fn(async (value: unknown) => value),
  attachMediaFieldsToGlobalVoice: vi.fn(async (value: unknown) => value),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/attach', () => attachMock)
vi.mock('@/lib/cos', () => ({
  extractCOSKey: vi.fn((value: string) => {
    if (/^https?:\/\//.test(value)) {
      return decodeURIComponent(new URL(value).pathname).replace(/^\/+/, '')
    }
    return value.replace(/^\/+/, '')
  }),
  generateUniqueKey: vi.fn(),
  getSignedUrl: vi.fn((value: string) => value),
  uploadToCOS: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-a')
  mockRole('editor')

  prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-a' })
  prismaMock.novelPromotionEpisode.update.mockResolvedValue({ id: 'episode-a' })
  prismaMock.globalVoice.create.mockResolvedValue({ id: 'voice-a' })
  prismaMock.globalCharacter.findFirst.mockResolvedValue({ id: 'character-a' })
  prismaMock.globalCharacter.findUnique.mockResolvedValue({ id: 'character-a' })
  prismaMock.globalCharacter.update.mockResolvedValue({ id: 'character-a' })
  prismaMock.mediaObject.findUnique.mockImplementation(async (args: {
    where?: { publicId?: string }
  }) => args.where?.publicId === 'existing-voice-line-output'
    ? {
        id: 'media-a',
        publicId: 'existing-voice-line-output',
        storageKey: IMMUTABLE_VOICE_LINE_KEY,
        sha256: null,
        mimeType: 'audio/wav',
        sizeBytes: 1,
        width: null,
        height: null,
        durationMs: null,
        updatedAt: new Date('2026-08-12T00:00:00.000Z'),
        uploadedByUserId: 'user-a',
      }
    : null)
})

async function patchEpisode(audioUrl: string | null) {
  const { PATCH } = await import(
    '@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/route'
  )
  return callRoute(PATCH as never, {
    path: '/api/novel-promotion/project-a/episodes/episode-a',
    method: 'PATCH',
    body: { audioUrl },
    context: {
      params: Promise.resolve({ projectId: 'project-a', episodeId: 'episode-a' }),
    } as never,
  })
}

async function createGlobalVoice(customVoiceUrl: string | null) {
  const { POST } = await import('@/app/api/asset-hub/voices/route')
  return callRoute(POST as never, {
    path: '/api/asset-hub/voices',
    method: 'POST',
    body: { name: 'Voice', customVoiceUrl },
    context: undefined as never,
  })
}

async function patchCharacterVoice(customVoiceUrl: string | null) {
  const { PATCH } = await import('@/app/api/asset-hub/character-voice/route')
  return callRoute(PATCH as never, {
    path: '/api/asset-hub/character-voice',
    method: 'PATCH',
    body: { characterId: 'character-a', voiceType: 'custom', customVoiceUrl },
    context: undefined as never,
  })
}

async function patchGlobalCharacter(customVoiceUrl: string | null) {
  const { PATCH } = await import('@/app/api/asset-hub/characters/[characterId]/route')
  return callRoute(PATCH as never, {
    path: '/api/asset-hub/characters/character-a',
    method: 'PATCH',
    body: { customVoiceUrl },
    context: { params: Promise.resolve({ characterId: 'character-a' }) } as never,
  })
}

async function createGlobalCharacter(initialImageUrl: string | null) {
  const { POST } = await import('@/app/api/asset-hub/characters/route')
  return callRoute(POST as never, {
    path: '/api/asset-hub/characters',
    method: 'POST',
    body: { name: 'Ann', initialImageUrl },
    context: undefined as never,
  })
}

function expectNoWrites() {
  expect(prismaMock.novelPromotionEpisode.update).not.toHaveBeenCalled()
  expect(prismaMock.globalVoice.create).not.toHaveBeenCalled()
  expect(prismaMock.globalCharacter.create).not.toHaveBeenCalled()
  expect(prismaMock.globalCharacter.update).not.toHaveBeenCalled()
  expect(prismaMock.globalCharacterAppearance.create).not.toHaveBeenCalled()
  expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
  expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
}

describe('task-scoped VoiceLine output reference write boundary', () => {
  it.each([
    ['raw immutable key', IMMUTABLE_VOICE_LINE_KEY],
    ['existing /m alias', MEDIA_ALIAS],
    ['signed COS URL', SIGNED_VOICE_LINE_URL],
  ])('episode PATCH rejects %s before media upsert or write', async (_label, audioUrl) => {
    const response = await patchEpisode(audioUrl)

    expect(response.status).toBe(400)
    expectNoWrites()
  })

  it.each([
    ['raw immutable key', IMMUTABLE_VOICE_LINE_KEY],
    ['existing /m alias', MEDIA_ALIAS],
    ['signed COS URL', SIGNED_VOICE_LINE_URL],
  ])('global voice POST rejects %s before media upsert or write', async (_label, customVoiceUrl) => {
    const response = await createGlobalVoice(customVoiceUrl)

    expect(response.status).toBe(400)
    expectNoWrites()
  })

  it('character-voice PATCH rejects a raw immutable key before write', async () => {
    const response = await patchCharacterVoice(IMMUTABLE_VOICE_LINE_KEY)

    expect(response.status).toBe(400)
    expectNoWrites()
  })

  it.each([
    ['existing /m alias', MEDIA_ALIAS],
    ['signed COS URL', SIGNED_VOICE_LINE_URL],
    ['trimmed raw immutable key', `  ${IMMUTABLE_VOICE_LINE_KEY}  `],
    ['uppercase signed URL scheme', SIGNED_VOICE_LINE_URL.replace('https://', 'HTTPS://')],
    ['absolute /m alias', `https://app.example${MEDIA_ALIAS}?download=1`],
    ['protocol-relative /m alias', `//app.example${MEDIA_ALIAS}#player`],
  ])('generic global character PATCH rejects %s before write', async (_label, customVoiceUrl) => {
    const response = await patchGlobalCharacter(customVoiceUrl)

    expect(response.status).toBe(400)
    expectNoWrites()
  })

  it.each([
    ['raw immutable key', IMMUTABLE_VOICE_LINE_KEY],
    ['existing /m alias', MEDIA_ALIAS],
    ['signed COS URL', SIGNED_VOICE_LINE_URL],
  ])('global character POST rejects task output used as %s initial image before write', async (_label, initialImageUrl) => {
    const response = await createGlobalCharacter(initialImageUrl)

    expect(response.status).toBe(400)
    expectNoWrites()
  })

  it('preserves null clears and an ordinary non-voice asset update', async () => {
    const episodeResponse = await patchEpisode(null)
    expect(episodeResponse.status).toBe(200)
    expect(prismaMock.novelPromotionEpisode.update).toHaveBeenCalledWith({
      where: { id: 'episode-a' },
      data: { audioUrl: null, audioMediaId: null },
    })

    vi.clearAllMocks()
    prismaMock.globalCharacter.findUnique.mockResolvedValue({ id: 'character-a' })
    prismaMock.globalCharacter.update.mockResolvedValue({ id: 'character-a' })
    const { PATCH } = await import('@/app/api/asset-hub/characters/[characterId]/route')
    const ordinaryResponse = await callRoute(PATCH as never, {
      path: '/api/asset-hub/characters/character-a',
      method: 'PATCH',
      body: { name: '  Ann  ' },
      context: { params: Promise.resolve({ characterId: 'character-a' }) } as never,
    })
    expect(ordinaryResponse.status).toBe(200)
    expect(prismaMock.globalCharacter.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { name: 'Ann' },
    }))
  })
})
