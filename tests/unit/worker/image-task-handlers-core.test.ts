import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => {}),
  getProjectModels: vi.fn(async () => ({ editModel: 'edit-model' })),
  getUserModels: vi.fn(async () => ({ editModel: 'edit-model', analysisModel: 'analysis-model' })),
  // Bug-6: typed vi.fn so mock.calls[0]?.[1] resolves to the second-arg type
  resolveImageSourceFromGeneration: vi.fn<(...args: [unknown, Record<string, unknown>]) => Promise<string>>(
    async () => 'generated-image-source',
  ),
  stripLabelBar: vi.fn(async () => 'required-reference-image'),
  toSignedUrlIfCos: vi.fn(() => 'https://signed/current-image.png'),
  uploadImageSourceToCos: vi.fn(async () => 'cos/new-image.png'),
  withLabelBar: vi.fn(async (source: unknown) => source),
}))

const outboundImageMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async () => ['normalized-reference-image']),
  normalizeToBase64ForGeneration: vi.fn(async () => 'base64-required-reference'),
}))

const sharedMock = vi.hoisted(() => ({
  resolveNovelData: vi.fn(async () => ({ videoRatio: '16:9' })),
}))

const prismaMock = vi.hoisted(() => ({
  characterAppearance: {
    findUnique: vi.fn(),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  locationImage: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  novelPromotionPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
}))

// Q-009 A: modify handler 也要 inject styleProfile（chokepoint 内做 — Bug-4）。
const styleProfileLoaderMock = vi.hoisted(() => ({
  loadStyleProfile: vi.fn(async () => null as null | {
    positivePrompt: string | null
    negativePrompt: string | null
    referenceImageUrls: string[]
  }),
  loadStyleProfileByProjectId: vi.fn(async () => null as null | {
    positivePrompt: string | null
    negativePrompt: string | null
    referenceImageUrls: string[]
  }),
}))

vi.mock('@/lib/style-profile/loader', () => styleProfileLoaderMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/outbound-image', () => outboundImageMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    resolveNovelData: sharedMock.resolveNovelData,
  }
})

import { handleModifyAssetImageTask } from '@/lib/workers/handlers/image-task-handlers-core'

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: TASK_TYPE.MODIFY_ASSET_IMAGE,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'target-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

function readUpdateData(arg: unknown): Record<string, unknown> {
  if (!arg || typeof arg !== 'object') return {}
  const data = (arg as { data?: unknown }).data
  if (!data || typeof data !== 'object') return {}
  return data as Record<string, unknown>
}

describe('worker image-task-handlers-core', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails fast when modify task payload is incomplete', async () => {
    const job = buildJob({})
    await expect(handleModifyAssetImageTask(job)).rejects.toThrow('modify task missing type/modifyPrompt')
  })

  it('updates location image with expected generation options and persistence payload', async () => {
    prismaMock.locationImage.findUnique.mockResolvedValue({
      id: 'location-image-1',
      locationId: 'location-1',
      imageUrl: 'cos/location-old.png',
      location: { name: 'Old Town' },
    })

    const job = buildJob({
      type: 'location',
      locationImageId: 'location-image-1',
      modifyPrompt: 'add heavy rain',
      extraImageUrls: [' https://example.com/location-ref.png '],
      generationOptions: { resolution: '1536x1024' },
    })

    const result = await handleModifyAssetImageTask(job)
    expect(result).toEqual({
      type: 'location',
      locationImageId: 'location-image-1',
      imageUrl: 'cos/new-image.png',
    })

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          aspectRatio: '1:1',
          resolution: '1536x1024',
          referenceImages: ['required-reference-image', 'normalized-reference-image'],
        }),
      }),
    )

    const updateArg = prismaMock.locationImage.update.mock.calls.at(-1)?.[0]
    const updateData = readUpdateData(updateArg)
    expect(updateData.previousImageUrl).toBe('cos/location-old.png')
    expect(updateData.imageUrl).toBe('cos/new-image.png')
  })

  it('updates storyboard panel image and keeps candidateImages reset', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'cos/panel-old.png',
      previousImageUrl: null,
    })

    const job = buildJob({
      type: 'storyboard',
      panelId: 'panel-1',
      modifyPrompt: 'cinematic backlight',
      selectedAssets: [{ imageUrl: 'https://example.com/asset-ref.png' }],
      extraImageUrls: ['https://example.com/extra-ref.png'],
      generationOptions: { resolution: '2048x1152' },
    })

    const result = await handleModifyAssetImageTask(job)
    expect(result).toEqual({
      type: 'storyboard',
      panelId: 'panel-1',
      imageUrl: 'cos/new-image.png',
    })

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          aspectRatio: '16:9',
          resolution: '2048x1152',
          referenceImages: [
            'base64-required-reference',
            'normalized-reference-image',
          ],
        }),
      }),
    )

    const updateArg = prismaMock.novelPromotionPanel.update.mock.calls.at(-1)?.[0]
    const updateData = readUpdateData(updateArg)
    expect(updateData.previousImageUrl).toBe('cos/panel-old.png')
    expect(updateData.imageUrl).toBe('cos/new-image.png')
    expect(updateData.candidateImages).toBeNull()
  })

  // Q-009 A: modify handler 必须透传 styleProfile 给 chokepoint，让 modify 后的图也保持 style lock。
  it('Q-009 A: project 有 styleProfile -> resolveImageSourceFromGeneration 收到原 styleProfile 透传', async () => {
    const styleProfileFixture = {
      positivePrompt: 'MODIFY_STYLE_POS',
      negativePrompt: 'MODIFY_STYLE_NEG',
      referenceImageUrls: ['https://style/modify-ref.png'],
    }
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(styleProfileFixture)

    prismaMock.locationImage.findUnique.mockResolvedValue({
      id: 'location-image-1',
      locationId: 'location-1',
      imageUrl: 'cos/location-old.png',
      location: { name: 'Old Town' },
    })

    const job = buildJob({
      type: 'location',
      locationImageId: 'location-image-1',
      modifyPrompt: 'add heavy rain',
      generationOptions: { resolution: '1536x1024' },
    })
    await handleModifyAssetImageTask(job)

    const call = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1] as {
      prompt: string
      styleProfile?: typeof styleProfileFixture | null
      options?: { negativePrompt?: string | null }
    }
    expect(call.styleProfile).toEqual(styleProfileFixture)
    // handler 不再自己 prepend
    expect(call.prompt).not.toContain('MODIFY_STYLE_POS')
    // negativePrompt 由 chokepoint 注入，handler 不应自己塞
    const neg = call.options?.negativePrompt ?? null
    expect(neg).toBeNull()
  })

  it('Q-009 A: project styleProfile 为 null -> resolveImageSourceFromGeneration 收到 styleProfile = null', async () => {
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(null)

    prismaMock.locationImage.findUnique.mockResolvedValue({
      id: 'location-image-1',
      locationId: 'location-1',
      imageUrl: 'cos/location-old.png',
      location: { name: 'Old Town' },
    })

    const job = buildJob({
      type: 'location',
      locationImageId: 'location-image-1',
      modifyPrompt: 'add heavy rain',
      generationOptions: { resolution: '1536x1024' },
    })
    await handleModifyAssetImageTask(job)

    const call = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1] as {
      prompt: string
      styleProfile?: unknown
    }
    expect(call.styleProfile).toBeNull()
    expect(call.prompt).not.toMatch(/MODIFY_STYLE_POS|MODIFY_STYLE_NEG/)
  })
})
