import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData, type TaskType } from '@/lib/task/types'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => {}),
  getProjectModels: vi.fn(async () => ({ editModel: 'edit-model' })),
  getUserModels: vi.fn(async () => ({ editModel: 'edit-model', analysisModel: 'analysis-model' })),
  resolveImageSourceFromGeneration: vi.fn<(job: unknown, params: Record<string, unknown>) => Promise<string>>(async () => 'generated-image-source'),
  stripLabelBar: vi.fn(async () => 'required-reference-image'),
  toSignedUrlIfCos: vi.fn(() => 'https://signed/current-image.png'),
  uploadImageSourceToCos: vi.fn(async () => 'cos/new-image.png'),
  withLabelBar: vi.fn(async (source: unknown) => source),
}))

const outboundImageMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async () => ['normalized-reference-image']),
  normalizeToBase64ForGeneration: vi.fn(async () => 'base64-reference'),
}))

const llmClientMock = vi.hoisted(() => ({
  chatCompletionWithVision: vi.fn(async () => ({ output_text: 'AI_EXTRACTED_DESCRIPTION' })),
  getCompletionContent: vi.fn(() => 'AI_EXTRACTED_DESCRIPTION'),
}))

// Q-009: image-task-handlers-core 改用 executeAiVisionStep 從 @/lib/ai-runtime 提取
// 描述（取代舊 chatCompletionWithVision）。Mock 該入口讓 vision 描述提取在背景靜默完成。
const aiRuntimeMock = vi.hoisted(() => ({
  executeAiVisionStep: vi.fn(async () => ({ text: 'AI_EXTRACTED_DESCRIPTION' })),
}))

const promptMock = vi.hoisted(() => ({
  PROMPT_IDS: {
    CHARACTER_IMAGE_TO_DESCRIPTION: 'character_image_to_description',
  },
  buildPrompt: vi.fn(() => 'vision-prompt-template'),
}))

const loggerWarnMock = vi.hoisted(() => vi.fn())
const loggingMock = vi.hoisted(() => ({
  // 2026-06-03 — cos.ts (transitively imported) calls .info/.error at module
  // load; the partial mock (warn-only) threw "cosLogger.info is not a function"
  // and killed the whole file at collection. Provide the full logger shape.
  createScopedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  })),
}))

const prismaMock = vi.hoisted(() => ({
  characterAppearance: {
    findUnique: vi.fn(),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  locationImage: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  novelPromotionPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  // Q-009: loadStyleProfile resolves reference image MediaObject ids when
  // styleReferenceImages JSON is non-null. Default empty so loader stays a no-op
  // unless a per-test override sets references.
  mediaObject: {
    findMany: vi.fn(async () => [] as unknown[]),
  },
  globalCharacter: {
    findFirst: vi.fn(),
  },
  globalCharacterAppearance: {
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  globalLocation: {
    findFirst: vi.fn(),
  },
  globalLocationImage: {
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
}))

vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/outbound-image', () => outboundImageMock)
vi.mock('@/lib/llm-client', () => llmClientMock)
vi.mock('@/lib/ai-runtime', () => aiRuntimeMock)
vi.mock('@/lib/prompt-i18n', () => promptMock)
vi.mock('@/lib/logging/core', () => loggingMock)
vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

import { handleModifyAssetImageTask } from '@/lib/workers/handlers/image-task-handlers-core'
import { handleAssetHubModifyTask } from '@/lib/workers/handlers/asset-hub-modify-task-handler'

function buildJob(type: TaskType, payload: Record<string, unknown>): Job<TaskJobData> {
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

function getUpdateData(callArg: unknown): Record<string, unknown> {
  if (!callArg || typeof callArg !== 'object') return {}
  const maybeData = (callArg as { data?: unknown }).data
  if (!maybeData || typeof maybeData !== 'object') return {}
  return maybeData as Record<string, unknown>
}

describe('modify image with references writes real description', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Q-009: image-task-handlers-core 在進入 type-specific 分支前會呼叫
    // loadStyleProfile(prisma, projectId) 取 styleProfile。讓 loader 跑真實
    // 邏輯（不 mock loader 本身）— 這裡只 mock 一層下游 prisma。
    // 第一次 findUnique by id 失敗（測試 projectId='project-1' 是 Project.id 不是
    // NovelPromotionProject.id），fallback by projectId 命中。
    prismaMock.novelPromotionProject.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'np-project-1',
        projectId: 'project-1',
        stylePositivePrompt: null,
        styleNegativePrompt: null,
        styleReferenceImages: null,
        project: { userId: 'user-1' },
      })
    aiRuntimeMock.executeAiVisionStep.mockResolvedValue({ text: 'AI_EXTRACTED_DESCRIPTION' })

    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      id: 'appearance-1',
      imageUrls: JSON.stringify(['cos/original-image.png']),
      imageUrl: 'cos/original-image.png',
      selectedIndex: 0,
      changeReason: 'base',
      description: 'old description',
      character: { name: 'Hero' },
    })

    prismaMock.globalCharacter.findFirst.mockResolvedValue({
      id: 'global-character-1',
      name: 'Hero',
      appearances: [
        {
          id: 'global-appearance-1',
          appearanceIndex: 0,
          changeReason: 'base',
          imageUrl: 'cos/original-global.png',
          imageUrls: JSON.stringify(['cos/original-global.png']),
          selectedIndex: 0,
        },
      ],
    })
  })

  it('updates character appearance description from vision output in project modify handler', async () => {
    const job = buildJob(TASK_TYPE.MODIFY_ASSET_IMAGE, {
      type: 'character',
      appearanceId: 'appearance-1',
      modifyPrompt: 'enhance details',
      extraImageUrls: [' https://ref.example/a.png '],
    })

    await handleModifyAssetImageTask(job)

    expect(utilsMock.resolveImageSourceFromGeneration).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        options: expect.objectContaining({
          aspectRatio: '3:2',
          referenceImages: ['required-reference-image', 'normalized-reference-image'],
        }),
      }),
    )

    // Q-009: loadStyleProfile 結果（三栏全 null → null）必須透傳給 chokepoint。
    const generationArg = utilsMock.resolveImageSourceFromGeneration.mock.calls.at(-1)?.[1] as
      | { styleProfile?: unknown }
      | undefined
    expect(generationArg).toHaveProperty('styleProfile')
    expect(generationArg?.styleProfile).toBeNull()

    const updateArg = prismaMock.characterAppearance.update.mock.calls.at(-1)?.[0]
    const updateData = getUpdateData(updateArg)
    expect(updateData.description).toBe('AI_EXTRACTED_DESCRIPTION')
    expect(updateData.previousDescription).toBe('old description')
    expect(updateData.imageUrl).toBe('cos/new-image.png')
  })

  it('character modify -> non-null styleProfile from loader is passed through to chokepoint untouched', async () => {
    // Q-009: 覆寫 loader 下游 prisma mock，讓 loadStyleProfile 回傳完整 styleProfile。
    // mediaObject.findMany 回傳 owner 匹配的 row，loader 才會把 mediaId 解析成 /m/<publicId> URL。
    prismaMock.novelPromotionProject.findUnique.mockReset()
    prismaMock.novelPromotionProject.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'np-project-1',
        projectId: 'project-1',
        stylePositivePrompt: 'STYLE_POS',
        styleNegativePrompt: 'STYLE_NEG',
        styleReferenceImages: JSON.stringify(['media-ref-1']),
        project: { userId: 'user-1' },
      })
    prismaMock.mediaObject.findMany.mockResolvedValueOnce([
      {
        id: 'media-ref-1',
        publicId: 'pub-1',
        storageKey: 'cos/style-ref.png',
        uploadedByUserId: 'user-1',
      },
    ])

    const job = buildJob(TASK_TYPE.MODIFY_ASSET_IMAGE, {
      type: 'character',
      appearanceId: 'appearance-1',
      modifyPrompt: 'enhance details',
      extraImageUrls: [' https://ref.example/a.png '],
    })

    await handleModifyAssetImageTask(job)

    const generationArg = utilsMock.resolveImageSourceFromGeneration.mock.calls.at(-1)?.[1] as
      | { styleProfile?: { positivePrompt?: string | null; negativePrompt?: string | null; referenceImageUrls?: string[] } }
      | undefined
    expect(generationArg?.styleProfile).toEqual({
      positivePrompt: 'STYLE_POS',
      negativePrompt: 'STYLE_NEG',
      referenceImageUrls: ['/m/pub-1'],
    })
  })

  it('updates asset-hub character description from vision output when reference image exists', async () => {
    utilsMock.uploadImageSourceToCos.mockResolvedValueOnce('cos/new-global-image.png')

    const job = buildJob(TASK_TYPE.ASSET_HUB_MODIFY, {
      type: 'character',
      id: 'global-character-1',
      appearanceIndex: 0,
      imageIndex: 0,
      modifyPrompt: 'make it sharper',
      extraImageUrls: ['https://ref.example/b.png'],
    })

    await handleAssetHubModifyTask(job)

    const updateArg = prismaMock.globalCharacterAppearance.update.mock.calls.at(-1)?.[0]
    const updateData = getUpdateData(updateArg)
    expect(updateData.description).toBe('AI_EXTRACTED_DESCRIPTION')
    expect(updateData.imageUrl).toBe('cos/new-global-image.png')
    expect(updateData.imageUrls).toBe(JSON.stringify(['cos/new-global-image.png']))
  })
})
