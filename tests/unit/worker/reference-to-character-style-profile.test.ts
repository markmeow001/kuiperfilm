import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHARACTER_PROMPT_SUFFIX, CHARACTER_IMAGE_BANANA_RATIO } from '@/lib/constants'
import { TASK_TYPE, type TaskJobData, type TaskType } from '@/lib/task/types'

// ============================================================================
// P1-4: reference-to-character styleProfile pass-through behavior.
//
// Q-006 / Phase 11.5 / Bug-4: implementer round 2 wired reference-to-character
// to load styleProfile via loadStyleProfileByProjectId(prisma, job.data.projectId)
// and pass it through to generateLabeledImageToCos (chokepoint). Chokepoint is
// the single owner of prepend + capability filter; handler emits raw prompt +
// raw styleProfile.
//
// Pattern mirrors character-image-task-handler.test.ts: mock chokepoint
// (generateLabeledImageToCos) so we can inspect the args handler passes through.
// We keep the existing reference-to-character.test.ts (legacy generateImage
// path) untouched per the rule "不准改現有測試斷言".
// ============================================================================

type StyleProfileForGen = {
  positivePrompt: string | null
  negativePrompt: string | null
  referenceImageUrls: string[]
} | null
type GenerateLabeledImageToCosArg = {
  prompt: string
  label?: string
  targetId?: string
  keyPrefix?: string
  options?: {
    aspectRatio?: string
    referenceImages?: string[]
    negativePrompt?: string | null
  }
  styleProfile?: StyleProfileForGen
}

const sharedMock = vi.hoisted(() => ({
  generateLabeledImageToCos: vi.fn<(arg: GenerateLabeledImageToCosArg) => Promise<string>>(
    async () => 'cos/ref-char-generated.png',
  ),
}))

const styleProfileLoaderMock = vi.hoisted(() => ({
  loadStyleProfileByProjectId: vi.fn(async () => null as null | {
    positivePrompt: string | null
    negativePrompt: string | null
    referenceImageUrls: string[]
  }),
  loadStyleProfile: vi.fn(async () => null),
}))

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiVisionStep: vi.fn(async () => ({ text: 'AI_EXTRACTED_DESCRIPTION' })),
}))

const apiConfigMock = vi.hoisted(() => ({
  // FAL key present so handler enters the three-view generation branch (calls
  // generateLabeledImageToCos x 3).
  getProviderConfig: vi.fn(async () => ({ apiKey: 'fal-key' })),
}))

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    characterModel: 'character-model-1',
    analysisModel: '', // empty so we skip background description extraction path
  })),
}))

const cosMock = vi.hoisted(() => ({
  generateUniqueKey: vi.fn(() => 'unique-key.jpg'),
  getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
  uploadToCOS: vi.fn(async () => 'cos/uploaded.jpg'),
}))

const fontsMock = vi.hoisted(() => ({
  initializeFonts: vi.fn(async () => {}),
}))

const workersSharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => {}),
}))

const workersUtilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => {}),
  // 2026-06-02 — these tests exercise the multi-view GENERATION path, so the
  // model is treated as reference-capable (supportReferenceImage: true) and
  // the handler does NOT take the new "use uploaded image directly" branch.
  resolveModelStyleCapabilities: vi.fn(() => ({
    supportReferenceImage: true,
    supportNegativePrompt: true,
  })),
  uploadImageSourceToCos: vi.fn(async () => 'cos://uploaded-ref'),
}))

const promptI18nMock = vi.hoisted(() => ({
  PROMPT_IDS: {
    CHARACTER_IMAGE_TO_DESCRIPTION: 'character_image_to_description',
    CHARACTER_REFERENCE_TO_SHEET: 'character_reference_to_sheet',
  },
  buildPrompt: vi.fn((input: { promptId: string }) => (
    input.promptId === 'character_reference_to_sheet'
      ? 'BASE_REFERENCE_PROMPT'
      : 'ANALYSIS_PROMPT'
  )),
}))

const prismaMock = vi.hoisted(() => ({
  globalCharacterAppearance: {
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  characterAppearance: {
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  // Loader is mocked above, but the source file imports prisma; provide a
  // safe default for any unforeseen findUnique reads.
  novelPromotionProject: {
    findUnique: vi.fn(async () => null),
  },
}))

const loggingMock = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  createScopedLogger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })),
}))

// ===== Mock registrations (must precede real import) =====
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/style-profile/loader', () => styleProfileLoaderMock)
vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/fonts', () => fontsMock)
vi.mock('@/lib/workers/shared', () => workersSharedMock)
vi.mock('@/lib/workers/utils', () => workersUtilsMock)
vi.mock('@/lib/prompt-i18n', () => promptI18nMock)
vi.mock('@/lib/logging/core', () => loggingMock)
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/workers/handlers/image-task-handler-shared')
  >('@/lib/workers/handlers/image-task-handler-shared')
  return {
    ...actual,
    generateLabeledImageToCos: sharedMock.generateLabeledImageToCos,
  }
})

import { handleReferenceToCharacterTask } from '@/lib/workers/handlers/reference-to-character'

function buildJob(payload: Record<string, unknown>, type: TaskType): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type,
      locale: 'zh',
      projectId: 'project-1',
      targetType: 'GlobalCharacter',
      targetId: 'target-1',
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker reference-to-character styleProfile pass-through (P1-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sharedMock.generateLabeledImageToCos.mockResolvedValue('cos/ref-char-generated.png')
  })

  it('project styleProfile non-null -> generateLabeledImageToCos receives raw styleProfile pass-through (no prepend in prompt)', async () => {
    const styleProfileFixture = {
      positivePrompt: 'STYLE_POS',
      negativePrompt: 'STYLE_NEG',
      referenceImageUrls: ['/m/style-ref-1'],
    }
    styleProfileLoaderMock.loadStyleProfileByProjectId.mockResolvedValueOnce(styleProfileFixture)

    const job = buildJob(
      {
        referenceImageUrls: ['https://example.com/ref-a.png'],
        characterName: 'Hero',
      },
      TASK_TYPE.REFERENCE_TO_CHARACTER,
    )

    await handleReferenceToCharacterTask(job)

    // Loader 必須以 job.data.projectId 呼叫（business contract）
    expect(styleProfileLoaderMock.loadStyleProfileByProjectId).toHaveBeenCalledWith(
      expect.anything(),
      'project-1',
    )

    // chokepoint 必須收到 raw styleProfile（透傳，不被 handler 動過）
    const firstCall = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    expect(firstCall).toBeDefined()
    expect(firstCall?.styleProfile).toEqual(styleProfileFixture)
    // 三視圖每張都應該收到同一份 styleProfile（不是只第一張）
    expect(sharedMock.generateLabeledImageToCos).toHaveBeenCalledTimes(3)
    for (const call of sharedMock.generateLabeledImageToCos.mock.calls) {
      expect(call[0].styleProfile).toEqual(styleProfileFixture)
    }
    // handler 不再 prepend — raw prompt 裡不應該出現 STYLE_POS marker
    expect(firstCall?.prompt).not.toContain('STYLE_POS')
    expect(firstCall?.prompt).toContain(CHARACTER_PROMPT_SUFFIX)
    expect(firstCall?.options?.aspectRatio).toBe(CHARACTER_IMAGE_BANANA_RATIO)
  })

  it('model can NOT img2img + uploaded reference -> uses the upload directly (no multi-view gen)', async () => {
    // 2026-06-02 — when the character model is text-only (AtlasCloud
    // nano-banana drops reference_images), regenerating a multi-view would
    // hallucinate a different character (user: 上傳自己的角色圖後變得跟原本
    // 不一樣). The handler must persist the UPLOADED image instead of calling
    // generateLabeledImageToCos.
    workersUtilsMock.resolveModelStyleCapabilities.mockReturnValueOnce({
      supportReferenceImage: false,
      supportNegativePrompt: false,
    })

    const job = buildJob(
      {
        referenceImageUrls: ['https://example.com/my-character.png'],
        characterName: 'Hero',
      },
      TASK_TYPE.REFERENCE_TO_CHARACTER,
    )

    await handleReferenceToCharacterTask(job)

    // Multi-view generation must be skipped...
    expect(sharedMock.generateLabeledImageToCos).not.toHaveBeenCalled()
    // ...and the uploaded image persisted to COS as-is instead.
    expect(workersUtilsMock.uploadImageSourceToCos).toHaveBeenCalledWith(
      'https://example.com/my-character.png',
      expect.any(String),
      expect.any(String),
    )
  })

  it('project styleProfile null (loader returns null) -> generateLabeledImageToCos receives styleProfile = null (pass-through unchanged)', async () => {
    styleProfileLoaderMock.loadStyleProfileByProjectId.mockResolvedValueOnce(null)

    const job = buildJob(
      {
        referenceImageUrls: ['https://example.com/ref-a.png'],
        characterName: 'Hero',
      },
      TASK_TYPE.REFERENCE_TO_CHARACTER,
    )

    await handleReferenceToCharacterTask(job)

    const firstCall = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    expect(firstCall).toBeDefined()
    expect(firstCall?.styleProfile).toBeNull()
    // prompt 是 raw user prompt（防 trivial pass — 至少非空 + 含 character suffix）
    expect(firstCall?.prompt.length).toBeGreaterThan(0)
    expect(firstCall?.prompt).toContain(CHARACTER_PROMPT_SUFFIX)
    expect(firstCall?.prompt).not.toMatch(/STYLE_POS|STYLE_NEG/)
  })

  // ============================================================================
  // 第四輪 mini round 4 補強（路線 B）：
  // 舊測試 reference-to-character.test.ts 有兩個業務行為案例 —
  //   1) customDescription disables reference-image injection
  //   2) background-mode persists extracted description
  // 因為 implementer round 2 改走 chokepoint (generateLabeledImageToCos)，
  // 舊測試的 generatorApiMock.generateImage 斷言已不可能滿足，故已刪除這兩個 case。
  // 這兩個獨立業務行為改在這裡用「mock chokepoint」方式覆蓋。
  // ============================================================================

  it('customDescription provided -> generateLabeledImageToCos receives suffix-appended prompt and NO referenceImages (injection disabled)', async () => {
    // styleProfile 不是這個 case 的重點，loader 預設回 null（chokepoint 透傳 null）。
    styleProfileLoaderMock.loadStyleProfileByProjectId.mockResolvedValueOnce(null)

    const job = buildJob(
      {
        referenceImageUrls: ['https://example.com/ref-a.png', 'https://example.com/ref-b.png'],
        customDescription: '冷静黑发角色',
        characterName: 'Hero',
      },
      TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER,
    )

    const result = await handleReferenceToCharacterTask(job)

    expect(result).toEqual(expect.objectContaining({ success: true }))
    // 三視圖各一次（chokepoint 共三次）
    expect(sharedMock.generateLabeledImageToCos).toHaveBeenCalledTimes(3)

    const firstCall = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    expect(firstCall).toBeDefined()
    // customDescription 必須被送進 prompt
    expect(firstCall?.prompt).toContain('冷静黑发角色')
    // suffix 必須被附上（addCharacterPromptSuffix）
    expect(firstCall?.prompt).toContain(CHARACTER_PROMPT_SUFFIX)
    // BANANA ratio 透過 options
    expect(firstCall?.options?.aspectRatio).toBe(CHARACTER_IMAGE_BANANA_RATIO)
    // customDescription 提供時，referenceImages 注入應被關閉
    expect(firstCall?.options?.referenceImages).toBeUndefined()
  })

  it('background-mode (asset-hub) -> persists extracted description + cos image url to globalCharacterAppearance', async () => {
    styleProfileLoaderMock.loadStyleProfileByProjectId.mockResolvedValueOnce(null)
    // 走 background-mode 路徑時 handler 必須有 analysisModel 才會 call vision 提取 description；
    // 預設 analysisModel = ''，這個 case 需要覆寫一次。
    configServiceMock.getUserModelConfig.mockResolvedValueOnce({
      characterModel: 'character-model-1',
      analysisModel: 'analysis-model-1',
    })
    aiRuntimeMock.executeAiVisionStep.mockResolvedValueOnce({ text: 'AI_EXTRACTED_DESCRIPTION' })
    sharedMock.generateLabeledImageToCos.mockResolvedValue('cos/ref-char-bg-image.png')

    const job = buildJob(
      {
        referenceImageUrls: [' https://example.com/ref-a.png ', 'https://example.com/ref-b.png'],
        isBackgroundJob: true,
        characterId: 'character-1',
        appearanceId: 'appearance-1',
        characterName: 'Hero',
      },
      TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER,
    )

    const result = await handleReferenceToCharacterTask(job)

    expect(result).toEqual({ success: true })
    expect(sharedMock.generateLabeledImageToCos).toHaveBeenCalledTimes(3)

    // chokepoint 第一次呼叫：referenceImages 必須被透傳（兩張，且 trim 過）
    const firstCall = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    expect(firstCall?.options?.referenceImages).toEqual([
      'https://example.com/ref-a.png',
      'https://example.com/ref-b.png',
    ])
    expect(firstCall?.options?.aspectRatio).toBe(CHARACTER_IMAGE_BANANA_RATIO)
    // template 流向（沒給 customDescription）→ 應使用 BASE_REFERENCE_PROMPT + suffix
    expect(firstCall?.prompt).toContain('BASE_REFERENCE_PROMPT')
    expect(firstCall?.prompt).toContain(CHARACTER_PROMPT_SUFFIX)

    // background-mode 必須把 vision 提出的 description 持久化到 asset-hub appearance row
    const updateArg = prismaMock.globalCharacterAppearance.update.mock.calls[0]?.[0] as {
      data?: Record<string, unknown>
      where?: Record<string, unknown>
    } | undefined
    expect(updateArg?.where).toEqual({ id: 'appearance-1' })
    const updateData = updateArg?.data || {}
    expect(updateData.description).toBe('AI_EXTRACTED_DESCRIPTION')
    expect(updateData.imageUrl).toBe('cos/ref-char-bg-image.png')
    expect(typeof updateData.imageUrls).toBe('string')
  })
})
