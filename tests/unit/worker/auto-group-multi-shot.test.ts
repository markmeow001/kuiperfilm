import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  novelPromotionPanel: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const aiMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

const activeMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(),
}))

const progressMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(),
}))

const promptMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(({ variables }: { variables: Record<string, string> }) =>
    `GROUP:${variables.panel_count}:${variables.target_duration_seconds}`,
  ),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ai-runtime', () => aiMock)
vi.mock('@/lib/workers/utils', () => activeMock)
vi.mock('@/lib/workers/shared', () => progressMock)
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_AUTO_GROUP_MULTI_SHOT: 'np_auto_group_multi_shot' },
  buildPrompt: promptMock.buildPrompt,
}))

import { handleAutoGroupMultiShotTask } from '@/lib/workers/handlers/auto-group-multi-shot'

const PROJECT_ID = 'project-1'
const EPISODE_ID = 'episode-1'

function buildJob(overrides: Partial<TaskJobData> = {}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-auto-group-1',
      type: 'auto_group_multi_shot',
      locale: 'zh',
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      targetType: 'NovelPromotionEpisode',
      targetId: EPISODE_ID,
      userId: 'user-1',
      payload: {
        episodeId: EPISODE_ID,
        analysisModel: 'openrouter::gpt-4o',
        maxInputTokens: 3000,
        maxOutputTokens: 1200,
      },
      ...overrides,
    },
  } as Job<TaskJobData>
}

function episodeFixture() {
  return {
    id: EPISODE_ID,
    novelPromotionProject: {
      projectId: PROJECT_ID,
      targetDuration: 60,
    },
    storyboards: [
      {
        panels: [
          {
            id: 'panel-1',
            panelIndex: 0,
            description: 'living room A',
            location: 'living room',
            characters: '["Alice"]',
            srtSegment: 'Alice: hello',
          },
          {
            id: 'panel-2',
            panelIndex: 1,
            description: 'living room B',
            location: 'living room',
            characters: '["Alice"]',
            srtSegment: 'Alice: again',
          },
          {
            id: 'panel-3',
            panelIndex: 2,
            description: 'kitchen A',
            location: 'kitchen',
            characters: '["Bob"]',
            srtSegment: 'Bob: hello',
          },
          {
            id: 'panel-4',
            panelIndex: 3,
            description: 'kitchen B',
            location: 'kitchen',
            characters: '["Bob"]',
            srtSegment: 'Bob: again',
          },
        ],
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  activeMock.assertTaskActive.mockResolvedValue(undefined)
  progressMock.reportTaskProgress.mockResolvedValue(undefined)
  prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(episodeFixture())
  prismaMock.novelPromotionPanel.findMany.mockResolvedValue([
    { id: 'panel-1' },
    { id: 'panel-2' },
    { id: 'panel-3' },
    { id: 'panel-4' },
  ])
  prismaMock.novelPromotionPanel.updateMany.mockImplementation(
    async ({ where }: { where: { id?: string | { in: string[] } } }) => ({
      count: typeof where.id === 'string' ? 1 : 4,
    }),
  )
  prismaMock.$transaction.mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => await fn(prismaMock),
  )
  aiMock.executeAiTextStep.mockResolvedValue({
    text: JSON.stringify({
      groups: [
        { id: 'model-a', panelIds: ['panel-1', 'panel-2'], reason: 'living room' },
        { id: 'model-b', panelIds: ['panel-3', 'panel-4'], reason: 'kitchen' },
      ],
    }),
  })
})

describe('auto-group multi-shot worker', () => {
  it('episode not in task project -> provider and persistence stay untouched', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)

    await expect(handleAutoGroupMultiShotTask(buildJob())).rejects.toThrow(
      'AUTO_GROUP_EPISODE_SCOPE_MISMATCH',
    )

    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: EPISODE_ID,
          novelPromotionProject: { projectId: PROJECT_ID },
        },
      }),
    )
    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('task cancelled before provider -> provider and persistence stay untouched', async () => {
    activeMock.assertTaskActive.mockRejectedValueOnce(new Error('TASK_CANCELLED'))

    await expect(handleAutoGroupMultiShotTask(buildJob())).rejects.toThrow('TASK_CANCELLED')

    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('valid response -> pinned model is called and every write is project/episode scoped', async () => {
    const result = await handleAutoGroupMultiShotTask(buildJob())

    expect(aiMock.executeAiTextStep).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      model: 'openrouter::gpt-4o',
      projectId: PROJECT_ID,
      action: 'auto_group_multi_shot',
      messages: [{ role: 'user', content: 'GROUP:4:60' }],
      maxRetries: 0,
      maxOutputTokens: 1200,
    }))
    expect(result).toEqual({
      groups: [
        {
          id: 'auto:task-auto-group-1:1',
          panelIds: ['panel-1', 'panel-2'],
          reason: 'living room',
        },
        {
          id: 'auto:task-auto-group-1:2',
          panelIds: ['panel-3', 'panel-4'],
          reason: 'kitchen',
        },
      ],
      panelCount: 4,
      groupedCount: 4,
      modelUsed: 'openrouter::gpt-4o',
    })

    const writes = prismaMock.novelPromotionPanel.updateMany.mock.calls.map((call) => call[0])
    expect(writes[0]).toEqual({
      where: {
        id: { in: ['panel-1', 'panel-2', 'panel-3', 'panel-4'] },
        storyboard: {
          episode: {
            id: EPISODE_ID,
            novelPromotionProject: { projectId: PROJECT_ID },
          },
        },
      },
      data: { multiShotGroupId: null, multiShotGroupOrder: null },
    })
    expect(writes.slice(1)).toEqual([
      {
        where: {
          id: 'panel-1',
          storyboard: {
            episode: {
              id: EPISODE_ID,
              novelPromotionProject: { projectId: PROJECT_ID },
            },
          },
        },
        data: { multiShotGroupId: 'auto:task-auto-group-1:1', multiShotGroupOrder: 0 },
      },
      {
        where: {
          id: 'panel-2',
          storyboard: {
            episode: {
              id: EPISODE_ID,
              novelPromotionProject: { projectId: PROJECT_ID },
            },
          },
        },
        data: { multiShotGroupId: 'auto:task-auto-group-1:1', multiShotGroupOrder: 1 },
      },
      {
        where: {
          id: 'panel-3',
          storyboard: {
            episode: {
              id: EPISODE_ID,
              novelPromotionProject: { projectId: PROJECT_ID },
            },
          },
        },
        data: { multiShotGroupId: 'auto:task-auto-group-1:2', multiShotGroupOrder: 0 },
      },
      {
        where: {
          id: 'panel-4',
          storyboard: {
            episode: {
              id: EPISODE_ID,
              novelPromotionProject: { projectId: PROJECT_ID },
            },
          },
        },
        data: { multiShotGroupId: 'auto:task-auto-group-1:2', multiShotGroupOrder: 1 },
      },
    ])
  })

  it('panel count exceeds shared budget -> provider and persistence stay untouched', async () => {
    const base = episodeFixture()
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      ...base,
      storyboards: [{
        panels: Array.from({ length: 81 }, (_, index) => ({
          ...base.storyboards[0].panels[index % base.storyboards[0].panels.length],
          id: `panel-${index + 1}`,
          panelIndex: index,
        })),
      }],
    })

    await expect(handleAutoGroupMultiShotTask(buildJob())).rejects.toThrow(
      'AUTO_GROUP_PANEL_BUDGET_EXCEEDED',
    )

    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('rendered prompt exceeds input budget -> provider and persistence stay untouched', async () => {
    promptMock.buildPrompt.mockReturnValueOnce('界'.repeat(4_000))

    await expect(handleAutoGroupMultiShotTask(buildJob())).rejects.toThrow(
      'AUTO_GROUP_PROMPT_BUDGET_EXCEEDED',
    )

    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('tampered task token budget -> provider and persistence stay untouched', async () => {
    await expect(handleAutoGroupMultiShotTask(buildJob({
      payload: {
        episodeId: EPISODE_ID,
        analysisModel: 'openrouter::gpt-4o',
        maxInputTokens: 3001,
        maxOutputTokens: 1200,
      },
    }))).rejects.toThrow('AUTO_GROUP_TASK_BUDGET_INVALID')

    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('task cancelled after provider -> no panel write is attempted', async () => {
    activeMock.assertTaskActive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('TASK_CANCELLED'))

    await expect(handleAutoGroupMultiShotTask(buildJob())).rejects.toThrow('TASK_CANCELLED')

    expect(aiMock.executeAiTextStep).toHaveBeenCalledTimes(1)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('panel set changes while provider runs -> transaction fails before clearing prior groups', async () => {
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue([
      { id: 'panel-1' },
      { id: 'panel-2' },
      { id: 'panel-3' },
    ])

    await expect(handleAutoGroupMultiShotTask(buildJob())).rejects.toThrow(
      'AUTO_GROUP_PANEL_SET_CHANGED',
    )

    expect(prismaMock.novelPromotionPanel.updateMany).not.toHaveBeenCalled()
  })
})
