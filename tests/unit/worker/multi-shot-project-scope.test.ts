import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const panelSetFixture = vi.hoisted(() => ({
  storyboardId: 'storyboard-1',
  episodeId: 'episode-1',
  panels: [
    {
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      imageUrl: 'images/panel-1.png',
      description: 'wide establishing shot',
      videoPrompt: 'slow pan',
      characters: '[]',
      props: '[]',
      location: null,
      shotType: 'wide',
      cameraMove: 'pan',
      srtSegment: null,
      storyboard: { id: 'storyboard-1', episodeId: 'episode-1' },
    },
  ],
}))

const projectScopeMock = vi.hoisted(() => ({
  requireNovelPromotionPanelSetInProject: vi.fn(async () => panelSetFixture),
  requireNovelPromotionStoryboardInProject: vi.fn(async () => ({
    id: 'storyboard-1',
    episodeId: 'episode-1',
    clipId: 'clip-1',
  })),
  updateNovelPromotionStoryboardInProject: vi.fn(async () => undefined),
}))

const pathMocks = vi.hoisted(() => ({
  runB: vi.fn(),
  runSeedance: vi.fn(),
  runArk: vi.fn(),
  runAtlas: vi.fn(),
  runFal: vi.fn(),
  shouldSeedance: vi.fn(() => false),
  shouldArk: vi.fn(() => false),
  shouldAtlas: vi.fn(() => false),
  shouldFal: vi.fn(() => false),
}))

const canonicalProjectData = vi.hoisted(() => ({
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
  canonicalizeEpisodeCharacterAppearances: vi.fn(async () => canonicalProjectData),
}))

const sharedWorkerMock = vi.hoisted(() => ({
  parsePanelCharacterReferences: vi.fn(
    (_value?: unknown): Array<{ name: string; appearance?: string }> => [],
  ),
  findCharacterByName: vi.fn(
    (_characters?: unknown, _name?: unknown): (typeof canonicalProjectData.characters)[number] | null => null,
  ),
  resolveNovelData: vi.fn(async () => ({ characters: [], locations: [] })),
  parseImageUrls: vi.fn((_value?: unknown, _field?: unknown): string[] => []),
}))

const generatorMock = vi.hoisted(() => ({
  generateMultiShot: vi.fn(async () => ({ success: true, externalId: 'external-1' })),
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  ensureImageWithinKieAILimits: vi.fn(async (url: string) => url),
  toSignedUrlIfCos: vi.fn((url: string | null) => url),
  uploadVideoSourceToCos: vi.fn(async () => 'video/multi-shot.mp4'),
  waitExternalResult: vi.fn(async () => ({ url: 'https://provider.example/video.mp4' })),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: { findUnique: vi.fn(async () => ({ videoResolution: '720p' })) },
  novelPromotionStoryboard: { update: vi.fn(async () => ({})) },
  novelPromotionPanel: { findUnique: vi.fn(), findMany: vi.fn() },
}))

vi.mock('@/lib/novel-promotion/project-scope', () => projectScopeMock)
vi.mock('@/lib/novel-promotion/episode-appearance', () => episodeAppearanceMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}))
vi.mock('@/lib/skills/server', () => ({ loadSkillConfigById: vi.fn(async () => null) }))
vi.mock('@/lib/skills/resolve-stage-model', () => ({ resolveStageModelWithFallback: vi.fn(() => null) }))
vi.mock('@/lib/skills/stage-mapper', () => ({ getRelevantStagesForTask: vi.fn(() => []) }))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', () => ({
  parsePanelCharacterReferences: sharedWorkerMock.parsePanelCharacterReferences,
  findCharacterByName: sharedWorkerMock.findCharacterByName,
  resolveNovelData: sharedWorkerMock.resolveNovelData,
  parseImageUrls: sharedWorkerMock.parseImageUrls,
}))
vi.mock('@/lib/workers/handlers/multi-shot-video-b-path', () => ({ runMultiShotBPath: pathMocks.runB }))
vi.mock('@/lib/workers/handlers/multi-shot-video-seedance-path', () => ({
  runMultiShotSeedanceComposite: pathMocks.runSeedance,
  shouldUseSeedanceComposite: pathMocks.shouldSeedance,
}))
vi.mock('@/lib/workers/handlers/multi-shot-video-ark-path', () => ({
  runMultiShotArkComposite: pathMocks.runArk,
  shouldUseArkComposite: pathMocks.shouldArk,
}))
vi.mock('@/lib/workers/handlers/multi-shot-video-atlascloud-path', () => ({
  runMultiShotAtlasCloudComposite: pathMocks.runAtlas,
  shouldUseAtlasCloudComposite: pathMocks.shouldAtlas,
}))
vi.mock('@/lib/workers/handlers/multi-shot-video-fal-path', () => ({
  runMultiShotFalComposite: pathMocks.runFal,
  shouldUseFalComposite: pathMocks.shouldFal,
}))
vi.mock('@/lib/generators/video/kieai-kling', () => ({
  KieAIKlingVideoGenerator: class {
    generateMultiShot = generatorMock.generateMultiShot
  },
}))

import { handleMultiShotVideoTask } from '@/lib/workers/handlers/multi-shot-video-handler'

function buildJob(overrides: Partial<TaskJobData> = {}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-multi-1',
      type: TASK_TYPE.VIDEO_MULTI_SHOT,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionStoryboard',
      targetId: 'storyboard-1',
      payload: { panelIds: ['panel-1'], videoModel: 'kieai::kling-2.1' },
      userId: 'user-1',
      ...overrides,
    },
  } as unknown as Job<TaskJobData>
}

describe('multi-shot worker project scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projectScopeMock.requireNovelPromotionPanelSetInProject.mockResolvedValue(panelSetFixture)
    projectScopeMock.requireNovelPromotionStoryboardInProject.mockResolvedValue({
      id: 'storyboard-1',
      episodeId: 'episode-1',
      clipId: 'clip-1',
    })
    projectScopeMock.updateNovelPromotionStoryboardInProject.mockResolvedValue(undefined)
    generatorMock.generateMultiShot.mockResolvedValue({ success: true, externalId: 'external-1' })
    pathMocks.shouldSeedance.mockReturnValue(false)
    pathMocks.shouldArk.mockReturnValue(false)
    pathMocks.shouldAtlas.mockReturnValue(false)
    pathMocks.shouldFal.mockReturnValue(false)
    episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances.mockResolvedValue(canonicalProjectData)
    sharedWorkerMock.parsePanelCharacterReferences.mockReturnValue([])
    sharedWorkerMock.findCharacterByName.mockReturnValue(null)
    sharedWorkerMock.parseImageUrls.mockReturnValue([])
  })

  it('forged cross-project panel IDs fail before every provider path', async () => {
    projectScopeMock.requireNovelPromotionPanelSetInProject.mockRejectedValueOnce(
      new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'),
    )

    await expect(handleMultiShotVideoTask(buildJob()))
      .rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')

    expect(projectScopeMock.requireNovelPromotionPanelSetInProject)
      .toHaveBeenCalledWith('project-1', ['panel-1'])
    expect(pathMocks.runB).not.toHaveBeenCalled()
    expect(pathMocks.runSeedance).not.toHaveBeenCalled()
    expect(pathMocks.runArk).not.toHaveBeenCalled()
    expect(pathMocks.runAtlas).not.toHaveBeenCalled()
    expect(pathMocks.runFal).not.toHaveBeenCalled()
    expect(generatorMock.generateMultiShot).not.toHaveBeenCalled()
  })

  it('job target storyboard must match the scoped panel set', async () => {
    await expect(handleMultiShotVideoTask(buildJob({ targetId: 'storyboard-forged' })))
      .rejects.toThrow('MULTI_SHOT_TARGET_STORYBOARD_MISMATCH')

    expect(generatorMock.generateMultiShot).not.toHaveBeenCalled()
  })

  it('unresolved episode appearance fails before every provider path or persistence', async () => {
    episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances.mockRejectedValueOnce(
      new Error('EPISODE_APPEARANCE_BINDING_STALE'),
    )

    await expect(handleMultiShotVideoTask(buildJob({
      payload: {
        panelIds: ['panel-1'],
        videoModel: 'kieai::kling-2.1',
        rawPrompt: '@Hero enters',
        characterOverrides: [{ characterId: 'character-1', appearanceId: 'appearance-a' }],
      },
    }))).rejects.toThrow('EPISODE_APPEARANCE_BINDING_STALE')

    expect(episodeAppearanceMock.canonicalizeEpisodeCharacterAppearances).toHaveBeenCalledWith({
      projectId: 'project-1',
      episodeId: 'episode-1',
      projectData: expect.any(Object),
      panels: panelSetFixture.panels,
      extraMiningText: '@Hero enters',
      characterOverrides: [{ characterId: 'character-1', appearanceId: 'appearance-a' }],
    })
    expect(pathMocks.runB).not.toHaveBeenCalled()
    expect(pathMocks.runSeedance).not.toHaveBeenCalled()
    expect(pathMocks.runArk).not.toHaveBeenCalled()
    expect(pathMocks.runAtlas).not.toHaveBeenCalled()
    expect(pathMocks.runFal).not.toHaveBeenCalled()
    expect(generatorMock.generateMultiShot).not.toHaveBeenCalled()
    expect(utilsMock.uploadVideoSourceToCos).not.toHaveBeenCalled()
    expect(projectScopeMock.updateNovelPromotionStoryboardInProject).not.toHaveBeenCalled()
  })

  it.each([
    ['Seedance', pathMocks.shouldSeedance, pathMocks.runSeedance],
    ['ARK', pathMocks.shouldArk, pathMocks.runArk],
    ['AtlasCloud', pathMocks.shouldAtlas, pathMocks.runAtlas],
    ['fal', pathMocks.shouldFal, pathMocks.runFal],
  ] as const)('%s dispatch receives the canonical roster and no appearance override', async (
    _name,
    shouldUsePath,
    runPath,
  ) => {
    shouldUsePath.mockReturnValue(true)

    await handleMultiShotVideoTask(buildJob({
      payload: {
        panelIds: ['panel-1'],
        videoModel: 'vendor::model',
        characterOverrides: [{ characterId: 'character-1', appearanceId: 'appearance-a' }],
      },
    }))

    expect(runPath).toHaveBeenCalledWith(expect.objectContaining({
      projectData: canonicalProjectData,
    }))
    expect(runPath.mock.calls[0]?.[0]).not.toHaveProperty('characterOverrides')
  })

  it('Tencent B dispatch receives the canonical roster and no appearance override', async () => {
    await handleMultiShotVideoTask(buildJob({
      payload: {
        panelIds: ['panel-1'],
        videoModel: 'tencent-vod::Kling-3.0-Omni',
        characterOverrides: [{ characterId: 'character-1', appearanceId: 'appearance-a' }],
      },
    }))

    expect(pathMocks.runB).toHaveBeenCalledWith(expect.objectContaining({
      projectData: canonicalProjectData,
    }))
    expect(pathMocks.runB.mock.calls[0]?.[0]).not.toHaveProperty('characterOverrides')
  })

  it('C path provider payload uses canonical B even when the panel hint requests A', async () => {
    sharedWorkerMock.parsePanelCharacterReferences.mockReturnValue([
      { name: 'Hero', appearance: 'A' },
    ])
    sharedWorkerMock.findCharacterByName.mockReturnValue(canonicalProjectData.characters[0])
    sharedWorkerMock.parseImageUrls.mockReturnValue(['characters/b.png'])

    await handleMultiShotVideoTask(buildJob())

    expect(generatorMock.generateMultiShot).toHaveBeenCalledWith(expect.objectContaining({
      klingElements: [expect.objectContaining({
        description: 'Hero',
        imageUrls: ['characters/b.png'],
      })],
    }))
  })

  it('allows ordered panels from different storyboards in the same episode', async () => {
    const secondPanel = {
      ...panelSetFixture.panels[0],
      id: 'panel-2',
      storyboardId: 'storyboard-2',
      panelIndex: 1,
      storyboard: { id: 'storyboard-2', episodeId: 'episode-1' },
    }
    projectScopeMock.requireNovelPromotionPanelSetInProject.mockResolvedValueOnce({
      storyboardId: 'storyboard-1',
      episodeId: 'episode-1',
      panels: [panelSetFixture.panels[0], secondPanel],
    })

    const result = await handleMultiShotVideoTask(buildJob({
      payload: {
        panelIds: ['panel-1', 'panel-2'],
        videoModel: 'kieai::kling-2.1',
      },
    }))

    expect(result).toEqual(expect.objectContaining({ storyboardId: 'storyboard-1' }))
    expect(projectScopeMock.requireNovelPromotionPanelSetInProject)
      .toHaveBeenCalledWith('project-1', ['panel-1', 'panel-2'])
    expect(projectScopeMock.updateNovelPromotionStoryboardInProject)
      .toHaveBeenCalledWith('project-1', 'storyboard-1', expect.any(Object))
  })

  it('C path uses an atomic project-scoped storyboard update', async () => {
    projectScopeMock.updateNovelPromotionStoryboardInProject.mockRejectedValueOnce(
      new Error('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH'),
    )

    await expect(handleMultiShotVideoTask(buildJob()))
      .rejects.toThrow('NOVEL_PROMOTION_PROJECT_SCOPE_MISMATCH')

    expect(generatorMock.generateMultiShot).toHaveBeenCalledTimes(1)
    expect(projectScopeMock.updateNovelPromotionStoryboardInProject).toHaveBeenCalledWith(
      'project-1',
      'storyboard-1',
      expect.any(Object),
    )
    expect(prismaMock.novelPromotionStoryboard.update).not.toHaveBeenCalled()
  })
})
