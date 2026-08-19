import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  novelPromotionEpisode: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  novelPromotionVoiceLine: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  novelPromotionCharacter: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  voicePreset: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}))
const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(),
  generateUniqueKey: vi.fn(),
  getSignedUrl: vi.fn((key: string) => `https://storage.example/${key}`),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => cosMock)

describe('speaker and character voice no-migration consent boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-a')
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-a',
      speakerVoices: '{}',
    })
    prismaMock.novelPromotionEpisode.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValue([
      { id: 'line-ann', speaker: 'Ann' },
    ])
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => (
      callback(prismaMock)
    ))
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValue({ id: 'character-a' })
    prismaMock.novelPromotionCharacter.updateMany.mockResolvedValue({ count: 1 })
    prismaMock.voicePreset.findFirst.mockResolvedValue({
      id: 'preset-system',
      isSystem: true,
      audioUrl: 'voice/system/ann.wav',
      audioMediaId: null,
      audioMedia: null,
    })
  })

  it.each([
    'https://attacker.example/raw.wav',
    'data:audio/wav;base64,ZmFrZQ==',
    '/m/media-from-another-user',
  ])('[speaker PATCH raw custom %s] -> [400 且 0 media resolve / 0 write]', async (audioUrl) => {
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/novel-promotion/project-a/speaker-voice',
      method: 'PATCH',
      body: {
        episodeId: 'episode-a',
        speaker: 'Ann',
        audioUrl,
        voiceType: 'uploaded',
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    const json = await response.json() as { error?: { details?: { reason?: string } } }
    expect(json.error?.details?.reason).toBe('VOICE_SOURCE_CONSENT_REQUIRED')
    expect(prismaMock.voicePreset.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalled()
  })

  it('[speaker GET legacy raw binding] -> [400 且 0 preset read / 0 signed URL]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: 'episode-a',
      speakerVoices: JSON.stringify({
        Ann: {
          audioUrl: 'https://attacker.example/raw.wav',
          voiceType: 'uploaded',
        },
      }),
    })

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const response = await callRoute(GET as never, {
      path: '/api/novel-promotion/project-a/speaker-voice?episodeId=episode-a',
      method: 'GET',
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    const json = await response.json() as { error?: { details?: { reason?: string } } }
    expect(json.error?.details?.reason).toBe('VOICE_SOURCE_CONSENT_REQUIRED')
    expect(prismaMock.voicePreset.findFirst).not.toHaveBeenCalled()
    expect(cosMock.getSignedUrl).not.toHaveBeenCalled()
  })

  it('[speaker PATCH system preset] -> [只儲存 preset id，scope updateMany，Ann 不覆蓋 Anna]', async () => {
    const previousSpeakerVoices = JSON.stringify({
      Anna: { voicePresetId: 'preset-anna' },
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: 'episode-a',
      speakerVoices: previousSpeakerVoices,
    })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/novel-promotion/project-a/speaker-voice',
      method: 'PATCH',
      body: {
        episodeId: 'episode-a',
        speaker: 'Ann',
        voicePresetId: 'preset-system',
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.voicePreset.findFirst).toHaveBeenCalledWith({
      where: { id: 'preset-system', isSystem: true },
      select: expect.any(Object),
    })
    const update = prismaMock.novelPromotionEpisode.updateMany.mock.calls[0]?.[0]
    expect(update.where).toEqual({
      id: 'episode-a',
      speakerVoices: previousSpeakerVoices,
      novelPromotionProject: { projectId: 'project-a' },
    })
    const stored = JSON.parse(update.data.speakerVoices) as Record<string, unknown>
    expect(stored).toEqual({
      Anna: { voicePresetId: 'preset-anna' },
      Ann: { voicePresetId: 'preset-system' },
    })
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['line-ann'] },
        episodeId: 'episode-a',
        episode: { novelPromotionProject: { projectId: 'project-a' } },
      },
      data: {
        audioUrl: null,
        audioMediaId: null,
        audioDuration: null,
      },
    })
  })

  it('[speaker PATCH uses normalized identity] -> [Ann binding clears ann/whitespace variants only]', async () => {
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      { id: 'line-ann-lower', speaker: ' ann ' },
      { id: 'line-anna', speaker: 'Anna' },
    ])

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/novel-promotion/project-a/speaker-voice',
      method: 'PATCH',
      body: {
        episodeId: 'episode-a',
        speaker: 'Ann',
        voicePresetId: 'preset-system',
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['line-ann-lower'] } }),
    }))
  })

  it('[speaker PATCH repeats the effective preset] -> [keeps existing line audio]', async () => {
    const speakerVoices = JSON.stringify({
      Ann: { voicePresetId: 'preset-system' },
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({
      id: 'episode-a',
      speakerVoices,
    })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/novel-promotion/project-a/speaker-voice',
      method: 'PATCH',
      body: {
        episodeId: 'episode-a',
        speaker: 'Ann',
        voicePresetId: 'preset-system',
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).not.toHaveBeenCalled()
  })

  it('[speaker PATCH concurrent different speaker] -> [CAS miss 後 scoped reread/merge retry，保留兩筆 binding]', async () => {
    const initialSpeakerVoices = JSON.stringify({
      Anna: { voicePresetId: 'preset-anna' },
    })
    const concurrentSpeakerVoices = JSON.stringify({
      Anna: { voicePresetId: 'preset-anna' },
      Bob: { voicePresetId: 'preset-bob' },
    })
    prismaMock.novelPromotionEpisode.findFirst
      .mockResolvedValueOnce({ id: 'episode-a', speakerVoices: initialSpeakerVoices })
      .mockResolvedValueOnce({ id: 'episode-a', speakerVoices: concurrentSpeakerVoices })
    prismaMock.novelPromotionEpisode.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/novel-promotion/project-a/speaker-voice',
      method: 'PATCH',
      body: {
        episodeId: 'episode-a',
        speaker: 'Ann',
        voicePresetId: 'preset-system',
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledTimes(2)
    expect(prismaMock.novelPromotionEpisode.updateMany).toHaveBeenCalledTimes(2)
    expect(prismaMock.novelPromotionEpisode.updateMany.mock.calls[0]?.[0].where).toEqual({
      id: 'episode-a',
      speakerVoices: initialSpeakerVoices,
      novelPromotionProject: { projectId: 'project-a' },
    })
    const retry = prismaMock.novelPromotionEpisode.updateMany.mock.calls[1]?.[0]
    expect(retry.where).toEqual({
      id: 'episode-a',
      speakerVoices: concurrentSpeakerVoices,
      novelPromotionProject: { projectId: 'project-a' },
    })
    expect(JSON.parse(retry.data.speakerVoices)).toEqual({
      Anna: { voicePresetId: 'preset-anna' },
      Bob: { voicePresetId: 'preset-bob' },
      Ann: { voicePresetId: 'preset-system' },
    })
  })

  it('[speaker PATCH 持續競爭] -> [bounded CAS exhaustion 409，不做無條件覆寫]', async () => {
    const snapshots = [0, 1, 2].map((revision) => JSON.stringify({
      [`Concurrent-${revision}`]: { voicePresetId: `preset-${revision}` },
    }))
    prismaMock.novelPromotionEpisode.findFirst
      .mockResolvedValueOnce({ id: 'episode-a', speakerVoices: snapshots[0] })
      .mockResolvedValueOnce({ id: 'episode-a', speakerVoices: snapshots[1] })
      .mockResolvedValueOnce({ id: 'episode-a', speakerVoices: snapshots[2] })
    prismaMock.novelPromotionEpisode.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/novel-promotion/project-a/speaker-voice',
      method: 'PATCH',
      body: {
        episodeId: 'episode-a',
        speaker: 'Ann',
        voicePresetId: 'preset-system',
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(409)
    expect(prismaMock.novelPromotionEpisode.updateMany).toHaveBeenCalledTimes(3)
    expect(prismaMock.novelPromotionEpisode.updateMany.mock.calls.map(([input]) => input.where.speakerVoices))
      .toEqual(snapshots)
  })

  it('[speaker PATCH foreign episode] -> [404 且 0 preset read / 0 write]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/speaker-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/novel-promotion/project-a/speaker-voice',
      method: 'PATCH',
      body: {
        episodeId: 'episode-from-project-b',
        speaker: 'Ann',
        voicePresetId: 'preset-system',
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.voicePreset.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalled()
  })

  it('[character PATCH foreign id] -> [404 且不更新]', async () => {
    prismaMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/character-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/novel-promotion/project-a/character-voice',
      method: 'PATCH',
      body: {
        characterId: 'character-from-project-b',
        customVoiceUrl: 'https://attacker.example/raw.wav',
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionCharacter.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'character-from-project-b',
        novelPromotionProject: { projectId: 'project-a' },
      },
      select: { id: true },
    })
    expect(prismaMock.novelPromotionCharacter.updateMany).not.toHaveBeenCalled()
  })

  it('[character PATCH 新 custom source] -> [400 且不更新]', async () => {
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/character-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/novel-promotion/project-a/character-voice',
      method: 'PATCH',
      body: {
        characterId: 'character-a',
        voiceType: 'custom',
        voiceId: 'custom-voice',
        customVoiceUrl: '/m/unverified',
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    const json = await response.json() as { error?: { details?: { reason?: string } } }
    expect(json.error?.details?.reason).toBe('VOICE_SOURCE_CONSENT_REQUIRED')
    expect(prismaMock.novelPromotionCharacter.updateMany).not.toHaveBeenCalled()
  })

  it('[character PATCH 清除 legacy custom source] -> [允許 project-scoped clear]', async () => {
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/character-voice/route')
    const response = await callRoute(PATCH as never, {
      path: '/api/novel-promotion/project-a/character-voice',
      method: 'PATCH',
      body: {
        characterId: 'character-a',
        voiceType: null,
        voiceId: null,
        customVoiceUrl: null,
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionCharacter.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'character-a',
        novelPromotionProject: { projectId: 'project-a' },
      },
      data: {
        voiceType: null,
        voiceId: null,
        customVoiceUrl: null,
        customVoiceMediaId: null,
      },
    })
  })

  it('[character POST upload/AI design] -> [consent schema 前 400，0 upload]', async () => {
    const { POST } = await import('@/app/api/novel-promotion/[projectId]/character-voice/route')
    const response = await callRoute(POST as never, {
      path: '/api/novel-promotion/project-a/character-voice',
      method: 'POST',
      body: {
        characterId: 'character-a',
        voiceDesign: { voiceId: 'designed', audioBase64: 'ZmFrZQ==' },
      },
      context: { params: Promise.resolve({ projectId: 'project-a' }) } as never,
    })

    expect(response.status).toBe(400)
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })
})
