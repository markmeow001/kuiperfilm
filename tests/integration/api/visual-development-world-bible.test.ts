import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockRequest } from '../../helpers/request'
import { installAuthMocks, mockAuthenticated, resetAuthMockState } from '../../helpers/auth'

const workspaceState = vi.hoisted(() => ({ value: null as Record<string, unknown> | null }))
const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  visualDevelopmentWorkspace: {
    findUnique: vi.fn(async () => workspaceState.value),
    updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (workspaceState.value) workspaceState.value = { ...workspaceState.value, ...args.data, updatedAt: new Date() }
      return { count: 1 }
    }),
    upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
      id: 'workspace-1',
      worldVersion: 1,
      status: args.update.status ?? args.create.status,
    })),
    update: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
  },
  task: {
    findMany: vi.fn(async (): Promise<Array<{ id: string; payload: unknown }>> => []),
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
  research: {
    designQuestion: 'How does ritual conceal extraction?',
    visualHypothesis: 'Warm sacred surfaces hide cold biological infrastructure.',
    eraAndCulture: 'Post-collapse subterranean civic religion.',
    materialReality: 'Aged brass, yellowed lace, oxidized steel, damp membranes.',
    cinematicLanguage: 'Restrained lenses, practical light, deep blacks.',
    culturalBoundaries: 'No direct living religious symbols.',
    assumptionsAndUnknowns: 'The origin of surviving craft remains uncertain.',
    sourcePolicy: 'Trace every adopted source for internal research only.',
    references: [
      { id: 'research-face', key: 'images/research-face.png', name: 'face', category: 'casting-face', usage: 'use', note: 'Use grounded facial proportions.', sourceUrl: 'https://example.com/face', creator: 'Archive', license: '', rightsStatus: 'owned', externalProcessingAllowed: true, downstreamEnabled: true, reviewStatus: 'approved', rejectionNote: null, createdAt: '2026-07-31' },
      { id: 'research-costume', key: 'images/research-costume.png', name: 'costume', category: 'costume-material', usage: 'use', note: 'Use layered practical construction.', sourceUrl: 'https://example.com/costume', creator: 'Archive', license: '', rightsStatus: 'owned', externalProcessingAllowed: true, downstreamEnabled: true, reviewStatus: 'approved', rejectionNote: null, createdAt: '2026-07-31' },
      { id: 'research-film', key: 'images/research-film.png', name: 'film', category: 'film-color', usage: 'use', note: 'Use motivated practical light.', sourceUrl: 'https://example.com/film', creator: 'Archive', license: '', rightsStatus: 'owned', externalProcessingAllowed: true, downstreamEnabled: true, reviewStatus: 'approved', rejectionNote: null, createdAt: '2026-07-31' },
      { id: 'research-culture', key: 'images/research-culture.png', name: 'culture', category: 'culture-symbol', usage: 'use', note: 'Use non-linguistic circular motifs.', sourceUrl: 'https://example.com/culture', creator: 'Archive', license: '', rightsStatus: 'owned', externalProcessingAllowed: true, downstreamEnabled: true, reviewStatus: 'approved', rejectionNote: null, createdAt: '2026-07-31' },
    ],
    status: 'locked',
    version: 1,
    canonId: 'RESEARCH-PROJECT--v001',
    lockedAt: '2026-07-31T00:00:00.000Z',
  },
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
    prismaMock.project.findUnique.mockResolvedValue({ userId: 'user-1' })
    workspaceState.value = {
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_draft', worldBible: completeWorld,
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    }
    prismaMock.visualDevelopmentWorkspace.findUnique.mockImplementation(async () => workspaceState.value)
    prismaMock.visualDevelopmentWorkspace.updateMany.mockImplementation(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (workspaceState.value) workspaceState.value = { ...workspaceState.value, ...args.data, updatedAt: new Date() }
      return { count: 1 }
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

  it('Research Canon 尚未鎖定 -> Phase 00 不得送出生圖任務', async () => {
    workspaceState.value = {
      id: 'workspace-1',
      projectId: 'project-1',
      worldVersion: 1,
      status: 'world_draft',
      worldBible: { ...completeWorld, research: { ...completeWorld.research, status: 'draft', canonId: null, lockedAt: null } },
    }
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.POST(generateRequest('atlascloud::flux-2-pro'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('RESEARCH_CANON_REQUIRED')
    expect(apiConfigMock.resolveModelSelection).not.toHaveBeenCalled()
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('World autosave 使用舊 revision -> 回報衝突且不覆蓋較新的 Research Canon', async () => {
    prismaMock.visualDevelopmentWorkspace.updateMany.mockResolvedValueOnce({ count: 0 })
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.PUT(buildMockRequest({
      path: '/api/visual-development/project-1/world-bible',
      method: 'PUT',
      body: { worldBible: { projectPremise: 'stale value' } },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('VISUAL_DEVELOPMENT_WRITE_CONFLICT')
  })

  it('Research Canon references exceed the selected model hard limit -> rejects before paid submission', async () => {
    workspaceState.value = {
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_draft',
      worldBible: {
        ...completeWorld,
        research: {
          ...completeWorld.research,
          references: Array.from({ length: 11 }, (_, index) => ({
            ...completeWorld.research.references[index % completeWorld.research.references.length],
            id: `approved-${index}`,
            key: `images/approved-${index}.png`,
          })),
        },
      },
    }
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud', modelId: 'flux-2-pro', modelKey: 'atlascloud::flux-2-pro',
    })
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.POST(generateRequest('atlascloud::flux-2-pro'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.details.code).toBe('MODEL_REFERENCE_IMAGE_LIMIT_EXCEEDED')
    expect(body.error.details.details).toMatchObject({ got: 11, max: 10 })
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
    expect(submissions[0]?.payload.referenceImages).toEqual([
      'images/research-face.png',
      'images/research-costume.png',
      'images/research-film.png',
      'images/research-culture.png',
    ])
    const prompts = submissions.map((submission) => String(submission.payload.prompt))
    expect(prompts).toEqual(expect.arrayContaining([
      expect.stringContaining('live-action establishing shot that expresses the governing contradiction'),
      expect.stringContaining('live-action scene that expresses faction hierarchy'),
      expect.stringContaining('photorealistic set-detail or still-life photograph'),
      expect.stringContaining('photorealistic live-action architecture shot'),
    ]))
    expect(prompts.every((prompt) => prompt.includes('must contain zero written characters'))).toBe(true)
    expect(prompts.every((prompt) => prompt.includes('LOCKED RESEARCH CANON'))).toBe(true)
    expect(prompts.every((prompt) => prompt.includes('Warm sacred surfaces hide cold biological infrastructure.'))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes('World Core Formula'))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes('Faction Color System'))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes('Material & Aging Rules'))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes('Architecture, Symbols & Exclusions'))).toBe(true)
    const reservationWrite = prismaMock.visualDevelopmentWorkspace.updateMany.mock.calls[0]?.[0]
    expect((reservationWrite?.data.worldBible as { generationReservation: { ownerUserId: string } }).generationReservation.ownerUserId).toBe('user-1')
    const update = prismaMock.visualDevelopmentWorkspace.updateMany.mock.calls.at(-1)?.[0]
    const savedWorldBible = update?.data.worldBible as { assets: unknown[] }
    expect(savedWorldBible.assets).toHaveLength(4)
  })

  it('生成批次 reservation 寫入衝突 -> 不會先送出任何付費任務', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud', modelId: 'flux-2-pro', modelKey: 'atlascloud::flux-2-pro',
    })
    prismaMock.visualDevelopmentWorkspace.updateMany.mockResolvedValueOnce({ count: 0 })
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.POST(generateRequest('atlascloud::flux-2-pro'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('VISUAL_DEVELOPMENT_WRITE_CONFLICT')
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
  })

  it('任務送出後遇到協作 autosave -> 重新合併最新文件並保留全部 task IDs', async () => {
    apiConfigMock.resolveModelSelection.mockResolvedValue({
      provider: 'atlascloud', modelId: 'flux-2-pro', modelKey: 'atlascloud::flux-2-pro',
    })
    let writes = 0
    prismaMock.visualDevelopmentWorkspace.updateMany.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      writes += 1
      if (writes === 2 && workspaceState.value) {
        const latestWorldBible = workspaceState.value.worldBible as Record<string, unknown>
        workspaceState.value = {
          ...workspaceState.value,
          worldBible: { ...latestWorldBible, projectPremise: 'A collaborator refined the premise during submission.' },
          updatedAt: new Date(),
        }
        return { count: 0 }
      }
      if (workspaceState.value) workspaceState.value = { ...workspaceState.value, ...args.data, updatedAt: new Date() }
      return { count: 1 }
    })
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.POST(generateRequest('atlascloud::flux-2-pro'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })

    expect(response.status).toBe(202)
    expect(writes).toBe(3)
    const savedWorldBible = workspaceState.value?.worldBible as { projectPremise: string; assets: Array<{ taskId: string }>; generationReservation: unknown }
    expect(savedWorldBible.projectPremise).toBe('A collaborator refined the premise during submission.')
    expect(savedWorldBible.assets.map((asset) => asset.taskId)).toHaveLength(4)
    expect(savedWorldBible.generationReservation).toBeNull()
  })

  it('伺服器於送出後中斷 -> 從既有任務完整復原 reservation 並避免重複扣款', async () => {
    const runId = 'recover-complete-run'
    const pendingAssets = ['WORLD-FORMULA', 'FACTION-COLOR', 'MATERIAL-AGING', 'ARCH-SYMBOL'].map((code) => ({
      code,
      prompt: `${code} prompt`,
      negativePrompt: 'text, watermark',
      requestedSeed: null,
      seedStatus: 'unsupported',
      approved: false,
      rejectionNote: null,
      originPrompt: `${code} prompt`,
      history: [],
    }))
    workspaceState.value = {
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_submitting',
      worldBible: {
        ...completeWorld,
        generationReservation: {
          id: runId,
          ownerUserId: 'user-1',
          kind: 'initial',
          startedAt: '2026-07-30T00:00:00.000Z',
          pendingAssets,
        },
      },
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    }
    prismaMock.task.findMany.mockResolvedValue(pendingAssets.map((asset) => ({
      id: `recovered-${asset.code}`,
      payload: { meta: { visualDevelopmentWorldAssetCode: asset.code } },
    })))

    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.POST(generateRequest('atlascloud::flux-2-pro'), {
      params: Promise.resolve({ projectId: 'project-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({ reconciled: true, resolved: true, recovered: 4, expected: 4 })
    expect(apiConfigMock.resolveModelSelection).not.toHaveBeenCalled()
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
    const saved = workspaceState.value?.worldBible as {
      generationReservation: unknown
      assets: Array<{ code: string; taskId: string }>
    }
    expect(saved.generationReservation).toBeNull()
    expect(saved.assets).toEqual(expect.arrayContaining(pendingAssets.map((asset) => expect.objectContaining({
      code: asset.code,
      taskId: `recovered-${asset.code}`,
    }))))
    expect(workspaceState.value?.status).toBe('world_generating')
  })

  it('舊版 ownerless reservation 僅允許專案擁有者復原', async () => {
    const runId = 'legacy-ownerless-run'
    const pendingAssets = ['WORLD-FORMULA', 'FACTION-COLOR', 'MATERIAL-AGING', 'ARCH-SYMBOL'].map((code) => ({
      code, prompt: `${code} prompt`, negativePrompt: '', requestedSeed: null,
      seedStatus: 'unsupported', approved: false, rejectionNote: null, originPrompt: `${code} prompt`, history: [],
    }))
    workspaceState.value = {
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_submitting',
      worldBible: {
        ...completeWorld,
        generationReservation: {
          id: runId, kind: 'initial', startedAt: '2026-07-30T00:00:00.000Z', pendingAssets,
        },
      },
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    }
    prismaMock.task.findMany.mockResolvedValue(pendingAssets.map((asset) => ({
      id: `legacy-${asset.code}`,
      payload: { meta: { visualDevelopmentWorldAssetCode: asset.code } },
    })))

    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/world-bible', method: 'PATCH',
      body: { action: 'recover-generation' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { reconciled: true, resolved: true, recovered: 4 },
    })
    expect(prismaMock.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-1' }),
    }))
    expect((workspaceState.value?.worldBible as { generationReservation: unknown }).generationReservation).toBeNull()
  })

  it('逾時 reservation 僅找到部分任務 -> 保留已扣款資產並解除永久阻塞', async () => {
    const runId = 'recover-partial-run'
    const pendingAssets = ['WORLD-FORMULA', 'FACTION-COLOR', 'MATERIAL-AGING', 'ARCH-SYMBOL'].map((code) => ({
      code,
      prompt: `${code} prompt`,
      negativePrompt: 'text, watermark',
      requestedSeed: null,
      seedStatus: 'unsupported',
      approved: false,
      rejectionNote: null,
      originPrompt: `${code} prompt`,
      history: [],
    }))
    workspaceState.value = {
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_submitting',
      worldBible: {
        ...completeWorld,
        generationReservation: {
          id: runId,
          ownerUserId: 'user-1',
          kind: 'initial',
          startedAt: '2026-07-30T00:00:00.000Z',
          pendingAssets,
        },
      },
      updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    }
    prismaMock.task.findMany.mockResolvedValue([{
      id: 'recovered-WORLD-FORMULA',
      payload: { meta: { visualDevelopmentWorldAssetCode: 'WORLD-FORMULA' } },
    }])

    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/world-bible',
      method: 'PATCH',
      body: {
        action: 'regenerate-asset',
        code: 'WORLD-FORMULA',
        prompt: 'This retry must recover instead of creating another paid task.',
      },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        action: 'recover-generation',
        requestedAction: 'regenerate-asset',
        reconciled: true,
        resolved: true,
      },
    })
    expect(submitterMock.submitTask).not.toHaveBeenCalled()
    const saved = workspaceState.value?.worldBible as {
      generationReservation: unknown
      assets: Array<{ code: string; taskId: string }>
    }
    expect(saved.generationReservation).toBeNull()
    expect(saved.assets).toEqual([expect.objectContaining({
      code: 'WORLD-FORMULA',
      taskId: 'recovered-WORLD-FORMULA',
    })])
    expect(workspaceState.value?.status).toBe('world_partial_failed')
  })

  it('協作者不得復原或清除另一位使用者的付費生成 reservation', async () => {
    const runId = 'owner-isolated-run'
    workspaceState.value = {
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_submitting',
      worldBible: {
        ...completeWorld,
        generationReservation: {
          id: runId,
          ownerUserId: 'user-1',
          kind: 'initial',
          startedAt: new Date().toISOString(),
          pendingAssets: [{
            code: 'WORLD-FORMULA', prompt: 'prompt', negativePrompt: '', requestedSeed: null,
            seedStatus: 'unsupported', approved: false, rejectionNote: null, originPrompt: 'prompt', history: [],
          }],
        },
      },
      updatedAt: new Date(),
    }
    mockAuthenticated('user-2')

    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/world-bible', method: 'PATCH',
      body: { action: 'recover-generation' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.details.code).toBe('WORLD_GENERATION_RESERVATION_OWNER_REQUIRED')
    expect(prismaMock.task.findMany).not.toHaveBeenCalled()
    expect((workspaceState.value?.worldBible as { generationReservation: { id: string } }).generationReservation.id).toBe(runId)
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
    workspaceState.value = {
      id: 'workspace-1',
      projectId: 'project-1',
      worldVersion: 1,
      status: 'world_generating',
      worldBible: { ...completeWorld, assets: activeAssets },
    }
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
    workspaceState.value = {
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_review', worldBible: { ...completeWorld, assets },
    }
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
        referenceImages: [
          'images/research-face.png',
          'images/research-costume.png',
          'images/research-film.png',
          'images/research-culture.png',
        ],
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
        referenceImages: [
          'images/research-face.png',
          'images/research-costume.png',
          'images/research-film.png',
          'images/research-culture.png',
        ],
        seed: 456,
      }),
    }))
    const update = prismaMock.visualDevelopmentWorkspace.updateMany.mock.calls.at(-1)?.[0]
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
    workspaceState.value = {
      id: 'workspace-1', projectId: 'project-1', worldVersion: 3, status: 'world_review', worldBible: { ...completeWorld, assets: approvedAssets },
    }
    prismaMock.task.count.mockResolvedValue(4)
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/world-bible', method: 'PATCH', body: { action: 'canon-lock' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.canonId).toBe('WORLD-PROJECT--v003')
    const update = prismaMock.visualDevelopmentWorkspace.updateMany.mock.calls.at(-1)?.[0]
    expect(update?.data.status).toBe('world_locked')
    expect((update?.data.worldBible as { canonId: string }).canonId).toBe('WORLD-PROJECT--v003')
  })

  it('舊資產已全數通過但缺少 Research Canon -> 後端仍拒絕鎖定 World Canon', async () => {
    const approvedAssets = ['WORLD-FORMULA', 'FACTION-COLOR', 'MATERIAL-AGING', 'ARCH-SYMBOL'].map((code) => ({
      code, taskId: `task-${code}`, prompt: code, negativePrompt: '', requestedSeed: null, seedStatus: 'unsupported', approved: true, rejectionNote: null,
    }))
    workspaceState.value = {
      id: 'workspace-1',
      projectId: 'project-1',
      worldVersion: 3,
      status: 'world_review',
      worldBible: {
        ...completeWorld,
        assets: approvedAssets,
        research: { ...completeWorld.research, status: 'draft', canonId: null, lockedAt: null },
      },
    }
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/route')
    const response = await mod.PATCH(buildMockRequest({
      path: '/api/visual-development/project-1/world-bible', method: 'PATCH', body: { action: 'canon-lock' },
    }), { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.details.code).toBe('RESEARCH_CANON_REQUIRED')
    expect(prismaMock.visualDevelopmentWorkspace.updateMany).not.toHaveBeenCalled()
  })

  it('有效 PNG 參考圖 -> 上傳並寫入專案 World Bible', async () => {
    workspaceState.value = {
      id: 'workspace-1', projectId: 'project-1', worldVersion: 1, status: 'world_draft', worldBible: { ...completeWorld, references: [] },
    }
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
    const update = prismaMock.visualDevelopmentWorkspace.updateMany.mock.calls.at(-1)?.[0]
    const savedWorldBible = update?.data.worldBible as { references: unknown[] }
    expect(savedWorldBible.references).toHaveLength(1)
  })

  it('Research Canon 已繼承十二張參考圖 -> 仍可加入不會送往外部的 Phase 00 站內參考圖', async () => {
    workspaceState.value = {
      id: 'workspace-1',
      projectId: 'project-1',
      worldVersion: 1,
      status: 'world_draft',
      worldBible: {
        ...completeWorld,
        references: [],
        research: {
          ...completeWorld.research,
          references: Array.from({ length: 12 }, (_, index) => ({
            ...completeWorld.research.references[index % completeWorld.research.references.length],
            id: `research-${index + 1}`,
            key: `images/research-${index + 1}.png`,
          })),
        },
      },
    }
    const form = new FormData()
    form.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'reference.png', { type: 'image/png' }))
    const request = new NextRequest('http://localhost/api/visual-development/project-1/world-bible/reference', { method: 'POST', body: form })
    const mod = await import('@/app/api/visual-development/[projectId]/world-bible/reference/route')
    const response = await mod.POST(request, { params: Promise.resolve({ projectId: 'project-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.reference.externalProcessingAllowed).toBe(false)
    expect(body.data.reference.reviewStatus).toBe('internal-only')
    expect(cosMock.uploadToCOS).toHaveBeenCalled()
  })
})
