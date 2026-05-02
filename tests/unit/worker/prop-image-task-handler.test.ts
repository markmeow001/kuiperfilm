import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ locationModel: 'location-model-1', artStyle: 'anime' })),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionProp: {
    findFirst: vi.fn(),
    update: vi.fn(async () => ({})),
  },
}))

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
    async () => 'cos/prop-generated-1.png',
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

import { handlePropImageTask } from '@/lib/workers/handlers/prop-image-task-handler'

function buildJob(payload: Record<string, unknown>, targetId = 'prop-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-prop-image-1',
      type: TASK_TYPE.IMAGE_PROP,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: null,
      targetType: 'NovelPromotionProp',
      targetId,
      payload,
      userId: 'user-1',
    },
    updateProgress: vi.fn(async () => undefined),
  } as unknown as Job<TaskJobData>
}

describe('handlePropImageTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    utilsMock.getProjectModels.mockResolvedValue({ locationModel: 'location-model-1', artStyle: 'anime' })
    sharedMock.generateLabeledImageToCos.mockResolvedValue('cos/prop-generated-1.png')
  })

  it('generates a prop image using the project locationModel and persists imageUrl', async () => {
    prismaMock.novelPromotionProp.findFirst.mockResolvedValueOnce({
      id: 'prop-1',
      name: '银色匕首',
      summary: 'a silver knife',
      description: 'a polished silver dagger lying on a velvet cloth',
    })
    const result = await handlePropImageTask(buildJob({ id: 'prop-1' }))
    expect(result).toEqual({ propId: 'prop-1', imageUrl: 'cos/prop-generated-1.png' })
    expect(sharedMock.generateLabeledImageToCos).toHaveBeenCalledTimes(1)
    const arg = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    expect(arg?.targetId).toBe('prop-1')
    expect(arg?.label).toBe('银色匕首')
    expect(arg?.prompt).toContain('a polished silver dagger')
    expect(prismaMock.novelPromotionProp.update).toHaveBeenCalledWith({
      where: { id: 'prop-1' },
      data: { imageUrl: 'cos/prop-generated-1.png' },
    })
  })

  it('falls back to summary when description is empty', async () => {
    prismaMock.novelPromotionProp.findFirst.mockResolvedValueOnce({
      id: 'prop-2',
      name: '绳索',
      summary: 'a coil of rope',
      description: null,
    })
    await handlePropImageTask(buildJob({ id: 'prop-2' }))
    const arg = sharedMock.generateLabeledImageToCos.mock.calls[0]?.[0]
    expect(arg?.prompt).toContain('a coil of rope')
  })

  it('throws when prop is missing', async () => {
    prismaMock.novelPromotionProp.findFirst.mockResolvedValueOnce(null)
    await expect(handlePropImageTask(buildJob({ id: 'prop-missing' }))).rejects.toThrow(/Prop not found/)
  })

  it('throws when prop has no description / summary / name to seed prompt', async () => {
    prismaMock.novelPromotionProp.findFirst.mockResolvedValueOnce({
      id: 'prop-3',
      name: '',
      summary: null,
      description: '',
    })
    await expect(handlePropImageTask(buildJob({ id: 'prop-3' }))).rejects.toThrow(
      /no description \/ summary to seed/,
    )
  })

  it('throws when project locationModel is not configured', async () => {
    utilsMock.getProjectModels.mockResolvedValueOnce({ locationModel: '' as string, artStyle: 'anime' })
    await expect(handlePropImageTask(buildJob({ id: 'prop-x' }))).rejects.toThrow(
      /Prop model \(locationModel\) not configured/,
    )
  })
})
