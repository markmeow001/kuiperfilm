import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

installAuthMocks()

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  characterAppearance: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  novelPromotionLocation: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  locationImage: {
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  novelPromotionPanel: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  novelPromotionStoryboard: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  novelPromotionEpisode: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  novelPromotionProject: {
    findFirst: vi.fn(),
  },
}))

const cosMock = vi.hoisted(() => ({
  cosKeyToSignedUrl: vi.fn((key: string) => `signed:${key}`),
  deleteCOSObject: vi.fn(async () => undefined),
  downloadAndUploadToCOS: vi.fn(async (_url: string, key: string) => key),
  generateUniqueKey: vi.fn((prefix: string, extension: string) => `${prefix}.${extension}`),
  getCOSClient: vi.fn(),
  getSignedUrl: vi.fn((key: string) => `signed:${key}`),
  toFetchableUrl: vi.fn((value: string) => value),
  uploadToCOS: vi.fn(async () => undefined),
}))

const mediaMock = vi.hoisted(() => ({
  classifyVoiceLineTaskOutputReference: vi.fn(async () => 'other' as const),
  resolveMediaRef: vi.fn(async () => null),
  resolveMediaRefFromLegacyValue: vi.fn(async () => null),
  resolveStorageKeyFromMediaValue: vi.fn(async (value: unknown) =>
    typeof value === 'string' ? value : null,
  ),
}))

const sharpMock = vi.hoisted(() => {
  const pipeline = {
    jpeg: vi.fn(),
    toBuffer: vi.fn(async () => Buffer.from('processed')),
  }
  pipeline.jpeg.mockReturnValue(pipeline)
  return {
    factory: vi.fn(() => pipeline),
    pipeline,
  }
})

const submitTaskMock = vi.hoisted(() => vi.fn(async () => ({ taskId: 'task-1', async: true })))
const maybeSubmitLLMTaskMock = vi.hoisted(() => vi.fn(async () =>
  new Response(JSON.stringify({ taskId: 'task-1', async: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }),
))
const hasPanelImageOutputMock = vi.hoisted(() => vi.fn(async () => false))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/media/service', () => mediaMock)
vi.mock('sharp', () => ({ default: sharpMock.factory }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/llm-observe/route-task', () => ({ maybeSubmitLLMTask: maybeSubmitLLMTaskMock }))
vi.mock('@/lib/task/resolve-locale', () => ({ resolveRequiredTaskLocale: vi.fn(() => 'zh') }))
vi.mock('@/lib/task/has-output', () => ({ hasPanelImageOutput: hasPanelImageOutputMock }))
vi.mock('@/lib/billing', () => ({ buildDefaultTaskBillingInfo: vi.fn(() => ({ billable: false })) }))
vi.mock('@/lib/config-service', () => ({
  buildImageBillingPayload: vi.fn(async ({ basePayload }: { basePayload: Record<string, unknown> }) => basePayload),
  getProjectModelConfig: vi.fn(async () => ({ analysisModel: null, editModel: 'image::edit' })),
}))
vi.mock('@/lib/media/outbound-image', () => ({
  sanitizeImageInputsForTaskPayload: vi.fn((values: unknown[]) => ({
    normalized: values.filter((value): value is string => typeof value === 'string'),
    issues: [],
  })),
}))
const PROJECT_ID = 'project-A'
const FOREIGN_PANEL_ID = 'panel-B'
const FOREIGN_STORYBOARD_ID = 'storyboard-B'
const FOREIGN_EPISODE_ID = 'episode-B'
const FOREIGN_APPEARANCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function includesProjectScope(value: unknown): boolean {
  return JSON.stringify(value).includes(`\"projectId\":\"${PROJECT_ID}\"`)
}

async function invoke(params: {
  modulePath: string
  exportName: 'GET' | 'POST' | 'PUT'
  path: string
  method: 'GET' | 'POST' | 'PUT'
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

function uploadRequest(panelId: string) {
  const form = new FormData()
  form.append('panelId', panelId)
  form.append('file', new File([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
  ], 'panel.png', { type: 'image/png' }))
  return new NextRequest(
    `http://localhost:3000/api/novel-promotion/${PROJECT_ID}/upload-panel-image`,
    { method: 'POST', body: form },
  )
}

describe('remaining Storyboard nested IDs fail closed at the project boundary', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-A')

    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => Promise<unknown>) =>
      await callback(prismaMock),
    )
    prismaMock.novelPromotionPanel.findFirst.mockImplementation(async ({ where }: { where?: unknown }) =>
      includesProjectScope(where)
        ? null
        : {
            id: FOREIGN_PANEL_ID,
            storyboardId: FOREIGN_STORYBOARD_ID,
            panelIndex: 0,
            imageUrl: 'foreign/current.png',
            previousImageUrl: 'foreign/previous.png',
          },
    )
    prismaMock.novelPromotionStoryboard.findFirst.mockImplementation(async ({ where }: { where?: unknown }) =>
      includesProjectScope(where)
        ? null
        : { id: FOREIGN_STORYBOARD_ID, episodeId: FOREIGN_EPISODE_ID },
    )
    prismaMock.novelPromotionEpisode.findFirst.mockImplementation(async ({ where }: { where?: unknown }) =>
      includesProjectScope(where) ? null : { id: FOREIGN_EPISODE_ID },
    )
    prismaMock.novelPromotionPanel.update.mockResolvedValue({})
    prismaMock.novelPromotionPanel.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.novelPromotionStoryboard.update.mockResolvedValue({})
    prismaMock.novelPromotionStoryboard.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.characterAppearance.update.mockResolvedValue({})
    prismaMock.characterAppearance.updateMany.mockResolvedValue({ count: 0 })
    prismaMock.locationImage.update.mockResolvedValue({})
    prismaMock.locationImage.updateMany.mockResolvedValue({ count: 0 })
  })

  it('panel-link rejects a foreign storyboard/panel before mutation', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/panel-link/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/panel-link`,
      method: 'POST',
      body: { storyboardId: FOREIGN_STORYBOARD_ID, panelIndex: 0, linked: true },
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionPanel.updateMany).not.toHaveBeenCalled()
  })

  it('select-candidate cancel rejects a foreign panel before mutation', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({ id: FOREIGN_PANEL_ID })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/panel/select-candidate/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/panel/select-candidate`,
      method: 'POST',
      body: { panelId: FOREIGN_PANEL_ID, action: 'cancel' },
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('select-candidate select rejects a foreign panel before media resolution or copy', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: FOREIGN_PANEL_ID,
      imageUrl: 'foreign/current.png',
      imageHistory: null,
      candidateImages: JSON.stringify(['foreign/candidate.png']),
    })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/panel/select-candidate/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/panel/select-candidate`,
      method: 'POST',
      body: {
        panelId: FOREIGN_PANEL_ID,
        action: 'select',
        selectedImageUrl: 'foreign/candidate.png',
      },
    })

    expect(response.status).toBe(404)
    expect(mediaMock.resolveStorageKeyFromMediaValue).not.toHaveBeenCalled()
    expect(cosMock.downloadAndUploadToCOS).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('photography-plan rejects a foreign storyboard before mutation', async () => {
    prismaMock.novelPromotionStoryboard.findUnique.mockResolvedValue({ id: FOREIGN_STORYBOARD_ID })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/photography-plan/route',
      exportName: 'PUT',
      path: `/api/novel-promotion/${PROJECT_ID}/photography-plan`,
      method: 'PUT',
      body: { storyboardId: FOREIGN_STORYBOARD_ID, photographyPlan: { lighting: 'soft' } },
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.update).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionStoryboard.updateMany).not.toHaveBeenCalled()
  })

  it('upload-panel-image rejects a foreign panel before Sharp, COS, or mutation', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: FOREIGN_PANEL_ID,
      imageUrl: 'foreign/current.png',
    })

    const route = await import('@/app/api/novel-promotion/[projectId]/upload-panel-image/route')
    const response = await route.POST(uploadRequest(FOREIGN_PANEL_ID), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    })

    expect(response.status).toBe(404)
    expect(sharpMock.factory).not.toHaveBeenCalled()
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('undo-regenerate panel rejects a foreign panel before COS delete or mutation', async () => {
    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: FOREIGN_PANEL_ID,
      imageUrl: 'foreign/current.png',
      previousImageUrl: 'foreign/previous.png',
    })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/undo-regenerate/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/undo-regenerate`,
      method: 'POST',
      body: { type: 'panel', id: FOREIGN_PANEL_ID },
    })

    expect(response.status).toBe(404)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
    expect(prismaMock.novelPromotionPanel.update).not.toHaveBeenCalled()
  })

  it('undo-regenerate character rejects a foreign appearance before COS delete or mutation', async () => {
    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      id: FOREIGN_APPEARANCE_ID,
      imageUrl: 'foreign/current.png',
      imageUrls: JSON.stringify(['foreign/current.png']),
      previousImageUrl: 'foreign/previous.png',
      previousImageUrls: JSON.stringify(['foreign/previous.png']),
      description: 'foreign',
      descriptions: null,
      previousDescription: 'previous',
      previousDescriptions: null,
    })
    prismaMock.characterAppearance.findFirst.mockResolvedValue(null)

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/undo-regenerate/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/undo-regenerate`,
      method: 'POST',
      body: { type: 'character', id: 'character-B', appearanceId: FOREIGN_APPEARANCE_ID },
    })

    expect(response.status).toBe(404)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
    expect(prismaMock.characterAppearance.update).not.toHaveBeenCalled()
  })

  it('undo-regenerate location rejects a foreign location before COS delete or mutation', async () => {
    prismaMock.novelPromotionLocation.findUnique.mockResolvedValue({
      id: 'location-B',
      images: [{
        id: 'location-image-B',
        imageUrl: 'foreign/current.png',
        previousImageUrl: 'foreign/previous.png',
        description: 'foreign',
        previousDescription: 'previous',
      }],
    })
    prismaMock.novelPromotionLocation.findFirst.mockResolvedValue(null)

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/undo-regenerate/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/undo-regenerate`,
      method: 'POST',
      body: { type: 'location', id: 'location-B' },
    })

    expect(response.status).toBe(404)
    expect(cosMock.deleteCOSObject).not.toHaveBeenCalled()
    expect(prismaMock.locationImage.update).not.toHaveBeenCalled()
  })

  it('download-images rejects a foreign episode before reading or fetching media', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: FOREIGN_EPISODE_ID,
      storyboards: [],
      clips: [],
    })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/download-images/route',
      exportName: 'GET',
      path: `/api/novel-promotion/${PROJECT_ID}/download-images`,
      method: 'GET',
      query: { episodeId: FOREIGN_EPISODE_ID },
    })

    expect(response.status).toBe(404)
    expect(cosMock.getCOSClient).not.toHaveBeenCalled()
  })

  it('video-urls rejects a foreign episode instead of returning proxy URLs', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: FOREIGN_EPISODE_ID,
      storyboards: [{
        id: FOREIGN_STORYBOARD_ID,
        clipId: 'clip-B',
        panels: [{
          panelIndex: 0,
          description: 'foreign panel',
          videoUrl: 'foreign/video.mp4',
          lipSyncVideoUrl: null,
        }],
      }],
      clips: [{ id: 'clip-B' }],
    })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/video-urls/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/video-urls`,
      method: 'POST',
      body: { episodeId: FOREIGN_EPISODE_ID },
    })

    expect(response.status).toBe(404)
  })

  it('modify-storyboard-image rejects a foreign panel before output, config, or task work', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/modify-storyboard-image/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/modify-storyboard-image`,
      method: 'POST',
      body: {
        storyboardId: FOREIGN_STORYBOARD_ID,
        panelIndex: 0,
        modifyPrompt: 'change it',
      },
    })

    expect(response.status).toBe(404)
    expect(hasPanelImageOutputMock).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('regenerate-storyboard-text rejects a foreign storyboard before task submission', async () => {
    prismaMock.novelPromotionStoryboard.findUnique.mockResolvedValue({
      id: FOREIGN_STORYBOARD_ID,
      episodeId: FOREIGN_EPISODE_ID,
    })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/regenerate-storyboard-text/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/regenerate-storyboard-text`,
      method: 'POST',
      body: { storyboardId: FOREIGN_STORYBOARD_ID },
    })

    expect(response.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('insert-panel rejects a foreign storyboard before task submission', async () => {
    prismaMock.novelPromotionStoryboard.findUnique.mockResolvedValue({
      id: FOREIGN_STORYBOARD_ID,
      episodeId: FOREIGN_EPISODE_ID,
    })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/insert-panel/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/insert-panel`,
      method: 'POST',
      body: { storyboardId: FOREIGN_STORYBOARD_ID, insertAfterPanelId: FOREIGN_PANEL_ID },
    })

    expect(response.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('insert-panel rejects an insertAfterPanelId from another storyboard in the same project', async () => {
    prismaMock.novelPromotionStoryboard.findUnique.mockResolvedValue({
      id: 'storyboard-A',
      episodeId: 'episode-A',
    })
    prismaMock.novelPromotionStoryboard.findFirst.mockResolvedValue({
      id: 'storyboard-A',
      episodeId: 'episode-A',
      clipId: 'clip-A',
    })
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue({
      id: 'panel-other-storyboard',
      storyboardId: 'storyboard-other',
      storyboard: { id: 'storyboard-other', episodeId: 'episode-A' },
    })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/insert-panel/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/insert-panel`,
      method: 'POST',
      body: { storyboardId: 'storyboard-A', insertAfterPanelId: 'panel-other-storyboard' },
    })

    expect(response.status).toBe(404)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('analyze-shot-variants rejects a foreign panel before LLM task submission', async () => {
    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/analyze-shot-variants/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/analyze-shot-variants`,
      method: 'POST',
      body: { panelId: FOREIGN_PANEL_ID, episodeId: FOREIGN_EPISODE_ID },
    })

    expect(response.status).toBe(404)
    expect(maybeSubmitLLMTaskMock).not.toHaveBeenCalled()
  })

  it('panel-link uses an atomic project-scoped update and fails closed on a race', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue({
      id: 'panel-A',
      storyboardId: 'storyboard-A',
      panelIndex: 0,
      storyboard: { id: 'storyboard-A', episodeId: 'episode-A' },
    })
    prismaMock.novelPromotionPanel.updateMany.mockResolvedValue({ count: 0 })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/panel-link/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/panel-link`,
      method: 'POST',
      body: { storyboardId: 'storyboard-A', panelIndex: 0, linked: true },
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionPanel.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'panel-A',
        storyboard: { episode: { novelPromotionProject: { projectId: PROJECT_ID } } },
      },
      data: { linkedToNextPanel: true },
    })
  })

  it('photography-plan uses an atomic project-scoped update and fails closed on a race', async () => {
    prismaMock.novelPromotionStoryboard.findFirst.mockResolvedValue({
      id: 'storyboard-A',
      episodeId: 'episode-A',
      clipId: 'clip-A',
    })
    prismaMock.novelPromotionStoryboard.updateMany.mockResolvedValue({ count: 0 })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/photography-plan/route',
      exportName: 'PUT',
      path: `/api/novel-promotion/${PROJECT_ID}/photography-plan`,
      method: 'PUT',
      body: { storyboardId: 'storyboard-A', photographyPlan: { lighting: 'soft' } },
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionStoryboard.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'storyboard-A',
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
      data: { photographyPlan: JSON.stringify({ lighting: 'soft' }) },
    })
  })

  it('upload-panel-image cleans the uploaded object when the final scoped update loses ownership', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue({
      id: 'panel-A',
      storyboardId: 'storyboard-A',
      panelIndex: 0,
      imageUrl: 'owned/previous.png',
      storyboard: { id: 'storyboard-A', episodeId: 'episode-A' },
    })
    prismaMock.novelPromotionPanel.updateMany.mockResolvedValue({ count: 0 })

    const route = await import('@/app/api/novel-promotion/[projectId]/upload-panel-image/route')
    const response = await route.POST(uploadRequest('panel-A'), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    })

    expect(response.status).toBe(404)
    expect(cosMock.uploadToCOS).toHaveBeenCalledTimes(1)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith('panel-panel-A-upload.jpg')
    expect(prismaMock.novelPromotionPanel.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      cosMock.uploadToCOS.mock.invocationCallOrder[0],
    )
    expect(cosMock.uploadToCOS.mock.invocationCallOrder[0]).toBeLessThan(
      prismaMock.novelPromotionPanel.updateMany.mock.invocationCallOrder[0],
    )
  })

  it('select-candidate cleans a copied candidate when the final scoped update loses ownership', async () => {
    const remoteCandidate = 'https://media.example/foreign-looking-but-owned.png'
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue({
      id: 'panel-A',
      storyboardId: 'storyboard-A',
      panelIndex: 0,
      imageUrl: 'owned/current.png',
      imageHistory: null,
      candidateImages: JSON.stringify([remoteCandidate]),
      storyboard: { id: 'storyboard-A', episodeId: 'episode-A' },
    })
    prismaMock.novelPromotionPanel.updateMany.mockResolvedValue({ count: 0 })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/panel/select-candidate/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/panel/select-candidate`,
      method: 'POST',
      body: {
        panelId: 'panel-A',
        action: 'select',
        selectedImageUrl: remoteCandidate,
      },
    })

    expect(response.status).toBe(404)
    expect(cosMock.downloadAndUploadToCOS).toHaveBeenCalledTimes(1)
    expect(cosMock.deleteCOSObject).toHaveBeenCalledWith('panel-panel-A-selected.png')
  })

  it('[select-candidate reserved VoiceLine output] -> [400 before panel mutation or copy]', async () => {
    const reserved = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue({
      id: 'panel-A',
      imageUrl: 'owned/current.png',
      imageHistory: null,
      candidateImages: JSON.stringify([reserved]),
      storyboard: { id: 'storyboard-A', episodeId: 'episode-A' },
    })
    mediaMock.classifyVoiceLineTaskOutputReference.mockResolvedValueOnce('reserved' as never)

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/panel/select-candidate/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/panel/select-candidate`,
      method: 'POST',
      body: { panelId: 'panel-A', action: 'select', selectedImageUrl: reserved },
    })

    expect(response.status).toBe(400)
    expect(prismaMock.novelPromotionPanel.updateMany).not.toHaveBeenCalled()
    expect(cosMock.downloadAndUploadToCOS).not.toHaveBeenCalled()
  })

  it('undo-regenerate commits the scoped panel restore before deleting the superseded object', async () => {
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue({
      id: 'panel-A',
      storyboardId: 'storyboard-A',
      panelIndex: 0,
      imageUrl: 'owned/current.png',
      previousImageUrl: 'owned/previous.png',
      storyboard: { id: 'storyboard-A', episodeId: 'episode-A' },
    })
    prismaMock.novelPromotionPanel.updateMany.mockResolvedValue({ count: 1 })

    const response = await invoke({
      modulePath: '@/app/api/novel-promotion/[projectId]/undo-regenerate/route',
      exportName: 'POST',
      path: `/api/novel-promotion/${PROJECT_ID}/undo-regenerate`,
      method: 'POST',
      body: { type: 'panel', id: 'panel-A' },
    })

    expect(response.status).toBe(200)
    expect(prismaMock.novelPromotionPanel.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'panel-A',
        storyboard: { episode: { novelPromotionProject: { projectId: PROJECT_ID } } },
      },
      data: {
        imageUrl: 'owned/previous.png',
        previousImageUrl: null,
        candidateImages: null,
      },
    })
    expect(prismaMock.novelPromotionPanel.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      cosMock.deleteCOSObject.mock.invocationCallOrder[0],
    )
  })
})
