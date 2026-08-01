import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  visualDevelopmentWorkspace: {
    findUnique: vi.fn(),
    create: vi.fn(async (_args: unknown) => ({ id: 'workspace-1' })),
    updateMany: vi.fn(async (_args: unknown) => ({ count: 1 })),
  },
}))
const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(async () => 'uploaded'),
  generateUniqueKey: vi.fn(() => 'images/visual-development/research/project-1/reference/ref.png'),
  getSignedUrl: vi.fn((key: string) => `signed:${key}`),
}))
const imageTypeMock = vi.hoisted(() => ({
  detectSupportedImageType: vi.fn(() => ({ extension: 'png', mime: 'image/png' })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/playground/image-file-type', () => imageTypeMock)

const researchFields = {
  designQuestion: 'How does ritual conceal extraction?',
  visualHypothesis: 'Warm sacred surfaces hide cold biological infrastructure.',
  eraAndCulture: 'Post-collapse subterranean civic religion.',
  materialReality: 'Aged brass, yellowed lace, oxidized steel, damp membranes.',
  cinematicLanguage: 'Restrained lenses, practical light, deep blacks.',
  culturalBoundaries: 'No direct living religious symbols.',
  assumptionsAndUnknowns: 'The origin of surviving craft remains uncertain.',
  sourcePolicy: 'Trace every adopted source for internal research only.',
}

function researchReference(id: string, category: string) {
  return {
    id,
    key: `images/${id}.png`,
    name: id,
    category,
    usage: 'use',
    note: 'Adopt the grounded visual principle.',
    sourceUrl: `https://example.com/${id}`,
    creator: 'Archive',
    license: 'Internal research only',
    rightsStatus: 'editorial-reference',
    externalProcessingAllowed: false,
    downstreamEnabled: false,
    reviewStatus: 'approved',
    rejectionNote: null,
    createdAt: '2026-07-31T00:00:00.000Z',
  }
}

const completeResearch = {
  ...researchFields,
  references: [
    researchReference('face', 'casting-face'),
    researchReference('costume', 'costume-material'),
    researchReference('film', 'film-color'),
    researchReference('culture', 'culture-symbol'),
  ],
  status: 'draft',
  version: 1,
  canonId: null,
  lockedAt: null,
}

describe('visual development research API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1',
      projectId: 'project-1',
      status: 'draft',
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
      worldBible: { research: completeResearch },
    })
  })

  it('載入研究台帳 -> 參考圖回傳簽名預覽與 Gate 狀態', async () => {
    const mod = await import('@/app/api/visual-development/[projectId]/research/route')
    const response = await mod.GET(buildMockRequest({ path: '/api/visual-development/project-1/research', method: 'GET' }), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.research.references[0].previewUrl).toBe('signed:images/face.png')
    expect(body.data.research.gate.ready).toBe(true)
  })

  it('研究欄位更新 -> 寫回同一份 World Bible JSON 且不改動世界狀態', async () => {
    const mod = await import('@/app/api/visual-development/[projectId]/research/route')
    const response = await mod.PUT(buildMockRequest({
      path: '/api/visual-development/project-1/research',
      method: 'PUT',
      body: { research: { designQuestion: 'Updated design question' } },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    const update = prismaMock.visualDevelopmentWorkspace.updateMany.mock.calls.at(-1)?.[0] as {
      data: { status?: string; worldBible: { research: typeof completeResearch } }
    }
    expect(update.data.status).toBeUndefined()
    expect(update.data.worldBible.research.designQuestion).toBe('Updated design question')
    expect(update.data.worldBible.research.references).toHaveLength(4)
  })

  it('自動儲存期間專案版本已改變 -> 回報衝突且不覆蓋較新的研究審核', async () => {
    prismaMock.visualDevelopmentWorkspace.updateMany.mockResolvedValueOnce({ count: 0 })
    const mod = await import('@/app/api/visual-development/[projectId]/research/route')
    const response = await mod.PUT(buildMockRequest({
      path: '/api/visual-development/project-1/research',
      method: 'PUT',
      body: { research: { designQuestion: 'Stale autosave value' } },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('VISUAL_DEVELOPMENT_WRITE_CONFLICT')
    expect(prismaMock.visualDevelopmentWorkspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'workspace-1',
        updatedAt: new Date('2026-07-31T00:00:00.000Z'),
      },
    }))
  })

  it('四類證據與來源皆完整 -> 鎖定可追溯 Research Canon', async () => {
    const mod = await import('@/app/api/visual-development/[projectId]/research/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/research',
      method: 'PATCH',
      body: { action: 'canon-lock' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.canonId).toBe('RESEARCH-PROJECT--v001')
    const update = prismaMock.visualDevelopmentWorkspace.updateMany.mock.calls.at(-1)?.[0] as {
      data: { worldBible: { research: typeof completeResearch } }
    }
    expect(update.data.worldBible.research.status).toBe('locked')
    expect(update.data.worldBible.research.lockedAt).toEqual(expect.any(String))
  })

  it('缺少文化符號採用證據 -> 明確拒絕鎖定並回報缺口', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1',
      projectId: 'project-1',
      status: 'draft',
      worldBible: { research: { ...completeResearch, references: completeResearch.references.slice(0, 3) } },
    })
    const mod = await import('@/app/api/visual-development/[projectId]/research/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/research',
      method: 'PATCH',
      body: { action: 'canon-lock' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('RESEARCH_GATE_INCOMPLETE')
    expect(body.error.details.details.missingCategories).toEqual(['culture-symbol'])
    expect(prismaMock.visualDevelopmentWorkspace.updateMany).not.toHaveBeenCalled()
  })

  it('有效研究圖片與來源資訊 -> 上傳並建立待審證據', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1', projectId: 'project-1', status: 'draft', updatedAt: new Date('2026-07-31T00:00:00.000Z'), worldBible: { research: { ...completeResearch, references: [] } },
    })
    const form = new FormData()
    form.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'material.png', { type: 'image/png' }))
    form.append('category', 'costume-material')
    form.append('usage', 'use')
    form.append('note', 'Adopt construction logic, not the literal garment.')
    form.append('sourceUrl', 'https://archive.example/material')
    form.append('creator', 'Costume Archive')
    form.append('license', 'Internal research only')
    form.append('rightsStatus', 'editorial-reference')
    form.append('externalProcessingAllowed', 'false')
    form.append('downstreamEnabled', 'false')
    const request = new NextRequest('http://localhost/api/visual-development/project-1/research/reference', { method: 'POST', body: form })
    const mod = await import('@/app/api/visual-development/[projectId]/research/reference/route')
    const response = await mod.POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(cosMock.uploadToCOS).toHaveBeenCalledWith(expect.any(Buffer), 'images/visual-development/research/project-1/reference/ref.png')
    expect(body.data.reference).toMatchObject({
      category: 'costume-material',
      usage: 'use',
      reviewStatus: 'pending',
      creator: 'Costume Archive',
    })
    const update = prismaMock.visualDevelopmentWorkspace.updateMany.mock.calls.at(-1)?.[0] as {
      data: { worldBible: { research: typeof completeResearch } }
    }
    expect(update.data.worldBible.research.references).toHaveLength(1)
  })
})
