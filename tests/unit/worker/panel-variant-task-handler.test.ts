import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ storyboardModel: 'storyboard-model-1', artStyle: 'cinematic' })),
  // Bug-6: typed vi.fn so mock.calls[0]?.[1] resolves to second-arg type
  resolveImageSourceFromGeneration: vi.fn<(...args: [unknown, Record<string, unknown>]) => Promise<string>>(
    async () => 'generated-variant-source',
  ),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => (url ? `https://signed.example/${url}` : null)),
  uploadImageSourceToCos: vi.fn(async () => 'cos/panel-variant-new.png'),
}))

const sharedMock = vi.hoisted(() => ({
  collectPanelReferenceImages: vi.fn(async () => ['https://signed.example/ref-character.png']),
  resolveNovelData: vi.fn(async () => ({
    videoRatio: '16:9',
    characters: [{ name: 'Hero', introduction: '主角' }],
    locations: [{ name: 'Old Town' }],
  })),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async (refs: string[]) => refs.map((item) => `normalized:${item}`)),
}))

// Q-009 A: variant handler 也要 inject styleProfile（chokepoint 内做）。
const styleProfileLoaderMock = vi.hoisted(() => ({
  loadStyleProfile: vi.fn(async () => null as null | {
    positivePrompt: string | null
    negativePrompt: string | null
    referenceImageUrls: string[]
  }),
}))

vi.mock('@/lib/style-profile/loader', () => styleProfileLoaderMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    collectPanelReferenceImages: sharedMock.collectPanelReferenceImages,
    resolveNovelData: sharedMock.resolveNovelData,
  }
})
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_AGENT_SHOT_VARIANT_GENERATE: 'np_agent_shot_variant_generate' },
  buildPrompt: vi.fn(() => 'panel-variant-prompt'),
}))

import { handlePanelVariantTask } from '@/lib/workers/handlers/panel-variant-task-handler'

function buildJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-panel-variant-1',
      type: TASK_TYPE.PANEL_VARIANT,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-new',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker panel-variant-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.novelPromotionPanel.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      if (args.where.id === 'panel-new') {
        return {
          id: 'panel-new',
          storyboardId: 'storyboard-1',
          imageUrl: null,
          location: 'Old Town',
          characters: JSON.stringify([{ name: 'Hero', appearance: 'default' }]),
        }
      }
      if (args.where.id === 'panel-source') {
        return {
          id: 'panel-source',
          storyboardId: 'storyboard-1',
          imageUrl: 'cos/panel-source.png',
          description: 'source description',
          shotType: 'medium',
          cameraMove: 'pan',
          location: 'Old Town',
          characters: JSON.stringify([{ name: 'Hero' }]),
        }
      }
      return null
    })
  })

  it('missing source/new panel ids -> explicit error', async () => {
    const job = buildJob({})
    await expect(handlePanelVariantTask(job)).rejects.toThrow('panel_variant missing newPanelId/sourcePanelId')
  })

  it('success path -> includes source panel image in referenceImages and persists new image', async () => {
    const payload = {
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
      variant: {
        title: '雨夜版本',
        description: '加强雨夜氛围',
      },
    }

    const result = await handlePanelVariantTask(buildJob(payload))

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'storyboard-model-1',
        prompt: 'panel-variant-prompt',
        options: expect.objectContaining({
          aspectRatio: '16:9',
          referenceImages: [
            'normalized:https://signed.example/cos/panel-source.png',
            'normalized:https://signed.example/ref-character.png',
          ],
        }),
      }),
    )

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-new' },
      data: { imageUrl: 'cos/panel-variant-new.png' },
    })

    expect(result).toEqual({
      panelId: 'panel-new',
      storyboardId: 'storyboard-1',
      imageUrl: 'cos/panel-variant-new.png',
    })
  })

  // Q-009 A 範圍擴大：variant handler 也要透传 styleProfile 给 chokepoint
  // (resolveImageSourceFromGeneration 内做 prepend + capability filter — Bug-4 chokepoint)。
  it('Q-009 A: project 有 styleProfile -> resolveImageSourceFromGeneration 收到原 styleProfile 透传', async () => {
    const styleProfileFixture = {
      positivePrompt: 'VARIANT_STYLE_POS',
      negativePrompt: 'VARIANT_STYLE_NEG',
      referenceImageUrls: ['https://style/variant-ref.png'],
    }
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(styleProfileFixture)

    const payload = {
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
      variant: { title: 't', description: 'd' },
    }
    await handlePanelVariantTask(buildJob(payload))

    const call = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1] as {
      prompt: string
      styleProfile?: typeof styleProfileFixture | null
      options?: { negativePrompt?: string | null; referenceImages?: string[] }
    }
    expect(call.styleProfile).toEqual(styleProfileFixture)
    // handler 不再自己 prepend → prompt 是 raw，不含 marker
    expect(call.prompt).not.toContain('VARIANT_STYLE_POS')
    // negativePrompt 由 chokepoint 注入，handler 不应自己塞
    const neg = call.options?.negativePrompt ?? null
    expect(neg).toBeNull()
  })

  it('Q-009 A: project styleProfile 为 null -> resolveImageSourceFromGeneration 收到 styleProfile = null', async () => {
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(null)

    const payload = {
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
      variant: { title: 't', description: 'd' },
    }
    await handlePanelVariantTask(buildJob(payload))

    const call = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1] as {
      prompt: string
      styleProfile?: unknown
      options?: { negativePrompt?: string | null }
    }
    expect(call.styleProfile).toBeNull()
    expect(call.prompt).not.toMatch(/VARIANT_STYLE_POS|VARIANT_STYLE_NEG/)
    const neg = call.options?.negativePrompt ?? null
    expect(neg).toBeNull()
  })
})
