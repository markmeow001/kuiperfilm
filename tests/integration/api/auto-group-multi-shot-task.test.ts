import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
}))

const modelMock = vi.hoisted(() => ({
  resolveAnalysisModel: vi.fn(),
}))

const submitMock = vi.hoisted(() => ({
  submitTask: vi.fn(),
}))

const aiMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/handlers/resolve-analysis-model', () => modelMock)
vi.mock('@/lib/task/submitter', () => submitMock)
vi.mock('@/lib/ai-runtime', () => aiMock)
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))

const PROJECT_ID = 'project-1'
const EPISODE_ID = 'episode-1'

function scopedEpisode(panelCount = 2) {
  return {
    id: EPISODE_ID,
    novelPromotionProject: {
      analysisModel: 'openrouter::project-model',
    },
    storyboards: [
      {
        panels: Array.from({ length: panelCount }, (_, index) => ({
          id: `panel-${index + 1}`,
        })),
      },
    ],
  }
}

async function invoke(body: Record<string, unknown> = {}) {
  const { POST } = await import(
    '@/app/api/novel-promotion/[projectId]/episodes/[episodeId]/auto-group-multi-shot/route'
  )
  return await callRoute(POST as never, {
    path: `/api/novel-promotion/${PROJECT_ID}/episodes/${EPISODE_ID}/auto-group-multi-shot`,
    method: 'POST',
    body,
    context: {
      params: Promise.resolve({ projectId: PROJECT_ID, episodeId: EPISODE_ID }),
    } as never,
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-1')
  prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(scopedEpisode())
  modelMock.resolveAnalysisModel.mockResolvedValue('openrouter::gpt-4o')
  submitMock.submitTask.mockResolvedValue({
    success: true,
    async: true,
    taskId: 'task-auto-group-1',
    status: 'queued',
    deduped: false,
  })
})

describe('POST auto-group-multi-shot durable task route', () => {
  it('foreign episode -> 404 before model resolution, task creation, or AI', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)

    const response = await invoke()

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: {
        id: EPISODE_ID,
        novelPromotionProject: { projectId: PROJECT_ID },
      },
      select: expect.any(Object),
    })
    expect(modelMock.resolveAnalysisModel).not.toHaveBeenCalled()
    expect(submitMock.submitTask).not.toHaveBeenCalled()
    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
  })

  it('fewer than two panels -> 400 and no task is created', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(scopedEpisode(1))

    const response = await invoke()

    expect(response.status).toBe(400)
    expect(submitMock.submitTask).not.toHaveBeenCalled()
    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
  })

  it('panel count exceeds the durable worker budget -> 400 before task creation', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(scopedEpisode(81))

    const response = await invoke()

    expect(response.status).toBe(400)
    expect(modelMock.resolveAnalysisModel).not.toHaveBeenCalled()
    expect(submitMock.submitTask).not.toHaveBeenCalled()
    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
  })

  it('valid episode -> returns standard submitted envelope and pins model into one deduped task', async () => {
    const response = await invoke({ locale: 'zh' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      async: true,
      taskId: 'task-auto-group-1',
      status: 'queued',
      deduped: false,
    })
    expect(modelMock.resolveAnalysisModel).toHaveBeenCalledWith({
      userId: 'user-1',
      projectAnalysisModel: 'openrouter::project-model',
    })
    expect(submitMock.submitTask).toHaveBeenCalledWith({
      userId: 'user-1',
      locale: 'zh',
      requestId: expect.anything(),
      projectId: PROJECT_ID,
      episodeId: EPISODE_ID,
      type: 'auto_group_multi_shot',
      targetType: 'NovelPromotionEpisode',
      targetId: EPISODE_ID,
      payload: {
        episodeId: EPISODE_ID,
        analysisModel: 'openrouter::gpt-4o',
        maxInputTokens: 3000,
        maxOutputTokens: 1200,
      },
      dedupeKey: `auto_group_multi_shot:${PROJECT_ID}:${EPISODE_ID}`,
      maxAttempts: 1,
    })
    expect(aiMock.executeAiTextStep).not.toHaveBeenCalled()
  })
})
