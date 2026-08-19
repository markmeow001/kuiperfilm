import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { ROUTE_CATALOG } from '../../contracts/route-catalog'

type AuthMode = 'editor' | 'viewer' | 'unauthenticated'

const authState = vi.hoisted(() => ({ mode: 'editor' as AuthMode }))

const txMock = vi.hoisted(() => ({
  novelPromotionCharacter: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
}))

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock)),
}))

const forbiddenEffects = vi.hoisted(() => ({
  maybeSubmitLLMTask: vi.fn(),
  submitTask: vi.fn(),
  executeAiTextStep: vi.fn(),
  addTaskJob: vi.fn(),
  prepareTaskBilling: vi.fn(),
}))

vi.mock('@/lib/api-auth', () => ({
  isErrorResponse: (value: unknown) => value instanceof Response,
  requireProjectAuthLight: async (projectId: string) => {
    if (authState.mode === 'unauthenticated') {
      return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (authState.mode === 'viewer') {
      return new Response(JSON.stringify({ error: { code: 'FORBIDDEN' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    }
    return {
      session: { user: { id: 'user-1' } },
      project: { id: projectId, userId: 'owner-1' },
    }
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/llm-observe/route-task', () => ({
  maybeSubmitLLMTask: forbiddenEffects.maybeSubmitLLMTask,
}))
vi.mock('@/lib/task/submitter', () => ({ submitTask: forbiddenEffects.submitTask }))
vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: forbiddenEffects.executeAiTextStep }))
vi.mock('@/lib/task/queues', () => ({ addTaskJob: forbiddenEffects.addTaskJob }))
vi.mock('@/lib/billing', () => ({ prepareTaskBilling: forbiddenEffects.prepareTaskBilling }))

const readyCharacter = {
  id: 'character-1',
  name: '林真',
  profileConfirmed: false,
  appearances: [{
    id: 'appearance-1',
    imageMediaId: 'media-1',
    imageUrl: 'characters/lin-zhen.png',
    imageUrls: JSON.stringify(['characters/lin-zhen.png']),
    selectedIndex: 0,
  }],
}

async function invoke(body: unknown = {
  characterId: 'character-1',
  appearanceId: 'appearance-1',
}) {
  const { POST } = await import('@/app/api/novel-promotion/[projectId]/character-profile/finalize/route')
  const request = buildMockRequest({
    path: '/api/novel-promotion/project-1/character-profile/finalize',
    method: 'POST',
    body,
    headers: { 'x-request-id': 'request-1' },
  })
  return POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })
}

describe('POST character-profile/finalize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.mode = 'editor'
    txMock.novelPromotionCharacter.findFirst.mockResolvedValue(readyCharacter)
    txMock.novelPromotionCharacter.updateMany.mockResolvedValue({ count: 1 })
    txMock.auditLog.create.mockResolvedValue({ id: 'audit-1' })
  })

  it('route catalog classifies synchronous finalization as CRUD, not LLM observation', () => {
    const route = ROUTE_CATALOG.find((entry) => (
      entry.routeFile === 'src/app/api/novel-promotion/[projectId]/character-profile/finalize/route.ts'
    ))

    expect(route).toEqual({
      routeFile: 'src/app/api/novel-promotion/[projectId]/character-profile/finalize/route.ts',
      category: 'novel-promotion',
      contractGroup: 'crud-novel-promotion-routes',
    })
  })

  it('editor finalizes one project-owned ready appearance synchronously without AI, task, queue, or billing', async () => {
    const response = await invoke()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      alreadyFinal: false,
      character: { id: 'character-1', profileConfirmed: true },
    })
    expect(txMock.novelPromotionCharacter.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'character-1',
        novelPromotionProject: { projectId: 'project-1' },
      },
      select: {
        id: true,
        name: true,
        profileConfirmed: true,
        appearances: {
          where: { id: 'appearance-1' },
          take: 1,
          select: {
            id: true,
            imageMediaId: true,
            imageUrl: true,
            imageUrls: true,
            selectedIndex: true,
          },
        },
      },
    })
    expect(txMock.novelPromotionCharacter.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'character-1',
        profileConfirmed: false,
        novelPromotionProject: { projectId: 'project-1' },
      },
      data: { profileConfirmed: true },
    })
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        projectId: 'project-1',
        action: 'character.visual_finalize',
        entityType: 'NovelPromotionCharacter',
        entityId: 'character-1',
        snapshot: {
          characterName: '林真',
          appearanceId: 'appearance-1',
          imageMediaId: 'media-1',
          visualRef: 'media-1',
          previousProfileConfirmed: false,
          profileConfirmed: true,
          requestId: 'request-1',
        },
      },
    })
    for (const effect of Object.values(forbiddenEffects)) {
      expect(effect).not.toHaveBeenCalled()
    }
  })

  it('replay after finalization is idempotent and does not append a second audit event', async () => {
    txMock.novelPromotionCharacter.findFirst.mockResolvedValue({
      ...readyCharacter,
      profileConfirmed: true,
    })

    const response = await invoke()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      alreadyFinal: true,
      character: { id: 'character-1', profileConfirmed: true },
    })
    expect(txMock.novelPromotionCharacter.updateMany).not.toHaveBeenCalled()
    expect(txMock.auditLog.create).not.toHaveBeenCalled()
  })

  it('already-final character with foreign appearanceId -> still hides the invalid appearance chain as 404', async () => {
    txMock.novelPromotionCharacter.findFirst.mockResolvedValue({
      ...readyCharacter,
      profileConfirmed: true,
      appearances: [],
    })

    const response = await invoke()

    expect(response.status).toBe(404)
    expect(txMock.novelPromotionCharacter.updateMany).not.toHaveBeenCalled()
    expect(txMock.auditLog.create).not.toHaveBeenCalled()
  })

  it('concurrent winner already changed the flag -> returns replay result without duplicate audit', async () => {
    txMock.novelPromotionCharacter.updateMany.mockResolvedValue({ count: 0 })

    const response = await invoke()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      alreadyFinal: true,
      character: { id: 'character-1', profileConfirmed: true },
    })
    expect(txMock.auditLog.create).not.toHaveBeenCalled()
  })

  it('foreign or missing character is hidden as 404 with zero mutation', async () => {
    txMock.novelPromotionCharacter.findFirst.mockResolvedValue(null)

    const response = await invoke()

    expect(response.status).toBe(404)
    expect(txMock.novelPromotionCharacter.updateMany).not.toHaveBeenCalled()
    expect(txMock.auditLog.create).not.toHaveBeenCalled()
  })

  it('appearance must belong to the character and contain a ready image', async () => {
    txMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce({
      ...readyCharacter,
      appearances: [],
    })
    const foreignAppearance = await invoke()
    expect(foreignAppearance.status).toBe(404)

    txMock.novelPromotionCharacter.findFirst.mockResolvedValueOnce({
      ...readyCharacter,
      appearances: [{
        id: 'appearance-1',
        imageMediaId: null,
        imageUrl: null,
        imageUrls: JSON.stringify([]),
        selectedIndex: null,
      }],
    })
    const noImage = await invoke()
    expect(noImage.status).toBe(409)
    expect(txMock.novelPromotionCharacter.updateMany).not.toHaveBeenCalled()
    expect(txMock.auditLog.create).not.toHaveBeenCalled()
  })

  it('legacy appearance with selected imageUrls entry -> records the selected visual reference', async () => {
    txMock.novelPromotionCharacter.findFirst.mockResolvedValue({
      ...readyCharacter,
      appearances: [{
        id: 'appearance-1',
        imageMediaId: null,
        imageUrl: null,
        imageUrls: JSON.stringify(['characters/lin-zhen-a.png', 'characters/lin-zhen-b.png']),
        selectedIndex: 1,
      }],
    })

    const response = await invoke()

    expect(response.status).toBe(200)
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        snapshot: expect.objectContaining({
          appearanceId: 'appearance-1',
          imageMediaId: null,
          visualRef: 'characters/lin-zhen-b.png',
        }),
      }),
    })
  })

  it('viewer and unauthenticated requests stop before the transaction', async () => {
    authState.mode = 'viewer'
    expect((await invoke()).status).toBe(403)
    authState.mode = 'unauthenticated'
    expect((await invoke()).status).toBe(401)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('strict body rejects unknown fields before the transaction', async () => {
    const response = await invoke({
      characterId: 'character-1',
      appearanceId: 'appearance-1',
      generateImage: false,
    })

    expect(response.status).toBe(400)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('audit insert failure fails the transaction instead of silently finalizing', async () => {
    txMock.auditLog.create.mockRejectedValue(new Error('audit unavailable'))

    const response = await invoke()

    expect(response.status).toBe(500)
    expect(txMock.novelPromotionCharacter.updateMany).toHaveBeenCalledTimes(1)
    expect(txMock.auditLog.create).toHaveBeenCalledTimes(1)
  })
})
