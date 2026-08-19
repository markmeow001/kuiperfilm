import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-a' } },
    project: { id: 'project-a', userId: 'user-a' },
  })),
}))
const prismaMock = vi.hoisted(() => ({
  voicePreset: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}))
const cosMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
}))

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: authMock.requireProjectAuthLight,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => cosMock)

describe('GET project system voice preset catalog', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    prismaMock.voicePreset.findMany.mockResolvedValue([
      { id: 'preset-storage', name: 'Ann', description: 'Warm', gender: 'female' },
      { id: 'preset-url', name: 'Ben', description: null, gender: 'male' },
      { id: 'preset-invalid', name: 'Unsafe', description: null, gender: null },
    ])
    prismaMock.voicePreset.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'preset-storage') {
        return {
          id: 'preset-storage', isSystem: true, audioUrl: '/m/raw-media-id',
          audioMediaId: 'media-system',
          audioMedia: { id: 'media-system', publicId: 'public-secret', storageKey: 'voice/system/ann.wav', mimeType: 'audio/wav', sizeBytes: 10 },
        }
      }
      if (where.id === 'preset-url') {
        return {
          id: 'preset-url', isSystem: true, audioUrl: 'https://voice.example/ben.mp3',
          audioMediaId: null, audioMedia: null,
        }
      }
      if (where.id === 'preset-invalid') {
        return {
          id: 'preset-invalid', isSystem: true, audioUrl: 'data:audio/wav;base64,ZmFrZQ==',
          audioMediaId: null, audioMedia: null,
        }
      }
      return null
    })
  })

  it('[catalog read] -> [read auth, system-only, canonical safe previews, invalid omitted]', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/voice-presets/route')
    const response = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-a/voice-presets',
      method: 'GET',
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith('project-a', { action: 'read' })
    expect(prismaMock.voicePreset.findMany).toHaveBeenCalledWith({
      where: { isSystem: true },
      select: { id: true, name: true, description: true, gender: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })
    expect(prismaMock.voicePreset.findFirst).toHaveBeenCalledTimes(3)
    expect(cosMock.getSignedUrl).toHaveBeenCalledWith('voice/system/ann.wav', 7200)

    const json = await response.json() as { voicePresets: unknown[] }
    expect(json).toEqual({
      voicePresets: [
        { id: 'preset-storage', name: 'Ann', description: 'Warm', gender: 'female', previewUrl: 'https://signed.example/voice/system/ann.wav' },
        { id: 'preset-url', name: 'Ben', description: null, gender: 'male', previewUrl: 'https://voice.example/ben.mp3' },
      ],
    })
    const serialized = JSON.stringify(json)
    expect(serialized).not.toContain('media-system')
    expect(serialized).not.toContain('public-secret')
    expect(serialized).not.toContain('preset-invalid')
    expect(Object.keys(json.voicePresets[0] as object)).toEqual([
      'id', 'name', 'description', 'gender', 'previewUrl',
    ])
  })
})
