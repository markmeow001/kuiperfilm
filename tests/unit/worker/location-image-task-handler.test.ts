import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ locationModel: 'location-model-1', artStyle: 'anime' })),
}))

const prismaMock = vi.hoisted(() => ({
  locationImage: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  novelPromotionLocation: {
    findUnique: vi.fn(),
    findMany: vi.fn(async () => []),
  },
}))

// 给 vi.fn 加泛型参数（Bug-6）：让 mock.calls[0]?.[0] 推导出非 undefined 的具体型别。
// Bug-4 chokepoint: generateLabeledImageToCos 接受 raw styleProfile 参数（chokepoint 内做 prepend）。
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
    async () => 'cos/location-generated-1.png',
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

import { handleLocationImageTask } from '@/lib/workers/handlers/location-image-task-handler'

function buildJob(payload: Record<string, unknown>, targetId = 'location-image-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-location-image-1',
      type: TASK_TYPE.IMAGE_LOCATION,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'LocationImage',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker location-image-task-handler behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.locationImage.findUnique.mockResolvedValue({
      id: 'location-image-1',
      locationId: 'location-1',
      imageIndex: 0,
      description: '雨夜街道',
      location: { name: 'Old Town' },
    })

    prismaMock.novelPromotionLocation.findUnique.mockResolvedValue({
      id: 'location-1',
      name: 'Old Town',
      images: [
        {
          id: 'location-image-1',
          locationId: 'location-1',
          imageIndex: 0,
          description: '雨夜街道',
        },
      ],
    })
  })

  it('locationModel missing -> explicit error', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({ locationModel: '', artStyle: 'anime' })
    await expect(handleLocationImageTask(buildJob({}))).rejects.toThrow('Location model not configured')
  })

  it('success path -> generates and persists concrete location image url', async () => {
    const result = await handleLocationImageTask(buildJob({ imageIndex: 0 }))

    expect(result).toEqual({
      updated: 1,
      locationIds: ['location-1'],
    })

    expect(sharedMock.generateLabeledImageToCos).toHaveBeenCalledWith(
      expect.objectContaining({
        // Session A's 56a857c prepends a no-people / no-animals scene spec
        // to the raw description so Tencent VOD GEM-3.1 doesn't paint
        // characters into pure environment shots. The user description
        // itself is still preserved at the end (asserted via `雨夜街道`).
        // A later commit also widened scenes to 16:9 (cinematic horizontal
        // composition spec is in the prefix), so the option value moves
        // from 1:1 → 16:9 here too.
        prompt: expect.stringContaining('雨夜街道'),
        label: 'Old Town',
        targetId: 'location-image-1',
        options: expect.objectContaining({ aspectRatio: '16:9' }),
      }),
    )

    expect(prismaMock.locationImage.update).toHaveBeenCalledWith({
      where: { id: 'location-image-1' },
      data: { imageUrl: 'cos/location-generated-1.png' },
    })
  })

  // Bug-4 chokepoint approach: handler 把 raw userPrompt + raw styleProfile 透传给
  // generateLabeledImageToCos，chokepoint (resolveImageSourceFromGeneration) 内部做
  // injectStyleProfile（prepend + capability filter）。因此 handler 测试只需验证
  // 「styleProfile 透传给 generateLabeledImageToCos 的 styleProfile 参数」+ prompt 是 raw user prompt。
  it('project 有 styleProfile -> generateLabeledImageToCos 收到原 styleProfile 透传 + prompt 是 raw user prompt（chokepoint 内做 prepend）', async () => {
    const styleProfileFixture = {
      positivePrompt: 'LOC_STYLE_POS',
      negativePrompt: 'LOC_STYLE_NEG',
      referenceImageUrls: ['https://style/loc-ref.png'],
    }
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(styleProfileFixture)

    await handleLocationImageTask(buildJob({ imageIndex: 0 }))

    const callArg = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    // styleProfile 必须原封不动透传给 chokepoint
    expect(callArg.styleProfile).toEqual(styleProfileFixture)
    // handler 不再自己 prepend — prompt 是 raw user prompt（不含 LOC_STYLE_POS marker）
    expect(callArg.prompt).not.toContain('LOC_STYLE_POS')
    // user prompt 必须存在（防 trivial pass）
    expect(callArg.prompt.length).toBeGreaterThan(0)
    // handler 不再透传 styleProfile.referenceImageUrls 到 options.referenceImages（chokepoint 处理）
    // 仍允许 caller-controlled referenceImages（例如 character primary anchor），但 location handler 没有这种 caller-controlled 引用，所以 referenceImages 应不存在或不含 style ref。
    const refs = callArg.options?.referenceImages ?? []
    expect(refs).not.toContain('https://style/loc-ref.png')
  })

  it('project styleProfile 为 null -> generateLabeledImageToCos 收到 styleProfile = null', async () => {
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(null)

    await handleLocationImageTask(buildJob({ imageIndex: 0 }))

    const callArg = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    expect(callArg.styleProfile).toBeNull()
    // prompt 是 raw user prompt（防 trivial pass — 至少非空）
    expect(typeof callArg.prompt).toBe('string')
    expect(callArg.prompt.length).toBeGreaterThan(0)
    expect(callArg.prompt).not.toContain('LOC_STYLE')
  })

  // Q-006 A: artStyle 完全停用 — handler 不再 read getArtStylePrompt(artStyle)。
  // 注意：Bug-4 chokepoint 架构下，handler 只透传 raw userPrompt 给
  // generateLabeledImageToCos，prepend / capability filter 在 chokepoint 内做。
  // 所以 handler 测试的断言对象是「prompt 不含旧 ART_STYLES marker」+ styleProfile 透传值。
  it('Q-006 A: 即使 artStyle 設了 (real value: realistic)，handler 透传给 generateLabeledImageToCos 的 prompt 不含舊 ART_STYLES 字串', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      locationModel: 'location-model-1',
      artStyle: 'realistic',
    })
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce(null)

    await handleLocationImageTask(buildJob({ imageIndex: 0 }))

    const callArg = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    // 旧 ART_STYLES['realistic'] 的特征字串都不應出現
    expect(callArg.prompt).not.toContain('Strictly photorealistic')
    expect(callArg.prompt).not.toContain('ABSOLUTELY NO cartoon')
    expect(callArg.prompt).not.toContain('写实风格')
  })

  it('Q-006 A: artStyle = japanese-anime → handler 透传的 prompt 不含舊 ART_STYLES anime 字串（styleProfile 透传给 chokepoint）', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({
      locationModel: 'location-model-1',
      artStyle: 'japanese-anime',
    })
    styleProfileLoaderMock.loadStyleProfile.mockResolvedValueOnce({
      positivePrompt: 'LOC_STYLE_PROFILE_POS',
      negativePrompt: null,
      referenceImageUrls: [],
    })

    await handleLocationImageTask(buildJob({ imageIndex: 0 }))

    const callArg = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    // 旧 ART_STYLES['japanese-anime'] 字串不應出現在 raw prompt
    expect(callArg.prompt).not.toContain('Modern Japanese anime style')
    expect(callArg.prompt).not.toContain('cel shading')
    // styleProfile 必须透传给 chokepoint（chokepoint 内做 prepend）
    expect(callArg.styleProfile).toEqual({
      positivePrompt: 'LOC_STYLE_PROFILE_POS',
      negativePrompt: null,
      referenceImageUrls: [],
    })
  })
})
