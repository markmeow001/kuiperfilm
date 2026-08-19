import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'

const authMock = vi.hoisted(() => ({
  requireProjectAuthLight: vi.fn(async () => ({
    session: { user: { id: 'user-a' } },
    project: { id: 'project-a', userId: 'user-a' },
  })),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionEpisode: {
    findFirst: vi.fn(),
  },
  videoEditorProject: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  task: {
    findUnique: vi.fn(),
  },
  mediaObject: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock)),
}))

const submitTaskMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-auth', () => ({
  requireProjectAuthLight: authMock.requireProjectAuthLight,
  isErrorResponse: (value: unknown) => value instanceof Response,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({
  extractCOSKey: (value: string | null | undefined) => {
    if (!value) return null
    const normalized = value.trim()
    if (/^https?:\/\//i.test(normalized)) {
      return decodeURIComponent(new URL(normalized).pathname).replace(/^\/+/, '')
    }
    return normalized.replace(/^\/+/, '')
  },
  getSignedUrl: (key: string) => `/signed/${encodeURIComponent(key)}`,
}))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/task/resolve-locale', () => ({ resolveRequiredTaskLocale: vi.fn(() => 'zh') }))
vi.mock('@/lib/workers/utils', () => ({ toSignedUrlIfCos: vi.fn() }))

const PROJECT_ID = 'project-a'
const EPISODE_ID = 'episode-a'
const TASK_OUTPUT = `voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav`

function editorContext() {
  return { params: Promise.resolve({ projectId: PROJECT_ID }) } as never
}

describe('legacy editor project scope and render freeze', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => Promise<unknown>) => callback(prismaMock),
    )
    prismaMock.mediaObject.findUnique.mockImplementation(async (args: unknown) => {
      const publicId = (args as { where?: { publicId?: unknown } }).where?.publicId
      if (publicId !== 'reserved-audio') return null
      return {
        id: 'media-reserved',
        publicId,
        storageKey: TASK_OUTPUT,
        sha256: null,
        mimeType: 'audio/wav',
        sizeBytes: null,
        width: null,
        height: null,
        durationMs: null,
        updatedAt: new Date('2026-08-12T00:00:00.000Z'),
        uploadedByUserId: null,
      }
    })
  })

  it('[foreign episode GET] -> [404 before editor data is read]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)
    prismaMock.videoEditorProject.findUnique.mockResolvedValue({
      id: 'foreign-editor',
      episodeId: EPISODE_ID,
      projectData: JSON.stringify({ secret: true }),
    })

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const response = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/editor`,
      method: 'GET',
      query: { episodeId: EPISODE_ID },
      context: editorContext(),
    })

    expect(response.status).toBe(404)
    expect(prismaMock.novelPromotionEpisode.findFirst).toHaveBeenCalledWith({
      where: { id: EPISODE_ID, novelPromotionProject: { projectId: PROJECT_ID } },
      select: { id: true },
    })
    expect(prismaMock.videoEditorProject.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.videoEditorProject.findFirst).not.toHaveBeenCalled()
  })

  it('[owned episode GET] -> [editor read stays on project to episode relation]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: EPISODE_ID })
    prismaMock.videoEditorProject.findFirst.mockResolvedValue({
      id: 'editor-a',
      episodeId: EPISODE_ID,
      projectData: JSON.stringify({ timeline: [] }),
      renderStatus: null,
      outputUrl: null,
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    })

    const { GET } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const response = await callRoute(GET as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/editor`,
      method: 'GET',
      query: { episodeId: EPISODE_ID },
      context: editorContext(),
    })

    expect(response.status).toBe(200)
    expect(prismaMock.videoEditorProject.findFirst).toHaveBeenCalledWith({
      where: {
        episodeId: EPISODE_ID,
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
    })
    expect(await response.json()).toMatchObject({ id: 'editor-a', episodeId: EPISODE_ID })
  })

  it('[foreign episode PUT] -> [404 and zero editor writes]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)

    const { PUT } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const response = await callRoute(PUT as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/editor`,
      method: 'PUT',
      body: { episodeId: EPISODE_ID, projectData: { timeline: [] } },
      context: editorContext(),
    })

    expect(response.status).toBe(404)
    expect(prismaMock.videoEditorProject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.videoEditorProject.updateMany).not.toHaveBeenCalled()
  })

  it('[owned episode PUT] -> [scope check and upsert share one transaction]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: EPISODE_ID })
    prismaMock.videoEditorProject.upsert.mockResolvedValue({
      id: 'editor-a',
      updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    })

    const { PUT } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const response = await callRoute(PUT as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/editor`,
      method: 'PUT',
      body: { episodeId: EPISODE_ID, projectData: { timeline: [] } },
      context: editorContext(),
    })

    expect(response.status).toBe(200)
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.videoEditorProject.upsert).toHaveBeenCalledWith({
      where: { episodeId: EPISODE_ID },
      create: { episodeId: EPISODE_ID, projectData: JSON.stringify({ timeline: [] }) },
      update: {
        projectData: JSON.stringify({ timeline: [] }),
        updatedAt: expect.any(Date),
      },
    })
  })

  it('[deep projectData contains an absolute /m alias to a reserved VoiceLine output] -> [400 and zero DB or task writes]', async () => {
    const { PUT } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const response = await callRoute(PUT as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/editor`,
      method: 'PUT',
      body: {
        episodeId: EPISODE_ID,
        projectData: { timeline: [{ clip: { audio: 'https://app.example/m/reserved-audio' } }] },
      },
      context: editorContext(),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: { details: { code: 'VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN' } },
    })
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.videoEditorProject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.videoEditorProject.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.upsert).not.toHaveBeenCalled()
    expect(prismaMock.mediaObject.update).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[projectData contains null, ordinary values, and a missing /m alias] -> [persists unchanged]', async () => {
    const projectData = {
      timeline: [{ audio: null, note: 'ordinary', unavailable: '/m/missing-audio' }],
    }
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: EPISODE_ID })
    prismaMock.videoEditorProject.upsert.mockResolvedValue({
      id: 'editor-a',
      updatedAt: new Date('2026-08-12T00:00:00.000Z'),
    })

    const { PUT } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const response = await callRoute(PUT as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/editor`,
      method: 'PUT',
      body: { episodeId: EPISODE_ID, projectData },
      context: editorContext(),
    })

    expect(response.status).toBe(200)
    expect(prismaMock.videoEditorProject.upsert).toHaveBeenCalledWith({
      where: { episodeId: EPISODE_ID },
      create: { episodeId: EPISODE_ID, projectData: JSON.stringify(projectData) },
      update: {
        projectData: JSON.stringify(projectData),
        updatedAt: expect.any(Date),
      },
    })
  })

  it('[foreign episode DELETE] -> [404 and zero delete]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue(null)

    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const response = await callRoute(DELETE as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/editor`,
      method: 'DELETE',
      query: { episodeId: EPISODE_ID },
      context: editorContext(),
    })

    expect(response.status).toBe(404)
    expect(prismaMock.videoEditorProject.delete).not.toHaveBeenCalled()
    expect(prismaMock.videoEditorProject.deleteMany).not.toHaveBeenCalled()
  })

  it('[owned episode DELETE] -> [delete predicate retains the project relation]', async () => {
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({ id: EPISODE_ID })
    prismaMock.videoEditorProject.deleteMany.mockResolvedValue({ count: 1 })

    const { DELETE } = await import('@/app/api/novel-promotion/[projectId]/editor/route')
    const response = await callRoute(DELETE as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/editor`,
      method: 'DELETE',
      query: { episodeId: EPISODE_ID },
      context: editorContext(),
    })

    expect(response.status).toBe(200)
    expect(prismaMock.videoEditorProject.deleteMany).toHaveBeenCalledWith({
      where: {
        episodeId: EPISODE_ID,
        episode: { novelPromotionProject: { projectId: PROJECT_ID } },
      },
    })
    expect(prismaMock.videoEditorProject.delete).not.toHaveBeenCalled()
  })

  it.each([
    ['POST', 'POST'],
    ['GET', 'GET'],
  ] as const)('[render %s] -> [409 disabled and zero read, submit, or write]', async (method, exportName) => {
    const route = await import('@/app/api/novel-promotion/[projectId]/editor/render/route')
    const response = await callRoute(route[exportName] as never, {
      path: `/api/novel-promotion/${PROJECT_ID}/editor/render`,
      method,
      ...(method === 'POST'
        ? { body: { editorProjectId: 'editor-a', locale: 'zh' } }
        : { query: { id: 'editor-a' } }),
      context: editorContext(),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: { details: { code: 'VIDEO_EDITOR_RENDER_DISABLED' } },
    })
    expect(prismaMock.videoEditorProject.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.videoEditorProject.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled()
    expect(submitTaskMock).not.toHaveBeenCalled()
  })
})
