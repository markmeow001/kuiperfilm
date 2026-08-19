import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'viewer-a' } },
    project: { id: 'project-a', userId: 'owner-a' },
  })),
}))
const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  task: {
    findMany: vi.fn(async () => []),
  },
}))
const cosMock = vi.hoisted(() => ({
  getSignedUrl: vi.fn((key: string) => `https://signed.example/download?object=${encodeURIComponent(key)}`),
}))

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: authMock.requireProjectAuthLight,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => cosMock)

const PROJECT_ID = 'project-a'
const EPISODE_ID = 'episode-a'
const PACKAGE_KEY = 'images/episode-pack-episode-a-1786300000000-abc123.zip'
const V1_TASK_ID = 'task-delivery-a'
const V1_PACKAGE_KEY = `images/episode-pack-${EPISODE_ID}-${V1_TASK_ID}.zip`
const ROUTE_PATH = `/api/novel-promotion/${PROJECT_ID}/episodes/${EPISODE_ID}/delivery`

function context() {
  return { params: Promise.resolve({ projectId: PROJECT_ID, episodeId: EPISODE_ID }) } as never
}

function deliveryEpisode(overrides: Record<string, unknown> = {}) {
  return {
    id: EPISODE_ID,
    name: '第一集',
    stitchStatus: 'completed',
    stitchedVideoUrl: PACKAGE_KEY,
    stitchedAt: new Date('2026-08-10T00:00:00.000Z'),
    storyboards: [{
      id: 'storyboard-a',
      createdAt: new Date('2026-08-09T00:00:00.000Z'),
      panels: [{
        id: 'panel-a',
        panelIndex: 1,
        description: 'shot',
        imageUrl: 'images/panel-a.jpg',
        videoUrl: 'video/panel-a-base.mp4',
        lipSyncVideoUrl: 'video/panel-a-lip.mp4',
        cameraMove: null,
        shotType: null,
        multiShotGroupId: null,
      }],
    }],
    voiceLines: [],
    ...overrides,
  }
}

describe('GET episode delivery catalog and scoped download', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    cosMock.getSignedUrl.mockImplementation(
      (key: string) => `https://signed.example/download?object=${encodeURIComponent(key)}`,
    )
    prismaMock.task.findMany.mockResolvedValue([])
  })

  it('[viewer reads completed package] -> [typed ready catalog without raw storage key]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(deliveryEpisode())

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const response = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      context: context(),
    })

    expect(response.status).toBe(200)
    expect(authMock.requireProjectAuthLight).toHaveBeenCalledWith(PROJECT_ID, { action: 'read' })
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: EPISODE_ID, novelPromotionProject: { projectId: PROJECT_ID } },
    }))
    const json = await response.json()
    expect(json).toEqual({
      success: true,
      delivery: {
        status: 'ready',
        filename: 'episode-episode-a-assets.zip',
        downloadUrl: `${ROUTE_PATH}?download=1`,
        version: 'legacy',
        taskId: null,
        createdAt: '2026-08-10T00:00:00.000Z',
        sourceFingerprint: null,
        stale: null,
        manifest: null,
      },
      input: {
        canCreate: true,
        selectedVideoCount: 1,
        imageCount: 1,
        multiShotVideoCount: 0,
        voiceAudioCount: 0,
        missingVoiceAudioCount: 0,
      },
    })
    expect(JSON.stringify(json)).not.toContain(PACKAGE_KEY)
    expect(cosMock.getSignedUrl).not.toHaveBeenCalled()
  })

  it('[owned episode has no completed package] -> [200 delivery null]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(deliveryEpisode({
      stitchStatus: 'rendering',
      stitchedVideoUrl: null,
      stitchedAt: null,
    }))

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const response = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      context: context(),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      delivery: null,
      input: {
        canCreate: true,
        selectedVideoCount: 1,
        imageCount: 1,
        multiShotVideoCount: 0,
        voiceAudioCount: 0,
        missingVoiceAudioCount: 0,
      },
    })
  })

  it('[replacement job is rendering while an exact prior v1 package exists] -> [prior receipt stays available]', async () => {
    const episode = deliveryEpisode({
      stitchStatus: 'rendering',
      stitchedVideoUrl: V1_PACKAGE_KEY,
      stitchedAt: new Date('2026-08-10T00:01:00.000Z'),
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(episode)
    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )
    const snapshot = await getEpisodeDeliveryInputSnapshot(PROJECT_ID, EPISODE_ID)
    prismaMock.task.findMany.mockResolvedValue([{
      id: V1_TASK_ID,
      status: 'completed',
      finishedAt: new Date('2026-08-10T00:03:00.000Z'),
      payload: { sourceFingerprint: snapshot!.sourceFingerprint },
      result: {
        outputUrl: V1_PACKAGE_KEY,
        sourceFingerprint: snapshot!.sourceFingerprint,
        manifest: {
          version: 1, fileCount: 4, selectedVideoCount: 1,
          multiShotVideoCount: 0, imageCount: 1, voiceAudioCount: 0,
          excludedVoiceLineCount: 0, scriptIncluded: true,
          checksumAlgorithm: 'sha256',
        },
      },
    }] as never)

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const response = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      context: context(),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).delivery).toMatchObject({
      status: 'ready',
      version: 'v1',
      taskId: V1_TASK_ID,
      createdAt: '2026-08-10T00:03:00.000Z',
      stale: false,
    })
  })

  it('[replacement job failed but an exact prior legacy package exists] -> [catalog and scoped download remain available]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(deliveryEpisode({
      stitchStatus: 'failed',
    }))

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const catalog = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      context: context(),
    })
    expect(catalog.status).toBe(200)
    expect((await catalog.json()).delivery).toMatchObject({
      status: 'ready',
      version: 'legacy',
      createdAt: '2026-08-10T00:00:00.000Z',
    })

    const download = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      query: { download: 1 },
      context: context(),
    })
    expect(download.status).toBe(302)
    expect(cosMock.getSignedUrl).toHaveBeenCalledWith(PACKAGE_KEY, 3600)
  })

  it.each([
    'missing_result',
    'output_mismatch',
    'fingerprint_invalid',
    'manifest_invalid',
    'finished_at_missing',
    'payload_fingerprint_missing',
    'payload_fingerprint_mismatch',
    'task_not_completed',
  ] as const)('[exact task-derived v1 candidate is malformed: %s] -> [catalog and direct download fail closed]', async (fault) => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(deliveryEpisode({
      stitchedVideoUrl: V1_PACKAGE_KEY,
    }))
    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )
    const snapshot = await getEpisodeDeliveryInputSnapshot(PROJECT_ID, EPISODE_ID)
    const sourceFingerprint = snapshot!.sourceFingerprint
    const task: Record<string, unknown> = {
      id: V1_TASK_ID,
      status: fault === 'task_not_completed' ? 'running' : 'completed',
      finishedAt: fault === 'finished_at_missing'
        ? null
        : new Date('2026-08-10T00:03:00.000Z'),
      payload: fault === 'payload_fingerprint_missing'
        ? {}
        : {
            sourceFingerprint: fault === 'payload_fingerprint_mismatch'
              ? 'a'.repeat(64)
              : sourceFingerprint,
          },
      result: {
        outputUrl: fault === 'output_mismatch'
          ? 'images/episode-pack-episode-a-another-task.zip'
          : V1_PACKAGE_KEY,
        sourceFingerprint: fault === 'fingerprint_invalid'
          ? 'not-a-fingerprint'
          : sourceFingerprint,
        manifest: fault === 'manifest_invalid'
          ? { version: 1 }
          : {
              version: 1, fileCount: 4, selectedVideoCount: 1,
              multiShotVideoCount: 0, imageCount: 1, voiceAudioCount: 0,
              excludedVoiceLineCount: 0, scriptIncluded: true,
              checksumAlgorithm: 'sha256',
            },
      },
    }
    if (fault === 'missing_result') task.result = null
    prismaMock.task.findMany.mockResolvedValue([task] as never)

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const catalog = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      context: context(),
    })
    expect(catalog.status).toBe(409)
    expect((await catalog.json()).error.details.code).toBe(
      'EPISODE_DELIVERY_RECEIPT_INVALID',
    )

    const download = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      query: { download: 1 },
      context: context(),
    })
    expect(download.status).toBe(409)
    expect((await download.json()).error.details.code).toBe(
      'EPISODE_DELIVERY_RECEIPT_INVALID',
    )
    expect(cosMock.getSignedUrl).not.toHaveBeenCalled()
  })

  it('[foreign episode] -> [404 and zero signing]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const response = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      context: context(),
    })

    expect(response.status).toBe(404)
    expect(cosMock.getSignedUrl).not.toHaveBeenCalled()
  })

  it.each([
    'https://foreign.example/package.zip',
    'data:application/zip;base64,ZmFrZQ==',
    'file:///tmp/secret.zip',
    '../images/episode-pack-episode-a-stolen.zip',
    'images/episode-pack-episode-b-1786300000000-abc123.zip',
  ])('[unsafe or foreign DB package reference %s] -> [404 and zero signing]', async (value) => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(deliveryEpisode({
      stitchedVideoUrl: value,
    }))

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const response = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      query: { download: 1 },
      context: context(),
    })

    expect(response.status).toBe(404)
    expect(cosMock.getSignedUrl).not.toHaveBeenCalled()
  })

  it('[scoped download action] -> [302 to server-signed exact DB key]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(deliveryEpisode())

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const response = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      query: { download: 1 },
      context: context(),
    })

    expect(response.status).toBe(302)
    expect(cosMock.getSignedUrl).toHaveBeenCalledWith(PACKAGE_KEY, 3600)
    expect(response.headers.get('location')).toBe(
      `https://signed.example/download?object=${encodeURIComponent(PACKAGE_KEY)}`,
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('[image-only snapshot] -> [catalog canCreate matches stitch submission truth]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(deliveryEpisode({
      stitchStatus: null,
      stitchedVideoUrl: null,
      stitchedAt: null,
      storyboards: [{
        id: 'storyboard-image',
        createdAt: new Date(),
        panels: [{
          id: 'panel-image', panelIndex: 1, description: 'still',
          imageUrl: 'images/still.jpg', videoUrl: null, lipSyncVideoUrl: null,
          cameraMove: null, shotType: null, multiShotGroupId: null,
        }],
      }],
    }))

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const response = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      context: context(),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      delivery: null,
      input: {
        canCreate: true,
        selectedVideoCount: 0,
        imageCount: 1,
        multiShotVideoCount: 0,
        voiceAudioCount: 0,
        missingVoiceAudioCount: 0,
      },
    })
  })

  it('[scoped completed v1 task result matches exact episode key] -> [typed fresh manifest receipt]', async () => {
    const episode = deliveryEpisode({ stitchedVideoUrl: V1_PACKAGE_KEY })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(episode)

    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )
    const snapshot = await getEpisodeDeliveryInputSnapshot(PROJECT_ID, EPISODE_ID)
    const sourceFingerprint = snapshot!.sourceFingerprint
    prismaMock.task.findMany.mockResolvedValue([{
      id: V1_TASK_ID,
      status: 'completed',
      createdAt: new Date('2026-08-10T00:02:00.000Z'),
      finishedAt: new Date('2026-08-10T00:03:00.000Z'),
      payload: { sourceFingerprint },
      result: {
        outputUrl: V1_PACKAGE_KEY,
        sourceFingerprint,
        manifest: {
          version: 1,
          fileCount: 4,
          selectedVideoCount: 1,
          multiShotVideoCount: 0,
          imageCount: 1,
          voiceAudioCount: 0,
          excludedVoiceLineCount: 0,
          scriptIncluded: true,
          checksumAlgorithm: 'sha256',
        },
      },
    }] as never)

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const response = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      context: context(),
    })

    expect(response.status).toBe(200)
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: PROJECT_ID,
        episodeId: EPISODE_ID,
        type: 'episode_stitch_mp4',
        targetType: 'NovelPromotionEpisode',
        targetId: EPISODE_ID,
      },
    }))
    const json = await response.json()
    expect(json.delivery).toEqual({
      status: 'ready',
      filename: 'episode-episode-a-assets.zip',
      downloadUrl: `${ROUTE_PATH}?download=1`,
      version: 'v1',
      taskId: V1_TASK_ID,
      createdAt: '2026-08-10T00:03:00.000Z',
      sourceFingerprint,
      stale: false,
      manifest: {
        version: 1,
        fileCount: 4,
        selectedVideoCount: 1,
        multiShotVideoCount: 0,
        imageCount: 1,
        voiceAudioCount: 0,
        excludedVoiceLineCount: 0,
        scriptIncluded: true,
        checksumAlgorithm: 'sha256',
      },
    })
  })

  it('[current source fingerprint drifted from exact v1 receipt] -> [receipt remains downloadable but stale=true]', async () => {
    const original = deliveryEpisode({ stitchedVideoUrl: V1_PACKAGE_KEY })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(original)
    const { getEpisodeDeliveryInputSnapshot } = await import(
      '@/lib/novel-promotion/episode-delivery-snapshot'
    )
    const originalSnapshot = await getEpisodeDeliveryInputSnapshot(PROJECT_ID, EPISODE_ID)

    const changed = deliveryEpisode({ stitchedVideoUrl: V1_PACKAGE_KEY })
    changed.storyboards[0].panels[0].description = 'changed after package'
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(changed)
    prismaMock.task.findMany.mockResolvedValue([{
      id: V1_TASK_ID,
      status: 'completed',
      createdAt: new Date('2026-08-10T00:02:00.000Z'),
      finishedAt: new Date('2026-08-10T00:03:00.000Z'),
      payload: { sourceFingerprint: originalSnapshot!.sourceFingerprint },
      result: {
        outputUrl: V1_PACKAGE_KEY,
        sourceFingerprint: originalSnapshot!.sourceFingerprint,
        manifest: {
          version: 1, fileCount: 4, selectedVideoCount: 1,
          multiShotVideoCount: 0, imageCount: 1, voiceAudioCount: 0,
          excludedVoiceLineCount: 0, scriptIncluded: true,
          checksumAlgorithm: 'sha256',
        },
      },
    }] as never)

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/delivery/route')
    const response = await callRoute(GET as never, {
      path: ROUTE_PATH,
      method: 'GET',
      context: context(),
    })

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.delivery).toMatchObject({
      version: 'v1',
      sourceFingerprint: originalSnapshot!.sourceFingerprint,
      stale: true,
    })
  })
})
