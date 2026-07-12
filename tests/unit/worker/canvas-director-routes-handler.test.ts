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

import { handleCanvasDirectorRoutesTask } from '@/lib/workers/handlers/canvas-director-routes'

const PLAN = {
  name: '01 蒙太奇·关系断裂',
  style: '广角中景 / 极低机位 / 快切',
  shots: [
    { label: '01 开场·远景', note: '远景 / 建立空间', durationSec: 7.5, cameraPreset: '正面全景', movement: '推近', focus: '角色A' },
    { label: '02 对峙·逼近', note: '中景', durationSec: 5, cameraPreset: '低角度仰拍', movement: '固定', focus: '角色B' },
  ],
}

function makeJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: { userId: 'user-1', projectId: 'playground', type: 'canvas_director_routes', targetId: 't-1', payload },
  } as unknown as Job<TaskJobData>
}

describe('handleCanvasDirectorRoutesTask', () => {
  beforeEach(() => {
    aiMock.executeAiTextStep.mockReset()
    workerMock.reportTaskProgress.mockReset()
    workerMock.assertTaskActive.mockReset()
  })

  it('returns whitelisted plans parsed from fenced model output', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '方案如下：\n```json\n' + JSON.stringify([PLAN]) + '\n```', reasoning: '' })
    const res = await handleCanvasDirectorRoutesTask(makeJob({ description: '两人对峙', cast: ['角色A', '角色B'], props: ['车'], model: 'gpt-x' }))
    expect(res.success).toBe(true)
    expect(res.count).toBe(1)
    expect(res.plans[0].shots[0]).toMatchObject({ cameraPreset: '正面全景', movement: '推近', durationSec: 7.5 })
  })

  it('feeds cast/props into the prompt', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: JSON.stringify([PLAN]), reasoning: '' })
    await handleCanvasDirectorRoutesTask(makeJob({ description: 'd', cast: ['角色A'], props: ['车'], model: 'm' }))
    const firstCall = aiMock.executeAiTextStep.mock.calls[0] as unknown as [{ messages: { content: string }[] }]
    const content = firstCall[0].messages[0]!.content
    expect(content).toContain('角色A')
    expect(content).toContain('车')
    expect(content).toContain('15 秒')
  })

  it('throws explicitly on missing description / model, and on unparseable output', async () => {
    await expect(handleCanvasDirectorRoutesTask(makeJob({ model: 'm' }))).rejects.toThrow('description is required')
    await expect(handleCanvasDirectorRoutesTask(makeJob({ description: 'd' }))).rejects.toThrow('model not resolved')
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '抱歉，无法生成。', reasoning: '' })
    await expect(handleCanvasDirectorRoutesTask(makeJob({ description: 'd', model: 'm' }))).rejects.toThrow('no JSON array')
  })
})
