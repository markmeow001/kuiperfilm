import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const aiMock = vi.hoisted(() => ({ executeAiTextStep: vi.fn() }))
const workerMock = vi.hoisted(() => ({ reportTaskProgress: vi.fn(), assertTaskActive: vi.fn() }))
vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: aiMock.executeAiTextStep }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))

import { handleCanvasDirectorBlockingTask } from '@/lib/workers/handlers/canvas-director-blocking'

const DRAFT = {
  title: '对峙', summary: '双人构图',
  subjects: [{ label: 'A', bodyType: 'male', position: [-1, 0, 0], facingDeg: 90 }],
  props: [],
  camera: { label: '35mm', position: [0, 1.6, 6], target: [0, 1, 0], focalLengthMm: 35, framing: '中景', rollDeg: 0 },
}

function job(payload: Record<string, unknown>): Job<TaskJobData> {
  return { data: { userId: 'u1', projectId: 'playground', type: 'canvas_director_blocking', targetId: 't1', payload } } as unknown as Job<TaskJobData>
}

describe('handleCanvasDirectorBlockingTask', () => {
  beforeEach(() => {
    aiMock.executeAiTextStep.mockReset()
    workerMock.reportTaskProgress.mockReset().mockResolvedValue(undefined)
    workerMock.assertTaskActive.mockReset().mockResolvedValue(undefined)
  })

  it('returns a validated blocking draft and sends film constraints to the model', async () => {
    aiMock.executeAiTextStep.mockResolvedValue({ text: JSON.stringify(DRAFT), reasoning: '' })
    const result = await handleCanvasDirectorBlockingTask(job({ description: '两人对峙，35mm', model: 'model-x' }))
    expect(result.success).toBe(true)
    expect(result.draft.camera.focalLengthMm).toBe(35)
    const call = aiMock.executeAiTextStep.mock.calls[0] as [{ messages: { content: string }[] }]
    expect(call[0].messages[0].content).toContain('35mm')
    expect(call[0].messages[0].content).toContain('所有人物必须被 camera')
  })

  it('fails explicitly for missing inputs and malformed model output', async () => {
    await expect(handleCanvasDirectorBlockingTask(job({ model: 'm' }))).rejects.toThrow('description is required')
    await expect(handleCanvasDirectorBlockingTask(job({ description: 'x' }))).rejects.toThrow('model not resolved')
    aiMock.executeAiTextStep.mockResolvedValue({ text: 'no scene', reasoning: '' })
    await expect(handleCanvasDirectorBlockingTask(job({ description: 'x', model: 'm' }))).rejects.toThrow('no JSON object')
  })
})
