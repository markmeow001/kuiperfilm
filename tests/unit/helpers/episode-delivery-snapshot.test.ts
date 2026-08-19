import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: { findFirst: vi.fn() },
  task: { findMany: vi.fn(async () => []) },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({
  getSignedUrl: vi.fn(),
  toFetchableUrl: vi.fn(),
}))
vi.mock('@/lib/http/ssrf-safe-fetch', () => ({ fetchPublicResource: vi.fn() }))

function episodeFixture() {
  return {
    id: 'episode-a',
    name: 'Episode A',
    stitchStatus: null,
    stitchedVideoUrl: null,
    stitchedAt: null,
    storyboards: [
      {
        id: 'storyboard-a',
        createdAt: new Date('2026-08-10T00:00:00.000Z'),
        panels: [
          {
            id: 'panel-a',
            panelIndex: 1,
            description: 'first',
            imageUrl: 'images/panel-a.jpg',
            videoUrl: 'video/panel-a-base.mp4',
            lipSyncVideoUrl: 'video/panel-a-lip.mp4',
            cameraMove: null,
            shotType: null,
            multiShotGroupId: 'group-a',
          },
        ],
      },
      {
        id: 'storyboard-b',
        createdAt: new Date('2026-08-10T00:01:00.000Z'),
        panels: [
          {
            id: 'panel-b',
            panelIndex: 1,
            description: 'second',
            imageUrl: 'images/panel-b.jpg',
            videoUrl: null,
            lipSyncVideoUrl: null,
            cameraMove: null,
            shotType: null,
            multiShotGroupId: null,
          },
        ],
      },
    ],
    voiceLines: [
      {
        id: 'line-a',
        episodeId: 'episode-a',
        lineIndex: 1,
        speaker: 'Ann',
        content: 'Hello',
        audioUrl: '/m/audio-public-a',
        audioMediaId: 'audio-media-a',
        audioMedia: {
          id: 'audio-media-a',
          publicId: 'audio-public-a',
          storageKey: 'voice/project-a/episode-a/line-a.wav',
          sha256: 'audio-sha-a',
          mimeType: 'audio/wav',
          sizeBytes: BigInt(8),
        },
        matchedPanelId: 'panel-a',
        matchedPanelIndex: 1,
      },
      {
        id: 'line-b',
        episodeId: 'episode-a',
        lineIndex: 2,
        speaker: 'Bob',
        content: 'No generated audio',
        audioUrl: null,
        audioMediaId: null,
        audioMedia: null,
        matchedPanelId: 'panel-b',
        matchedPanelIndex: 1,
      },
    ],
  }
}

describe('episode delivery input snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockResolvedValue([])
  })

  it('[lip-sync, image-only, and completed multi-shot inputs] -> [one deterministic canonical snapshot]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(episodeFixture())
    prismaMock.task.findMany.mockResolvedValue([{
      payload: { panelIds: ['panel-a'] },
      result: {
        multiShotClipUrls: ['video/group-a-1.mp4', 'video/group-a-2.mp4'],
        multiShotVideoUrl: 'video/group-a-legacy.mp4',
      },
    }] as never)

    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )
    const snapshot = await getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')

    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'episode-a', novelPromotionProject: { projectId: 'project-a' } },
    }))
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: 'project-a',
        episodeId: 'episode-a',
        type: 'video_multi_shot',
        status: 'completed',
      },
    }))
    expect(snapshot?.panels.map((panel) => ({
      id: panel.panelId,
      sequence: panel.sequence,
      panelIndex: panel.panelIndex,
      selectedVideoKey: panel.selectedVideoKey,
      imageKey: panel.imageKey,
    }))).toEqual([
      {
        id: 'panel-a',
        sequence: 1,
        panelIndex: 1,
        selectedVideoKey: 'video/panel-a-lip.mp4',
        imageKey: 'images/panel-a.jpg',
      },
      {
        id: 'panel-b',
        sequence: 2,
        panelIndex: 1,
        selectedVideoKey: null,
        imageKey: 'images/panel-b.jpg',
      },
    ])
    expect(snapshot?.multiShotVideos).toEqual([
      expect.objectContaining({
        groupOrder: 1,
        storyboardId: 'storyboard-a',
        groupId: 'group-a',
        storageKeys: ['video/group-a-1.mp4', 'video/group-a-2.mp4'],
      }),
    ])
    expect(snapshot?.input).toEqual({
      canCreate: true,
      selectedVideoCount: 1,
      imageCount: 2,
      multiShotVideoCount: 2,
      voiceAudioCount: 1,
      missingVoiceAudioCount: 1,
    })
    expect(snapshot?.voiceAudios).toEqual([
      expect.objectContaining({
        lineId: 'line-a',
        sequence: 1,
        storageKey: 'voice/project-a/episode-a/line-a.wav',
      }),
    ])
    expect(snapshot?.excludedVoiceLines).toEqual([
      { lineId: 'line-b', lineIndex: 2, reason: 'audio_url_missing' },
    ])
    expect(snapshot?.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
  })

  it.each([
    'https://foreign.example/lip.mp4',
    '',
  ])('[selected lip-sync key %j is unsafe but base video is safe] -> [fail closed instead of falling back]', async (lipSyncVideoUrl) => {
    const fixture = episodeFixture()
    fixture.storyboards[0].panels[0].lipSyncVideoUrl = lipSyncVideoUrl
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(fixture)

    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )
    await expect(getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')).rejects.toThrow(
      'EPISODE_PACKAGE_SOURCE_INVALID',
    )
  })

  it('[foreign episode] -> [null and zero task reads]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)
    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )

    await expect(getEpisodeDeliveryInputSnapshot('project-a', 'episode-b')).resolves.toBeNull()
    expect(prismaMock.task.findMany).not.toHaveBeenCalled()
  })

  it('[immutable generated voice output] -> [is retained in canonical delivery snapshot]', async () => {
    const fixture = episodeFixture()
    const immutableKey = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`
    fixture.voiceLines[0].audioUrl = immutableKey
    fixture.voiceLines[0].audioMediaId = null
    fixture.voiceLines[0].audioMedia = null
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(fixture)

    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )
    const snapshot = await getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')

    expect(snapshot?.voiceAudios).toEqual([
      expect.objectContaining({ lineId: 'line-a', storageKey: immutableKey }),
    ])
  })

  it.each([
    'https://foreign.example/raw.wav',
    'data:audio/wav;base64,ZmFrZQ==',
    '/m/foreign-public-id',
    'voice/project-b/episode-b/line-b.wav',
  ])('[generated voice source %s is not owned by this line] -> [snapshot fails closed]', async (audioUrl) => {
    const fixture = episodeFixture()
    fixture.voiceLines[0].audioUrl = audioUrl
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(fixture)

    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )
    await expect(getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')).rejects.toThrow(
      'EPISODE_PACKAGE_SOURCE_INVALID',
    )
  })

  it('[script or source lineage changes] -> [source fingerprint changes deterministically]', async () => {
    const original = episodeFixture()
    Object.assign(original.storyboards[0].panels[0], {
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    })
    Object.assign(original.voiceLines[0], {
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(original)
    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )
    const first = await getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')
    const second = await getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')
    expect(second?.sourceFingerprint).toBe(first?.sourceFingerprint)

    const timestampOnlyChange = episodeFixture()
    Object.assign(timestampOnlyChange.storyboards[0].panels[0], {
      updatedAt: new Date('2026-08-10T01:00:00.000Z'),
    })
    Object.assign(timestampOnlyChange.voiceLines[0], {
      updatedAt: new Date('2026-08-10T01:00:00.000Z'),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(timestampOnlyChange)
    const timestampOnly = await getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')
    expect(timestampOnly?.sourceFingerprint).toBe(first?.sourceFingerprint)

    const changed = episodeFixture()
    changed.voiceLines[0].content = 'Changed script'
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(changed)
    const third = await getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')
    expect(third?.sourceFingerprint).not.toBe(first?.sourceFingerprint)

    const changedSelection = episodeFixture()
    changedSelection.storyboards[0].panels[0].lipSyncVideoUrl = null
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(changedSelection)
    const selected = await getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')
    expect(selected?.sourceFingerprint).not.toBe(first?.sourceFingerprint)

    const changedMedia = episodeFixture()
    changedMedia.voiceLines[0].audioMedia!.storageKey = 'voice/project-a/episode-a/line-a-v2.wav'
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(changedMedia)
    const media = await getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')
    expect(media?.sourceFingerprint).not.toBe(first?.sourceFingerprint)
  })

  it('[legacy generated voice overwrites the same deterministic key] -> [line version timestamp changes fingerprint]', async () => {
    const firstFixture = episodeFixture()
    Object.assign(firstFixture.voiceLines[0], {
      audioUrl: 'voice/project-a/episode-a/line-a.wav',
      audioMediaId: null,
      audioMedia: null,
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(firstFixture)
    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )
    const first = await getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')

    const overwrittenFixture = episodeFixture()
    Object.assign(overwrittenFixture.voiceLines[0], {
      audioUrl: 'voice/project-a/episode-a/line-a.wav',
      audioMediaId: null,
      audioMedia: null,
      updatedAt: new Date('2026-08-10T00:01:00.000Z'),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(overwrittenFixture)
    const overwritten = await getEpisodeDeliveryInputSnapshot('project-a', 'episode-a')
    expect(overwritten?.sourceFingerprint).not.toBe(first?.sourceFingerprint)
  })
})
