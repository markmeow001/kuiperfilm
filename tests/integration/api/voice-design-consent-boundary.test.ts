import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockProjectAuth,
  mockRole,
  mockUnauthenticated,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  novelPromotionProject: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  task: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
}))

const submitTaskMock = vi.hoisted(() => vi.fn())
const qwenMock = vi.hoisted(() => ({
  createVoiceDesign: vi.fn(),
  validateVoicePrompt: vi.fn(() => ({ valid: true })),
  validatePreviewText: vi.fn(() => ({ valid: true })),
}))
const billingMock = vi.hoisted(() => ({
  buildDefaultTaskBillingInfo: vi.fn(() => ({})),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/task/submitter', () => ({ submitTask: submitTaskMock }))
vi.mock('@/lib/qwen-voice-design', () => qwenMock)
vi.mock('@/lib/billing', () => billingMock)

const VALID_DESIGN_BODY = {
  voicePrompt: 'calm female narrator, warm and low',
  previewText: '這是一段預覽文字',
  preferredName: 'custom_voice',
  language: 'zh',
} as const

async function postVoiceDesign(body: unknown) {
  const { POST } = await import('@/app/api/novel-promotion/[projectId]/voice-design/route')
  return await callRoute(POST as never, {
    path: '/api/novel-promotion/project-1/voice-design',
    method: 'POST',
    body,
    context: { params: Promise.resolve({ projectId: 'project-1' }) } as never,
  })
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('user-a')
  mockRole('editor')
  // Arm the whole downstream path for success so a passing assertion proves
  // the gate refused, not that a mock was missing.
  submitTaskMock.mockResolvedValue({ taskId: 'task-1', async: true })
  qwenMock.createVoiceDesign.mockResolvedValue({ success: true, voiceId: 'voice-1' })
  prismaMock.novelPromotionProject.findFirst.mockResolvedValue({ id: 'np-1' })
})

describe('POST /api/novel-promotion/[projectId]/voice-design consent boundary', () => {
  it('[authorized editor sends a valid design request] -> [400 VOICE_SOURCE_CONSENT_REQUIRED and zero task submit]', async () => {
    const response = await postVoiceDesign(VALID_DESIGN_BODY)
    const body = await response.json() as { error?: { details?: { reason?: string } } }

    expect(response.status).toBe(400)
    expect(body.error?.details?.reason).toBe('VOICE_SOURCE_CONSENT_REQUIRED')
    expect(submitTaskMock).not.toHaveBeenCalled()
    expect(billingMock.buildDefaultTaskBillingInfo).not.toHaveBeenCalled()
    expect(prismaMock.task.create).not.toHaveBeenCalled()
  })

  it('[request body is never parsed] -> [refuses before reading prompt/preview text at all]', async () => {
    await postVoiceDesign(VALID_DESIGN_BODY)

    expect(qwenMock.validateVoicePrompt).not.toHaveBeenCalled()
    expect(qwenMock.validatePreviewText).not.toHaveBeenCalled()
    expect(qwenMock.createVoiceDesign).not.toHaveBeenCalled()
  })

  it('[unauthenticated] -> [401 before the consent reason is disclosed]', async () => {
    mockUnauthenticated()

    const response = await postVoiceDesign(VALID_DESIGN_BODY)

    expect(response.status).toBe(401)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[caller has no access to the project] -> [project auth decides before the consent gate]', async () => {
    mockProjectAuth('forbidden')

    const response = await postVoiceDesign(VALID_DESIGN_BODY)

    expect(response.status).toBe(403)
    expect(submitTaskMock).not.toHaveBeenCalled()
  })

  it('[Asset Hub twin] -> [same reason, so neither entry point is the soft one]', async () => {
    const { POST } = await import('@/app/api/asset-hub/voice-design/route')
    const response = await callRoute(POST as never, {
      path: '/api/asset-hub/voice-design',
      method: 'POST',
      body: VALID_DESIGN_BODY,
      context: undefined as never,
    })
    const body = await response.json() as { error?: { details?: { reason?: string } } }

    expect(response.status).toBe(400)
    expect(body.error?.details?.reason).toBe('VOICE_SOURCE_CONSENT_REQUIRED')
    expect(submitTaskMock).not.toHaveBeenCalled()
  })
})
