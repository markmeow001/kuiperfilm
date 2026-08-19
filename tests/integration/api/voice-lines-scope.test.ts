import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  novelPromotionVoiceLine: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  novelPromotionPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  },
  voicePreset: {
    findFirst: vi.fn(),
  },
}))
const mediaMock = vi.hoisted(() => ({
  resolveMediaRef: vi.fn(async () => null),
  resolveVoiceLineMediaRef: vi.fn(async () => null),
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/service', () => mediaMock)

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-A')
  prismaMock.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => (
    callback(prismaMock)
  ))
  mediaMock.resolveMediaRef.mockResolvedValue(null)
  mediaMock.resolveVoiceLineMediaRef.mockResolvedValue(null)
  mediaMock.resolveMediaRefFromLegacyValue.mockResolvedValue(null)
  prismaMock.voicePreset.findFirst.mockResolvedValue({
    id: 'preset-system',
    isSystem: true,
    audioUrl: 'voice/system/ann.wav',
    audioMediaId: null,
    audioMedia: null,
  })
})

const PROJECT_ID = 'project-A'

describe('voice lines project and episode scope', () => {
  it('[POST owned episode + owned panel] -> [serial transaction creates the next scoped line]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ lineIndex: 2 })
      .mockResolvedValueOnce({
        id: 'voice-line-idempotent',
        episodeId: 'episode-A1',
        lineIndex: 3,
        speaker: 'Ann',
        content: 'Hello',
        matchedPanelId: 'panel-A1',
        audioMediaId: null,
        audioUrl: null,
        matchedPanel: { id: 'panel-A1', storyboardId: 'storyboard-A1', panelIndex: 4 },
      })
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-A1',
      storyboardId: 'storyboard-A1',
      panelIndex: 4,
      storyboard: { episodeId: 'episode-A1' },
    })
    prismaMock.novelPromotionVoiceLine.createMany.mockResolvedValueOnce({ count: 1 })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'POST',
      body: {
        episodeId: 'episode-A1',
        content: ' Hello ',
        speaker: ' Ann ',
        matchedPanelId: 'panel-A1',
        clientRequestId: '11111111-1111-4111-8111-111111111111',
      },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-A1',
        novelPromotionProject: { projectId: PROJECT_ID },
      },
      select: { id: true },
    })
    expect(prismaMock.novelPromotionPanel.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'panel-A1',
        storyboard: {
          episodeId: 'episode-A1',
          episode: { novelPromotionProject: { projectId: PROJECT_ID } },
        },
      },
      select: {
        id: true,
        storyboardId: true,
        panelIndex: true,
        storyboard: { select: { episodeId: true } },
      },
    })
    expect(prismaMock.novelPromotionVoiceLine.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        episodeId: 'episode-A1',
        lineIndex: 3,
        content: 'Hello',
        speaker: 'Ann',
        matchedPanelId: 'panel-A1',
        matchedStoryboardId: 'storyboard-A1',
        matchedPanelIndex: 4,
      }),
      skipDuplicates: true,
    }))
  })

  it('[POST panel is outside current owned episode] -> [404 and transaction creates nothing]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce(null)

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'POST',
      body: {
        episodeId: 'episode-A1',
        content: 'Hello',
        speaker: 'Ann',
        matchedPanelId: 'panel-from-episode-B',
        clientRequestId: '22222222-2222-4222-8222-222222222222',
      },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.createMany).not.toHaveBeenCalled()
  })

  it('[POST concurrent line index collision] -> [409 with explicit retry code and no false success]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ lineIndex: 2 })
    prismaMock.novelPromotionVoiceLine.createMany.mockRejectedValueOnce({ code: 'P2002' })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'POST',
      body: {
        episodeId: 'episode-A1',
        content: 'Hello',
        speaker: 'Ann',
        clientRequestId: '33333333-3333-4333-8333-333333333333',
      },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: 'VOICE_LINE_INDEX_CONFLICT',
      message: expect.stringMatching(/reload|retry/i),
    })
  })

  it('[POST response is lost then the same client key retries] -> [returns the committed line without a duplicate]', async () => {
    const committedLine = {
      id: 'voice-line-idempotent',
      episodeId: 'episode-A1',
      lineIndex: 3,
      speaker: 'Ann',
      content: 'Hello',
      matchedPanelId: null,
      matchedStoryboardId: null,
      matchedPanelIndex: null,
      audioMediaId: null,
      audioUrl: null,
      matchedPanel: null,
    }
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ lineIndex: 2 })
      .mockResolvedValueOnce(committedLine)
      .mockResolvedValueOnce(committedLine)
    prismaMock.novelPromotionVoiceLine.createMany.mockResolvedValueOnce({ count: 1 })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const input = {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'POST' as const,
      body: {
        episodeId: 'episode-A1',
        content: 'Hello',
        speaker: 'Ann',
        matchedPanelId: null,
        clientRequestId: '44444444-4444-4444-8444-444444444444',
      },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    }
    const first = await callRoute(POST as never, input)
    const retry = await callRoute(POST as never, input)

    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect((await first.json()).voiceLine.id).toBe('voice-line-idempotent')
    expect((await retry.json()).voiceLine.id).toBe('voice-line-idempotent')
    expect(prismaMock.novelPromotionVoiceLine.createMany).toHaveBeenCalledTimes(1)
  })

  it('[POST reuses a client key with changed content] -> [409 and does not create another line]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({
      id: 'voice-line-idempotent',
      episodeId: 'episode-A1',
      lineIndex: 3,
      speaker: 'Ann',
      content: 'Original',
      matchedPanelId: null,
      audioMediaId: null,
      audioUrl: null,
      matchedPanel: null,
    })

    const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(POST as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'POST',
      body: {
        episodeId: 'episode-A1',
        content: 'Changed',
        speaker: 'Ann',
        matchedPanelId: null,
        clientRequestId: '55555555-5555-4555-8555-555555555555',
      },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'VOICE_LINE_IDEMPOTENCY_CONFLICT' })
    expect(prismaMock.novelPromotionVoiceLine.createMany).not.toHaveBeenCalled()
  })

  it('[查詢本集發言人] -> [只用指定 episodeId 讀取角色]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      { speaker: '角色A' },
      { speaker: '旁白' },
    ])

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?speakersOnly=1&episodeId=episode-A1`,
      method: 'GET',
      query: { speakersOnly: '1', episodeId: 'episode-A1' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ speakers: ['角色A', '旁白'] })
    expect(prismaMock.novelPromotionEpisode.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        id: 'episode-A1',
        novelPromotionProject: { projectId: PROJECT_ID },
      },
    })
    expect(prismaMock.novelPromotionVoiceLine.findMany.mock.calls[0][0]).toMatchObject({
      where: { episodeId: 'episode-A1' },
    })
  })

  it('[speakersOnly 缺少 episodeId] -> [回傳 400 且不查詢台詞]', async () => {
    const { GET } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?speakersOnly=1`,
      method: 'GET',
      query: { speakersOnly: '1' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionVoiceLine.findMany).not.toHaveBeenCalled()
  })

  it('[一般列表傳入其他專案 episodeId] -> [回傳 404 且不讀取台詞或媒體]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      { id: 'foreign-line', speaker: 'foreign', content: 'foreign evidence' },
    ])

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?episodeId=episode-from-project-B`,
      method: 'GET',
      query: { episodeId: 'episode-from-project-B' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'episode-from-project-B',
        novelPromotionProject: { projectId: PROJECT_ID },
      },
      select: { id: true },
    })
    expect(prismaMock.novelPromotionVoiceLine.findMany).not.toHaveBeenCalled()
  })

  it('[一般列表查本專案 episode] -> [資料查詢本身也保留 project ownership chain]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?episodeId=episode-A1`,
      method: 'GET',
      query: { episodeId: 'episode-A1' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        episodeId: 'episode-A1',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
    }))
  })

  it('[GET published task audio] -> [uses the VoiceLine serializer instead of lazy MediaObject creation]', async () => {
    const taskOutput = `voice/${PROJECT_ID}/episode-A1/line-1/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([{
      id: 'line-1',
      episodeId: 'episode-A1',
      audioMediaId: null,
      audioUrl: taskOutput,
      matchedPanel: null,
    }])
    mediaMock.resolveVoiceLineMediaRef.mockResolvedValueOnce({
      id: 'virtual-ref',
      publicId: 'virtual-public',
      url: '/signed/voice-output',
      mimeType: 'audio/wav',
      sizeBytes: null,
      width: null,
      height: null,
      durationMs: null,
      sha256: null,
      updatedAt: null,
      storageKey: taskOutput,
    } as never)

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?episodeId=episode-A1`,
      method: 'GET',
      query: { episodeId: 'episode-A1' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(mediaMock.resolveVoiceLineMediaRef).toHaveBeenCalledWith(null, taskOutput)
    expect(mediaMock.resolveMediaRef).not.toHaveBeenCalled()
  })

  it('[PATCH 傳入其他專案台詞] -> [回傳 404 且不更新]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-from-project-B', emotionPrompt: '生氣', emotionStrength: 0.8 },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.findFirst.mock.calls[0][0]).toMatchObject({
      where: {
        id: 'line-from-project-B',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
    })
    expect(prismaMock.novelPromotionVoiceLine.update).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.updateMany).not.toHaveBeenCalled()
  })

  it('[情緒強度超出 0.1 至 1] -> [回傳 400 且不更新]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({
      id: 'line-A1',
      episodeId: 'episode-A1',
    })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-A1', emotionStrength: 1.5 },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionVoiceLine.update).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['raw immutable key', 'voice/project-A/episode-A1/line-A1/task-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.wav'],
    ['/m alias', '/m/media-owned-by-user-A'],
    ['signed URL', 'https://cos.example/voice/project-A/episode-A1/line-A1/output.wav?sign=forged'],
  ])('[single PATCH non-null audioUrl: %s] -> [400 before media resolve/transaction/write]', async (_label, audioUrl) => {
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-A1', audioUrl },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(400)
    expect(mediaMock.resolveMediaRefFromLegacyValue).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.update).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.updateMany).not.toHaveBeenCalled()
  })

  it('[single PATCH audioUrl null] -> [explicit clear remains allowed through scoped atomic write]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce({
        id: 'line-A1', episodeId: 'episode-A1', content: 'Same text', speaker: 'Ann',
      })
      .mockResolvedValueOnce({
        id: 'line-A1', episodeId: 'episode-A1', content: 'Same text', speaker: 'Ann',
        audioMediaId: null, audioUrl: null, audioDuration: null, matchedPanel: null,
      })
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 1 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-A1', audioUrl: null },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'line-A1',
        episodeId: 'episode-A1',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
      data: expect.objectContaining({ audioUrl: null, audioMediaId: null }),
    }))
  })

  it('[single PATCH omitted preset] -> [non-voice change keeps preset and uses scoped CAS + reread]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce({ id: 'line-A1', episodeId: 'episode-A1', content: 'updated', speaker: 'Ann' })
      .mockResolvedValueOnce({
        id: 'line-A1', episodeId: 'episode-A1', content: 'updated', speaker: 'Ann',
        voicePresetId: 'preset-existing', audioMediaId: null, audioUrl: null, matchedPanel: null,
      })
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 1 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-A1', content: ' updated ' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.voicePreset.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.update).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'line-A1',
        episodeId: 'episode-A1',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
      data: { content: 'updated' },
    })
    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: {
        id: 'line-A1',
        episodeId: 'episode-A1',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
    }))
  })

  it('[single PATCH changes normalized content] -> [atomically detaches stale generated audio]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce({
        id: 'line-A1', episodeId: 'episode-A1', content: 'Old text', speaker: 'Ann',
      })
      .mockResolvedValueOnce({
        id: 'line-A1', episodeId: 'episode-A1', content: 'New text', speaker: 'Ann',
        audioMediaId: null, audioUrl: null, audioDuration: null, matchedPanel: null,
      })
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 1 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-A1', content: ' New text ' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        content: 'New text',
        audioUrl: null,
        audioMediaId: null,
        audioDuration: null,
      },
    }))
  })

  it.each([
    {
      label: 'voice preset',
      body: { voicePresetId: 'preset-system' },
      expectedData: { voicePresetId: 'preset-system' },
    },
    {
      label: 'emotion prompt',
      body: { emotionPrompt: 'urgent' },
      expectedData: { emotionPrompt: 'urgent' },
    },
    {
      label: 'emotion strength',
      body: { emotionStrength: 0.8 },
      expectedData: { emotionStrength: 0.8 },
    },
  ])('[single PATCH changes $label] -> [atomically detaches stale generated audio]', async ({ body, expectedData }) => {
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce({
        id: 'line-A1',
        episodeId: 'episode-A1',
        content: 'Same text',
        speaker: 'Ann',
        voicePresetId: 'preset-old',
        emotionPrompt: 'calm',
        emotionStrength: 0.4,
      })
      .mockResolvedValueOnce({
        id: 'line-A1',
        episodeId: 'episode-A1',
        content: 'Same text',
        speaker: 'Ann',
        audioMediaId: null,
        audioUrl: null,
        audioDuration: null,
        matchedPanel: null,
      })
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 1 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-A1', ...body },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        ...expectedData,
        audioUrl: null,
        audioMediaId: null,
        audioDuration: null,
      },
    }))
  })

  it('[single PATCH repeats identical voice inputs] -> [keeps generated audio references]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce({
        id: 'line-A1',
        episodeId: 'episode-A1',
        content: 'Same text',
        speaker: 'Ann',
        voicePresetId: 'preset-system',
        emotionPrompt: 'calm',
        emotionStrength: 0.4,
      })
      .mockResolvedValueOnce({
        id: 'line-A1',
        episodeId: 'episode-A1',
        content: 'Same text',
        speaker: 'Ann',
        voicePresetId: 'preset-system',
        emotionPrompt: 'calm',
        emotionStrength: 0.4,
        audioMediaId: 'media-existing',
        audioUrl: '/m/existing',
        audioDuration: 1500,
        matchedPanel: null,
      })
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 1 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: {
        episodeId: 'episode-A1',
        lineId: 'line-A1',
        voicePresetId: 'preset-system',
        emotionPrompt: 'calm',
        emotionStrength: 0.4,
      },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        voicePresetId: 'preset-system',
        emotionPrompt: 'calm',
        emotionStrength: 0.4,
      },
    }))
  })

  it('[single PATCH sends the same normalized content] -> [keeps generated audio references]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce({
        id: 'line-A1', episodeId: 'episode-A1', content: 'Same text', speaker: 'Ann',
      })
      .mockResolvedValueOnce({
        id: 'line-A1', episodeId: 'episode-A1', content: 'Same text', speaker: 'Ann',
        audioMediaId: 'media-existing', audioUrl: '/m/existing', audioDuration: 1.5, matchedPanel: null,
      })
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 1 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-A1', content: '  Same text  ' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { content: 'Same text' },
    }))
  })

  it.each([
    { label: 'explicit clear', voicePresetId: null, expected: null },
    { label: 'trusted system preset', voicePresetId: 'preset-system', expected: 'preset-system' },
  ])('[single PATCH $label] -> [scoped atomic write]', async ({ voicePresetId, expected }) => {
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce({
        id: 'line-A1', episodeId: 'episode-A1', content: 'hello', speaker: 'Ann',
        voicePresetId: 'preset-old', emotionPrompt: null, emotionStrength: 0.4,
      })
      .mockResolvedValueOnce({
        id: 'line-A1', episodeId: 'episode-A1', content: 'hello', speaker: 'Ann',
        voicePresetId: expected, audioMediaId: null, audioUrl: null, matchedPanel: null,
      })
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 1 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-A1', voicePresetId },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'line-A1',
        episodeId: 'episode-A1',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      }),
      data: {
        voicePresetId: expected,
        audioUrl: null,
        audioMediaId: null,
        audioDuration: null,
      },
    }))
    expect(prismaMock.voicePreset.findFirst).toHaveBeenCalledTimes(expected ? 1 : 0)
  })

  it.each([
    ['unknown preset', null],
    ['raw HTTP preset', { id: 'raw', isSystem: true, audioUrl: 'data:audio/wav;base64,ZmFrZQ==', audioMediaId: null, audioMedia: null }],
    ['foreign media route', { id: 'raw', isSystem: true, audioUrl: '/m/foreign', audioMediaId: null, audioMedia: null }],
  ])('[single PATCH %s] -> [400 and 0 write]', async (_label, preset) => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({ id: 'line-A1', episodeId: 'episode-A1' })
    prismaMock.voicePreset.findFirst.mockResolvedValueOnce(preset)

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-A1', voicePresetId: 'raw' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.update).not.toHaveBeenCalled()
  })

  it('[single PATCH ownership changes before write] -> [404 and no unscoped update/reread]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({ id: 'line-A1', episodeId: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 0 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', lineId: 'line-A1', voicePresetId: null },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenCalledTimes(1)
    expect(prismaMock.novelPromotionVoiceLine.update).not.toHaveBeenCalled()
  })

  it('[batch PATCH trusted preset] -> [episode/project-scoped write]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: 'episode-A1' })
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 2 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', speaker: 'Ann', voicePresetId: 'preset-system' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith({
      where: {
        episodeId: 'episode-A1',
        speaker: 'Ann',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
        OR: [
          { voicePresetId: null },
          { voicePresetId: { not: 'preset-system' } },
        ],
      },
      data: {
        voicePresetId: 'preset-system',
        audioUrl: null,
        audioMediaId: null,
        audioDuration: null,
      },
    })
  })

  it('[batch PATCH omitted preset] -> [400 and 0 write]', async () => {
    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', speaker: 'Ann' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.updateMany).not.toHaveBeenCalled()
  })

  it('[batch PATCH untrusted preset] -> [400 and 0 write]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ id: 'episode-A1' })
    prismaMock.voicePreset.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-A1', speaker: 'Ann', voicePresetId: 'custom-or-foreign' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).not.toHaveBeenCalled()
  })

  it('[batch PATCH foreign episode] -> [404 before preset read and 0 write]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: { episodeId: 'episode-B1', speaker: 'Ann', voicePresetId: 'preset-system' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.voicePreset.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.updateMany).not.toHaveBeenCalled()
  })

  it('[single PATCH line belongs to a different episode] -> [404 before panel lookup or write]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: {
        episodeId: 'episode-A1',
        lineId: 'line-from-episode-A2',
        content: 'updated',
        matchedPanelId: 'panel-A1',
      },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'line-from-episode-A2',
        episodeId: 'episode-A1',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
      select: {
        id: true,
        episodeId: true,
        content: true,
        speaker: true,
        voicePresetId: true,
        emotionPrompt: true,
        emotionStrength: true,
      },
    })
    expect(prismaMock.novelPromotionPanel.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.updateMany).not.toHaveBeenCalled()
  })

  it('[single PATCH rebinds to an owned panel in the same episode] -> [one scoped atomic write]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst
      .mockResolvedValueOnce({
        id: 'line-A1', episodeId: 'episode-A1', content: 'updated', speaker: 'Ann',
      })
      .mockResolvedValueOnce({
        id: 'line-A1',
        episodeId: 'episode-A1',
        content: 'updated',
        speaker: 'Ann',
        audioMediaId: null,
        audioUrl: null,
        matchedPanel: { id: 'panel-A1', storyboardId: 'storyboard-A1', panelIndex: 1 },
      })
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValueOnce({
      id: 'panel-A1',
      storyboardId: 'storyboard-A1',
      panelIndex: 1,
      storyboard: { episodeId: 'episode-A1' },
    })
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValueOnce({ count: 1 })

    const { PATCH } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(PATCH as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines`,
      method: 'PATCH',
      body: {
        episodeId: 'episode-A1',
        lineId: 'line-A1',
        content: ' updated ',
        speaker: ' Ann ',
        matchedPanelId: 'panel-A1',
      },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionVoiceLine.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'line-A1',
        episodeId: 'episode-A1',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
      data: {
        content: 'updated',
        speaker: 'Ann',
        matchedPanelId: 'panel-A1',
        matchedStoryboardId: 'storyboard-A1',
        matchedPanelIndex: 1,
      },
    })
  })

  it('[DELETE 傳入其他專案台詞] -> [回傳 404 且不刪除]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce(null)

    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(DELETE as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?lineId=line-from-project-B&episodeId=episode-A1`,
      method: 'DELETE',
      query: { lineId: 'line-from-project-B', episodeId: 'episode-A1' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.deleteMany).not.toHaveBeenCalled()
  })

  it('[DELETE ownership changes before delete] -> [transaction returns 404 and does not reindex]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({
      id: 'line-A2', episodeId: 'episode-A1', lineIndex: 2,
    })
    prismaMock.novelPromotionVoiceLine.deleteMany.mockResolvedValueOnce({ count: 0 })

    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(DELETE as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?lineId=line-A2&episodeId=episode-A1`,
      method: 'DELETE',
      query: { lineId: 'line-A2', episodeId: 'episode-A1' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'line-A2',
        episodeId: 'episode-A1',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
    })
    expect(prismaMock.novelPromotionVoiceLine.findMany).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionVoiceLine.updateMany).not.toHaveBeenCalled()
  })

  it('[DELETE middle line with gapped order] -> [two-phase scoped writes commit contiguous 1..N]', async () => {
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValueOnce({
      id: 'line-A2', episodeId: 'episode-A1', lineIndex: 2,
    })
    prismaMock.novelPromotionVoiceLine.deleteMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.novelPromotionVoiceLine.findMany.mockResolvedValueOnce([
      { id: 'line-A1', lineIndex: 1 },
      { id: 'line-A3', lineIndex: 3 },
      { id: 'line-A5', lineIndex: 5 },
    ])
    prismaMock.novelPromotionVoiceLine.updateMany.mockResolvedValue({ count: 1 })

    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/voice-lines/route')
    const response = await callRoute(DELETE as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/voice-lines?lineId=line-A2&episodeId=episode-A1`,
      method: 'DELETE',
      query: { lineId: 'line-A2', episodeId: 'episode-A1' },
      context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      deletedId: 'line-A2',
      remainingCount: 3,
    })
    const writeCalls = prismaMock.novelPromotionVoiceLine.updateMany.mock.calls.map(([call]) => call)
    expect(writeCalls).toEqual([
      {
        where: { id: 'line-A1', episodeId: 'episode-A1', episode: { novelPromotionProject: { projectId: PROJECT_ID } } },
        data: { lineIndex: 10 },
      },
      {
        where: { id: 'line-A3', episodeId: 'episode-A1', episode: { novelPromotionProject: { projectId: PROJECT_ID } } },
        data: { lineIndex: 11 },
      },
      {
        where: { id: 'line-A5', episodeId: 'episode-A1', episode: { novelPromotionProject: { projectId: PROJECT_ID } } },
        data: { lineIndex: 12 },
      },
      {
        where: { id: 'line-A1', episodeId: 'episode-A1', episode: { novelPromotionProject: { projectId: PROJECT_ID } } },
        data: { lineIndex: 1 },
      },
      {
        where: { id: 'line-A3', episodeId: 'episode-A1', episode: { novelPromotionProject: { projectId: PROJECT_ID } } },
        data: { lineIndex: 2 },
      },
      {
        where: { id: 'line-A5', episodeId: 'episode-A1', episode: { novelPromotionProject: { projectId: PROJECT_ID } } },
        data: { lineIndex: 3 },
      },
    ])
  })
})
