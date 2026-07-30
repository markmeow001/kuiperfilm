import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  visualDevelopmentWorkspace: {
    findUnique: vi.fn(),
    upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
      id: 'workspace-1',
      worldVersion: 1,
      status: args.update.status ?? args.create.status,
    })),
    update: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
  },
  task: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
}))
const apiConfigMock = vi.hoisted(() => ({ resolveModelSelection: vi.fn() }))
const submitterMock = vi.hoisted(() => ({ submitTask: vi.fn() }))
const cosMock = vi.hoisted(() => ({
  uploadToCOS: vi.fn(async () => 'uploaded'),
  generateUniqueKey: vi.fn(() => 'images/visual-development/world/project-1/reference/ref.png'),
  getSignedUrl: vi.fn((key: string) => `signed:${key}`),
}))
const imageTypeMock = vi.hoisted(() => ({
  detectSupportedImageType: vi.fn(() => ({ extension: 'png', mime: 'image/png' })),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/task/submitter', () => submitterMock)
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/playground/image-file-type', () => imageTypeMock)

const completeWorld = {
  projectPremise: 'An underground city survives by consuming biological energy.',
  visualThesis: 'Sacred white order conceals industrial predation.',
  eraAndGeography: 'A sealed subterranean metropolis after ecological collapse.',
  societyAndFactions: 'Religious rulers above workers and hidden dissidents.',
  technologyRules: 'Steam infrastructure is fused with controlled gene technology.',
  colorScript: 'Ivory and gold belong to authority; soot and brass belong to workers.',
  materialRules: 'Metals oxidize, lace yellows, and biological membranes remain damp.',
  architectureLanguage: 'Vertical gothic authority over circular industrial infrastructure.',
  cameraFormat: '2.39:1, restrained lenses, deep blacks, motivated practical light.',
  forbiddenElements: 'No clean fantasy magic, modern plastics, or decorative steampunk clutter.',
  references: [
    { id: 'ref-1', key: 'images/ref-1.png', name: 'one', category: 'world', note: '', createdAt: '2026-07-29' },
    { id: 'ref-2', key: 'images/ref-2.png', name: 'two', category: 'world', note: '', createdAt: '2026-07-29' },
  ],
  assets: [],
  modelKey: '',
  resolution: '2K',
  aspectRatio: '16:9',
  canonId: null,
  lockedAt: null,
}

function generateRequest(modelKey: string) {
  return buildMockRequest({
    path: '/api/visual-development/project-1/world-bible',
    method: 'POST',
    body: { worldBible: completeWorld, modelKey, meta: { locale: 'zh' } },
  })
}

describe('visual development World Bible API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetAuthMockState()
    installAuthMocks()
    mockAuthenticated('user-1')
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_draft', worldBible: completeWorld,
    })
    submitterMock.submitTask.mockImplementation(async (input: { targetId: string }) => ({
      taskId: `task-${input.targetId.split(':')[1]}`,
      status: 'queued',
    }))
  })

  it('兩張參考素材搭配單參考模型 -> 明確拒絕且不送出任務', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud', modelId: 'flux-kontext-pro', modelKey: 'atlascloud::flux-kontext-pro',
    })
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.POST(generateRequest('atlascloud::flux-kontext-pro'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('MULTI_REFERENCE_IMAGE_UNSUPPORTED')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('完整規則與多參考模型 -> 送出四張不同責任的世界觀資產', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud', modelId: 'flux-2-pro', modelKey: 'atlascloud::flux-2-pro',
    })
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.POST(generateRequest('atlascloud::flux-2-pro'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.data.submitted).toBe(4)
    expect(submitterMock.submitTask).toHaveBeenCalledTimes(4)
    const submissions = submitterMock.submitTask.mock.calls.map((call) => call[0] as { payload: Record<string, unknown> })
    expect(submissions[0]?.payload.referenceImages).toEqual(['images/ref-1.png', 'images/ref-2.png'])
    const prompts = submissions.map((submission) => String(submission.payload.prompt))
    expect(prompts).toEqual(expect.arrayContaining([
      expect.stringContaining('live-action establishing shot that expresses the governing contradiction'),
      expect.stringContaining('live-action scene that expresses faction hierarchy'),
      expect.stringContaining('photorealistic set-detail or still-life photograph'),
      expect.stringContaining('photorealistic live-action architecture shot'),
    ]))
    expect(prompts.every((prompt) => prompt.includes('must contain zero written characters'))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes('World Core Formula'))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes('Faction Color System'))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes('Material & Aging Rules'))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes('Architecture, Symbols & Exclusions'))).toBe(true)
    const update = prismaMock.visualDevelopmentWorkspace.upsert.mock.calls.at(-1)?.[0]
    const savedWorldBible = update?.update.worldBible as { assets: unknown[] }
    expect(savedWorldBible.assets).toHaveLength(4)
  })

  it('上一批世界觀資產仍在生成 -> 拒絕重複送出第二批付費任務', async () => {
    const activeAssets = ['WORLD-FORMULA', 'FACTION-COLOR', 'MATERIAL-AGING', 'ARCH-SYMBOL'].map((code) => ({
      code,
      taskId: `active-${code}`,
      prompt: code,
      negativePrompt: '',
      requestedSeed: null,
      seedStatus: 'unsupported',
      approved: false,
      rejectionNote: null,
    }))
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1',
      projectId: 'project-1',
      worldVersion: 1,
      status: 'world_generating',
      worldBible: { ...completeWorld, assets: activeAssets },
    })
    prismaMock.task.count.mockResolvedValue(2)

    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.POST(generateRequest('atlascloud::flux-2-pro'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('WORLD_ASSET_GENERATION_ACTIVE')
    expect(body.error.details.activeTaskCount).toBe(2)
    expect(prismaMock.task.count).toHaveBeenCalledWith({
      where: {
        id: { in: activeAssets.map((asset) => asset.taskId) },
        projectId: 'project-1',
        userId: 'user-1',
        status: { in: ['queued', 'processing'] },
      },
    })
    expect(apiConfigMock.resolveModelSelection).not.toHaveBeenCalled()
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('只重生指定世界觀資產並保留上一版 Prompt 與任務', async () => {
    const assets = ['WORLD-FORMULA', 'FACTION-COLOR', 'MATERIAL-AGING', 'ARCH-SYMBOL'].map((code) => ({
      code,
      taskId: `task-${code}`,
      prompt: `${code} original prompt`,
      negativePrompt: 'text, watermark',
      requestedSeed: 456,
      seedStatus: 'applied',
      approved: code !== 'WORLD-FORMULA',
      rejectionNote: null,
      originPrompt: `${code} original prompt`,
      history: [],
    }))
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_review', worldBible: { ...completeWorld, assets },
    })
    prismaMock.task.findFirst.mockResolvedValue({
      id: 'task-WORLD-FORMULA',
      type: 'visual_development_image',
      targetType: 'visual-development-world-asset',
      status: 'completed',
      result: { resultUrls: ['images/world-formula.png'] },
      payload: {
        prompt: 'WORLD-FORMULA original prompt',
        modelKey: 'atlascloud::flux-2-pro',
        modelId: 'flux-2-pro',
        aspectRatio: '16:9',
        referenceImages: ['images/ref-1.png', 'images/ref-2.png'],
        seed: 456,
        meta: { visualDevelopmentWorldAssetCode: 'WORLD-FORMULA' },
      },
    })
    submitterMock.submitTask.mockResolvedValueOnce({ taskId: 'task-world-regenerated', status: 'queued' })

    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/world-bible',
      method: 'PATCH',
      body: {
        action: 'regenerate-asset',
        code: 'WORLD-FORMULA',
        prompt: 'WORLD-FORMULA edited prompt',
        seedMode: 'reuse',
        meta: { locale: 'zh' },
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(202)
    expect(submitterMock.submitTask).toHaveBeenCalledTimes(1)
    expect(submitterMock.submitTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        prompt: 'WORLD-FORMULA edited prompt',
        modelKey: 'atlascloud::flux-2-pro',
        referenceImages: ['images/ref-1.png', 'images/ref-2.png'],
        seed: 456,
      }),
    }))
    const update = prismaMock.visualDevelopmentWorkspace.update.mock.calls.at(-1)?.[0]
    const saved = update?.data.worldBible as { assets: Array<{ code: string; taskId: string; prompt: string; approved: boolean; history: Array<{ taskId: string; prompt: string }> }> }
    const regenerated = saved.assets.find((asset) => asset.code === 'WORLD-FORMULA')
    expect(regenerated).toMatchObject({
      taskId: 'task-world-regenerated',
      prompt: 'WORLD-FORMULA edited prompt',
      approved: false,
    })
    expect(regenerated?.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: 'task-WORLD-FORMULA', prompt: 'WORLD-FORMULA original prompt' }),
    ]))
  })

  it('四張資產完成且全數通過 -> 建立可追溯 World Canon', async () => {
    const approvedAssets = ['WORLD-FORMULA', 'FACTION-COLOR', 'MATERIAL-AGING', 'ARCH-SYMBOL'].map((code) => ({
      code, taskId: `task-${code}`, prompt: code, negativePrompt: '', requestedSeed: null, seedStatus: 'unsupported', approved: true, rejectionNote: null,
    }))
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1', projectId: 'project-1', worldVersion: 3, status: 'world_review', worldBible: { ...completeWorld, assets: approvedAssets },
    })
    prismaMock.task.count.mockResolvedValue(4)
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/world-bible', method: 'PATCH', body: { action: 'canon-lock' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.canonId).toBe('WORLD-PROJECT--v003')
    const update = prismaMock.visualDevelopmentWorkspace.update.mock.calls.at(-1)?.[0]
    expect(update?.data.status).toBe('world_locked')
    expect((update?.data.worldBible as { canonId: string }).canonId).toBe('WORLD-PROJECT--v003')
  })

  it('有效 PNG 參考圖 -> 上傳並寫入專案 World Bible', async () => {
    prismaMock.visualDevelopmentWorkspace.findUnique.mockResolvedValue({
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_draft', worldBible: { ...completeWorld, references: [] },
    })
    const form = new FormData()
    form.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'reference.png', { type: 'image/png' }))
    form.append('category', 'architecture')
    const request = new NextRequest('http://localhost/api/visual-development/project-1/world-bible/reference', { method: 'POST', body: form })
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/reference/route')
    const response = await mod.POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(cosMock.uploadToCOS).toHaveBeenCalledWith(expect.any(Buffer), 'images/visual-development/world/project-1/reference/ref.png')
    expect(body.data.reference.category).toBe('architecture')
    const update = prismaMock.visualDevelopmentWorkspace.upsert.mock.calls.at(-1)?.[0]
    const savedWorldBible = update?.update.worldBible as { references: unknown[] }
    expect(savedWorldBible.references).toHaveLength(1)
  })
})
