import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    update: vi.fn(async (_args?: unknown) => ({})),
  },
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ storyboardModel: 'storyboard-model-1', artStyle: 'cinematic' })),
  resolveImageSourceFromGeneration: vi.fn(),
  uploadImageSourceToCos: vi.fn(),
}))

const sharedMock = vi.hoisted(() => ({
  collectPanelReferenceImages: vi.fn(async () => ['https://signed.example/ref-1.png']),
  resolveNovelData: vi.fn(async () => ({
    videoRatio: '16:9',
    characters: [],
    locations: [],
  })),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async () => ['normalized-ref-1']),
  normalizeReferenceImagesAsUrls: vi.fn((refs: string[]) => refs),
  modelRequiresUrlReferences: vi.fn(() => false),
}))

const styleProfileLoaderMock = vi.hoisted(() => ({
  loadStyleProfile: vi.fn(async () => null as null | {
    positivePrompt: string | null
    negativePrompt: string | null
    referenceImageUrls: string[]
  }),
}))

const projectScopeMock = vi.hoisted(() => ({
  requireNovelPromotionPanelInProject: vi.fn(),
  updateNovelPromotionPanelInProject: vi.fn(),
}))

const canonicalPanelProjectData = vi.hoisted(() => ({
  videoRatio: '16:9',
  characters: [{
    id: 'character-1',
    name: 'Hero',
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
  locations: [],
  props: [],
}))

const episodeAppearanceMock = vi.hoisted(() => ({
  canonicalizeEpisodeCharacterAppearances: vi.fn(async () => canonicalPanelProjectData),
}))

vi.mock('@/lib/style-profile/loader', () => styleProfileLoaderMock)
vi.mock('@/lib/novel-promotion/project-scope', () => projectScopeMock)
vi.mock('@/lib/novel-promotion/episode-appearance', () => episodeAppearanceMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    child: vi.fn(),
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
  PROMPT_IDS: { NP_SINGLE_PANEL_IMAGE: 'np_single_panel_image' },
  buildPrompt: vi.fn(() => 'panel-image-prompt'),
}))

import { handlePanelImageTask } from '@/lib/workers/handlers/panel-image-task-handler'

function buildJob(payload: Record<string, unknown>, targetId = 'panel-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-panel-image-1',
      type: TASK_TYPE.IMAGE_PANEL,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker panel-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.uploadImageSourceToCos.mockReset()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      shotType: 'close-up',
      cameraMove: 'static',
      description: 'hero close-up',
      videoPrompt: 'dramatic',
      location: 'Old Town',
      characters: JSON.stringify([{ name: 'Hero', appearance: 'default' }]),
      srtSegment: '台词片段',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
      imageUrl: null,
      storyboard: { id: 'storyboard-1', episodeId: 'episode-1' },
    })

    projectScopeMock.requireNovelPromotionPanelInProject.mockImplementation(
      async () => await prismaMock.novelPromotionPanel.findUnique(),
    )
    projectScopeMock.updateNovelPromotionPanelInProject.mockImplementation(
      async (_projectId: string, panelId: string, data: Record<string, unknown>) => {
        await prismaMock.novelPromotionPanel.update({ where: { id: panelId }, data })
      },
    )
    episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances.mockImplementation(
      async () => canonicalPanelProjectData,
    )

    utilsMock.resolveImageSourceFromGeneration
      .mockResolvedValueOnce('generated-source-1')
      .mockResolvedValueOnce('generated-source-2')

    utilsMock.uploadImageSourceToCos
      .mockResolvedValueOnce('cos/panel-candidate-1.png')
      .mockResolvedValueOnce('cos/panel-candidate-2.png')
  })

  it('missing panelId -> explicit error', async () => {
    const job = buildJob({}, '')
    await expect(handlePanelImageTask(job)).rejects.toThrow('panelId missing')
  })

  it('forged cross-project target fails before provider or persistence', async () => {
    projectScopeMock.requireNovelPromotionPanelInProject.mockRejectedValueOnce(
      new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'),
    )

    await expect(handlePanelImageTask(buildJob({ candidateCount: 1 }, 'panel-foreign')))
      .rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')

    expect(projectScopeMock.requireNovelPromotionPanelInProject)
      .toHaveBeenCalledWith('project-1', 'panel-foreign')
    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
    expect(utilsMock.uploadImageSourceToCos).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('payload panel cannot override the durable job target', async () => {
    await expect(handlePanelImageTask(buildJob({ panelId: 'panel-2', candidateCount: 1 })))
      .rejects.toThrow('PANEL_IMAGE_TARGET_MISMATCH')

    expect(projectScopeMock.requireNovelPromotionPanelInProject).not.toHaveBeenCalled()
    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
    expect(utilsMock.uploadImageSourceToCos).not.toHaveBeenCalled()
  })

  it('job episode must match the scoped panel episode', async () => {
    const job = buildJob({ candidateCount: 1 })
    job.data.episodeId = 'episode-2'

    await expect(handlePanelImageTask(job)).rejects.toThrow('PANEL_IMAGE_TARGET_EPISODE_MISMATCH')

    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
    expect(utilsMock.uploadImageSourceToCos).not.toHaveBeenCalled()
  })

  it('unresolved episode appearance fails before provider, upload, or persistence', async () => {
    episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances.mockRejectedValueOnce(
      new Error('EPISODE_APPEARANCE_BINDING_MISSING'),
    )

    await expect(handlePanelImageTask(buildJob({ candidateCount: 1 })))
      .rejects.toThrow('EPISODE_APPEARANCE_BINDING_MISSING')

    expect(episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        episodeId: 'episode-1',
        panels: [expect.objectContaining({ id: 'panel-1' })],
      }),
    )
    expect(utilsMock.getProjectModels).not.toHaveBeenCalled()
    expect(utilsMock.resolveImageSourceFromGeneration).not.toHaveBeenCalled()
    expect(utilsMock.uploadImageSourceToCos).not.toHaveBeenCalled()
    expect(projectScopeMock.updateNovelPromotionPanelInProject).not.toHaveBeenCalled()
  })

  it('reference collector receives only the canonical roster and no episode fallback argument', async () => {
    await handlePanelImageTask(buildJob({ candidateCount: 1 }))

    expect(sharedMock.collectPanelReferenceImages).toHaveBeenCalledWith(
      canonicalPanelProjectData,
      expect.objectContaining({ id: 'panel-1' }),
    )
    expect(sharedMock.collectPanelReferenceImages.mock.calls[0]).toHaveLength(2)
  })

  it('scope is rechecked atomically before panel persistence', async () => {
    projectScopeMock.updateNovelPromotionPanelInProject.mockRejectedValueOnce(
      new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'),
    )

    await expect(handlePanelImageTask(buildJob({ candidateCount: 1 })))
      .rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledTimes(1)
    expect(projectScopeMock.updateNovelPromotionPanelInProject).toHaveBeenCalledWith(
      'project-1',
      'panel-1',
      expect.any(Object),
    )
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('first generation -> persists main image and candidate list', async () => {
    const job = buildJob({ candidateCount: 2 })
    const result = await handlePanelImageTask(job)

    expect(result).toEqual({
      panelId: 'panel-1',
      candidateCount: 2,
      imageUrl: 'cos/panel-candidate-1.png',
    })

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        modelId: 'storyboard-model-1',
        prompt: 'panel-image-prompt',
        options: expect.objectContaining({
          referenceImages: ['normalized-ref-1'],
          aspectRatio: '16:9',
        }),
      }),
    )

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        imageUrl: 'cos/panel-candidate-1.png',
        candidateImages: JSON.stringify(['cos/panel-candidate-1.png', 'cos/panel-candidate-2.png']),
      },
    })
  })

  it('regeneration branch -> keeps old image in previousImageUrl and stores candidates only', async () => {
    utilsMock.resolveImageSourceFromGeneration.mockReset()
    utilsMock.uploadImageSourceToCos.mockReset()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      shotType: 'close-up',
      cameraMove: 'static',
      description: 'hero close-up',
      videoPrompt: 'dramatic',
      location: 'Old Town',
      characters: '[]',
      srtSegment: null,
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
      imageUrl: 'cos/panel-old.png',
      storyboard: { id: 'storyboard-1', episodeId: 'episode-1' },
    })

    utilsMock.resolveImageSourceFromGeneration.mockResolvedValueOnce('generated-source-regen')
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce('cos/panel-regenerated.png')

    const job = buildJob({ candidateCount: 1 })
    const result = await handlePanelImageTask(job)

    // Single-candidate regen now replaces imageUrl directly in DB so the
    // user sees the new image immediately; previous-image is still
    // stashed. The handler return keeps imageUrl: null on regen because
    // the front-end uses the candidate path for re-pick UI.
    expect(result).toEqual({
      panelId: 'panel-1',
      candidateCount: 1,
      imageUrl: null,
    })

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        previousImageUrl: 'cos/panel-old.png',
        imageUrl: 'cos/panel-regenerated.png',
        candidateImages: null,
      },
    })
  })

  // Bug-4 chokepoint approach: handler 把 raw prompt + raw styleProfile 透传给
  // resolveImageSourceFromGeneration (chokepoint)，chokepoint 內做 inject。
  // 因此 handler 测试只验证「styleProfile 透传给 chokepoint」+「prompt 不含 prepend marker」。
  it('project 有 styleProfile -> resolveImageSourceFromGeneration 收到原 styleProfile 透传 + prompt 是 raw', async () => {
    const styleProfileFixture = {
      positivePrompt: 'PANEL_STYLE_POS',
      negativePrompt: 'PANEL_STYLE_NEG',
      referenceImageUrls: ['https://style/panel-ref.png'],
    }
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(styleProfileFixture)

    const job = buildJob({ candidateCount: 1 })
    await handlePanelImageTask(job)

    const generationCall = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1] as {
      prompt: string
      options?: { referenceImages?: string[]; negativePrompt?: string | null }
      styleProfile?: typeof styleProfileFixture | null
    }
    // styleProfile 必须原封不动透传给 chokepoint
    expect(generationCall.styleProfile).toEqual(styleProfileFixture)
    // handler 不再自己 prepend — prompt 不含 PANEL_STYLE_POS marker
    expect(generationCall.prompt).not.toContain('PANEL_STYLE_POS')
    // handler 不再 inline 注入 negativePrompt — chokepoint 处理
    const neg = generationCall.options?.negativePrompt ?? null
    expect(neg).toBeNull()
    // handler 不再透传 styleProfile.referenceImageUrls 到 options.referenceImages（chokepoint 处理）
    const refs = generationCall.options?.referenceImages ?? []
    expect(refs).not.toContain('https://style/panel-ref.png')
  })

  it('project styleProfile 为 null -> resolveImageSourceFromGeneration 收到 styleProfile = null', async () => {
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(null)

    const job = buildJob({ candidateCount: 1 })
    await handlePanelImageTask(job)

    const generationCall = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1] as {
      prompt: string
      options?: { negativePrompt?: string | null }
      styleProfile?: unknown
    }
    expect(generationCall.styleProfile).toBeNull()
    expect(generationCall.prompt).not.toMatch(/PANEL_STYLE_POS|PANEL_STYLE_NEG/)
    const neg = generationCall.options?.negativePrompt ?? null
    expect(neg).toBeNull()
  })

  // Q-006 A: artStyle 完全停用。handler 不再呼叫 getArtStylePrompt 注入舊風格 prompt。
  // 注意：本檔 buildPanelPrompt 是 mock 過的（return 固定 'panel-image-prompt'）— 但 implementer
  // 改為傳「'与参考图风格一致'」作為 styleText 占位（避免拿 getArtStylePrompt）。所以
  // 旧 ART_STYLES 字串不應出現在 final prompt 裡。
  it('Q-006 A: 即使 artStyle = realistic，final prompt 不含舊 ART_STYLES 字串', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      storyboardModel: 'storyboard-model-1',
      artStyle: 'realistic',
    })
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(null)

    const job = buildJob({ candidateCount: 1 })
    await handlePanelImageTask(job)

    const generationCall = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1] as {
      prompt: string
    }
    expect(generationCall.prompt).not.toContain('Strictly photorealistic')
    expect(generationCall.prompt).not.toContain('ABSOLUTELY NO cartoon')
    expect(generationCall.prompt).not.toContain('写实风格')
  })

  it('Q-006 A: artStyle = japanese-anime → final prompt 不含 ART_STYLES anime 字串（styleProfile 透传给 chokepoint）', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      storyboardModel: 'storyboard-model-1',
      artStyle: 'japanese-anime',
    })
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce({
      positivePrompt: 'PANEL_STYLE_PROFILE_POS',
      negativePrompt: null,
      referenceImageUrls: [],
    })

    const job = buildJob({ candidateCount: 1 })
    await handlePanelImageTask(job)

    const generationCall = utilsMock.resolveImageSourceFromGeneration.mock.calls[0]?.[1] as {
      prompt: string
      styleProfile?: unknown
    }
    expect(generationCall.prompt).not.toContain('Modern Japanese anime style')
    expect(generationCall.prompt).not.toContain('cel shading')
    // styleProfile 必须透传给 chokepoint
    expect(generationCall.styleProfile).toEqual({
      positivePrompt: 'PANEL_STYLE_PROFILE_POS',
      negativePrompt: null,
      referenceImageUrls: [],
    })
  })
})
