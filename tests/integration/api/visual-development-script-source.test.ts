import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  visualDevelopmentWorkspace: { findUnique: vi.fn(), upsert: vi.fn() },
}))
const cosMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn((_prefix: string, ext: string) => `documents/source.${ext}`),
  getSignedUrl: vi.fn((key: string) => `https://storage.test/${key}`),
  toFetchableUrl: vi.fn((url: string) => url),
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

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('persists an uploaded PDF screenplay with the extracted text', async () => {
    const scriptText = '劇本內容。'.repeat(160)
    const pdfBytes = new TextEncoder().encode(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n`)
    const form = new FormData()
    form.append('file', new File([pdfBytes], '序列三.pdf', { type: 'application/pdf' }))
    form.append('scriptText', scriptText)
    form.append('sourceTitle', '序列三')
    const request = new NextRequest('http://localhost/api/visual-development/project-1/script-source', { method: 'POST', body: form })
    const mod = await import('@/app/api/visual-development/[projectId]/script-source/route')
    const response = await mod.POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data.source).toMatchObject({
      version: 1,
      sourceTitle: '序列三',
      sourceFormat: 'pdf',
      mimeType: 'application/pdf',
      name: '序列三.pdf',
    })
    // Normalized text + original PDF are both persisted.
    expect(cosMock.uploadToCOS).toHaveBeenCalledTimes(2)
    expect(body.data.source.originalKey).toBe('documents/source.pdf')
  })

  it('rejects a file with .pdf extension but non-PDF content', async () => {
    const form = new FormData()
    form.append('file', new File([new TextEncoder().encode('not a pdf at all')], 'fake.pdf', { type: 'application/pdf' }))
    form.append('scriptText', '劇本內容。'.repeat(160))
    form.append('sourceTitle', 'Fake')
    const request = new NextRequest('http://localhost/api/visual-development/project-1/script-source', { method: 'POST', body: form })
    const mod = await import('@/app/api/visual-development/[projectId]/script-source/route')
    const response = await mod.POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('PDF_CONTENT_INVALID')
    expect(cosMock.uploadToCOS).not.toHaveBeenCalled()
  })

  it('restores normalized text from a saved source version', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      worldBible: {
        sources: [{
          id: 'source-2', key: 'documents/source.txt', originalKey: 'documents/source.docx', name: 'V2.docx',
          sourceTitle: 'V2', sourceFormat: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sha256: 'abc', sizeBytes: 1000, textLength: 800, createdAt: '2026-07-29T00:00:00.000Z',
        }],
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('場景一。'.repeat(160), {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    })))
    const mod = await import('@/app/api/visual-development/[projectId]/script-source/route')
    const response = await mod.GET(buildMockRequest({
      path: '/api/visual-development/project-1/script-source?sourceId=source-2',
      method: 'GET',
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.source).toMatchObject({ id: 'source-2', version: 1, sourceTitle: 'V2' })
    expect(body.data.scriptText).toContain('場景一。')
  })
})
