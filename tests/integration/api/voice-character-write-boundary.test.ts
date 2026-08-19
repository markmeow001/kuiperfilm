import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  globalCharacter: { findFirst: vi.fn() },
  globalLocation: { findFirst: vi.fn() },
  globalVoice: { findFirst: vi.fn() },
  novelPromotionCharacter: {
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  characterAppearance: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  novelPromotionLocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  locationImage: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  novelPromotionPanel: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  mediaObject: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const labelMock = vi.hoisted(() => ({
  updateCharacterAppearanceLabels: vi.fn(),
  updateLocationImageLabels: vi.fn(),
}))

const renameMock = vi.hoisted(() => ({
  propagateCharacterRename: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/image-label', () => labelMock)
vi.mock('@/lib/novel-promotion/rename-propagation', () => renameMock)

const PROJECT_ID = 'project-a'
const CHARACTER_ID = 'character-a'

function ownedCharacter(overrides: Record<string, unknown> = {}) {
  return {
    id: CHARACTER_ID,
    name: 'Ann',
    introduction: 'old',
    voiceId: 'legacy-id',
    voiceType: 'custom',
    customVoiceUrl: '/m/legacy-media',
    customVoiceMediaId: 'legacy-media-id',
    appearances: [],
    ...overrides,
  }
}

async function callCharacterPatch(body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/character/route')
  return await callRoute(PATCH as never, {
    path: `/api/novel-promotion/${PROJECT_ID}/character`,
    method: 'PATCH',
    body,
    context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
  })
}

async function callCopy(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/novel-promotion/[projectId]/copy-from-global/route')
  return await callRoute(POST as never, {
    path: `/api/novel-promotion/${PROJECT_ID}/copy-from-global`,
    method: 'POST',
    body,
    context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-a')

  prismaMock.novelPromotionCharacter.findFirst.mockResolvedValue(ownedCharacter())
  prismaMock.novelPromotionCharacter.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => await fn(prismaMock),
  )
  labelMock.updateCharacterAppearanceLabels.mockResolvedValue([])
  renameMock.propagateCharacterRename.mockResolvedValue({
    panelsRewritten: 0,
    panelsScanned: 0,
  })
  prismaMock.globalVoice.findFirst.mockResolvedValue({
    name: 'Safe clear',
    voiceId: null,
    voiceType: null,
    customVoiceUrl: null,
    customVoiceMediaId: null,
  })
  prismaMock.globalCharacter.findFirst.mockResolvedValue({
    name: 'Ann global',
    voiceId: null,
    voiceType: null,
    customVoiceUrl: null,
    customVoiceMediaId: null,
    appearances: [],
  })
  prismaMock.mediaObject.findMany.mockResolvedValue([])
  prismaMock.mediaObject.findUnique.mockResolvedValue(null)
})

describe('generic character PATCH durable voice boundary', () => {
  it('[同專案 explicit triple-null] -> [scoped atomic clear]', async () => {
    const response = await callCharacterPatch({
      characterId: CHARACTER_ID,
      voiceId: null,
      voiceType: null,
      customVoiceUrl: null,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionCharacter.updateMany).toHaveBeenCalledWith({
      where: { id: CHARACTER_ID, novelPromotionProject: { projectId: PROJECT_ID } },
      data: {
        voiceId: null,
        voiceType: null,
        customVoiceUrl: null,
        customVoiceMediaId: null,
      },
    })
    expect(prismaMock.novelPromotionCharacter.update).not.toHaveBeenCalled()
  })

  it('[非 voice introduction 修改] -> [保留既有功能且不改 voice 欄位]', async () => {
    const response = await callCharacterPatch({
      characterId: CHARACTER_ID,
      introduction: 'updated',
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionCharacter.updateMany).toHaveBeenCalledWith({
      where: { id: CHARACTER_ID, novelPromotionProject: { projectId: PROJECT_ID } },
      data: { introduction: 'updated' },
    })
  })

  it.each([
    { label: 'partial clear', patch: { voiceId: null } },
    { label: 'raw http', patch: { voiceId: null, voiceType: 'custom', customVoiceUrl: 'https://attacker.example/voice.wav' } },
    { label: 'data URL', patch: { voiceId: null, voiceType: 'custom', customVoiceUrl: 'data:audio/wav;base64,ZmFrZQ==' } },
    { label: 'foreign /m', patch: { voiceId: null, voiceType: 'custom', customVoiceUrl: '/m/foreign-media' } },
    { label: 'durable media id', patch: { voiceId: null, voiceType: null, customVoiceUrl: null, customVoiceMediaId: 'foreign-media-id' } },
  ])('[generic PATCH $label] -> [400 且 0 write]', async ({ patch }) => {
    const response = await callCharacterPatch({
      characterId: CHARACTER_ID,
      introduction: 'must-not-write',
      ...patch,
    })

    expect(response.status).toBe(400)
    const json = await response.json() as { error?: { details?: { reason?: string } } }
    expect(json.error?.details?.reason).toBe('VOICE_SOURCE_CONSENT_REQUIRED')
    expect(prismaMock.novelPromotionCharacter.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionCharacter.update).not.toHaveBeenCalled()
    expect(renameMock.propagateCharacterRename).not.toHaveBeenCalled()
  })
})

describe('copy-from-global character target and voice policy', () => {
  it.each(['voice', 'character'] as const)(
    '[%s foreign targetCharacterId] -> [404 且 0 write]',
    async (type) => {
      prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce(null)

      const response = await callCopy({
        type,
        targetId: 'character-from-project-b',
        globalAssetId: type === 'voice' ? 'global-voice-a' : 'global-character-a',
      })

      expect(response.status).toBe(404)
      expect(prismaMock.novelPromotionCharacter.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'character-from-project-b',
            novelPromotionProject: { projectId: PROJECT_ID },
          },
        }),
      )
      expect(prismaMock.novelPromotionCharacter.updateMany).not.toHaveBeenCalled()
      expect(prismaMock.novelPromotionCharacter.update).not.toHaveBeenCalled()
      expect(prismaMock.characterAppearance.deleteMany).not.toHaveBeenCalled()
      expect(prismaMock.characterAppearance.create).not.toHaveBeenCalled()
    },
  )

  it.each(['voice', 'character'] as const)(
    '[%s raw global voice source] -> [consent schema 前 400 且 0 write]',
    async (type) => {
      const rawSource = {
        name: 'Unverified global source',
        voiceId: 'custom-id',
        voiceType: 'custom',
        customVoiceUrl: '/m/foreign-or-unconsented',
        customVoiceMediaId: 'foreign-or-unconsented-media',
      }
      if (type === 'voice') {
        prismaMock.globalVoice.findFirst.mockResolvedValueOnce(rawSource)
      } else {
        prismaMock.globalCharacter.findFirst.mockResolvedValueOnce({
          ...rawSource,
          appearances: [],
        })
      }

      const response = await callCopy({
        type,
        targetId: CHARACTER_ID,
        globalAssetId: type === 'voice' ? 'global-voice-a' : 'global-character-a',
      })

      expect(response.status).toBe(400)
      const json = await response.json() as { error?: { details?: { reason?: string } } }
      expect(json.error?.details?.reason).toBe('VOICE_SOURCE_CONSENT_REQUIRED')
      expect(prismaMock.novelPromotionCharacter.updateMany).not.toHaveBeenCalled()
      expect(prismaMock.novelPromotionCharacter.update).not.toHaveBeenCalled()
      expect(prismaMock.characterAppearance.deleteMany).not.toHaveBeenCalled()
      expect(prismaMock.characterAppearance.create).not.toHaveBeenCalled()
    },
  )

  it('[voice same-project triple-null source] -> [transaction scoped clear]', async () => {
    const response = await callCopy({
      type: 'voice',
      targetId: CHARACTER_ID,
      globalAssetId: 'global-voice-clear',
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionCharacter.updateMany).toHaveBeenCalledWith({
      where: { id: CHARACTER_ID, novelPromotionProject: { projectId: PROJECT_ID } },
      data: {
        voiceId: null,
        voiceType: null,
        customVoiceUrl: null,
        customVoiceMediaId: null,
      },
    })
    expect(prismaMock.novelPromotionCharacter.update).not.toHaveBeenCalled()
  })

  it('[character same-project triple-null source] -> [appearance copy and voice clear share scoped transaction]', async () => {
    const response = await callCopy({
      type: 'character',
      targetId: CHARACTER_ID,
      globalAssetId: 'global-character-clear',
    })

    expect(response.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionCharacter.updateMany).toHaveBeenCalledWith({
      where: { id: CHARACTER_ID, novelPromotionProject: { projectId: PROJECT_ID } },
      data: {
        sourceGlobalCharacterId: 'global-character-clear',
        profileConfirmed: true,
        voiceId: null,
        voiceType: null,
        customVoiceUrl: null,
        customVoiceMediaId: null,
      },
    })
    expect(prismaMock.novelPromotionCharacter.update).not.toHaveBeenCalled()
  })

  it('[character appearance retains a reserved task output] -> [400 before labels or transaction]', async () => {
    prismaMock.globalCharacter.findFirst.mockResolvedValueOnce({
      name: 'Unsafe global',
      voiceId: null,
      voiceType: null,
      customVoiceUrl: null,
      customVoiceMediaId: null,
      appearances: [{
        appearanceIndex: 0,
        changeReason: 'default',
        description: null,
        descriptions: null,
        imageUrl: `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`,
        imageUrls: '[]',
        imageMediaId: null,
        selectedIndex: 0,
      }],
    })

    const response = await callCopy({
      type: 'character',
      targetId: CHARACTER_ID,
      globalAssetId: 'global-character-reserved',
    })

    expect(response.status).toBe(400)
    expect(labelMock.updateCharacterAppearanceLabels).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})
