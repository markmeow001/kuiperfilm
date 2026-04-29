/**
 * Bug-4 chokepoint test:
 * `resolveImageSourceFromGeneration` is the single source of truth for styleProfile
 * injection (prepend positive prompt + capability-filter negativePrompt /
 * referenceImageUrls). Handlers pass raw `userPrompt` + raw `styleProfile` and the
 * chokepoint owns the inject + filter logic by calling `injectStyleProfile`.
 *
 * This test verifies:
 *  1. With styleProfile != null → final prompt sent to generateImage is prepended.
 *  2. With caps.supportNegativePrompt = false → negativePrompt is NOT sent.
 *  3. With caps.supportReferenceImage = false → referenceImages is NOT sent.
 *  4. With styleProfile = null → pass-through.
 *
 * Note: this test mocks `injectStyleProfile` indirectly by importing the real
 * style-profile-injector. It mocks `generateImage` to capture the final args.
 */

import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ===== Mocks =====
type GenerateImageResult = {
  success: boolean
  imageUrl?: string | null
  imageBase64?: string | null
  error?: string
}

const generatorApiMock = vi.hoisted(() => ({
  generateImage: vi.fn<(...args: unknown[]) => Promise<GenerateImageResult>>(
    async () => ({ success: true, imageUrl: 'https://provider.example/img.png' }),
  ),
  generateVideo: vi.fn(async () => ({ success: true, videoUrl: 'https://provider.example/v.mp4' })),
}))

const billingMock = vi.hoisted(() => ({
  getTaskExistingExternalId: vi.fn(async () => null),
  withTaskBilling: vi.fn(async (_taskId: string, fn: () => Promise<unknown>) => await fn()),
}))

const capsMock = vi.hoisted(() => ({
  resolveProjectModelCapabilityGenerationOptions: vi.fn(async () => ({})),
}))

const builtinCapsMock = vi.hoisted(() => ({
  // 默认 full caps：支持 negative + reference image
  caps: {
    supportNegativePrompt: true,
    supportReferenceImage: true,
  },
}))

const logCtxMock = vi.hoisted(() => ({
  withLogContext: vi.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => await fn()),
}))

vi.mock('@/lib/generator-api', () => generatorApiMock)
vi.mock('@/lib/logging/log-context', () => logCtxMock)

// resolveProjectModelCapabilityGenerationOptions 来自 config-service — 必须 mock 让 chokepoint 不去碰 DB
vi.mock('@/lib/config-service', () => ({
  resolveProjectModelCapabilityGenerationOptions: capsMock.resolveProjectModelCapabilityGenerationOptions,
}))

// 关键：mock builtin capabilities 让 caps 可控
vi.mock('@/lib/model-capabilities/catalog', () => ({
  findBuiltinCapabilities: vi.fn(() => ({
    image: builtinCapsMock.caps,
    video: builtinCapsMock.caps,
  })),
}))

vi.mock('@/lib/model-config-contract', () => ({
  parseModelKeyStrict: vi.fn(() => ({ provider: 'fal', modelId: 'test-model' })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(async () => ({ status: 'RUNNING' })) },
    novelPromotionProject: { findUnique: vi.fn(async () => null) },
    userPreference: { findUnique: vi.fn(async () => null) },
  },
}))

// ===== Real imports (after mocks). 真实 injector 不 mock，让 chokepoint 真的跑 inject 逻辑。
import { resolveImageSourceFromGeneration } from '@/lib/workers/utils'

function buildJob(): Job {
  return {
    data: {
      taskId: 'task-chokepoint-1',
      type: 'IMAGE_PANEL',
      locale: 'zh',
      projectId: 'project-1',
      userId: 'user-1',
      targetId: 'target-1',
      payload: {},
    },
    updateProgress: vi.fn(async () => undefined),
  } as unknown as Job
}

describe('chokepoint resolveImageSourceFromGeneration: styleProfile injection (Bug-4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    builtinCapsMock.caps = { supportNegativePrompt: true, supportReferenceImage: true }
  })

  it('styleProfile != null + full caps -> final prompt 被 prepend + negativePrompt + referenceImages 都透传给 generateImage', async () => {
    const job = buildJob()

    const styleProfile = {
      positivePrompt: 'INK_HIGH_CONTRAST_STYLE',
      negativePrompt: 'NO_BLUR',
      referenceImageUrls: ['https://style/ref-a.png'],
    }

    await resolveImageSourceFromGeneration(job, {
      userId: 'user-1',
      modelId: 'fal::test-model',
      prompt: 'A hero on cliff',
      options: {
        aspectRatio: '16:9',
      },
      styleProfile,
    })

    // 业务断言：generateImage 收到的 final prompt 是「styleProfile.positivePrompt + \n\n + userPrompt」
    expect(generatorApiMock.generateImage).toHaveBeenCalledTimes(1)
    const callArgs = generatorApiMock.generateImage.mock.calls[0]
    const finalPrompt = callArgs?.[2] as string
    const finalOptions = callArgs?.[3] as {
      negativePrompt?: string | null
      referenceImages?: string[]
    }

    expect(finalPrompt).toBe('INK_HIGH_CONTRAST_STYLE\n\nA hero on cliff')
    expect(finalOptions.negativePrompt).toBe('NO_BLUR')
    expect(finalOptions.referenceImages).toContain('https://style/ref-a.png')
  })

  it('styleProfile != null + supportNegativePrompt=false -> negativePrompt 被 capability filter 丢弃', async () => {
    builtinCapsMock.caps = { supportNegativePrompt: false, supportReferenceImage: true }
    const job = buildJob()

    await resolveImageSourceFromGeneration(job, {
      userId: 'user-1',
      modelId: 'fal::test-model',
      prompt: 'A hero',
      options: { aspectRatio: '16:9' },
      styleProfile: {
        positivePrompt: 'STYLE_POS',
        negativePrompt: 'SHOULD_BE_DROPPED',
        referenceImageUrls: ['https://style/ref-a.png'],
      },
    })

    const callArgs = generatorApiMock.generateImage.mock.calls[0]
    const finalOptions = callArgs?.[3] as { negativePrompt?: string | null; referenceImages?: string[] }
    // negativePrompt 不在 final options
    expect(finalOptions.negativePrompt).toBeUndefined()
    // referenceImages 仍然透传（因为 supportReferenceImage = true）
    expect(finalOptions.referenceImages).toContain('https://style/ref-a.png')
    // prompt prepend 仍然进行（prompt 不需要 capability check）
    const finalPrompt = callArgs?.[2] as string
    expect(finalPrompt).toContain('STYLE_POS')
  })

  it('styleProfile != null + supportReferenceImage=false -> referenceImages 被 capability filter 丢弃', async () => {
    builtinCapsMock.caps = { supportNegativePrompt: true, supportReferenceImage: false }
    const job = buildJob()

    await resolveImageSourceFromGeneration(job, {
      userId: 'user-1',
      modelId: 'fal::test-model',
      prompt: 'A hero',
      options: { aspectRatio: '16:9' },
      styleProfile: {
        positivePrompt: 'STYLE_POS',
        negativePrompt: 'NO_BLUR',
        referenceImageUrls: ['https://style/ref-a.png'],
      },
    })

    const callArgs = generatorApiMock.generateImage.mock.calls[0]
    const finalOptions = callArgs?.[3] as { negativePrompt?: string | null; referenceImages?: string[] }
    // referenceImages 不在 final options（或为 undefined）
    expect(finalOptions.referenceImages).toBeUndefined()
    // negativePrompt 仍然透传
    expect(finalOptions.negativePrompt).toBe('NO_BLUR')
  })

  it('styleProfile = null -> pass-through，generateImage 收到原 userPrompt + 没有 styleProfile-injected 字段', async () => {
    const job = buildJob()

    await resolveImageSourceFromGeneration(job, {
      userId: 'user-1',
      modelId: 'fal::test-model',
      prompt: 'A hero',
      options: { aspectRatio: '16:9' },
      styleProfile: null,
    })

    const callArgs = generatorApiMock.generateImage.mock.calls[0]
    const finalPrompt = callArgs?.[2] as string
    const finalOptions = callArgs?.[3] as { negativePrompt?: string | null; referenceImages?: string[] }
    // prompt 是原 userPrompt，不含任何 STYLE marker
    expect(finalPrompt).toBe('A hero')
    expect(finalOptions.negativePrompt).toBeUndefined()
    expect(finalOptions.referenceImages).toBeUndefined()
  })

  it('caller-controlled referenceImages（如 character primary anchor）+ styleProfile.referenceImageUrls -> 两者合并 + 去重', async () => {
    const job = buildJob()

    await resolveImageSourceFromGeneration(job, {
      userId: 'user-1',
      modelId: 'fal::test-model',
      prompt: 'A hero',
      options: {
        aspectRatio: '16:9',
        referenceImages: ['https://primary/anchor.png'],
      },
      styleProfile: {
        positivePrompt: 'STYLE_POS',
        negativePrompt: null,
        referenceImageUrls: ['https://style/ref-a.png'],
      },
    })

    const callArgs = generatorApiMock.generateImage.mock.calls[0]
    const finalOptions = callArgs?.[3] as { referenceImages?: string[] }
    expect(finalOptions.referenceImages).toEqual(
      expect.arrayContaining(['https://primary/anchor.png', 'https://style/ref-a.png']),
    )
  })
})
