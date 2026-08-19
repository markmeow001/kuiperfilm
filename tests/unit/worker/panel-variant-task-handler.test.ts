import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    update: vi.fn(async (_args?: unknown) => ({})),
  },
}))

const panelFixtures = vi.hoisted(() => ({
  newPanel: {
    id: 'panel-new',
    storyboardId: 'storyboard-1',
    imageUrl: null,
    location: 'Old Town',
    characters: JSON.stringify([{ name: 'Hero', appearance: 'A' }]),
    description: 'Hero variant',
    videoPrompt: 'Hero turns',
    srtSegment: null,
    shotType: 'close-up',
    cameraMove: 'static',
    storyboard: { id: 'storyboard-1', episodeId: 'episode-1' },
  },
  sourcePanel: {
    id: 'panel-source',
    storyboardId: 'storyboard-1',
    imageUrl: 'cos/panel-source.png',
    description: 'source description',
    videoPrompt: 'source movement',
    srtSegment: null,
    shotType: 'medium',
    cameraMove: 'pan',
    location: 'Old Town',
    characters: JSON.stringify([{ name: 'Hero' }]),
    storyboard: { id: 'storyboard-1', episodeId: 'episode-1' },
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
    characters: [{
      id: 'character-1',
      name: 'Hero',
      introduction: '主角',
      appearances: [
        { id: 'appearance-a', appearanceIndex: 0, changeReason: 'A', imageUrl: 'characters/a.png' },
        { id: 'appearance-b', appearanceIndex: 1, changeReason: 'B', imageUrl: 'characters/b.png' },
      ],
    }],
    locations: [{ name: 'Old Town' }],
  })),
}))

const canonicalProjectData = vi.hoisted(() => ({
  videoRatio: '16:9',
  characters: [{
    id: 'character-1',
    name: 'Hero',
    introduction: '主角',
    appearances: [{
      id: 'appearance-b',
      appearanceIndex: 1,
      changeReason: 'B',
      description: 'canonical B',
      descriptions: null,
      imageUrl: 'characters/b.png',
      imageUrls: JSON.stringify(['characters/b.png']),
      selectedIndex: 0,
    }],
  }],
  locations: [{ name: 'Old Town' }],
  props: [],
}))

const episodeAppearanceMock = vi.hoisted(() => ({
  canonicalizeEpisodeCharacterAppearances: vi.fn(async () => canonicalProjectData),
}))

const projectScopeMock = vi.hoisted(() => ({
  requireNovelPromotionPanelInProject: vi.fn(),
  updateNovelPromotionPanelInProject: vi.fn(),
}))

const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn((_args: { variables: Record<string, string>; [key: string]: unknown }) => 'panel-variant-prompt'),
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
vi.mock('@/lib/novel-promotion/episode-appearance', () => episodeAppearanceMock)
vi.mock('@/lib/novel-promotion/project-scope', () => projectScopeMock)
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
  buildPrompt: promptMock.buildPrompt,
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
      if (args.where.id === 'panel-new') return panelFixtures.newPanel
      if (args.where.id === 'panel-source') return panelFixtures.sourcePanel
      return null
    })
    projectScopeMock.requireNovelPromotionPanelInProject.mockImplementation(
      async (_projectId: string, panelId: string) => {
        if (panelId === 'panel-new') return panelFixtures.newPanel
        if (panelId === 'panel-source') return panelFixtures.sourcePanel
        throw new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')
      },
    )
    projectScopeMock.updateNovelPromotionPanelInProject.mockImplementation(
      async (_projectId: string, panelId: string, data: Record<string, unknown>) => {
        await prismaMock.novelPromotionPanel.update({ where: { id: panelId }, data })
      },
    )
    episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances.mockResolvedValue(canonicalProjectData)
  })

  it('missing source/new panel ids -> explicit error', async () => {
    const job = buildJob({})
    await expect(handlePanelVariantTask(job)).rejects.toThrow('panel_variant missing newPanelId/sourcePanelId')
  })

  it('payload new panel cannot override the durable job target', async () => {
    const job = buildJob({ newPanelId: 'panel-new', sourcePanelId: 'panel-source' })
    job.data.targetId = 'panel-forged'

    await expect(handlePanelVariantTask(job)).rejects.toThrow('PANEL_VARIANT_TARGET_MISMATCH')

    expect(projectScopeMock.requireNovelPromotionPanelInProject).not.toHaveBeenCalled()
    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
  })

  it('foreign panel fails before canonical resolution, provider, or persistence', async () => {
    projectScopeMock.requireNovelPromotionPanelInProject.mockRejectedValueOnce(
      new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'),
    )

    await expect(handlePanelVariantTask(buildJob({
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
    }))).rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')

    expect(episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances).not.toHaveBeenCalled()
    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
    expect(utilsMock.uploadImageSourceToCos).not.toHaveBeenCalled()
    expect(projectScopeMock.updateNovelPromotionPanelInProject).not.toHaveBeenCalled()
  })

  it('source and target panels must belong to the same episode', async () => {
    projectScopeMock.requireNovelPromotionPanelInProject
      .mockResolvedValueOnce(panelFixtures.newPanel)
      .mockResolvedValueOnce({
        ...panelFixtures.sourcePanel,
        storyboard: { id: 'storyboard-2', episodeId: 'episode-2' },
      })

    await expect(handlePanelVariantTask(buildJob({
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
    }))).rejects.toThrow('PANEL_VARIANT_EPISODE_MISMATCH')

    expect(episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances).not.toHaveBeenCalled()
    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
  })

  it('binding B beats panel hint A in both prompt and reference collection', async () => {
    await handlePanelVariantTask(buildJob({
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
      variant: { title: 'B version' },
    }))

    expect(episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      projectData: expect.any(Object),
      panels: [panelFixtures.newPanel, panelFixtures.sourcePanel],
    })
    expect(sharedMock.collectPanelReferenceImages).toHaveBeenCalledWith(
      canonicalProjectData,
      panelFixtures.newPanel,
    )
    expect(promptMock.buildPrompt).toHaveBeenCalledWith(expect.objectContaining({
      variables: expect.objectContaining({
        characters_info: expect.stringContaining('Hero（B）'),
      }),
    }))
    const promptVariables = promptMock.buildPrompt.mock.calls[0]?.[0]?.variables as Record<string, string>
    expect(promptVariables.characters_info).not.toContain('Hero（A）')
  })

  it.each([
    'EPISODE_APPEARANCE_BINDING_MISSING',
    'EPISODE_APPEARANCE_BINDING_STALE',
  ])('%s fails before provider, upload, or persistence', async (errorCode) => {
    episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances.mockRejectedValueOnce(
      new Error(errorCode),
    )

    await expect(handlePanelVariantTask(buildJob({
      newPanelId: 'panel-new',
      sourcePanelId: 'panel-source',
    }))).rejects.toThrow(errorCode)

    expect(utilsMock.getProjectModels).not.toHaveBeenCalled()
    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
    expect(utilsMock.uploadImageSourceToCos).not.toHaveBeenCalled()
    expect(projectScopeMock.updateNovelPromotionPanelInProject).not.toHaveBeenCalled()
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

    expect(projectScopeMock.updateNovelPromotionPanelInProject).toHaveBeenCalledWith(
      'project-1',
      'panel-new',
      { imageUrl: 'cos/panel-variant-new.png' },
    )

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
