import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  novelPromotionProject: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  novelPromotionEpisode: { findFirst: vi.fn() },
  novelPromotionCharacter: { create: vi.fn(async () => ({ id: 'char-new-1' })) },
  novelPromotionLocation: { create: vi.fn(async () => ({ id: 'loc-new-1' })) },
  locationImage: { create: vi.fn(async () => ({})) },
  characterAppearance: {
    create: vi.fn(async () => ({ id: 'appearance-new-1' })),
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
    update: vi.fn(async () => ({})),
    upsert: vi.fn(async () => ({ id: 'appearance-upsert-1' })),
  },
  episodeCharacter: {
    upsert: vi.fn(async () => ({})),
    findMany: vi.fn(async () => []),
  },
}))

const llmMock = vi.hoisted(() => ({
  chatCompletion: vi.fn(async () => ({ id: 'completion-1' })),
  getCompletionContent: vi.fn(),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/llm-client', () => llmMock)
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))
vi.mock('@/lib/constants', () => ({
  getArtStylePrompt: vi.fn(() => 'cinematic style'),
  removeLocationPromptSuffix: vi.fn((text: string) => text.replace(' [SUFFIX]', '')),
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({
    onStage: vi.fn(),
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    flush: vi.fn(async () => undefined),
  })),
}))
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: {
    NP_AGENT_CHARACTER_PROFILE: 'char',
    NP_SELECT_LOCATION: 'loc',
  },
  buildPrompt: vi.fn(() => 'analysis-prompt'),
}))

import { handleAnalyzeNovelTask } from '@/lib/workers/handlers/analyze-novel'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-analyze-novel-1',
      type: TASK_TYPE.ANALYZE_NOVEL,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionProject',
      targetId: 'np-project-1',
      payload: {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker analyze-novel behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
      mode: 'novel-promotion',
    })

    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: '全局设定文本',
      characters: [{ id: 'char-existing', name: '已有角色' }],
      locations: [{ id: 'loc-existing', name: '已有场景', summary: 'old' }],
    })

    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      novelText: '首集内容',
    })

    llmMock.getCompletionContent
      .mockReturnValueOnce(JSON.stringify({
        characters: [
          {
            name: '新角色',
            aliases: ['别名A'],
            role_level: 'main',
            personality_tags: ['冷静'],
            visual_keywords: ['黑发'],
          },
        ],
      }))
      .mockReturnValueOnce(JSON.stringify({
        locations: [
          {
            name: '新地点',
            summary: '雨夜街道',
            descriptions: ['雨夜街道 [SUFFIX]'],
          },
        ],
      }))
  })

  it('no global text and no episode text -> explicit error', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: '',
      characters: [],
      locations: [],
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ novelText: '' })

    await expect(handleAnalyzeNovelTask(buildJob())).rejects.toThrow('请先填写全局资产设定或剧本内容')
  })

  it('success path -> creates character/location and persists cleaned location descriptions', async () => {
    const result = await handleAnalyzeNovelTask(buildJob())

    expect(result).toEqual({
      success: true,
      characters: [{ id: 'char-new-1' }],
      locations: [{ id: 'loc-new-1' }],
      characterCount: 1,
      locationCount: 1,
      cascadedToClipsBuild: false,
    })

    expect(prismaMock.novelPromotionCharacter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          novelPromotionProjectId: 'np-project-1',
          name: '新角色',
          aliases: JSON.stringify(['别名A']),
        }),
      }),
    )

    expect(prismaMock.novelPromotionLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          novelPromotionProjectId: 'np-project-1',
          name: '新地点',
          summary: '雨夜街道',
        }),
      }),
    )

    expect(prismaMock.locationImage.create).toHaveBeenCalledWith({
      data: {
        locationId: 'loc-new-1',
        imageIndex: 0,
        description: '雨夜街道',
      },
    })

    // Q-006: artStylePrompt 完全停用 — analyze-novel 不再 update artStylePrompt 欄位。
    // styleProfile 由 PATCH /api/projects/{id}/style-profile 管理，handler 不再寫入 art-style 字段。
    // 反向斷言：保證未來沒人偷塞 artStylePrompt 寫入。
    const updateCalls = prismaMock.novelPromotionProject.update.mock.calls as unknown as Array<
      [{ where?: unknown; data?: Record<string, unknown> }]
    >
    for (const [arg] of updateCalls) {
      const data = (arg && typeof arg === 'object' ? arg.data : undefined) || {}
      expect(data).not.toHaveProperty('artStylePrompt')
    }

    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(
      expect.anything(),
      60,
      expect.objectContaining({
        stepId: 'analyze_characters',
        done: true,
        output: expect.stringContaining('"characters"'),
      }),
    )

    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(
      expect.anything(),
      70,
      expect.objectContaining({
        stepId: 'analyze_locations',
        done: true,
        output: expect.stringContaining('"locations"'),
      }),
    )
  })
})
