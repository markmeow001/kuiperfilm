import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS, TASK_TYPE } from '@/lib/task/types'
import { buildMockRequest } from '../../../helpers/request'

type AuthState = {
  authenticated: boolean
  projectAccessAllowed: boolean
}

type TaskRecord = {
  id: string
  userId: string
  projectId: string
  episodeId: string | null
  type: string
  targetType: string
  targetId: string
  status: string
  progress: number
  attempt: number
  maxAttempts: number
  errorCode: string | null
  errorMessage: string | null
  billingInfo: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  externalId: string | null
  dedupeKey: string | null
  queuedAt: Date | null
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

const authState = vi.hoisted<AuthState>(() => ({
  authenticated: true,
  projectAccessAllowed: true,
}))

const queryTasksMock = vi.hoisted(() => vi.fn())
const dismissFailedTasksMock = vi.hoisted(() => vi.fn())
const getTaskByIdMock = vi.hoisted(() => vi.fn())
const cancelTaskMock = vi.hoisted(() => vi.fn())
const removeTaskJobMock = vi.hoisted(() => vi.fn(async () => true))
const reconcileVoiceLineTerminalStateMock = vi.hoisted(() => vi.fn(async () => 'deleted'))
const publishTaskEventMock = vi.hoisted(() => vi.fn(async () => undefined))
const queryTaskTargetStatesMock = vi.hoisted(() => vi.fn())
const withPrismaRetryMock = vi.hoisted(() => vi.fn(async <T>(fn: () => Promise<T>) => await fn()))
const listEventsAfterMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []))
const listTaskLifecycleEventsMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []))
const addChannelListenerMock = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => async () => undefined))
const subscriberState = vi.hoisted(() => ({
  listener: null as ((message: string) => void) | null,
}))

vi.mock('@/lib/api-auth', () => {
  const unauthorized = () => new Response(
    JSON.stringify({ error: { code: 'UNAUTHORIZED' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )

  return {
    isErrorResponse: (value: unknown) => value instanceof Response,
    requireUserAuth: async () => {
      if (!authState.authenticated) return unauthorized()
      return { session: { user: { id: 'user-1' } } }
    },
    requireProjectAuthLight: async (projectId: string) => {
      if (!authState.authenticated) return unauthorized()
      return {
        session: { user: { id: 'user-1' } },
        project: { id: projectId, userId: 'user-1' },
      }
    },
    requireProjectAccess: async () => authState.projectAccessAllowed
      ? { allowed: true, effectiveRole: 'editor' }
      : { allowed: false, reason: 'NO_ACCESS' },
  }
})

vi.mock('@/lib/task/service', () => ({
  queryTasks: queryTasksMock,
  dismissFailedTasks: dismissFailedTasksMock,
  getTaskById: getTaskByIdMock,
  cancelTask: cancelTaskMock,
}))

vi.mock('@/lib/task/queues', () => ({
  removeTaskJob: removeTaskJobMock,
}))

vi.mock('@/lib/voice/voice-line-publication', () => ({
  reconcileVoiceLineTerminalState: reconcileVoiceLineTerminalStateMock,
}))

vi.mock('@/lib/task/publisher', () => ({
  publishTaskEvent: publishTaskEventMock,
  getProjectChannel: vi.fn((projectId: string) => `project:${projectId}`),
  listEventsAfter: listEventsAfterMock,
  listTaskLifecycleEvents: listTaskLifecycleEventsMock,
}))

vi.mock('@/lib/task/state-service', () => ({
  queryTaskTargetStates: queryTaskTargetStatesMock,
}))

vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: withPrismaRetryMock,
}))

vi.mock('@/lib/sse/shared-subscriber', () => ({
  getSharedSubscriber: vi.fn(() => ({
    addChannelListener: addChannelListenerMock,
  })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: vi.fn(async () => []),
    },
  },
}))

const baseTask: TaskRecord = {
  id: 'task-1',
  userId: 'user-1',
  projectId: 'project-1',
  episodeId: 'episode-1',
  type: 'IMAGE_CHARACTER',
  targetType: 'CharacterAppearance',
  targetId: 'appearance-1',
  status: TASK_STATUS.FAILED,
  progress: 15,
  attempt: 1,
  maxAttempts: 3,
  errorCode: null,
  errorMessage: null,
  billingInfo: null,
  payload: { prompt: 'private prompt', panelIds: ['panel-1'] },
  result: { imageUrl: 'private result' },
  externalId: 'provider-request-1',
  dedupeKey: 'private-dedupe-key',
  queuedAt: new Date('2026-08-08T10:00:00.000Z'),
  startedAt: null,
  finishedAt: null,
  createdAt: new Date('2026-08-08T10:00:00.000Z'),
  updatedAt: new Date('2026-08-08T10:01:00.000Z'),
}

describe('api contract - task infra routes (behavior)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.authenticated = true
    authState.projectAccessAllowed = true
    subscriberState.listener = null

    queryTasksMock.mockResolvedValue([baseTask])
    dismissFailedTasksMock.mockResolvedValue(1)
    getTaskByIdMock.mockResolvedValue(baseTask)
    cancelTaskMock.mockResolvedValue({
      task: {
        ...baseTask,
        status: TASK_STATUS.FAILED,
        errorCode: 'TASK_CANCELLED',
        errorMessage: 'Task cancelled by user',
      },
      cancelled: true,
    })
    queryTaskTargetStatesMock.mockResolvedValue([
      {
        targetType: 'CharacterAppearance',
        targetId: 'appearance-1',
        active: true,
        status: TASK_STATUS.PROCESSING,
        taskId: 'task-1',
        updatedAt: new Date().toISOString(),
      },
    ])
    addChannelListenerMock.mockImplementation(async (...args: unknown[]) => {
      subscriberState.listener = args[1] as (message: string) => void
      return async () => undefined
    })
    listTaskLifecycleEventsMock.mockResolvedValue([])
  })

  it('GET /api/tasks: unauthenticated -> 401; authenticated -> 200 with caller-owned tasks', async () => {
    const { GET } = await import('@/app/api/tasks/route')

    authState.authenticated = false
    const unauthorizedReq = buildMockRequest({
      path: '/api/tasks',
      method: 'GET',
      query: { projectId: 'project-1', limit: 20 },
    })
    const unauthorizedRes = await GET(unauthorizedReq, { params: Promise.resolve({}) })
    expect(unauthorizedRes.status).toBe(401)

    authState.authenticated = true
    const req = buildMockRequest({
      path: '/api/tasks',
      method: 'GET',
      query: { projectId: 'project-1', limit: 20, targetId: 'appearance-1' },
    })
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const payload = await res.json() as { tasks: TaskRecord[] }
    expect(payload.tasks).toHaveLength(1)
    expect(payload.tasks[0]?.id).toBe('task-1')
    const safeTask = payload.tasks[0] as unknown as Record<string, unknown>
    expect(safeTask.payload).toEqual({ panelIds: ['panel-1'] })
    expect(JSON.stringify(safeTask)).not.toContain('private prompt')
    expect(safeTask.result).toBeUndefined()
    expect(safeTask.billingInfo).toBeUndefined()
    expect(safeTask.externalId).toBeUndefined()
    expect(safeTask.dedupeKey).toBeUndefined()
    expect(queryTasksMock).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      targetId: 'appearance-1',
      limit: 21,
    }))
  })

  it('GET /api/tasks?scope=summary: personal cursor page -> DB ownership filter and allowlisted DTO', async () => {
    const { GET } = await import('@/app/api/tasks/route')
    const cancelled = {
      ...baseTask,
      id: 'task-cancelled',
      status: TASK_STATUS.FAILED,
      errorCode: 'TASK_CANCELLED',
      errorMessage: 'Task cancelled by user',
      billingInfo: {
        billable: true,
        source: 'task',
        taskType: 'video_panel',
        apiType: 'video',
        model: 'atlascloud::seedance-2.0-r2v',
        quantity: 1,
        unit: 'video',
        maxFrozenCost: 1.5,
        action: 'video.generate',
        status: 'rolled_back',
      },
    }
    queryTasksMock.mockResolvedValue([
      cancelled,
      { ...baseTask, id: 'task-next' },
    ])

    const req = buildMockRequest({
      path: '/api/tasks?scope=summary&episodeId=episode-1&jobStatus=cancelled&type=video_panel&cursor=task-before',
      method: 'GET',
      query: { limit: 1 },
    })
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const payload = await res.json() as {
      tasks: Array<Record<string, unknown>>
      nextCursor: string | null
    }
    expect(payload.nextCursor).toBe('task-cancelled')
    expect(payload.tasks).toHaveLength(1)
    expect(payload.tasks[0]).toMatchObject({
      id: 'task-cancelled',
      status: 'cancelled',
      model: 'atlascloud::seedance-2.0-r2v',
      billingStatus: 'refunded',
      refund: { status: 'refunded', amount: null },
      cost: { estimated: 1.5, actual: 0, currency: 'CNY' },
    })
    expect(payload.tasks[0]).not.toHaveProperty('payload')
    expect(payload.tasks[0]).not.toHaveProperty('result')
    expect(payload.tasks[0]).not.toHaveProperty('externalId')
    expect(payload.tasks[0]).not.toHaveProperty('dedupeKey')
    expect(queryTasksMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      episodeId: 'episode-1',
      jobStatus: ['cancelled'],
      type: ['video_panel'],
      cursor: 'task-before',
      limit: 2,
    }))
  })

  it('GET /api/tasks?scope=summary without jobStatus -> excludes dismissed in the DB query', async () => {
    const { GET } = await import('@/app/api/tasks/route')
    queryTasksMock.mockResolvedValue([])

    const req = buildMockRequest({
      path: '/api/tasks?scope=summary',
      method: 'GET',
    })
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    expect(queryTasksMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      status: [
        TASK_STATUS.QUEUED,
        TASK_STATUS.PROCESSING,
        TASK_STATUS.COMPLETED,
        TASK_STATUS.FAILED,
      ],
    }))
  })

  it('POST /api/tasks/dismiss: invalid params -> 400; success -> dismissed count', async () => {
    const { POST } = await import('@/app/api/tasks/dismiss/route')

    const invalidReq = buildMockRequest({
      path: '/api/tasks/dismiss',
      method: 'POST',
      body: { taskIds: [] },
    })
    const invalidRes = await POST(invalidReq, { params: Promise.resolve({}) })
    expect(invalidRes.status).toBe(400)

    const req = buildMockRequest({
      path: '/api/tasks/dismiss',
      method: 'POST',
      body: { taskIds: ['task-1', 'task-2'] },
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const payload = await res.json() as { success: boolean; dismissed: number }
    expect(payload.success).toBe(true)
    expect(payload.dismissed).toBe(1)
    expect(dismissFailedTasksMock).toHaveBeenCalledWith(['task-1', 'task-2'], 'user-1')
  })

  it('POST /api/task-target-states: validates payload and returns queried states', async () => {
    const { POST } = await import('@/app/api/task-target-states/route')

    const invalidReq = buildMockRequest({
      path: '/api/task-target-states',
      method: 'POST',
      body: { projectId: 'project-1' },
    })
    const invalidRes = await POST(invalidReq, { params: Promise.resolve({}) })
    expect(invalidRes.status).toBe(400)

    const req = buildMockRequest({
      path: '/api/task-target-states',
      method: 'POST',
      body: {
        projectId: 'project-1',
        targets: [
          {
            targetType: 'CharacterAppearance',
            targetId: 'appearance-1',
            types: ['IMAGE_CHARACTER'],
          },
        ],
      },
    })
    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const payload = await res.json() as { states: Array<Record<string, unknown>> }
    expect(payload.states).toHaveLength(1)
    expect(withPrismaRetryMock).toHaveBeenCalledTimes(1)
    expect(queryTaskTargetStatesMock).toHaveBeenCalledWith({
      projectId: 'project-1',
      userId: 'user-1',
      targets: [
        {
          targetType: 'CharacterAppearance',
          targetId: 'appearance-1',
          types: ['IMAGE_CHARACTER'],
        },
      ],
    })
  })

  it('GET /api/tasks/[taskId]: enforces ownership and returns task detail', async () => {
    const route = await import('@/app/api/tasks/[taskId]/route')

    authState.authenticated = false
    const unauthorizedReq = buildMockRequest({ path: '/api/tasks/task-1', method: 'GET' })
    const unauthorizedRes = await route.GET(unauthorizedReq, { params: Promise.resolve({ taskId: 'task-1' }) })
    expect(unauthorizedRes.status).toBe(401)

    authState.authenticated = true
    getTaskByIdMock.mockResolvedValueOnce({ ...baseTask, userId: 'other-user' })
    authState.projectAccessAllowed = false
    const notFoundReq = buildMockRequest({ path: '/api/tasks/task-1', method: 'GET' })
    const notFoundRes = await route.GET(notFoundReq, { params: Promise.resolve({ taskId: 'task-1' }) })
    expect(notFoundRes.status).toBe(404)

    authState.projectAccessAllowed = true
    const req = buildMockRequest({ path: '/api/tasks/task-1', method: 'GET' })
    const res = await route.GET(req, { params: Promise.resolve({ taskId: 'task-1' }) })
    expect(res.status).toBe(200)

    const payload = await res.json() as { task: TaskRecord }
    expect(payload.task.id).toBe('task-1')
    const safeTask = payload.task as unknown as Record<string, unknown>
    expect(safeTask.payload).toBeUndefined()
    expect(safeTask.billingInfo).toBeUndefined()
    expect(safeTask.externalId).toBeUndefined()
    expect(safeTask.dedupeKey).toBeUndefined()
    expect(safeTask.result).toEqual({ imageUrl: 'private result' })
  })

  it('GET /api/tasks/[taskId]: revoked original submitter cannot read a real-project task', async () => {
    const route = await import('@/app/api/tasks/[taskId]/route')
    getTaskByIdMock.mockResolvedValueOnce(baseTask)
    authState.projectAccessAllowed = false

    const req = buildMockRequest({ path: '/api/tasks/task-1', method: 'GET' })
    const res = await route.GET(req, { params: Promise.resolve({ taskId: 'task-1' }) })

    expect(res.status).toBe(404)
  })

  it('GET /api/tasks/[taskId]: virtual task is owner-only', async () => {
    const route = await import('@/app/api/tasks/[taskId]/route')
    getTaskByIdMock.mockResolvedValueOnce({ ...baseTask, projectId: 'playground' })

    const ownerReq = buildMockRequest({ path: '/api/tasks/task-1', method: 'GET' })
    const ownerRes = await route.GET(ownerReq, { params: Promise.resolve({ taskId: 'task-1' }) })
    expect(ownerRes.status).toBe(200)

    getTaskByIdMock.mockResolvedValueOnce({
      ...baseTask,
      projectId: 'playground',
      userId: 'other-user',
    })
    const otherReq = buildMockRequest({ path: '/api/tasks/task-1', method: 'GET' })
    const otherRes = await route.GET(otherReq, { params: Promise.resolve({ taskId: 'task-1' }) })
    expect(otherRes.status).toBe(404)
  })

  it('GET /api/tasks/[taskId]?includeEvents=1: returns lifecycle events for refresh replay', async () => {
    const route = await import('@/app/api/tasks/[taskId]/route')
    const replayEvents = [
      {
        id: '11',
        type: 'task.lifecycle',
        taskId: 'task-1',
        projectId: 'project-1',
        userId: 'user-1',
        ts: new Date().toISOString(),
        taskType: 'IMAGE_CHARACTER',
        targetType: 'CharacterAppearance',
        targetId: 'appearance-1',
        episodeId: null,
        payload: {
          lifecycleType: 'processing',
          stepId: 'clip_1_phase1',
          stepTitle: '分镜规划',
          stepIndex: 1,
          stepTotal: 3,
          message: 'running',
          prompt: 'private worker prompt',
        },
      },
    ]
    listTaskLifecycleEventsMock.mockResolvedValueOnce(replayEvents)

    const req = buildMockRequest({
      path: '/api/tasks/task-1',
      method: 'GET',
      query: { includeEvents: '1', eventsLimit: '1200' },
    })
    const res = await route.GET(req, { params: Promise.resolve({ taskId: 'task-1' }) })
    expect(res.status).toBe(200)

    const payload = await res.json() as { task: TaskRecord; events: Array<Record<string, unknown>> }
    expect(payload.task.id).toBe('task-1')
    expect(payload.events).toHaveLength(1)
    expect(payload.events[0]?.id).toBe('11')
    expect((payload.events[0]?.payload as Record<string, unknown>).message).toBe('running')
    expect((payload.events[0]?.payload as Record<string, unknown>).prompt).toBeUndefined()
    expect(listTaskLifecycleEventsMock).toHaveBeenCalledWith('task-1', 1200)
  })

  it('DELETE /api/tasks/[taskId]: cancellation publishes cancelled event payload', async () => {
    const { DELETE } = await import('@/app/api/tasks/[taskId]/route')

    const req = buildMockRequest({ path: '/api/tasks/task-1', method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ taskId: 'task-1' }) })
    expect(res.status).toBe(200)

    expect(removeTaskJobMock).toHaveBeenCalledWith('task-1')
    expect(reconcileVoiceLineTerminalStateMock).not.toHaveBeenCalled()
    expect(publishTaskEventMock).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      projectId: 'project-1',
      payload: expect.objectContaining({
        cancelled: true,
        stage: 'cancelled',
      }),
    }))
    const payload = await res.json() as { task: Record<string, unknown> }
    expect(payload.task.payload).toBeUndefined()
    expect(payload.task.billingInfo).toBeUndefined()
    expect(payload.task.externalId).toBeUndefined()
    expect(payload.task.dedupeKey).toBeUndefined()
  })

  it('DELETE /api/tasks/[taskId]: cancelled delayed VOICE_LINE immediately reconciles its durable marker', async () => {
    const { DELETE } = await import('@/app/api/tasks/[taskId]/route')
    const voiceTask = {
      ...baseTask,
      externalId: null,
      type: 'voice_line',
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-1',
      payload: {
        episodeId: 'episode-1',
        lineId: 'line-1',
        sourceFingerprint: 'f'.repeat(64),
        meta: { locale: 'zh' },
      },
    }
    getTaskByIdMock.mockResolvedValueOnce(voiceTask)
    cancelTaskMock.mockResolvedValueOnce({
      task: { ...voiceTask, status: TASK_STATUS.FAILED, errorCode: 'TASK_CANCELLED' },
      cancelled: true,
    })

    const req = buildMockRequest({ path: '/api/tasks/task-1', method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ taskId: 'task-1' }) })

    expect(res.status).toBe(200)
    expect(removeTaskJobMock).toHaveBeenCalledWith('task-1')
    expect(reconcileVoiceLineTerminalStateMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-1',
      data: expect.objectContaining({
        taskId: 'task-1',
        type: 'voice_line',
        projectId: 'project-1',
        episodeId: 'episode-1',
        targetType: 'NovelPromotionVoiceLine',
        targetId: 'line-1',
      }),
    }))
  })

  it('DELETE /api/tasks/[taskId]: voice cleanup failure keeps the delayed job available for terminal retry', async () => {
    const { DELETE } = await import('@/app/api/tasks/[taskId]/route')
    const voiceTask = {
      ...baseTask,
      externalId: null,
      type: 'voice_line',
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-1',
      payload: {
        episodeId: 'episode-1',
        lineId: 'line-1',
        sourceFingerprint: 'f'.repeat(64),
        meta: { locale: 'zh' },
      },
    }
    getTaskByIdMock.mockResolvedValueOnce(voiceTask)
    cancelTaskMock.mockResolvedValueOnce({
      task: { ...voiceTask, status: TASK_STATUS.FAILED, errorCode: 'TASK_CANCELLED' },
      cancelled: true,
    })
    reconcileVoiceLineTerminalStateMock.mockRejectedValueOnce(new Error('storage unavailable'))

    const req = buildMockRequest({ path: '/api/tasks/task-1', method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ taskId: 'task-1' }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, cancelled: true })
    expect(removeTaskJobMock).not.toHaveBeenCalled()
  })

  it('DELETE /api/tasks/[taskId]: repeated cancel retries terminal voice cleanup before removing the job', async () => {
    const { DELETE } = await import('@/app/api/tasks/[taskId]/route')
    const voiceTask = {
      ...baseTask,
      externalId: null,
      type: 'voice_line',
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-1',
      status: TASK_STATUS.FAILED,
      errorCode: 'TASK_CANCELLED',
      payload: {
        episodeId: 'episode-1',
        lineId: 'line-1',
        sourceFingerprint: 'f'.repeat(64),
        meta: { locale: 'zh' },
      },
    }
    getTaskByIdMock.mockResolvedValueOnce(voiceTask)
    cancelTaskMock.mockResolvedValueOnce({ task: voiceTask, cancelled: false })

    const req = buildMockRequest({ path: '/api/tasks/task-1', method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ taskId: 'task-1' }) })

    expect(res.status).toBe(200)
    expect(reconcileVoiceLineTerminalStateMock).toHaveBeenCalledTimes(1)
    expect(removeTaskJobMock).toHaveBeenCalledWith('task-1')
  })

  it('DELETE /api/tasks/[taskId]: publish failure does not mask durable cancellation success', async () => {
    const { DELETE } = await import('@/app/api/tasks/[taskId]/route')
    publishTaskEventMock.mockRejectedValueOnce(new Error('redis unavailable'))

    const req = buildMockRequest({ path: '/api/tasks/task-1', method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ taskId: 'task-1' }) })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, cancelled: true })
    expect(removeTaskJobMock).toHaveBeenCalledWith('task-1')
    expect(publishTaskEventMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    'FAL:VOICE:fal-ai/index-tts-2/text-to-speech:req-1',
    'FAL:VOICE:CLAIM:claim-1:owner-1',
    'malformed-paid-handoff',
  ])('DELETE /api/tasks/[taskId]: protected VoiceLine handoff %s -> 409 and zero mutation', async (externalId) => {
    const { DELETE } = await import('@/app/api/tasks/[taskId]/route')
    const voiceTask = {
      ...baseTask,
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'NovelPromotionVoiceLine',
      targetId: 'line-1',
      status: TASK_STATUS.PROCESSING,
      externalId,
      payload: {
        episodeId: 'episode-1',
        lineId: 'line-1',
        sourceFingerprint: 'f'.repeat(64),
        meta: { locale: 'zh' },
      },
    }
    getTaskByIdMock.mockResolvedValueOnce(voiceTask)
    cancelTaskMock.mockResolvedValueOnce({
      task: voiceTask,
      cancelled: false,
      providerHandoffProtected: true,
    })

    const req = buildMockRequest({ path: '/api/tasks/task-1', method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ taskId: 'task-1' }) })

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: {
        details: { code: 'VOICE_PROVIDER_CANCEL_RECONCILIATION_REQUIRED' },
      },
    })
    expect(removeTaskJobMock).not.toHaveBeenCalled()
    expect(reconcileVoiceLineTerminalStateMock).not.toHaveBeenCalled()
    expect(publishTaskEventMock).not.toHaveBeenCalled()
  })

  it('DELETE /api/tasks/[taskId]: original submitter downgraded to viewer cannot cancel a real-project task', async () => {
    const { DELETE } = await import('@/app/api/tasks/[taskId]/route')
    authState.projectAccessAllowed = false

    const req = buildMockRequest({ path: '/api/tasks/task-1', method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ taskId: 'task-1' }) })

    expect(res.status).toBe(404)
    expect(cancelTaskMock).not.toHaveBeenCalled()
    expect(removeTaskJobMock).not.toHaveBeenCalled()
    expect(publishTaskEventMock).not.toHaveBeenCalled()
  })

  it('DELETE /api/tasks/[taskId]: virtual-project tasks remain submitter-only', async () => {
    const { DELETE } = await import('@/app/api/tasks/[taskId]/route')
    authState.projectAccessAllowed = false
    getTaskByIdMock.mockResolvedValueOnce({ ...baseTask, projectId: 'playground' })

    const req = buildMockRequest({ path: '/api/tasks/task-1', method: 'DELETE' })
    const res = await DELETE(req, { params: Promise.resolve({ taskId: 'task-1' }) })

    expect(res.status).toBe(200)
    expect(cancelTaskMock).toHaveBeenCalledWith('task-1')
  })

  it('GET /api/sse: missing projectId -> 400; unauthenticated with projectId -> 401', async () => {
    const { GET } = await import('@/app/api/sse/route')

    const invalidReq = buildMockRequest({ path: '/api/sse', method: 'GET' })
    const invalidRes = await GET(invalidReq, { params: Promise.resolve({}) })
    expect(invalidRes.status).toBe(400)

    authState.authenticated = false
    const unauthorizedReq = buildMockRequest({
      path: '/api/sse',
      method: 'GET',
      query: { projectId: 'project-1' },
    })
    const unauthorizedRes = await GET(unauthorizedReq, { params: Promise.resolve({}) })
    expect(unauthorizedRes.status).toBe(401)
  })

  it('GET /api/sse: authenticated replay request returns SSE stream and replays missed events', async () => {
    const { GET } = await import('@/app/api/sse/route')

    listEventsAfterMock.mockResolvedValueOnce([
      {
        id: '4',
        type: 'task.lifecycle',
        taskId: 'task-1',
        projectId: 'project-1',
        userId: 'user-1',
        ts: new Date().toISOString(),
        taskType: 'IMAGE_CHARACTER',
        targetType: 'CharacterAppearance',
        targetId: 'appearance-1',
        episodeId: null,
        payload: { lifecycleType: 'created' },
      },
    ])

    const req = buildMockRequest({
      path: '/api/sse',
      method: 'GET',
      query: { projectId: 'project-1' },
      headers: { 'last-event-id': '3' },
    })
    const res = await GET(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(listEventsAfterMock).toHaveBeenCalledWith('project-1', 3, 5000)
    expect(addChannelListenerMock).toHaveBeenCalledWith('project:project-1', expect.any(Function))

    const reader = res.body?.getReader()
    expect(reader).toBeTruthy()
    const firstChunk = await reader!.read()
    expect(firstChunk.done).toBe(false)
    const decoded = new TextDecoder().decode(firstChunk.value)
    expect(decoded).toContain('event:')
    await reader!.cancel()
  })

  it('GET /api/sse: channel lifecycle stream includes terminal completed event', async () => {
    const { GET } = await import('@/app/api/sse/route')
    listEventsAfterMock.mockResolvedValueOnce([])

    const req = buildMockRequest({
      path: '/api/sse',
      method: 'GET',
      query: { projectId: 'project-1' },
      headers: { 'last-event-id': '10' },
    })
    const res = await GET(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)

    const listener = subscriberState.listener
    expect(listener).toBeTruthy()

    listener!(JSON.stringify({
      id: '11',
      type: 'task.lifecycle',
      taskId: 'task-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: new Date().toISOString(),
      taskType: 'IMAGE_CHARACTER',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      episodeId: null,
      payload: { lifecycleType: 'processing', progress: 60 },
    }))
    listener!(JSON.stringify({
      id: '12',
      type: 'task.lifecycle',
      taskId: 'task-1',
      projectId: 'project-1',
      userId: 'user-1',
      ts: new Date().toISOString(),
      taskType: 'IMAGE_CHARACTER',
      targetType: 'CharacterAppearance',
      targetId: 'appearance-1',
      episodeId: null,
      payload: { lifecycleType: 'completed', progress: 100 },
    }))

    const reader = res.body?.getReader()
    expect(reader).toBeTruthy()
    const chunk1 = await reader!.read()
    const chunk2 = await reader!.read()
    const merged = `${new TextDecoder().decode(chunk1.value)}${new TextDecoder().decode(chunk2.value)}`

    expect(merged).toContain('"lifecycleType":"processing"')
    expect(merged).toContain('"lifecycleType":"completed"')
    expect(merged).toContain('"taskId":"task-1"')
    await reader!.cancel()
  })
})
