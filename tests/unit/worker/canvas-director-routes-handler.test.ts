import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const aiMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({ text: '{"segments":[]}', reasoning: '' })),
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

const SEGMENT = { title: '对峙', sourceSummary: '角色A 与角色B 在车旁对峙。', plans: [PLAN] }

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

  it('短描述 -> 返回白名单收敛后的单段多方案结果', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '方案如下：\n```json\n' + JSON.stringify({ segments: [SEGMENT] }) + '\n```', reasoning: '' })
    const res = await handleCanvasDirectorRoutesTask(makeJob({ description: '两人对峙', mode: 'brief', cast: ['角色A', '角色B'], props: ['车'], model: 'gpt-x' }))
    expect(res.success).toBe(true)
    expect(res.count).toBe(1)
    expect(res.planCount).toBe(1)
    expect(res.segments[0]).toMatchObject({ order: 1, title: '对峙', sourceSummary: '角色A 与角色B 在车旁对峙。' })
    expect(res.segments[0].plans[0].shots[0]).toMatchObject({ cameraPreset: '正面全景', movement: '推近', durationSec: 7.5 })
  })

  it('完整分镜 -> prompt 要求依序拆段、保留硬性限制且每段只产一套方案', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: JSON.stringify({ segments: [SEGMENT] }), reasoning: '' })
    await handleCanvasDirectorRoutesTask(makeJob({ description: 'd', mode: 'storyboard', cast: ['角色A'], props: ['车'], model: 'm' }))
    const firstCall = aiMock.executeAiTextStep.mock.calls[0] as unknown as [{ messages: { content: string }[] }]
    const content = firstCall[0].messages[0]!.content
    expect(content).toContain('角色A')
    expect(content).toContain('车')
    expect(content).toContain('按原文顺序拆成')
    expect(content).toContain('硬性限制')
    expect(content).toContain('每个段落只给 1 套')
    expect(content).toContain('15 秒内')
  })

  it('缺少 description、mode、model 或模型输出不可解析 -> 显式失败', async () => {
    await expect(handleCanvasDirectorRoutesTask(makeJob({ mode: 'brief', model: 'm' }))).rejects.toThrow('description is required')
    await expect(handleCanvasDirectorRoutesTask(makeJob({ description: 'd', model: 'm' }))).rejects.toThrow('mode is required')
    await expect(handleCanvasDirectorRoutesTask(makeJob({ description: 'd', mode: 'brief' }))).rejects.toThrow('model not resolved')
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '抱歉，无法生成。', reasoning: '' })
    await expect(handleCanvasDirectorRoutesTask(makeJob({ description: 'd', mode: 'brief', model: 'm' }))).rejects.toThrow('no JSON object')
  })
})
