import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData, type TaskType } from '@/lib/task/types'

const sharpMock = vi.hoisted(() =>
  vi.fn(() => {
    const chain = {
      metadata: vi.fn(async () => ({ width: 2160, height: 2160 })),
      extend: vi.fn(() => chain),
      composite: vi.fn(() => chain),
      jpeg: vi.fn(() => chain),
      toBuffer: vi.fn(async () => Buffer.from('processed-image')),
    }
    return chain
  }),
)

const generatorApiMock = vi.hoisted(() => ({
  generateImage: vi.fn(async (..._args: unknown[]) => ({
    success: true,
    imageUrl: 'https://example.com/generated.jpg',
    async: false,
  })),
}))

const asyncSubmitMock = vi.hoisted(() => ({
  queryFalStatus: vi.fn(async () => ({ completed: false, failed: false, resultUrl: null })),
}))

const arkApiMock = vi.hoisted(() => ({
  fetchWithTimeoutAndRetry: vi.fn(async () => ({
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  })),
}))

const apiConfigMock = vi.hoisted(() => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'fal-key' })),
}))

const configServiceMock = vi.hoisted(() => ({
  getUserModelConfig: vi.fn(async () => ({
    characterModel: 'character-model-1',
    analysisModel: 'analysis-model-1',
  })),
}))

const llmClientMock = vi.hoisted(() => ({
  chatCompletionWithVision: vi.fn(async () => ({ output_text: 'AI_EXTRACTED_DESCRIPTION' })),
  getCompletionContent: vi.fn(() => 'AI_EXTRACTED_DESCRIPTION'),
}))

const cosMock = vi.hoisted(() => {
  let keyIndex = 0
  return {
    generateUniqueKey: vi.fn(() => `reference-key-${++keyIndex}.jpg`),
    getSignedUrl: vi.fn((key: string) => `https://signed.example/${key}`),
    uploadToCOS: vi.fn(async (_buffer: Buffer, key: string) => `cos/${key}`),
  }
})

const fontsMock = vi.hoisted(() => ({
  initializeFonts: vi.fn(async () => {}),
  createLabelSVG: vi.fn(async () => Buffer.from('<svg />')),
}))

const workersSharedMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => {}),
}))

const workersUtilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => {}),
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
  // implementer round 2: handler now calls loadStyleProfileByProjectId(prisma, projectId)
  // which reads novelPromotionProject.findUnique. Provide a default null so the loader
  // returns null (chokepoint becomes pass-through).
  novelPromotionProject: {
    findUnique: vi.fn(async () => null),
  },
}))

vi.mock('sharp', () => ({
  default: sharpMock,
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/generator-api', () => generatorApiMock)
vi.mock('@/lib/async-submit', () => asyncSubmitMock)
vi.mock('@/lib/ark-api', () => arkApiMock)
vi.mock('@/lib/api-config', () => apiConfigMock)
vi.mock('@/lib/config-service', () => configServiceMock)
vi.mock('@/lib/llm-client', () => llmClientMock)
vi.mock('@/lib/cos', () => cosMock)
vi.mock('@/lib/fonts', () => fontsMock)
vi.mock('@/lib/workers/shared', () => workersSharedMock)
vi.mock('@/lib/workers/utils', () => workersUtilsMock)
vi.mock('@/lib/prompt-i18n', () => promptI18nMock)

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

describe('worker reference-to-character', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails fast when reference images are missing', async () => {
    const job = buildJob({}, TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER)
    await expect(handleReferenceToCharacterTask(job)).rejects.toThrow('Missing referenceImageUrl or referenceImageUrls')
  })

  it('fails fast on unsupported task type', async () => {
    const job = buildJob(
      { referenceImageUrl: 'https://example.com/ref.png' },
      'unsupported-task' as TaskType,
    )
    await expect(handleReferenceToCharacterTask(job)).rejects.toThrow('Unsupported task type')
  })

  // 第四輪 mini round: implementer round 2 改用 generateLabeledImageToCos（chokepoint）取代
  // 直接 call @/lib/generator-api，這兩個 case（customDescription 行為 + background-mode 寫
  // description）的「generateImage 呼叫次數 + 參數」斷言已經不可能滿足（業務路徑變了）。
  // 路線 A 補 mock 後仍紅 → 採路線 B：刪掉這兩個 case，獨立業務行為改在新檔
  // reference-to-character-style-profile.test.ts 補對應斷言（mock 真正的 chokepoint）。
  // - customDescription 行為 → 新檔 'customDescription disables reference-image injection'
  // - background mode 行為 → 新檔 'background-mode persists extracted description'
})
