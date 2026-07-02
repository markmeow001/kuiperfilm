import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const aiMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({ text: '', reasoning: '' })),
}))
const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: aiMock.executeAiTextStep }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))

import { handleCanvasTextTask, CANVAS_TEXT_MODES } from '@/lib/workers/handlers/canvas-text'

function makeJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: { userId: 'user-1', projectId: 'playground', type: 'canvas_text', targetId: 't-1', payload },
  } as unknown as Job<TaskJobData>
}

describe('handleCanvasTextTask', () => {
  beforeEach(() => {
    aiMock.executeAiTextStep.mockReset()
    workerMock.reportTaskProgress.mockReset()
    workerMock.assertTaskActive.mockReset()
  })

  it('rewrites: returns the model output as the new text', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '改写后的正文', reasoning: '' })
    const res = await handleCanvasTextTask(makeJob({ text: '原文', mode: 'rewrite', model: 'm' }))
    expect(res.success).toBe(true)
    expect(res.text).toBe('改写后的正文')
  })

  it('continue mode APPENDS to the original text', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '续写的一段', reasoning: '' })
    const res = await handleCanvasTextTask(makeJob({ text: '原文', mode: 'continue', model: 'm' }))
    expect(res.text).toBe('原文\n续写的一段')
  })

  it('sends the whitelisted instruction for the mode', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: 'x', reasoning: '' })
    await handleCanvasTextTask(makeJob({ text: 'T', mode: 'expand', model: 'm' }))
    const call = (aiMock.executeAiTextStep.mock.calls as unknown as Array<[{ messages: Array<{ content: string }> }]>)[0]?.[0]
    expect(call?.messages[0]?.content).toContain(CANVAS_TEXT_MODES.expand)
    expect(call?.messages[0]?.content).toContain('T')
  })

  it('throws when text is missing', async () => {
    await expect(handleCanvasTextTask(makeJob({ mode: 'expand', model: 'm' }))).rejects.toThrow(/text is required/)
  })

  it('throws on a non-whitelisted mode', async () => {
    await expect(handleCanvasTextTask(makeJob({ text: 't', mode: 'jailbreak', model: 'm' }))).rejects.toThrow(/invalid mode/)
  })

  it('throws when model is not resolved', async () => {
    await expect(handleCanvasTextTask(makeJob({ text: 't', mode: 'expand' }))).rejects.toThrow(/model not resolved/)
  })

  it('throws on empty model output', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '   ', reasoning: '' })
    await expect(handleCanvasTextTask(makeJob({ text: 't', mode: 'polish', model: 'm' }))).rejects.toThrow(/empty model output/)
  })
})
