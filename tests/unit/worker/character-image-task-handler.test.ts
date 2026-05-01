import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHARACTER_PROMPT_SUFFIX } from '@/lib/constants'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ characterModel: 'image-model-1', artStyle: 'noir' })),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => (url ? `https://signed.example/${url}` : null)),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async () => ['normalized-primary-ref']),
}))

const prismaMock = vi.hoisted(() => ({
  characterAppearance: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(async (..._args: unknown[]) => ({})),
  },
  novelPromotionCharacter: {
    findUnique: vi.fn(),
  },
  novelPromotionProject: {
    findUnique: vi.fn(async () => ({
      id: 'np-project-1',
      stylePositivePrompt: null,
      styleNegativePrompt: null,
      styleReferenceImagesJson: null,
    })),
  },
  novelPromotionEpisode: {
    findFirst: vi.fn(async () => ({ novelText: '' })),
  },
}))

// Bug-4 chokepoint: generateLabeledImageToCos 接受 raw styleProfile 参数（chokepoint 内做 prepend + capability filter）。
type StyleProfileForGen = {
  positivePrompt: string | null
  negativePrompt: string | null
  referenceImageUrls: string[]
} | null
type GenerateLabeledImageToCosArg = {
  prompt: string
  label?: string
  targetId?: string
  options?: {
    aspectRatio?: string
    referenceImages?: string[]
    negativePrompt?: string | null
  }
  styleProfile?: StyleProfileForGen
}
const sharedMock = vi.hoisted(() => ({
  generateLabeledImageToCos: vi.fn<(arg: GenerateLabeledImageToCosArg) => Promise<string>>(
    async () => 'cos/character-generated-0.png',
  ),
}))

const styleProfileLoaderMock = vi.hoisted(() => ({
  loadStyleProfile: vi.fn(async () => null as null | {
    positivePrompt: string | null
    negativePrompt: string | null
    referenceImageUrls: string[]
  }),
}))

vi.mock('@/lib/style-profile/loader', () => styleProfileLoaderMock)
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    generateLabeledImageToCos: sharedMock.generateLabeledImageToCos,
  }
})

import { handleCharacterImageTask } from '@/lib/workers/handlers/character-image-task-handler'

function buildJob(payload: Record<string, unknown>, targetId = 'appearance-2'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-character-image-1',
      type: TASK_TYPE.IMAGE_CHARACTER,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'CharacterAppearance',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker character-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.characterAppearance.findUnique.mockResolvedValue({
      id: 'appearance-2',
      characterId: 'character-1',
      appearanceIndex: 1,
      descriptions: JSON.stringify(['角色描述A']),
      description: '角色描述A',
      imageUrls: JSON.stringify([]),
      selectedIndex: 0,
      imageUrl: null,
      changeReason: '战斗形态',
      character: { name: 'Hero' },
    })

    prismaMock.characterAppearance.findFirst.mockResolvedValue({
      imageUrl: 'cos/primary.png',
      imageUrls: JSON.stringify(['cos/primary.png']),
    })
  })

  it('characterModel not configured -> explicit error', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({ characterModel: '', artStyle: 'noir' })
    await expect(handleCharacterImageTask(buildJob({}))).rejects.toThrow('Character model not configured')
  })

  it('success path -> uses primary appearance as reference and persists imageUrls', async () => {
    const job = buildJob({ imageIndex: 0 })
    const result = await handleCharacterImageTask(job)

    expect(result).toEqual({
      appearanceId: 'appearance-2',
      imageCount: 1,
      imageUrl: 'cos/character-generated-0.png',
    })

    const generationInput = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0] as {
      prompt: string
      options?: { referenceImages?: string[]; aspectRatio?: string }
    }

    expect(generationInput.prompt).toContain(CHARACTER_PROMPT_SUFFIX)
    expect(generationInput.options).toEqual(expect.objectContaining({
      referenceImages: ['normalized-primary-ref'],
      aspectRatio: '3:2',
    }))

    expect(prismaMock.characterAppearance.update).toHaveBeenCalledWith({
      where: { id: 'appearance-2' },
      data: {
        imageUrls: JSON.stringify(['cos/character-generated-0.png']),
        imageUrl: 'cos/character-generated-0.png',
      },
    })
  })

  // Bug-4 chokepoint approach: handler 把 raw userPrompt + raw styleProfile 透传给
  // generateLabeledImageToCos，chokepoint 内做 inject (prepend + capability filter)。
  // 因此 handler 测试只验证「styleProfile 原封不动透传」+ prompt 是 raw user prompt。
  it('project 有 styleProfile -> generateLabeledImageToCos 收到原 styleProfile 透传 + raw user prompt 不含 prepend marker', async () => {
    const styleProfileFixture = {
      positivePrompt: 'STYLE_POS',
      negativePrompt: 'STYLE_NEG',
      referenceImageUrls: ['https://style/ref-a.png'],
    }
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(styleProfileFixture)

    const job = buildJob({ imageIndex: 0 })
    await handleCharacterImageTask(job)

    const generationInput = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    // styleProfile 必须原封不动透传给 chokepoint
    expect(generationInput.styleProfile).toEqual(styleProfileFixture)
    // handler 不再自己 prepend — prompt 不含 STYLE_POS marker
    expect(generationInput.prompt).not.toContain('STYLE_POS')
    expect(generationInput.prompt.length).toBeGreaterThan(0)
    // handler 不再 inline 注入 negativePrompt — chokepoint 处理
    const neg = generationInput.options?.negativePrompt ?? null
    expect(neg).toBeNull()
  })

  it('project styleProfile 三栏全 null -> generateLabeledImageToCos 收到 styleProfile = null + prompt 是 raw user prompt', async () => {
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(null)

    const job = buildJob({ imageIndex: 0 })
    await handleCharacterImageTask(job)

    const generationInput = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    expect(generationInput.styleProfile).toBeNull()
    // prompt 是 raw user prompt（防 trivial pass — 至少非空）
    expect(generationInput.prompt.length).toBeGreaterThan(0)
    expect(generationInput.prompt).not.toMatch(/STYLE_POS|STYLE_NEG/)
    const neg = generationInput.options?.negativePrompt ?? null
    expect(neg).toBeNull()
  })

  // Q-006 A: artStyle 完全停用 — handler 不再 read getArtStylePrompt(artStyle)。
  // Bug-4 chokepoint 架构下，handler 只把 raw userPrompt 透传给 chokepoint。
  it('Q-006 A: 即使 artStyle 設了 (real value: realistic)，handler 透传给 generateLabeledImageToCos 的 prompt 不含舊 ART_STYLES 字串', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      characterModel: 'image-model-1',
      artStyle: 'realistic',
    })
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(null)

    const job = buildJob({ imageIndex: 0 })
    await handleCharacterImageTask(job)

    const generationInput = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    // 旧 ART_STYLES['realistic'] 的特征字串都不應出現
    expect(generationInput.prompt).not.toContain('Strictly photorealistic')
    expect(generationInput.prompt).not.toContain('ABSOLUTELY NO cartoon')
    expect(generationInput.prompt).not.toContain('写实风格')
  })

  it('Q-006 A: artStyle = japanese-anime → handler 透传的 prompt 不含舊 ART_STYLES anime 字串（styleProfile 透传给 chokepoint）', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      characterModel: 'image-model-1',
      artStyle: 'japanese-anime',
    })
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce({
      positivePrompt: 'STYLE_PROFILE_ANIME_POS',
      negativePrompt: null,
      referenceImageUrls: [],
    })

    const job = buildJob({ imageIndex: 0 })
    await handleCharacterImageTask(job)

    const generationInput = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    // 旧 ART_STYLES['japanese-anime'] 字串不應出現在 raw prompt
    expect(generationInput.prompt).not.toContain('Modern Japanese anime style')
    expect(generationInput.prompt).not.toContain('cel shading')
    // styleProfile 必须透传给 chokepoint
    expect(generationInput.styleProfile).toEqual({
      positivePrompt: 'STYLE_PROFILE_ANIME_POS',
      negativePrompt: null,
      referenceImageUrls: [],
    })
  })
})
