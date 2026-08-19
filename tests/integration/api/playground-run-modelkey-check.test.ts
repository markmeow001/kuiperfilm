import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

// Phase 9.1 — Playground now submits through the Task spine (submitTask).
// This covers the modelKey enabled-list + type-match gate at the submission
// boundary: a disabled / wrong-type modelKey is rejected BEFORE submitTask
// (no Task row, no billing freeze, no enqueue). Enabled keys reach submitTask
// with projectId='playground' and the matching playground task type.

const prismaMock = vi.hoisted(() => ({
  workspaceMember: {
    findFirst: vi.fn<(...args: unknown[]) => Promise<{ workspaceId: string } | null>>(async (..._args: unknown[]) => null),
  },
  workspace: { findFirst: vi.fn(async (..._args: unknown[]) => null) },
}))

const apiConfigMock = vi.hoisted(() => ({
  resolveModelSelection: vi.fn(async (_userId: string, modelKey: string, mediaType: string) => ({
    provider: 'atlascloud',
    modelId: modelKey.split('::')[1] || modelKey,
    modelKey,
    mediaType,
  })),
}))

const submitterMock = vi.hoisted(() => ({
  submitTask: vi.fn<(arg: Record<string, unknown>) => Promise<{
    success: boolean
    async: boolean
    taskId: string
    runId: string
    status: string
    deduped: boolean
  }>>(async () => ({
    success: true,
    async: true,
    taskId: 'task-1',
    runId: 'run-1',
    status: 'queued',
    deduped: false,
  })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/submitter', () => submitterMock)

describe('POST /api/playground/run — modelKey enablement gate (Phase 9.1 spine)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    apiConfigMock.resolveModelSelection.mockImplementation(
      async (_userId: string, modelKey: string, mediaType: string) => ({
        provider: 'atlascloud',
        modelId: modelKey.split('::')[1] || modelKey,
        modelKey,
        mediaType,
      }),
    )
    submitterMock.submitTask.mockResolvedValue({
      success: true,
      async: true,
      taskId: 'task-1',
      runId: 'run-1',
      status: 'queued',
      deduped: false,
    })
  })

  async function loadRoute() {
    return await import('@/app/api/playground/run/route')
  }

  it('disabled modelKey → 403 MODEL_NOT_ENABLED + submitTask not called', async () => {
    apiConfigMock.resolveModelSelection.mockRejectedValueOnce(
      new Error('MODEL_NOT_FOUND: openai::dall-e-3 is not enabled for image'),
    )

    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: { prompt: 'a red cube', outputType: 'image', modelKey: 'openai::dall-e-3' },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error.code).toBe('FORBIDDEN')
    expect(json.error.details.code).toBe('MODEL_NOT_ENABLED')
    expect(json.error.details.details.modelKey).toBe('openai::dall-e-3')
    expect(json.error.details.details.outputType).toBe('image')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('outputType=image but model is video-only → 403 MODEL_NOT_ENABLED', async () => {
    apiConfigMock.resolveModelSelection.mockRejectedValueOnce(
      new Error('MODEL_NOT_FOUND: atlascloud::seedance-2.0 is not enabled for image'),
    )

    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: { prompt: 'horse running', outputType: 'image', modelKey: 'atlascloud::seedance-2.0' },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(403)
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('enabled image modelKey → 200 + submitTask(playground_image, projectId=playground)', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: { prompt: 'a sunset', outputType: 'image', modelKey: 'atlascloud::nano-banana-pro' },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.run.modelKey).toBe('atlascloud::nano-banana-pro')
    expect(json.run.id).toBe('task-1')
    expect(submitterMock.submitTask).toHaveBeenCalledOnce()
    const arg = submitterMock.submitTask.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.type).toBe('playground_image')
    expect(arg.projectId).toBe('playground')
    const payload = arg.payload as Record<string, unknown>
    expect(payload.modelKey).toBe('atlascloud::nano-banana-pro')
    expect(payload.modelId).toBe('nano-banana-pro')
    expect(payload.outputType).toBe('image')
  })

  it('[signed immutable VoiceLine output reference] -> rejects before playground task submission', async () => {
    const reserved = `https://cos.example/voice/project-a/episode-a/line-a/${'a'.repeat(32)}-${'b'.repeat(64)}.wav?q-signature=fake`
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: {
        prompt: 'a sunset',
        outputType: 'image',
        modelKey: 'atlascloud::nano-banana-pro',
        referenceImages: [reserved],
      },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    const responseBody = await res.json()
    expect(res.status).toBe(400)
    expect(responseBody.error.details.code).toBe('VOICE_LINE_TASK_OUTPUT_REFERENCE_FORBIDDEN')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('enabled video modelKey → 200 + submitTask(playground_video)', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: { prompt: 'horse running', outputType: 'video', modelKey: 'atlascloud::seedance-2.0', durationSec: 5 },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    expect(submitterMock.submitTask).toHaveBeenCalledOnce()
    const arg = submitterMock.submitTask.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg.type).toBe('playground_video')
    const payload = arg.payload as Record<string, unknown>
    expect(payload.duration).toBe(5)
  })

  it('video prompt between 4001 and 6000 chars -> accepted and submitted unchanged', async () => {
    const prompt = 'v'.repeat(5000)
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: { prompt, outputType: 'video', modelKey: 'atlascloud::seedance-2.0-r2v', durationSec: 12 },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(200)
    const arg = submitterMock.submitTask.mock.calls[0]?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(arg?.payload?.prompt).toBe(prompt)
  })

  it('video prompt above 6000 chars -> 400 PROMPT_TOO_LONG with the video limit', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: { prompt: 'v'.repeat(6001), outputType: 'video', modelKey: 'atlascloud::seedance-2.0-r2v' },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.details.code).toBe('PROMPT_TOO_LONG')
    expect(json.error.details.details).toMatchObject({ max: 6000, got: 6001 })
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('image prompt above 4000 chars -> keeps the existing image limit', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: { prompt: 'i'.repeat(4001), outputType: 'image', modelKey: 'atlascloud::nano-banana-pro' },
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.details.details).toMatchObject({ max: 4000, got: 4001 })
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('workspace run -> writes workspaceId into progress-safe payload meta', async () => {
    prismaMock.workspaceMember.findFirst.mockResolvedValueOnce({ workspaceId: 'ws-1' })
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: { prompt: 'shared scene', outputType: 'image', modelKey: 'atlascloud::nano-banana-pro', workspaceId: 'ws-1' },
    })

    const res = await POST(req, { params: Promise.resolve({}) })

    expect(res.status).toBe(200)
    const arg = submitterMock.submitTask.mock.calls.at(-1)?.[0] as { payload?: Record<string, unknown> } | undefined
    expect(arg?.payload).not.toHaveProperty('workspaceId')
    expect(arg?.payload?.meta).toMatchObject({ workspaceId: 'ws-1' })
  })

  it('malformed JSON body → 400 INVALID_JSON_BODY (not silent {} coercion)', async () => {
    const { POST } = await loadRoute()
    const req = new NextRequest('http://localhost:3000/api/playground/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    })

    const res = await POST(req, { params: Promise.resolve({}) })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.code).toBe('INVALID_PARAMS')
    expect(json.error.details.code).toBe('INVALID_JSON_BODY')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('modelKey is trimmed before resolution + submit', async () => {
    const { POST } = await loadRoute()
    const req = buildMockRequest({
      path: '/api/playground/run',
      method: 'POST',
      body: { prompt: 'a tree', outputType: 'image', modelKey: '  atlascloud::nano-banana-pro  ' },
    })

    await POST(req, { params: Promise.resolve({}) })
    expect(apiConfigMock.resolveModelSelection).toHaveBeenCalledWith(
      'user-1',
      'atlascloud::nano-banana-pro',
      'image',
    )
    const arg = submitterMock.submitTask.mock.calls[0]?.[0] as Record<string, unknown>
    const payload = arg.payload as Record<string, unknown>
    expect(payload.modelKey).toBe('atlascloud::nano-banana-pro')
  })
})
