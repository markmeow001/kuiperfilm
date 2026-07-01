import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const aiMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({ text: '[]', reasoning: '' })),
}))
const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: aiMock.executeAiTextStep }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))

import { handleCanvasStoryboardTask } from '@/lib/workers/handlers/canvas-storyboard'

function makeJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: { userId: 'user-1', projectId: 'playground', type: 'canvas_storyboard', targetId: 't-1', payload },
  } as unknown as Job<TaskJobData>
}

describe('handleCanvasStoryboardTask', () => {
  beforeEach(() => {
    aiMock.executeAiTextStep.mockReset()
    workerMock.reportTaskProgress.mockReset()
    workerMock.assertTaskActive.mockReset()
  })

  it('parses a plain JSON array of shots', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: '[{"shotNumber":1,"description":"男主推门而入，冷光","shotSize":"中景","cameraMove":"推近","durationSec":5,"dialogue":"我回来了"},{"shotNumber":2,"description":"女主转身惊讶"}]',
      reasoning: '',
    })
    const res = await handleCanvasStoryboardTask(makeJob({ script: '一场重逢', model: 'gpt-x' }))
    expect(res.success).toBe(true)
    expect(res.count).toBe(2)
    expect(res.shots[0]).toMatchObject({ shotNumber: 1, description: '男主推门而入，冷光', shotSize: '中景', cameraMove: '推近', durationSec: 5, dialogue: '我回来了' })
    // second shot keeps only the fields present
    expect(res.shots[1]).toEqual({ shotNumber: 2, description: '女主转身惊讶' })
  })

  it('tolerates markdown code fences / prose around the array', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: '好的，这是分镜：\n```json\n[{"description":"航拍城市夜景"}]\n```',
      reasoning: '',
    })
    const res = await handleCanvasStoryboardTask(makeJob({ script: 's', model: 'm' }))
    expect(res.count).toBe(1)
    expect(res.shots[0].shotNumber).toBe(1) // defaulted from index
    expect(res.shots[0].description).toBe('航拍城市夜景')
  })

  it('drops entries without a description and defaults shotNumber by index', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: '[{"description":""},{"foo":1},{"description":"有效镜头"}]',
      reasoning: '',
    })
    const res = await handleCanvasStoryboardTask(makeJob({ script: 's', model: 'm' }))
    expect(res.count).toBe(1)
    expect(res.shots[0].description).toBe('有效镜头')
  })

  it('throws when script is missing', async () => {
    await expect(handleCanvasStoryboardTask(makeJob({ model: 'm' }))).rejects.toThrow(/script is required/)
  })

  it('throws when model is not resolved', async () => {
    await expect(handleCanvasStoryboardTask(makeJob({ script: 's' }))).rejects.toThrow(/model not resolved/)
  })

  it('throws when the model output has no JSON array', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '抱歉我无法生成', reasoning: '' })
    await expect(handleCanvasStoryboardTask(makeJob({ script: 's', model: 'm' }))).rejects.toThrow(/CANVAS_STORYBOARD_PARSE/)
  })

  it('throws when the array has no valid shots', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '[{"foo":1}]', reasoning: '' })
    await expect(handleCanvasStoryboardTask(makeJob({ script: 's', model: 'm' }))).rejects.toThrow(/no valid shots/)
  })
})
