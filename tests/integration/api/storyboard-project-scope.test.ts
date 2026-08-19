import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

type PanelRow = {
  id: string
  imageUrl: string | null
  storyboardId: string
  storyboard?: { id: string; episodeId: string }
}

const submitTaskMock = vi.hoisted(() => vi.fn(async () => ({ taskId: 'task-1', async: true })))
const hasOutputMock = vi.hoisted(() => ({
  hasPanelImageOutput: vi.fn(async () => false),
  hasPanelLipSyncOutput: vi.fn(async () => false),
  hasPanelVideoOutput: vi.fn(async () => false),
}))

const prismaMock = vi.hoisted(() => ({
  userPreference: { findUnique: vi.fn(async () => ({ lipSyncModel: 'fal::lipsync-model' })) },
  novelPromotionEpisode: { findFirst: vi.fn() },
  novelPromotionStoryboard: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(async () => ({})),
    updateMany: vi.fn(async () => ({ count: 0 })),
  },
  novelPromotionPanel: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  novelPromotionVoiceLine: {
    findFirst: vi.fn(),
    findMany: vi.fn(async () => []),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/task/has-output', () => hasOutputMock)
vi.mock('@/lib/task/resolve-locale', () => ({
  resolveRequiredTaskLocale: vi.fn(() => 'zh'),
}))
vi.mock('@/lib/billing', () => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({ billable: false })),
}))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(async () => ({ storyboardModel: 'fal::storyboard-model' })),
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({})),
}))
vi.mock('@/lib/api-config', () => ({
  resolveModelSelection: vi.fn(async () => ({ model: 'fal::storyboard-model' })),
}))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => ({ video: { firstlastframe: true } })),
}))
vi.mock('@/lib/model-pricing/lookup', () => ({
  resolveBuiltinPricing: vi.fn(() => ({ status: 'ok' })),
}))
vi.mock('@/lib/media/attach', () => ({
  attachMediaFieldsToProject: vi.fn(async (value: unknown) => value),
}))
vi.mock('@/lib/cos', () => ({ getSignedUrl: vi.fn((value: string) => value) }))
vi.mock('@/lib/video-models/multi-shot-text-only', () => ({
  videoModelToleratesTextOnlyPanels: vi.fn(() => true),
}))
vi.mock('@/lib/skills/server', () => ({
  loadSkillConfigForProject: vi.fn(async () => null),
}))
vi.mock('@/lib/skills/apply-defaults', () => ({
  applySkillDefaultsToPayload: vi.fn((payload: unknown) => payload),
}))
vi.mock('@/lib/skills/resolve-stage-model', () => ({
  resolveStageModel: vi.fn(() => null),
}))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    event: vi.fn(),
  })),
}))

const PROJECT_ID = 'project-A'
const FOREIGN_EPISODE_ID = 'episode-B'
let panelRows: PanelRow[]

function includesProjectScope(value: unknown): boolean {
  return JSON.stringify(value).includes(`\"projectId\":\"${PROJECT_ID}\"`)
}

async function invoke(params: {
  modulePath: string
  exportName: 'GET' | 'POST' | 'PATCH'
  path: string
  method: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  query?: Record<string, string>
}) {
  const route = await import(params.modulePath)
  return await callRoute(route[params.exportName] as never, {
    path: params.path,
    method: params.method,
    body: params.body,
    query: params.query,
    context: { params: Promise.resolve({ projectId: PROJECT_ID }) } as never,
  })
}

describe('Storyboard routes fail closed on foreign or mixed nested IDs', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-A')

    panelRows = [
      {
        id: 'panel-B1',
        imageUrl: 'images/foreign.png',
        storyboardId: 'storyboard-B',
        storyboard: { id: 'storyboard-B', episodeId: FOREIGN_EPISODE_ID },
      },
    ]

    // A scoped lookup represents a foreign identifier and must not resolve.
    // The legacy unscoped shapes deliberately resolve so every test is RED
    // until the route adopts the project-scoped DAL.
    prismaMock.novelPromotionEpisode.findFirst.mockImplementation(async ({ where }: { where?: unknown }) =>
      includesProjectScope(where) ? null : { id: FOREIGN_EPISODE_ID },
    )
    prismaMock.novelPromotionStoryboard.findFirst.mockImplementation(async ({ where }: { where?: unknown }) =>
      includesProjectScope(where)
        ? null
        : { id: 'storyboard-B', episodeId: FOREIGN_EPISODE_ID },
    )
    prismaMock.novelPromotionStoryboard.findMany.mockResolvedValue([
      { id: 'storyboard-B', episodeId: FOREIGN_EPISODE_ID, panels: [], clip: {} },
    ])
    prismaMock.novelPromotionPanel.findFirst.mockImplementation(async ({ where }: { where?: unknown }) =>
      includesProjectScope(where) ? null : panelRows[0],
    )
    prismaMock.novelPromotionPanel.findMany.mockImplementation(async ({ where }: { where?: unknown }) =>
      includesProjectScope(where) ? [] : panelRows,
    )
    prismaMock.novelPromotionVoiceLine.findFirst.mockImplementation(async ({ where }: { where?: unknown }) =>
      includesProjectScope(where)
        ? null
        : { id: 'voice-B1', episodeId: FOREIGN_EPISODE_ID, audioUrl: 'audio/foreign.mp3' },
    )
  })

  it('GET storyboards rejects a foreign episode before reading storyboards', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/storyboards/route',
      exportName: 'GET',
      path: `/api/novel-promotion/${PROJECT_ID}/storyboards`,
      method: 'GET',
      query: { episodeId: FOREIGN_EPISODE_ID },
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.findMany).not.toHaveBeenCalled()
  })

  it('PATCH storyboards rejects a foreign storyboard before mutation', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/storyboards/route',
      exportName: 'PATCH',
      path: `/api/novel-promotion/${PROJECT_ID}/storyboards`,
      method: 'PATCH',
      body: { storyboardId: 'storyboard-B' },
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.update).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionStoryboard.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'storyboard-B',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
      data: { lastError: null },
    })
  })

  it('regenerate-panel-image rejects a foreign panel before output lookup or submit', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/regenerate-panel-image/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/regenerate-panel-image`,
      method: 'POST',
      body: { panelId: 'panel-B1', count: 1 },
    })

    expect(response.status).toBe(404)
    expect(hasOutputMock.hasPanelImageOutput).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('generate-video single rejects a foreign panel before output lookup or submit', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/generate-video/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/generate-video`,
      method: 'POST',
      body: {
        videoModel: 'fal::video-model',
        storyboardId: 'storyboard-B',
        panelIndex: 0,
      },
    })

    expect(response.status).toBe(404)
    expect(hasOutputMock.hasPanelVideoOutput).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('generate-video batch rejects a foreign episode before panel lookup or submit', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/generate-video/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/generate-video`,
      method: 'POST',
      body: {
        videoModel: 'fal::video-model',
        all: true,
        intent: 'estimate',
        episodeId: FOREIGN_EPISODE_ID,
      },
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.findMany).not.toHaveBeenCalled()
    expect(hasOutputMock.hasPanelVideoOutput).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('lip-sync rejects a foreign panel before voice, output, or task lookup', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/lip-sync/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/lip-sync`,
      method: 'POST',
      body: {
        storyboardId: 'storyboard-B',
        panelIndex: 0,
        voiceLineId: 'voice-B1',
        lipSyncModel: 'fal::lipsync-model',
      },
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionVoiceLine.findFirst).not.toHaveBeenCalled()
    expect(hasOutputMock.hasPanelLipSyncOutput).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('lip-sync rejects a foreign or cross-episode voice line before output or submit', async () => {
    const ownedPanel: PanelRow = {
      id: 'panel-A1',
      imageUrl: 'images/a.png',
      storyboardId: 'storyboard-A',
      storyboard: { id: 'storyboard-A', episodeId: 'episode-A' },
    }
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(ownedPanel)
    prismaMock.novelPromotionVoiceLine.findFirst.mockResolvedValue({
      id: 'voice-A2',
      episodeId: 'episode-B',
      audioUrl: 'audio/b.mp3',
    })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/lip-sync/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/lip-sync`,
      method: 'POST',
      body: {
        storyboardId: 'storyboard-A',
        panelIndex: 0,
        voiceLineId: 'voice-A2',
        lipSyncModel: 'fal::lipsync-model',
      },
    })

    expect(response.status).toBe(404)
    expect(hasOutputMock.hasPanelLipSyncOutput).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('generate-video rejects a foreign last-frame panel before output lookup or submit', async () => {
    const ownedPanel: PanelRow = {
      id: 'panel-A1',
      imageUrl: 'images/a.png',
      storyboardId: 'storyboard-A',
      storyboard: { id: 'storyboard-A', episodeId: 'episode-A' },
    }
    prismaMock.novelPromotionPanel.findFirst.mockImplementation(async ({ where }: { where?: unknown }) => {
      const serializedWhere = JSON.stringify(where)
      if (serializedWhere.includes('storyboard-A')) return ownedPanel
      return null
    })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/generate-video/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/generate-video`,
      method: 'POST',
      body: {
        videoModel: 'fal::video-model',
        storyboardId: 'storyboard-A',
        panelIndex: 0,
        firstLastFrame: {
          flModel: 'fal::video-model',
          lastFrameStoryboardId: 'storyboard-foreign',
          lastFramePanelIndex: 0,
        },
      },
    })

    expect(response.status).toBe(404)
    expect(hasOutputMock.hasPanelVideoOutput).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('generate-multi-shot-video rejects foreign panels before task submission', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/generate-multi-shot-video`,
      method: 'POST',
      body: { panelIds: ['panel-B1'], videoModel: 'fal::video-model' },
    })

    expect(response.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('generate-multi-shot-video rejects duplicate panel IDs before lookup or submit', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/generate-multi-shot-video`,
      method: 'POST',
      body: { panelIds: ['panel-A1', 'panel-A1'], videoModel: 'fal::video-model' },
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionPanel.findMany).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('generate-multi-shot-video rejects panels from different episodes', async () => {
    panelRows = [
      {
        id: 'panel-A1',
        imageUrl: 'images/a.png',
        storyboardId: 'storyboard-A1',
        storyboard: { id: 'storyboard-A1', episodeId: 'episode-A' },
      },
      {
        id: 'panel-A2',
        imageUrl: 'images/b.png',
        storyboardId: 'storyboard-A2',
        storyboard: { id: 'storyboard-A2', episodeId: 'episode-B' },
      },
    ]
    // Both rows are in project A; the DAL must still reject the mixed group.
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue(panelRows)

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/generate-multi-shot-video`,
      method: 'POST',
      body: { panelIds: ['panel-A1', 'panel-A2'], videoModel: 'fal::video-model' },
    })

    expect(response.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('generate-multi-shot-video allows different storyboards in the same episode', async () => {
    panelRows = [
      {
        id: 'panel-A1',
        imageUrl: 'images/a.png',
        storyboardId: 'storyboard-A1',
        storyboard: { id: 'storyboard-A1', episodeId: 'episode-A' },
      },
      {
        id: 'panel-A2',
        imageUrl: 'images/b.png',
        storyboardId: 'storyboard-A2',
        storyboard: { id: 'storyboard-A2', episodeId: 'episode-A' },
      },
    ]
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue(panelRows)

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/generate-multi-shot-video/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/generate-multi-shot-video`,
      method: 'POST',
      body: { panelIds: ['panel-A1', 'panel-A2'], videoModel: 'fal::video-model' },
    })

    expect(response.status).toBe(200)
    expect(submitTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      episodeId: 'episode-A',
      targetId: 'storyboard-A1',
      payload: expect.objectContaining({ panelIds: ['panel-A1', 'panel-A2'] }),
    }))
  })
})
