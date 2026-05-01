/**
 * Unit test for handleEpisodePackageZipTask — the worker that
 * replaces ffmpeg episode stitching with archiver-based zip packaging.
 *
 * Verifies:
 *   - panel videos + images are pulled and added to the zip
 *   - script.txt is generated from voiceLines + camera notes
 *   - README.txt is included
 *   - episode.stitchedVideoUrl is set on success
 *   - episode.stitchStatus moves rendering → completed
 *   - failure path sets stitchStatus = 'failed' and rethrows
 */
import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import type { TaskJobData } from '@/lib/task/types'

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  toSignedUrlIfCos: vi.fn((url: string | null) => (url ? `https://signed.example/${url}` : null)),
}))

const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(async (_buffer: Buffer, key: string) => key),
  generateUniqueKey: vi.fn((prefix: string, ext: string) => `images/${prefix}-fixed.${ext}`),
}))

const loggingMock = vi.hoisted(() => ({
  logWarn: vi.fn(),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findUnique: vi.fn(),
    update: vi.fn(async () => undefined),
  },
}))

vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: reportTaskProgressMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/logging/core', () => loggingMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function makeFetchResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response
}

function makeJob(episodeId: string): Job<TaskJobData> {
  return {
    id: 'job-test',
    queueName: 'kuiper-video',
    data: {
      type: 'episode_stitch_mp4',
      payload: { episodeId },
    },
  } as unknown as Job<TaskJobData>
}

beforeEach(() => {
  vi.clearAllMocks()
  cosMock.uploadToCOS.mockImplementation(async (_buffer: Buffer, key: string) => key)
  cosMock.generateUniqueKey.mockImplementation((prefix: string, ext: string) => `images/${prefix}-fixed.${ext}`)
  utilsMock.toSignedUrlIfCos.mockImplementation((url: string | null) => (url ? `https://signed.example/${url}` : null))
})

describe('handleEpisodePackageZipTask', () => {
  it('packages videos + images + script + readme into a zip, persists URL', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
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
              videoUrl: 'video/panel-1.mp4',
              cameraMove: 'pan right',
              shotType: 'wide',
            },
            {
              id: 'panel-2',
              panelIndex: 2,
              description: 'Closeup',
              imageUrl: null,
              videoUrl: 'video/panel-2.mp4',
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
              cameraMove: null,
              shotType: null,
            },
          ],
        },
      ],
      voiceLines: [
        {
          lineIndex: 1,
          speaker: '小明',
          content: 'Hello world',
          matchedPanelId: 'panel-1',
          matchedPanelIndex: 1,
        },
      ],
    })

    fetchMock.mockImplementation((url: string) => {
      if (url.includes('panel-1.mp4')) return Promise.resolve(makeFetchResponse('VIDEO-1'))
      if (url.includes('panel-2.mp4')) return Promise.resolve(makeFetchResponse('VIDEO-2'))
      if (url.includes('panel-1.jpg')) return Promise.resolve(makeFetchResponse('IMAGE-1'))
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    const result = await handleEpisodePackageZipTask(makeJob('ep-1'))

    expect(result.episodeId).toBe('ep-1')
    expect(result.panelCount).toBe(2)
    expect(result.outputUrl).toContain('episode-pack-ep-1')
    expect(result.outputUrl).toMatch(/\.zip$/)

    const calls = cosMock.uploadToCOS.mock.calls
    expect(calls.length).toBe(1)
    const [zipBuffer, zipKey] = calls[0]
    expect(zipKey).toMatch(/episode-pack-ep-1.+\.zip$/)

    const zip = await JSZip.loadAsync(zipBuffer)
    const names = Object.keys(zip.files).sort()
    expect(names).toContain('README.txt')
    expect(names).toContain('script.txt')
    expect(names.some((n) => n.startsWith('videos/01-'))).toBe(true)
    expect(names.some((n) => n.startsWith('videos/02-'))).toBe(true)
    expect(names.some((n) => n.startsWith('images/01-'))).toBe(true)
    // panel-2 has no image, panel-3 has no video — neither contributes an image entry
    expect(names.some((n) => n.startsWith('images/02-'))).toBe(false)
    expect(names.some((n) => n.startsWith('images/03-'))).toBe(false)

    const script = await zip.file('script.txt')!.async('string')
    expect(script).toContain('Panel 01')
    expect(script).toContain('Shot: wide')
    expect(script).toContain('Camera: pan right')
    expect(script).toContain('小明: Hello world')
    expect(script).toContain('Panel 02')

    const updateCalls = prismaMock.novelPromotionEpisode.update.mock.calls as unknown as Array<
      [{ where: { id: string }; data: { stitchStatus?: string; stitchedVideoUrl?: string } }]
    >
    expect(updateCalls.length).toBe(2)
    expect(updateCalls[0][0]).toMatchObject({
      where: { id: 'ep-1' },
      data: { stitchStatus: 'rendering' },
    })
    expect(updateCalls[1][0]).toMatchObject({
      where: { id: 'ep-1' },
      data: {
        stitchStatus: 'completed',
      },
    })
    expect(updateCalls[1][0].data.stitchedVideoUrl).toContain('episode-pack-ep-1')
  })

  it('marks episode failed when no panels have videoUrl', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'ep-empty',
      storyboards: [
        {
          createdAt: new Date(),
          panels: [
            { id: 'p1', panelIndex: 1, description: 'x', imageUrl: null, videoUrl: null, cameraMove: null, shotType: null },
          ],
        },
      ],
      voiceLines: [],
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')

    await expect(handleEpisodePackageZipTask(makeJob('ep-empty'))).rejects.toThrow(
      /no panels have videoUrl/,
    )
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('marks episode failed and rethrows when video fetch fails', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
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

    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response)

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    await expect(handleEpisodePackageZipTask(makeJob('ep-fetch-fail'))).rejects.toThrow(/HTTP 503/)

    const updateCalls = prismaMock.novelPromotionEpisode.update.mock.calls as unknown as Array<
      [{ where: { id: string }; data: { stitchStatus?: string } }]
    >
    const failedCall = updateCalls.find((call) => call[0]?.data?.stitchStatus === 'failed')
    expect(failedCall).toBeTruthy()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('continues packaging when an image fetch fails (non-fatal)', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
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

    fetchMock.mockImplementation((url: string) => {
      if (url.includes('works.mp4')) return Promise.resolve(makeFetchResponse('VIDEO'))
      if (url.includes('will-fail.jpg')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          arrayBuffer: async () => new ArrayBuffer(0),
        } as unknown as Response)
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { handleEpisodePackageZipTask } = await import('@/lib/workers/handlers/episode-package-zip')
    const result = await handleEpisodePackageZipTask(makeJob('ep-img-fail'))

    expect(result.panelCount).toBe(1)
    expect(loggingMock.logWarn).toHaveBeenCalledWith(
      'EPISODE_PACKAGE_ZIP: skipping image',
      expect.objectContaining({ panelId: 'panel-1' }),
    )

    const [zipBuffer] = cosMock.uploadToCOS.mock.calls[0]
    const zip = await JSZip.loadAsync(zipBuffer)
    const names = Object.keys(zip.files)
    expect(names.some((n) => n.startsWith('videos/01-'))).toBe(true)
    expect(names.some((n) => n.startsWith('images/'))).toBe(false)
  })
})
