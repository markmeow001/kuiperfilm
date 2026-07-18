import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

// Live Composite persistence (2026-07-17) — contract at the API boundary:
// owner-scoped CRUD, storage keys locked to the caller's own playground-ref
// namespace, timeline JSON validated stroke-by-stroke, and GET detail signs
// every stored key into a fresh URL (never returns bare keys without URLs).

interface ProjectRow {
  id: string
  ownerUserId: string
  name: string
  videoKey: string | null
  videoName: string | null
  backgroundKey: string | null
  backgroundColor: string
  timeline: unknown
  createdAt: Date
  updatedAt: Date
}

const dbState = vi.hoisted(() => ({ rows: [] as ProjectRow[], nextId: 1 }))

const prismaMock = vi.hoisted(() => {
  const state = dbState
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value)
  return {
    liveCompositeProject: {
      findMany: vi.fn(async (args: { where: Record<string, unknown>; take?: number }) => {
        const rows = state.rows
          .filter((row) => matches(row as unknown as Record<string, unknown>, args.where))
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        return rows.slice(0, args.take ?? rows.length)
      }),
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) =>
        state.rows.find((row) => matches(row as unknown as Record<string, unknown>, args.where)) ?? null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const now = new Date('2026-07-17T00:00:00.000Z')
        const row: ProjectRow = {
          id: `proj-${state.nextId++}`,
          ownerUserId: args.data.ownerUserId as string,
          name: (args.data.name as string | undefined) ?? '未命名合成',
          videoKey: (args.data.videoKey as string | null | undefined) ?? null,
          videoName: (args.data.videoName as string | null | undefined) ?? null,
          backgroundKey: (args.data.backgroundKey as string | null | undefined) ?? null,
          backgroundColor: (args.data.backgroundColor as string | undefined) ?? '#172033',
          timeline: args.data.timeline,
          createdAt: now,
          updatedAt: now,
        }
        state.rows.push(row)
        return row
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.rows.find((candidate) => candidate.id === args.where.id)
        if (!row) throw new Error('Record not found')
        Object.assign(row, args.data, { updatedAt: new Date('2026-07-17T01:00:00.000Z') })
        return row
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const index = state.rows.findIndex((candidate) => candidate.id === args.where.id)
        if (index < 0) throw new Error('Record not found')
        const [row] = state.rows.splice(index, 1)
        return row
      }),
    },
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => ({
  getSignedUrl: (key: string) => `https://signed.example/${key}`,
}))

const OWNER = 'user-1'
const VIDEO_KEY = `video/playground-ref/${OWNER}/ref-a.mp4`
const BG_KEY = `images/playground-ref/${OWNER}/ref-bg.png`
const MASK_KEY = `images/playground-ref/${OWNER}/ref-mask.png`
const OCCLUSION_KEY = `images/playground-ref/${OWNER}/ref-occlusion.png`
const CHARACTER_KEY = `video/playground-ref/${OWNER}/robot.webm`

function validTimeline(overrides: Record<string, unknown> = {}) {
  return {
    keyframes: [
      {
        id: 'kf-0',
        time: 0,
        baseMaskKey: MASK_KEY,
        strokes: [
          { id: 's-1', tool: 'keep', brushPercent: 6, points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] },
          { id: 's-2', tool: 'erase', brushPercent: 12, points: [{ x: 0.5, y: 0.5 }] },
        ],
      },
      { id: 'kf-1', time: 1.5, strokes: [] },
    ],
    ...overrides,
  }
}

function virtualCharacter(assetKey = CHARACTER_KEY) {
  return {
    assetType: 'video', assetName: 'robot.webm', assetKey,
    anchor: 'person', x: 0.7, y: 0.5, offsetX: 0.2, offsetY: 0,
    scale: 0.4, rotation: 0, opacity: 1, startTime: 0, endTime: 2,
    loop: true, depth: 'behind-person',
  }
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    name: '雨夜合成',
    videoKey: VIDEO_KEY,
    videoName: 'take-1.mp4',
    backgroundKey: BG_KEY,
    backgroundColor: '#101820',
    timeline: validTimeline(),
    ...overrides,
  }
}

async function loadCollectionRoute() {
  return await import('@/app/api/live-composite/projects/route')
}

async function loadDetailRoute() {
  return await import('@/app/api/live-composite/projects/[id]/route')
}

describe('/api/live-composite/projects — persistence contract', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    dbState.rows = []
    dbState.nextId = 1
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated(OWNER)
  })

  it('create → list → get roundtrip keeps shape and signs every stored key', async () => {
    const { POST, GET: LIST } = await loadCollectionRoute()
    const { GET: DETAIL } = await loadDetailRoute()

    const createRes = await POST(
      buildMockRequest({
        path: '/api/live-composite/projects', method: 'POST',
        body: createBody({ timeline: validTimeline({
          virtualCharacter: virtualCharacter(),
          occlusionKeyframes: [{ id: 'depth-0', time: 0, baseMaskKey: OCCLUSION_KEY, strokes: [] }],
        }) }),
      }),
      { params: Promise.resolve({}) },
    )
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    expect(created.project).toMatchObject({ name: '雨夜合成', videoName: 'take-1.mp4' })
    const projectId = created.project.id as string

    const listRes = await LIST(
      buildMockRequest({ path: '/api/live-composite/projects', method: 'GET' }),
      { params: Promise.resolve({}) },
    )
    expect(listRes.status).toBe(200)
    const listed = await listRes.json()
    expect(listed.projects).toHaveLength(1)
    expect(listed.projects[0]).toEqual({
      id: projectId,
      name: '雨夜合成',
      videoName: 'take-1.mp4',
      updatedAt: expect.any(String),
    })
    // List rows never carry storage keys or timeline payloads.
    expect(listed.projects[0]).not.toHaveProperty('videoKey')
    expect(listed.projects[0]).not.toHaveProperty('timeline')

    const detailRes = await DETAIL(
      buildMockRequest({ path: `/api/live-composite/projects/${projectId}`, method: 'GET' }),
      { params: Promise.resolve({ id: projectId }) },
    )
    expect(detailRes.status).toBe(200)
    const detail = (await detailRes.json()).project
    expect(detail.videoKey).toBe(VIDEO_KEY)
    expect(detail.videoUrl).toBe(`https://signed.example/${VIDEO_KEY}`)
    expect(detail.backgroundUrl).toBe(`https://signed.example/${BG_KEY}`)
    expect(detail.backgroundColor).toBe('#101820')
    expect(detail.timeline.keyframes).toHaveLength(2)
    expect(detail.timeline.keyframes[0].baseMaskUrl).toBe(`https://signed.example/${MASK_KEY}`)
    expect(detail.timeline.keyframes[0].strokes).toEqual(validTimeline().keyframes[0].strokes)
    expect(detail.timeline.keyframes[1]).not.toHaveProperty('baseMaskUrl')
    expect(detail.timeline.occlusionKeyframes[0].baseMaskUrl).toBe(`https://signed.example/${OCCLUSION_KEY}`)
    expect(detail.timeline.virtualCharacter).toMatchObject({
      assetKey: CHARACTER_KEY,
      assetUrl: `https://signed.example/${CHARACTER_KEY}`,
      anchor: 'person',
      depth: 'behind-person',
    })
  })

  it('non-owner get / patch / delete → 404 (existence does not leak)', async () => {
    const { POST } = await loadCollectionRoute()
    const createRes = await POST(
      buildMockRequest({ path: '/api/live-composite/projects', method: 'POST', body: createBody() }),
      { params: Promise.resolve({}) },
    )
    const projectId = (await createRes.json()).project.id as string

    vi.resetModules()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-2')
    const { GET: DETAIL, PATCH, DELETE } = await loadDetailRoute()

    const getRes = await DETAIL(
      buildMockRequest({ path: `/api/live-composite/projects/${projectId}`, method: 'GET' }),
      { params: Promise.resolve({ id: projectId }) },
    )
    expect(getRes.status).toBe(404)
    expect((await getRes.json()).error.details.code).toBe('LIVE_COMPOSITE_PROJECT_NOT_FOUND')

    const patchRes = await PATCH(
      buildMockRequest({ path: `/api/live-composite/projects/${projectId}`, method: 'PATCH', body: { name: '偷改' } }),
      { params: Promise.resolve({ id: projectId }) },
    )
    expect(patchRes.status).toBe(404)

    const deleteRes = await DELETE(
      buildMockRequest({ path: `/api/live-composite/projects/${projectId}`, method: 'DELETE' }),
      { params: Promise.resolve({ id: projectId }) },
    )
    expect(deleteRes.status).toBe(404)
    expect(dbState.rows).toHaveLength(1)
  })

  it('foreign storage-key prefixes → 403 LIVE_COMPOSITE_STORAGE_KEY_REJECTED', async () => {
    const { POST } = await loadCollectionRoute()

    const foreignVideo = await POST(
      buildMockRequest({
        path: '/api/live-composite/projects',
        method: 'POST',
        body: createBody({ videoKey: 'video/playground-ref/user-2/ref-x.mp4' }),
      }),
      { params: Promise.resolve({}) },
    )
    expect(foreignVideo.status).toBe(403)
    const videoJson = await foreignVideo.json()
    expect(videoJson.error.details.code).toBe('LIVE_COMPOSITE_STORAGE_KEY_REJECTED')
    expect(videoJson.error.details.details.field).toBe('videoKey')

    const foreignMask = await POST(
      buildMockRequest({
        path: '/api/live-composite/projects',
        method: 'POST',
        body: createBody({
          timeline: validTimeline({
            keyframes: [{ id: 'kf-0', time: 0, baseMaskKey: 'images/other-namespace/mask.png', strokes: [] }],
          }),
        }),
      }),
      { params: Promise.resolve({}) },
    )
    expect(foreignMask.status).toBe(403)
    expect((await foreignMask.json()).error.details.code).toBe('LIVE_COMPOSITE_STORAGE_KEY_REJECTED')

    const foreignCharacter = await POST(
      buildMockRequest({
        path: '/api/live-composite/projects', method: 'POST',
        body: createBody({
          timeline: validTimeline({ virtualCharacter: virtualCharacter('video/playground-ref/user-2/robot.webm') }),
        }),
      }),
      { params: Promise.resolve({}) },
    )
    expect(foreignCharacter.status).toBe(403)
    expect((await foreignCharacter.json()).error.details.details.field).toBe('timeline.virtualCharacter.assetKey')
    expect(dbState.rows).toHaveLength(0)
  })

  it('malformed timeline strokes → 400 LIVE_COMPOSITE_PAYLOAD_INVALID', async () => {
    const { POST } = await loadCollectionRoute()

    const badTool = await POST(
      buildMockRequest({
        path: '/api/live-composite/projects',
        method: 'POST',
        body: createBody({
          timeline: {
            keyframes: [{
              id: 'kf-0',
              time: 0,
              strokes: [{ id: 's-1', tool: 'paint', brushPercent: 6, points: [{ x: 0.1, y: 0.1 }] }],
            }],
          },
        }),
      }),
      { params: Promise.resolve({}) },
    )
    expect(badTool.status).toBe(400)
    expect((await badTool.json()).error.details.code).toBe('LIVE_COMPOSITE_PAYLOAD_INVALID')

    const outOfRangePoint = await POST(
      buildMockRequest({
        path: '/api/live-composite/projects',
        method: 'POST',
        body: createBody({
          timeline: {
            keyframes: [{
              id: 'kf-0',
              time: 0,
              strokes: [{ id: 's-1', tool: 'keep', brushPercent: 6, points: [{ x: 1.4, y: 0.1 }] }],
            }],
          },
        }),
      }),
      { params: Promise.resolve({}) },
    )
    expect(outOfRangePoint.status).toBe(400)

    const missingPoints = await POST(
      buildMockRequest({
        path: '/api/live-composite/projects',
        method: 'POST',
        body: createBody({
          timeline: {
            keyframes: [{ id: 'kf-0', time: 0, strokes: [{ id: 's-1', tool: 'keep', brushPercent: 6 }] }],
          },
        }),
      }),
      { params: Promise.resolve({}) },
    )
    expect(missingPoints.status).toBe(400)
    expect(dbState.rows).toHaveLength(0)
  })

  it('patch updates fields owner-side and returns fresh summary', async () => {
    const { POST } = await loadCollectionRoute()
    const created = await POST(
      buildMockRequest({ path: '/api/live-composite/projects', method: 'POST', body: createBody() }),
      { params: Promise.resolve({}) },
    )
    const projectId = (await created.json()).project.id as string

    const { PATCH } = await loadDetailRoute()
    const patched = await PATCH(
      buildMockRequest({
        path: `/api/live-composite/projects/${projectId}`,
        method: 'PATCH',
        body: { name: '改名合成', timeline: { keyframes: [{ id: 'kf-0', time: 0, strokes: [] }] } },
      }),
      { params: Promise.resolve({ id: projectId }) },
    )
    expect(patched.status).toBe(200)
    expect((await patched.json()).project.name).toBe('改名合成')
    expect(dbState.rows[0].name).toBe('改名合成')
    expect((dbState.rows[0].timeline as { keyframes: unknown[] }).keyframes).toHaveLength(1)
  })
})
