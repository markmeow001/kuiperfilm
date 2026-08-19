/**
 * Unit test for handleEpisodePackageZipTask — the worker that
 * replaces ffmpeg episode stitching with archiver-based zip packaging.
 *
 * Verifies:
 *   - panel videos + images are pulled and added to the zip
 *   - script.txt is generated from voiceLines + camera notes
 *   - README.txt is included
 *   - a durable task-scoped publication marker precedes upload
 *   - retries reconcile the exact task-stable output without rebuilding
 *   - cancellation cleanup never overwrites the prior episode receipt
 */
import type { Job } from 'bullmq'
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { TaskTerminatedError } from '@/lib/task/errors'
import type { TaskJobData } from '@/lib/task/types'

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async (_job: unknown, _stage: string) => undefined),
}))

const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(async (_buffer: Buffer, key: string) => key),
  deleteCOSObject: vi.fn(async () => undefined),
  getStorageObjectSize: vi.fn(async () => null as number | null),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `images/${prefix}-fixed.${ext}`),
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
  toFetchableUrl: vi.fn((url: string) => url),
}))

const safeFetchMock = vi.hoisted(() => ({
  fetchPublicResource: vi.fn(),
  SsrfSafeFetchError: class SsrfSafeFetchError extends Error {},
}))

const loggingMock = vi.hoisted(() => ({
  logWarn: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  // Session A added multi-shot B-path support — handler now queries the
  // Task table to find completed video_multi_shot tasks per group.
  // Default to empty so the original per-panel-video tests stay focused.
  task: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async (_args?: unknown): Promise<Record<string, unknown> | null> => ({
      status: 'processing', payload: {}, result: null, finishedAt: null,
    })),
    updateMany: vi.fn(async (_args?: { data?: { payload?: unknown } }) => ({ count: 1 })),
  },
}))

vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: reportTaskProgressMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/cos', () => cosMock)
vi.mock('server-only', () => ({}))
vi.mock('@/lib/logging/core', () => loggingMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/http/ssrf-safe-fetch', () => safeFetchMock)

function makeFetchResponse(body: string, contentType = 'application/octet-stream'): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  })
}

function makeJob(episodeId: string, overrides: Partial<TaskJobData> = {}): Job<TaskJobData> {
  return {
    id: 'task-test',
    queueName: 'kuiper-video',
    data: {
      taskId: 'task-test',
      type: 'episode_stitch_mp4',
      userId: 'user-a',
      projectId: 'project-a',
      episodeId,
      targetType: 'NovelPromotionEpisode',
      targetId: episodeId,
      payload: { episodeId, sourceFingerprint: 'f'.repeat(64) },
      ...overrides,
    },
  } as unknown as Job<TaskJobData>
}

async function makePreparedJob(
  episodeId: string,
  overrides: Partial<TaskJobData> = {},
): Promise<Job<TaskJobData>> {
  const { getEpisodeDeliveryInputSnapshot } = await import(
    '@/lib/novel-promotion/episode-delivery-snapshot'
  )
  const snapshot = await getEpisodeDeliveryInputSnapshot('project-a', episodeId)
  if (!snapshot) throw new Error('test fixture episode missing')
  return makeJob(episodeId, {
    ...overrides,
    payload: {
      episodeId,
      sourceFingerprint: snapshot.sourceFingerprint,
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  utilsMock.assertTaskActive.mockResolvedValue(undefined)
  cosMock.uploadToCOS.mockImplementation(async (_buffer: Buffer, key: string) => key)
  cosMock.deleteCOSObject.mockResolvedValue(undefined)
  cosMock.getStorageObjectSize.mockResolvedValue(null)
  cosMock.generateUniqueKey.mockImplementation((prefix: string, ext: string) => `images/${prefix}-fixed.${ext}`)
  cosMock.getSignedUrl.mockImplementation((key: string) => `https://signed.example/${key}`)
  cosMock.toFetchableUrl.mockImplementation((url: string) => url)
  prismaMock.novelPromotionEpisode.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.task.findFirst.mockResolvedValue({
    status: 'processing', payload: {}, result: null, finishedAt: null,
  })
  prismaMock.task.updateMany.mockResolvedValue({ count: 1 })
})

describe('handleEpisodePackageZipTask', () => {
  it('packages videos + images + script + readme into a zip and durably prepares publication', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'ep-1',
      storyboards: [
        {
          createdAt: new Date('2026-04-01T00:00:00Z'),
          panels: [
            {
              id: 'panel-1',
              panelIndex: 1,
              description: 'Opening shot',
              imageUrl: 'images/panel-1.jpg',
              videoUrl: 'video/panel-1-base.mp4',
              lipSyncVideoUrl: 'video/panel-1-lip.mp4',
              cameraMove: 'pan right',
              shotType: 'wide',
            },
            {
              id: 'panel-2',
              panelIndex: 2,
              description: 'Closeup',
              imageUrl: null,
              videoUrl: 'video/panel-2.mp4',
              lipSyncVideoUrl: null,
              cameraMove: null,
              shotType: 'close',
            },
            {
              // No video — should be skipped entirely
              id: 'panel-3',
              panelIndex: 3,
              description: 'Reveal',
              imageUrl: 'images/panel-3.jpg',
              videoUrl: null,
              lipSyncVideoUrl: null,
              cameraMove: null,
              shotType: null,
            },
          ],
        },
      ],
      voiceLines: [
        {
          id: 'voice-line-1',
          episodeId: 'ep-1',
          lineIndex: 1,
          speaker: '小明',
          content: 'Hello world',
          audioUrl: 'voice/project-a/ep-1/voice-line-1.wav',
          audioMediaId: null,
          audioMedia: null,
          matchedPanelId: 'panel-1',
          matchedPanelIndex: 1,
        },
        {
          id: 'voice-line-2',
          episodeId: 'ep-1',
          lineIndex: 2,
          speaker: '小美',
          content: 'Still missing',
          audioUrl: null,
          audioMediaId: null,
          audioMedia: null,
          matchedPanelId: 'panel-2',
          matchedPanelIndex: 2,
        },
      ],
    })

    safeFetchMock.fetchPublicResource.mockImplementation((url: string) => {
      if (url.includes('panel-1-lip.mp4')) return Promise.resolve(makeFetchResponse('VIDEO-1', 'video/mp4'))
      if (url.includes('panel-2.mp4')) return Promise.resolve(makeFetchResponse('VIDEO-2', 'video/mp4'))
      if (url.includes('panel-1.jpg')) return Promise.resolve(makeFetchResponse('IMAGE-1', 'image/jpeg'))
      if (url.includes('panel-3.jpg')) return Promise.resolve(makeFetchResponse('IMAGE-3', 'image/jpeg'))
      if (url.includes('voice-line-1.wav')) {
        return Promise.resolve(makeFetchResponse('VOICE-1', 'audio/wav'))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    const result = await handleEpisodePackageZipTask(await makePreparedJob('ep-1'))

    expect(result.episodeId).toBe('ep-1')
    expect(result.panelCount).toBe(2)
    expect(result.outputUrl).toContain('episode-pack-ep-1')
    expect(result.outputUrl).toMatch(/\.zip$/)
    expect(result.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(result.manifest).toMatchObject({
      version: 1,
      selectedVideoCount: 2,
      imageCount: 2,
      voiceAudioCount: 1,
      excludedVoiceLineCount: 1,
      scriptIncluded: true,
      checksumAlgorithm: 'sha256',
    })
    expect(safeFetchMock.fetchPublicResource).toHaveBeenCalledWith(
      'https://signed.example/video/panel-1-lip.mp4',
      expect.objectContaining({
        timeoutMs: 120_000,
        maxResponseBytes: 256 * 1024 * 1024,
        trustedInternalOrigins: ['https://signed.example'],
      }),
    )
    expect(safeFetchMock.fetchPublicResource).toHaveBeenCalledWith(
      'https://signed.example/images/panel-1.jpg',
      expect.objectContaining({
        timeoutMs: 60_000,
        maxResponseBytes: 32 * 1024 * 1024,
        trustedInternalOrigins: ['https://signed.example'],
      }),
    )
    expect(safeFetchMock.fetchPublicResource).not.toHaveBeenCalledWith(
      expect.stringContaining('panel-1-base.mp4'),
      expect.anything(),
    )

    const calls = cosMock.uploadToCOS.mock.calls
    expect(calls.length).toBe(1)
    const [zipBuffer, zipKey] = calls[0]
    expect(zipKey).toBe('images/episode-pack-ep-1-task-test.zip')

    const zip = await JSZip.loadAsync(zipBuffer)
    const names = Object.keys(zip.files).sort()
    expect(names).toContain('README.txt')
    expect(names).toContain('script.txt')
    expect(names).toContain('manifest.json')
    expect(names.some((n) => n.startsWith('videos/001-'))).toBe(true)
    expect(names.some((n) => n.startsWith('videos/002-'))).toBe(true)
    expect(names.some((n) => n.startsWith('images/001-'))).toBe(true)
    expect(names.some((n) => n.startsWith('images/002-'))).toBe(false)
    // Image-only panels remain real delivery inputs and must be packaged.
    expect(names.some((n) => n.startsWith('images/003-'))).toBe(true)
    expect(names.some((n) => n.startsWith('voices/001-'))).toBe(true)

    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as {
      version: number
      episodeId: string
      taskId: string
      sourceFingerprint: string
      files: Array<{ sourceId: string; kind: string; path: string; bytes: number; sha256: string }>
      excluded: Array<{ sourceId: string; kind: string; reason: string }>
      summary: { fileCount: number }
    }
    expect(manifest).toMatchObject({
      version: 1,
      episodeId: 'ep-1',
      taskId: 'task-test',
      sourceFingerprint: result.sourceFingerprint,
      excluded: [{
        sourceId: 'voice-line-2',
        kind: 'voice_audio',
        reason: 'audio_url_missing',
      }],
    })
    expect(manifest.summary.fileCount).toBe(manifest.files.length)
    expect(manifest.files.map((file) => file.path)).not.toContain('manifest.json')
    expect(new Set(manifest.files.map((file) => file.path)).size).toBe(manifest.files.length)
    for (const file of manifest.files) {
      const bytes = await zip.file(file.path)!.async('nodebuffer')
      expect(file.bytes).toBe(bytes.byteLength)
      expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(file.sourceId).toBeTruthy()
      expect(file.kind).toBeTruthy()
    }

    const script = await zip.file('script.txt')!.async('string')
    expect(script).toContain('Panel 01')
    expect(script).toContain('Shot: wide')
    expect(script).toContain('Camera: pan right')
    expect(script).toContain('小明: Hello world')
    expect(script).toContain('Panel 02')
    const readme = await zip.file('README.txt')!.async('string')
    expect(readme).toContain('Kuiper 影界 Episode Package')
    expect(readme).toContain('voices/')
    expect(readme).toContain('manifest.json')
    expect(readme).toContain('SHA-256')
    expect(readme).not.toMatch(/Kino|KuiperAI|Kuiperfilm/)

    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'task-test', projectId: 'project-a', episodeId: 'ep-1' }),
      data: expect.objectContaining({ payload: expect.anything() }),
    }))
  })

  it('fails without mutating the last successful episode pointer when no inputs exist', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'ep-empty',
      storyboards: [
        {
          id: 'sb-empty',
          createdAt: new Date(),
          panels: [
            { id: 'p1', panelIndex: 1, description: 'x', imageUrl: null, videoUrl: null, cameraMove: null, shotType: null, multiShotGroupId: null },
          ],
        },
      ],
      voiceLines: [],
    })
    prismaMock.task.findMany.mockResolvedValue([]) // no multi-shot tasks either

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')

    await expect(handleEpisodePackageZipTask(await makePreparedJob('ep-empty'))).rejects.toThrow(
      /no panel videos, storyboard images, or multi-shot group videos/,
    )
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('rethrows a video fetch failure without mutating the last successful episode pointer', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'ep-fetch-fail',
      storyboards: [
        {
          createdAt: new Date(),
          panels: [
            {
              id: 'panel-x',
              panelIndex: 1,
              description: 'broken',
              imageUrl: null,
              videoUrl: 'video/missing.mp4',
              cameraMove: null,
              shotType: null,
            },
          ],
        },
      ],
      voiceLines: [],
    })

    safeFetchMock.fetchPublicResource.mockResolvedValue(new Response(null, {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'content-type': 'video/mp4' },
    }))

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    await expect(handleEpisodePackageZipTask(await makePreparedJob('ep-fetch-fail'))).rejects.toThrow(
      'EPISODE_PACKAGE_UPSTREAM_HTTP_503',
    )

    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('fails the whole package when a promised image fetch fails', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'ep-img-fail',
      storyboards: [
        {
          createdAt: new Date(),
          panels: [
            {
              id: 'panel-1',
              panelIndex: 1,
              description: 'has video and image',
              imageUrl: 'images/will-fail.jpg',
              videoUrl: 'video/works.mp4',
              cameraMove: null,
              shotType: null,
            },
          ],
        },
      ],
      voiceLines: [],
    })

    safeFetchMock.fetchPublicResource.mockImplementation((url: string) => {
      if (url.includes('works.mp4')) return Promise.resolve(makeFetchResponse('VIDEO', 'video/mp4'))
      if (url.includes('will-fail.jpg')) {
        return Promise.resolve(new Response(null, {
          status: 404,
          statusText: 'Not Found',
          headers: { 'content-type': 'image/jpeg' },
        }))
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    await expect(handleEpisodePackageZipTask(await makePreparedJob('ep-img-fail'))).rejects.toThrow(
      'EPISODE_PACKAGE_UPSTREAM_HTTP_404',
    )

    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong target type', { targetType: 'VideoEditorProject' }],
    ['wrong target id', { targetId: 'episode-b' }],
    ['wrong envelope episode', { episodeId: 'episode-b' }],
    ['wrong task type', { type: 'video_editor_render' }],
    ['missing project', { projectId: '' }],
    ['wrong payload episode', { payload: { episodeId: 'episode-b' } }],
  ] as const)('[forged job: %s] -> [explicit failure before DB, fetch, upload, or write]', async (_label, overrides) => {
    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')

    await expect(handleEpisodePackageZipTask(makeJob('episode-a', overrides))).rejects.toThrow(
      'EPISODE_PACKAGE_TASK_TARGET_INVALID',
    )
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalled()
    expect(safeFetchMock.fetchPublicResource).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[foreign episode in forged project job] -> [scoped miss before fetch, upload, or write]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)
    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')

    await expect(handleEpisodePackageZipTask(makeJob('episode-foreign'))).rejects.toThrow(
      'EPISODE_PACKAGE_ZIP: episode not found in task project',
    )
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'episode-foreign',
        novelPromotionProject: { projectId: 'project-a' },
      },
    }))
    expect(safeFetchMock.fetchPublicResource).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    'https://foreign.example/video.mp4',
    'data:video/mp4;base64,ZmFrZQ==',
    'file:///tmp/secret.mp4',
    '/m/foreign-media',
    '../video/foreign.mp4',
  ])('[unsafe panel video source %s] -> [fail closed before outbound fetch or upload]', async (videoUrl) => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-a',
      storyboards: [{
        id: 'storyboard-a',
        createdAt: new Date(),
        panels: [{
          id: 'panel-a',
          panelIndex: 1,
          description: 'unsafe',
          imageUrl: null,
          videoUrl,
          cameraMove: null,
          shotType: null,
          multiShotGroupId: null,
        }],
      }],
      voiceLines: [],
    })
    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')

    await expect(handleEpisodePackageZipTask(makeJob('episode-a'))).rejects.toThrow(
      'EPISODE_PACKAGE_SOURCE_INVALID',
    )
    expect(safeFetchMock.fetchPublicResource).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stitchStatus: 'completed' }) }),
    )
  })

  it('[multi-shot lookup] -> [task read includes exact project and episode scope]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-a',
      storyboards: [{
        id: 'storyboard-a',
        createdAt: new Date(),
        panels: [{
          id: 'panel-a',
          panelIndex: 1,
          description: 'group',
          imageUrl: null,
          videoUrl: null,
          cameraMove: null,
          shotType: null,
          multiShotGroupId: 'group-a',
        }],
      }],
      voiceLines: [],
    })
    prismaMock.task.findMany.mockResolvedValue([{
      payload: { panelIds: ['panel-a'] },
      result: { multiShotVideoUrl: 'video/group-a.mp4' },
    }] as never)
    safeFetchMock.fetchPublicResource.mockResolvedValue(makeFetchResponse('GROUP-VIDEO', 'video/mp4'))

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    await handleEpisodePackageZipTask(await makePreparedJob('episode-a'))

    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        projectId: 'project-a',
        episodeId: 'episode-a',
        type: 'video_multi_shot',
        status: 'completed',
      },
    }))
    expect(safeFetchMock.fetchPublicResource).toHaveBeenCalledTimes(1)
  })

  it('[two image-only panels reuse panelIndex across storyboards] -> [both images package under unique global sequence paths]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-images',
      name: 'Image episode',
      stitchStatus: null,
      stitchedVideoUrl: null,
      stitchedAt: null,
      storyboards: [
        {
          id: 'storyboard-a',
          createdAt: new Date('2026-08-10T00:00:00.000Z'),
          panels: [{
            id: 'panel-a', panelIndex: 1, description: 'first still',
            imageUrl: 'images/first.png', videoUrl: null, lipSyncVideoUrl: null,
            cameraMove: null, shotType: null, multiShotGroupId: null,
          }],
        },
        {
          id: 'storyboard-b',
          createdAt: new Date('2026-08-10T00:01:00.000Z'),
          panels: [{
            id: 'panel-b', panelIndex: 1, description: 'second still',
            imageUrl: 'images/second.webp', videoUrl: null, lipSyncVideoUrl: null,
            cameraMove: null, shotType: null, multiShotGroupId: null,
          }],
        },
      ],
      voiceLines: [],
    })
    safeFetchMock.fetchPublicResource.mockImplementation((url: string) => {
      if (url.includes('first.png')) return Promise.resolve(makeFetchResponse('IMAGE-1', 'image/png'))
      if (url.includes('second.webp')) return Promise.resolve(makeFetchResponse('IMAGE-2', 'image/webp'))
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    const result = await handleEpisodePackageZipTask(await makePreparedJob('episode-images'))

    expect(result.panelCount).toBe(0)
    const [zipBuffer] = cosMock.uploadToCOS.mock.calls[0]
    const zip = await JSZip.loadAsync(zipBuffer)
    const imageNames = Object.keys(zip.files).filter((name) => name.startsWith('images/')).sort()
    expect(imageNames).toEqual([
      expect.stringMatching(/^images\/001-.*\.png$/),
      expect.stringMatching(/^images\/002-.*\.webp$/),
    ])
    await expect(zip.file(imageNames[0])!.async('string')).resolves.toBe('IMAGE-1')
    await expect(zip.file(imageNames[1])!.async('string')).resolves.toBe('IMAGE-2')
  })

  it('[voice-only episode] -> [can package canonical audio and record missing line exclusion]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-voices',
      name: 'Voice only',
      stitchStatus: null,
      stitchedVideoUrl: null,
      stitchedAt: null,
      storyboards: [],
      voiceLines: [
        {
          id: 'line-a', episodeId: 'episode-voices', lineIndex: 1,
          speaker: 'Ann', content: 'Generated',
          audioUrl: 'voice/project-a/episode-voices/line-a.wav',
          audioMediaId: null, audioMedia: null,
          matchedPanelId: null, matchedPanelIndex: null,
        },
        {
          id: 'line-b', episodeId: 'episode-voices', lineIndex: 2,
          speaker: 'Bob', content: 'Missing',
          audioUrl: null, audioMediaId: null, audioMedia: null,
          matchedPanelId: null, matchedPanelIndex: null,
        },
        {
          id: 'line-c', episodeId: 'episode-voices', lineIndex: 3,
          speaker: 'Cara', content: 'Generated MP3',
          audioUrl: '/m/audio-public-c',
          audioMediaId: 'audio-media-c',
          audioMedia: {
            id: 'audio-media-c', publicId: 'audio-public-c',
            storageKey: 'voice/project-a/episode-voices/line-c.mp3',
            sha256: 'audio-sha-c', mimeType: 'audio/mpeg', sizeBytes: BigInt(9),
          },
          matchedPanelId: null, matchedPanelIndex: null,
        },
      ],
    })
    safeFetchMock.fetchPublicResource.mockImplementation((url: string) => {
      if (url.includes('line-a.wav')) return Promise.resolve(makeFetchResponse('VOICE-WAV', 'audio/wav'))
      if (url.includes('line-c.mp3')) return Promise.resolve(makeFetchResponse('VOICE-MP3', 'audio/mpeg'))
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    const result = await handleEpisodePackageZipTask(await makePreparedJob('episode-voices'))

    expect(result.panelCount).toBe(0)
    expect(result.manifest).toMatchObject({ voiceAudioCount: 2, excludedVoiceLineCount: 1 })
    const [zipBuffer] = cosMock.uploadToCOS.mock.calls[0]
    const zip = await JSZip.loadAsync(zipBuffer)
    const voicePaths = Object.keys(zip.files).filter((name) => name.startsWith('voices/')).sort()
    expect(voicePaths).toEqual([
      expect.stringMatching(/^voices\/001-.*\.wav$/),
      expect.stringMatching(/^voices\/002-.*\.mp3$/),
    ])
    await expect(zip.file(voicePaths[0])!.async('string')).resolves.toBe('VOICE-WAV')
    await expect(zip.file(voicePaths[1])!.async('string')).resolves.toBe('VOICE-MP3')
    const script = await zip.file('script.txt')!.async('string')
    expect(script).toContain('Unassigned dialogue')
    expect(script).toContain('Ann: Generated')
    expect(script).toContain('Cara: Generated MP3')
  })

  it('[voice audio fetch fails] -> [whole package fails with zero upload]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-voice-fail',
      name: 'Voice fail',
      stitchStatus: null,
      stitchedVideoUrl: null,
      stitchedAt: null,
      storyboards: [],
      voiceLines: [{
        id: 'line-a', episodeId: 'episode-voice-fail', lineIndex: 1,
        speaker: 'Ann', content: 'Generated',
        audioUrl: 'voice/project-a/episode-voice-fail/line-a.wav',
        audioMediaId: null, audioMedia: null,
        matchedPanelId: null, matchedPanelIndex: null,
      }],
    })
    safeFetchMock.fetchPublicResource.mockResolvedValue(new Response(null, {
      status: 503,
      headers: { 'content-type': 'audio/wav' },
    }))

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    await expect(
      handleEpisodePackageZipTask(await makePreparedJob('episode-voice-fail')),
    ).rejects.toThrow('VOICE_AUDIO_UPSTREAM_STATUS_503')
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalled()
  })

  it('[snapshot changed after submit] -> [worker rejects source drift before fetch or status write]', async () => {
    const base = {
      id: 'episode-drift', name: 'Drift', stitchStatus: null,
      stitchedVideoUrl: null, stitchedAt: null,
      storyboards: [{
        id: 'storyboard-a', createdAt: new Date(),
        panels: [{
          id: 'panel-a', panelIndex: 1, description: 'before',
          imageUrl: 'images/before.jpg', videoUrl: null, lipSyncVideoUrl: null,
          cameraMove: null, shotType: null, multiShotGroupId: null,
        }],
      }],
      voiceLines: [],
    }
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(base)
    const job = await makePreparedJob('episode-drift')
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      ...base,
      storyboards: [{
        ...base.storyboards[0],
        panels: [{ ...base.storyboards[0].panels[0], imageUrl: 'images/after.jpg' }],
      }],
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    await expect(handleEpisodePackageZipTask(job)).rejects.toThrow(
      'EPISODE_PACKAGE_SOURCE_FINGERPRINT_MISMATCH',
    )
    expect(safeFetchMock.fetchPublicResource).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalled()
  })

  it('[missing submitted source fingerprint] -> [worker rejects before DB or outbound side effects]', async () => {
    const job = makeJob('episode-a', { payload: { episodeId: 'episode-a' } })
    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')

    await expect(handleEpisodePackageZipTask(job)).rejects.toThrow(
      'EPISODE_PACKAGE_SOURCE_FINGERPRINT_MISMATCH',
    )
    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(safeFetchMock.fetchPublicResource).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('[cancel before upload] -> [durable marker CAS observes cancellation and performs zero upload or delete]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-cancel-before', name: 'Cancel before', stitchStatus: 'completed',
      stitchedVideoUrl: 'images/previous-package.zip', stitchedAt: new Date('2026-08-01T00:00:00Z'),
      storyboards: [{
        id: 'storyboard-a', createdAt: new Date(),
        panels: [{
          id: 'panel-a', panelIndex: 1, description: 'still',
          imageUrl: 'images/still.png', videoUrl: null, lipSyncVideoUrl: null,
          cameraMove: null, shotType: null, multiShotGroupId: null,
        }],
      }],
      voiceLines: [],
    })
    safeFetchMock.fetchPublicResource.mockResolvedValue(makeFetchResponse('IMAGE', 'image/png'))
    utilsMock.assertTaskActive.mockImplementation(async (_job: unknown, stage: string) => {
      if (stage === 'upload_zip') throw new TaskTerminatedError('task-test', 'cancel won')
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    await expect(
      handleEpisodePackageZipTask(await makePreparedJob('episode-cancel-before')),
    ).rejects.toBeInstanceOf(TaskTerminatedError)

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'task-test', projectId: 'project-a', episodeId: 'episode-cancel-before',
      }),
      data: expect.objectContaining({ payload: expect.anything() }),
    }))
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[upload response is lost but exact atomic object exists with expected bytes] -> [reconciles without second upload]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-upload-loss', name: 'Upload loss', stitchStatus: null,
      stitchedVideoUrl: null, stitchedAt: null,
      storyboards: [{
        id: 'storyboard-a', createdAt: new Date(),
        panels: [{
          id: 'panel-a', panelIndex: 1, description: 'still',
          imageUrl: 'images/still.png', videoUrl: null, lipSyncVideoUrl: null,
          cameraMove: null, shotType: null, multiShotGroupId: null,
        }],
      }],
      voiceLines: [],
    })
    safeFetchMock.fetchPublicResource.mockResolvedValue(makeFetchResponse('IMAGE', 'image/png'))
    cosMock.uploadToCOS.mockRejectedValueOnce(new Error('transport response lost'))
    cosMock.getStorageObjectSize.mockImplementation(async () => {
      const uploadedBuffer = cosMock.uploadToCOS.mock.calls[0]?.[0]
      return Buffer.isBuffer(uploadedBuffer) ? uploadedBuffer.byteLength : null
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    const result = await handleEpisodePackageZipTask(await makePreparedJob('episode-upload-loss'))

    expect(result.outputUrl).toBe('images/episode-pack-episode-upload-loss-task-test.zip')
    expect(cosMock.uploadToCOS).toHaveBeenCalledTimes(1)
    expect(cosMock.uploadToCOS).toHaveBeenCalledWith(
      expect.any(Buffer),
      'images/episode-pack-episode-upload-loss-task-test.zip',
      1,
    )
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
  })

  it('[durable prepared marker + exact object survive retry] -> [zero source fetch, archive, and upload]', async () => {
    const markerResult = {
      episodeId: 'episode-retry',
      outputUrl: 'images/episode-pack-episode-retry-task-test.zip',
      panelCount: 1,
      sourceFingerprint: 'f'.repeat(64),
      manifest: {
        version: 1,
        fileCount: 3,
        selectedVideoCount: 1,
        multiShotVideoCount: 0,
        imageCount: 0,
        voiceAudioCount: 0,
        excludedVoiceLineCount: 0,
        scriptIncluded: true,
        checksumAlgorithm: 'sha256',
      },
    }
    prismaMock.task.findFirst.mockResolvedValue({
      status: 'processing',
      result: null,
      finishedAt: null,
      payload: {
        episodePackagePublication: {
          kind: 'episode_package_publication_v1',
          state: 'prepared',
          taskId: 'task-test',
          projectId: 'project-a',
          episodeId: 'episode-retry',
          outputUrl: markerResult.outputUrl,
          sourceFingerprint: 'f'.repeat(64),
          archiveSha256: 'a'.repeat(64),
          archiveBytes: 321,
          result: markerResult,
        },
      },
    })
    cosMock.getStorageObjectSize.mockResolvedValue(321)

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    await expect(handleEpisodePackageZipTask(makeJob('episode-retry'))).resolves.toEqual(markerResult)

    expect(prismaMock.novelPromotionEpisode.findFirst).not.toHaveBeenCalled()
    expect(safeFetchMock.fetchPublicResource).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalled()
  })

  it('[cancel after upload before completion claim] -> [strictly deletes exact task key and preserves prior episode pointer]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      id: 'episode-cancel-after', name: 'Cancel after', stitchStatus: 'completed',
      stitchedVideoUrl: 'images/previous-package.zip', stitchedAt: new Date('2026-08-01T00:00:00Z'),
      storyboards: [{
        id: 'storyboard-a', createdAt: new Date(),
        panels: [{
          id: 'panel-a', panelIndex: 1, description: 'still',
          imageUrl: 'images/still.png', videoUrl: null, lipSyncVideoUrl: null,
          cameraMove: null, shotType: null, multiShotGroupId: null,
        }],
      }],
      voiceLines: [],
    })
    safeFetchMock.fetchPublicResource.mockResolvedValue(makeFetchResponse('IMAGE', 'image/png'))
    prismaMock.task.findFirst
      .mockResolvedValueOnce({ status: 'processing', payload: {}, result: null, finishedAt: null })
      .mockResolvedValueOnce({ status: 'processing', payload: {}, result: null, finishedAt: null })
      .mockImplementationOnce(async () => ({
        status: 'failed',
        errorCode: 'TASK_CANCELLED',
        payload: prismaMock.task.updateMany.mock.calls.at(-1)?.[0]?.data?.payload ?? {},
        result: null,
        finishedAt: new Date(),
      }))
    utilsMock.assertTaskActive.mockImplementation(async (_job: unknown, stage: string) => {
      if (stage === 'persist_result') throw new TaskTerminatedError('task-test', 'cancel won')
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    await expect(
      handleEpisodePackageZipTask(await makePreparedJob('episode-cancel-after')),
    ).rejects.toBeInstanceOf(TaskTerminatedError)

    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith(
      'images/episode-pack-episode-cancel-after-task-test.zip',
      { throwOnError: true },
    )
    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stitchStatus: 'failed' }) }),
    )
    expect(prismaMock.novelPromotionEpisode.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stitchedVideoUrl: expect.any(String) }) }),
    )
  })
})
