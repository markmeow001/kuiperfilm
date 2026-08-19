import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest, callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockRole,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  globalVoice: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  globalAssetFolder: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  globalCharacter: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  mediaObject: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
}))

const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(),
  generateUniqueKey: vi.fn(),
  getSignedUrl: vi.fn((value: string) => value),
}))

const submitTaskMock = vi.hoisted(() => vi.fn())
const qwenMock = vi.hoisted(() => ({
  validateVoicePrompt: vi.fn(() => ({ valid: true })),
  validatePreviewText: vi.fn(() => ({ valid: true })),
}))
const mediaAttachMock = vi.hoisted(() => ({
  attachMediaFieldsToGlobalVoice: vi.fn(async (value: unknown) => value),
  attachMediaFieldsToGlobalCharacter: vi.fn(async (value: unknown) => value),
}))
const mediaServiceMock = vi.hoisted(() => ({
  resolveMediaRefFromLegacyValue: vi.fn(),
}))
const mediaWritePolicyMock = vi.hoisted(() => ({
  assertUserMediaWriteReferenceAllowed: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/qwen-voice-design', () => qwenMock)
vi.mock('@/lib/media/attach', () => mediaAttachMock)
vi.mock('@/lib/media/service', () => mediaServiceMock)
vi.mock('@/lib/media/write-policy', () => mediaWritePolicyMock)

function expectConsentRequired(responseBody: {
  error?: { details?: { reason?: string } }
}) {
  expect(responseBody.error?.details?.reason).toBe('VOICE_SOURCE_CONSENT_REQUIRED')
}

function expectNoCustomVoiceSideEffects() {
  expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  expect(submitTaskMock).not.toHaveBeenCalled()
  expect(prismaMock.globalVoice.create).not.toHaveBeenCalled()
  expect(prismaMock.globalCharacter.update).not.toHaveBeenCalled()
  expect(prismaMock.globalCharacter.updateMany).not.toHaveBeenCalled()
  expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
  expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
  expect(mediaServiceMock.resolveMediaRefFromLegacyValue).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-a')
  mockRole('editor')

  prismaMock.globalVoice.findMany.mockResolvedValue([])
  prismaMock.globalVoice.findFirst.mockResolvedValue({
    id: 'voice-owned',
    userId: 'user-a',
    name: 'Owned voice',
    description: null,
    folderId: null,
  })
  prismaMock.globalVoice.update.mockResolvedValue({
    id: 'voice-owned',
    userId: 'user-a',
    name: 'Renamed voice',
    description: null,
    folderId: null,
  })
  prismaMock.globalVoice.delete.mockResolvedValue({ id: 'voice-owned' })
  prismaMock.globalAssetFolder.findFirst.mockResolvedValue({
    id: 'folder-owned',
    userId: 'user-a',
  })
  prismaMock.globalCharacter.findMany.mockResolvedValue([])
  prismaMock.globalCharacter.findFirst.mockResolvedValue({ id: 'character-owned' })
  prismaMock.globalCharacter.findUnique.mockResolvedValue({ id: 'character-owned' })
  prismaMock.globalCharacter.update.mockResolvedValue({ id: 'character-owned' })
  prismaMock.globalCharacter.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.globalCharacter.delete.mockResolvedValue({ id: 'character-owned' })
})

describe('asset hub GlobalVoice tenant scope', () => {
  it('[GET folder filter] -> [always includes authenticated owner scope and preserves reads]', async () => {
    prismaMock.globalVoice.findMany.mockResolvedValueOnce([{
      id: 'voice-owned',
      userId: 'user-a',
      name: 'Existing voice',
    }])

    const { GET } = await import('@/app/api/asset-hub/voices/route')
    const response = await callRoute(GET as never, {
      path: '/api/asset-hub/voices',
      method: 'GET',
      query: { folderId: 'folder-owned' },
      context: undefined as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.globalVoice.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-a', folderId: 'folder-owned' },
      orderBy: { createdAt: 'desc' },
    })
    expect(await response.json()).toEqual({
      voices: [{ id: 'voice-owned', userId: 'user-a', name: 'Existing voice' }],
    })
  })

  it('[GET null folder filter] -> [combines owner scope with root-folder filter]', async () => {
    const { GET } = await import('@/app/api/asset-hub/voices/route')
    const response = await callRoute(GET as never, {
      path: '/api/asset-hub/voices',
      method: 'GET',
      query: { folderId: 'null' },
      context: undefined as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.globalVoice.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-a', folderId: null },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('[DELETE foreign voice id] -> [404 and zero delete]', async () => {
    prismaMock.globalVoice.findFirst.mockResolvedValueOnce(null)

    const { DELETE } = await import('@/app/api/asset-hub/voices/[id]/route')
    const response = await callRoute(DELETE as never, {
      path: '/api/asset-hub/voices/voice-foreign',
      method: 'DELETE',
      context: { params: Promise.resolve({ id: 'voice-foreign' }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.globalVoice.findFirst).toHaveBeenCalledWith({
      where: { id: 'voice-foreign', userId: 'user-a' },
    })
    expect(prismaMock.globalVoice.delete).not.toHaveBeenCalled()
  })

  it('[DELETE owned voice] -> [delete mutation remains tenant scoped]', async () => {
    const { DELETE } = await import('@/app/api/asset-hub/voices/[id]/route')
    const response = await callRoute(DELETE as never, {
      path: '/api/asset-hub/voices/voice-owned',
      method: 'DELETE',
      context: { params: Promise.resolve({ id: 'voice-owned' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.globalVoice.delete).toHaveBeenCalledWith({
      where: { id: 'voice-owned', userId: 'user-a' },
    })
  })

  it('[PATCH foreign voice id] -> [404 and zero update]', async () => {
    prismaMock.globalVoice.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/asset-hub/voices/[id]/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/asset-hub/voices/voice-foreign',
      method: 'PATCH',
      body: { name: 'Must not update' },
      context: { params: Promise.resolve({ id: 'voice-foreign' }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.globalVoice.findFirst).toHaveBeenCalledWith({
      where: { id: 'voice-foreign', userId: 'user-a' },
    })
    expect(prismaMock.globalVoice.update).not.toHaveBeenCalled()
  })

  it('[PATCH owned voice and owned folder] -> [read, folder check, and update are tenant scoped]', async () => {
    const { PATCH } = await import('@/app/api/asset-hub/voices/[id]/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/asset-hub/voices/voice-owned',
      method: 'PATCH',
      body: { name: 'Renamed voice', folderId: 'folder-owned' },
      context: { params: Promise.resolve({ id: 'voice-owned' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.globalAssetFolder.findFirst).toHaveBeenCalledWith({
      where: { id: 'folder-owned', userId: 'user-a' },
      select: { id: true },
    })
    expect(prismaMock.globalVoice.update).toHaveBeenCalledWith({
      where: { id: 'voice-owned', userId: 'user-a' },
      data: {
        name: 'Renamed voice',
        description: null,
        folderId: 'folder-owned',
      },
    })
  })

  it('[PATCH foreign folder] -> [400 and zero update]', async () => {
    prismaMock.globalAssetFolder.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/asset-hub/voices/[id]/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/asset-hub/voices/voice-owned',
      method: 'PATCH',
      body: { folderId: 'folder-foreign' },
      context: { params: Promise.resolve({ id: 'voice-owned' }) } as never,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.globalVoice.update).not.toHaveBeenCalled()
  })

  it('[GET signed legacy voice] -> [read-only compatibility remains available]', async () => {
    const existing = {
      id: 'voice-owned',
      userId: 'user-a',
      name: 'Legacy preview',
      customVoiceUrl: '/m/legacy-preview',
    }
    prismaMock.globalVoice.findMany.mockResolvedValueOnce([existing])

    const { GET } = await import('@/app/api/asset-hub/voices/route')
    const response = await callRoute(GET as never, {
      path: '/api/asset-hub/voices',
      method: 'GET',
      context: undefined as never,
    })

    expect(response.status).toBe(200)
    expect(mediaAttachMock.attachMediaFieldsToGlobalVoice).toHaveBeenCalledWith(existing)
  })
})

describe('asset hub GlobalCharacter tenant scope', () => {
  it('[GET character list] -> [owner scope is combined with folder filter]', async () => {
    const existing = {
      id: 'character-owned',
      userId: 'user-a',
      appearances: [],
    }
    prismaMock.globalCharacter.findMany.mockResolvedValueOnce([existing])

    const { GET } = await import('@/app/api/asset-hub/characters/route')
    const response = await callRoute(GET as never, {
      path: '/api/asset-hub/characters',
      method: 'GET',
      query: { folderId: 'folder-owned' },
      context: undefined as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.globalCharacter.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-a', folderId: 'folder-owned' },
      include: { appearances: true },
      orderBy: { createdAt: 'desc' },
    })
    expect(mediaAttachMock.attachMediaFieldsToGlobalCharacter).toHaveBeenCalledWith(existing)
  })

  it('[GET foreign character id] -> [404 from owner-scoped lookup]', async () => {
    prismaMock.globalCharacter.findFirst.mockResolvedValue(null)

    const { GET } = await import('@/app/api/asset-hub/characters/[characterId]/route')
    const response = await callRoute(GET as never, {
      path: '/api/asset-hub/characters/character-foreign',
      method: 'GET',
      context: { params: Promise.resolve({ characterId: 'character-foreign' }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.globalCharacter.findFirst).toHaveBeenCalledWith({
      where: { id: 'character-foreign', userId: 'user-a' },
      include: { appearances: true },
    })
  })

  it('[DELETE foreign character id] -> [404 and zero delete]', async () => {
    prismaMock.globalCharacter.findFirst.mockResolvedValue(null)

    const { DELETE } = await import('@/app/api/asset-hub/characters/[characterId]/route')
    const response = await callRoute(DELETE as never, {
      path: '/api/asset-hub/characters/character-foreign',
      method: 'DELETE',
      context: { params: Promise.resolve({ characterId: 'character-foreign' }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.globalCharacter.findFirst).toHaveBeenCalledWith({
      where: { id: 'character-foreign', userId: 'user-a' },
      select: { id: true },
    })
    expect(prismaMock.globalCharacter.delete).not.toHaveBeenCalled()
  })

  it('[DELETE owned character id] -> [delete mutation carries exact owner scope]', async () => {
    const { DELETE } = await import('@/app/api/asset-hub/characters/[characterId]/route')
    const response = await callRoute(DELETE as never, {
      path: '/api/asset-hub/characters/character-owned',
      method: 'DELETE',
      context: { params: Promise.resolve({ characterId: 'character-owned' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.globalCharacter.delete).toHaveBeenCalledWith({
      where: { id: 'character-owned', userId: 'user-a' },
    })
  })
})

describe('asset hub legacy custom voice fail-closed boundary', () => {
  it('[GlobalVoice create POST] -> [400 before JSON, media resolution, or writes]', async () => {
    const { POST } = await import('@/app/api/asset-hub/voices/route')
    const request = buildMockRequest({
      path: '/api/asset-hub/voices',
      method: 'POST',
      body: { name: 'Unverified voice', customVoiceUrl: 'https://example.com/raw.wav' },
    })
    const jsonSpy = vi.spyOn(request, 'json')

    const response = await POST(request, undefined as never)

    expect(response.status).toBe(400)
    expectConsentRequired(await response.json())
    expect(jsonSpy).not.toHaveBeenCalled()
    expectNoCustomVoiceSideEffects()
  })

  it('[voice upload POST] -> [400 before FormData/file read, COS, or writes]', async () => {
    const { POST } = await import('@/app/api/asset-hub/voices/upload/route')
    const request = buildMockRequest({
      path: '/api/asset-hub/voices/upload',
      method: 'POST',
    })
    const formDataSpy = vi.spyOn(request, 'formData')

    const response = await POST(request, undefined as never)

    expect(response.status).toBe(400)
    expectConsentRequired(await response.json())
    expect(formDataSpy).not.toHaveBeenCalled()
    expectNoCustomVoiceSideEffects()
  })

  it('[Asset Hub voice design POST] -> [400 before JSON, validator, provider task, or writes]', async () => {
    const { POST } = await import('@/app/api/asset-hub/voice-design/route')
    const request = buildMockRequest({
      path: '/api/asset-hub/voice-design',
      method: 'POST',
      body: { voicePrompt: 'clone a human', previewText: 'hello' },
    })
    const jsonSpy = vi.spyOn(request, 'json')

    const response = await POST(request, undefined as never)

    expect(response.status).toBe(400)
    expectConsentRequired(await response.json())
    expect(jsonSpy).not.toHaveBeenCalled()
    expect(qwenMock.validateVoicePrompt).not.toHaveBeenCalled()
    expect(qwenMock.validatePreviewText).not.toHaveBeenCalled()
    expectNoCustomVoiceSideEffects()
  })

  it('[character voice JSON design POST] -> [400 before JSON, COS, or character write]', async () => {
    const { POST } = await import('@/app/api/asset-hub/character-voice/route')
    const request = buildMockRequest({
      path: '/api/asset-hub/character-voice',
      method: 'POST',
      body: {
        characterId: 'character-owned',
        voiceDesign: { voiceId: 'unverified', audioBase64: 'ZmFrZQ==' },
      },
    })
    const jsonSpy = vi.spyOn(request, 'json')

    const response = await POST(request, undefined as never)

    expect(response.status).toBe(400)
    expectConsentRequired(await response.json())
    expect(jsonSpy).not.toHaveBeenCalled()
    expectNoCustomVoiceSideEffects()
  })

  it('[character voice upload POST] -> [400 before FormData/file read, COS, or character write]', async () => {
    const { POST } = await import('@/app/api/asset-hub/character-voice/route')
    const request = buildMockRequest({
      path: '/api/asset-hub/character-voice',
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=test' },
    })
    const formDataSpy = vi.spyOn(request, 'formData')

    const response = await POST(request, undefined as never)

    expect(response.status).toBe(400)
    expectConsentRequired(await response.json())
    expect(formDataSpy).not.toHaveBeenCalled()
    expectNoCustomVoiceSideEffects()
  })

  it('[character voice PATCH custom source] -> [400 reason and zero character write]', async () => {
    const { PATCH } = await import('@/app/api/asset-hub/character-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/asset-hub/character-voice',
      method: 'PATCH',
      body: {
        characterId: 'character-owned',
        voiceType: 'custom',
        voiceId: 'legacy-provider-id',
        customVoiceUrl: '/m/unverified',
      },
      context: undefined as never,
    })

    expect(response.status).toBe(400)
    expectConsentRequired(await response.json())
    expect(prismaMock.globalCharacter.findFirst).toHaveBeenCalledWith({
      where: { id: 'character-owned', userId: 'user-a' },
    })
    expectNoCustomVoiceSideEffects()
  })

  it('[character voice PATCH exact clear] -> [allows tenant-scoped legacy cleanup]', async () => {
    const { PATCH } = await import('@/app/api/asset-hub/character-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/asset-hub/character-voice',
      method: 'PATCH',
      body: {
        characterId: 'character-owned',
        voiceType: null,
        voiceId: null,
        customVoiceUrl: null,
      },
      context: undefined as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.globalCharacter.updateMany).toHaveBeenCalledWith({
      where: { id: 'character-owned', userId: 'user-a' },
      data: {
        voiceId: null,
        voiceType: null,
        customVoiceUrl: null,
        customVoiceMediaId: null,
      },
    })
    expect(prismaMock.globalCharacter.update).not.toHaveBeenCalled()
  })

  it('[generic GlobalCharacter PATCH voice binding bypass] -> [400 reason and zero update]', async () => {
    const { PATCH } = await import('@/app/api/asset-hub/characters/[characterId]/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/asset-hub/characters/character-owned',
      method: 'PATCH',
      body: {
        globalVoiceId: 'voice-owned',
        voiceType: 'custom',
        voiceId: 'legacy-provider-id',
        customVoiceUrl: '/m/unverified',
      },
      context: { params: Promise.resolve({ characterId: 'character-owned' }) } as never,
    })

    expect(response.status).toBe(400)
    expectConsentRequired(await response.json())
    expect(prismaMock.globalCharacter.update).not.toHaveBeenCalled()
  })

  it('[generic GlobalCharacter PATCH exact clear] -> [allows scoped cleanup and clears globalVoiceId]', async () => {
    const { PATCH } = await import('@/app/api/asset-hub/characters/[characterId]/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/asset-hub/characters/character-owned',
      method: 'PATCH',
      body: {
        voiceType: null,
        voiceId: null,
        customVoiceUrl: null,
      },
      context: { params: Promise.resolve({ characterId: 'character-owned' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.globalCharacter.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'character-owned', userId: 'user-a' },
      data: {
        voiceId: null,
        voiceType: null,
        customVoiceUrl: null,
        customVoiceMediaId: null,
        globalVoiceId: null,
      },
    }))
  })
})
