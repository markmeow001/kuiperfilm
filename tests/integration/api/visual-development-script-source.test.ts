import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  visualDevelopmentWorkspace: { findUnique: vi.fn(), upsert: vi.fn() },
}))
const cosMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn((_prefix: string, ext: string) => `documents/source.${ext}`),
  getSignedUrl: vi.fn((key: string) => `https://storage.test/${key}`),
  uploadToCOS: vi.fn(async (_buffer: Buffer, key: string) => key),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => cosMock)

describe('visual development screenplay source API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue(null)
    prismaMock.visualDevelopmentWorkspace.upsert.mockResolvedValue({ id: 'workspace-1' })
  })

  it('persists a pasted screenplay as an immutable source version', async () => {
    const mod = await import('@/app/api/visual-development/[projectId]/script-source/route')
    const response = await mod.POST(buildMockRequest({
      path: '/api/visual-development/project-1/script-source',
      method: 'POST',
      body: { sourceTitle: '序列三', scriptText: '劇本內容。'.repeat(160) },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data.source).toMatchObject({ version: 1, sourceTitle: '序列三', sourceFormat: 'pasted' })
    expect(body.data.source.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(cosMock.uploadToCOS).toHaveBeenCalledTimes(1)
    const saved = prismaMock.visualDevelopmentWorkspace.upsert.mock.calls[0]?.[0].create.worldBible
    expect(saved.sources).toHaveLength(1)
  })
})
