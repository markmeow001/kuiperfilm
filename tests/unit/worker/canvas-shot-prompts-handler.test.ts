import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const aiMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async () => ({ text: '{}', reasoning: '' })),
}))
const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: aiMock.executeAiTextStep }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))

import { handleCanvasShotPromptsTask } from '@/lib/workers/handlers/canvas-shot-prompts'

const SHOTS = [
  { shotNumber: 1, description: '现代沈昭昭 伏案敲击键盘', lighting: '冷蓝屏幕光', sfx: '键盘声' },
  { shotNumber: 2, description: '古代沈昭昭 跪在金銮殿', shotSize: '全景' },
]
const ASSETS = [
  { kind: 'character', name: '现代沈昭昭', description: '现代女白领，28岁' },
  { kind: 'character', name: '古代沈昭昭', description: '盛唐男装女官' },
  { kind: 'scene', name: '金銮殿', description: '唐代皇宫大殿' },
]

function makeJob(payload: Record<string, unknown>): Job<TaskJobData> {
  return {
    data: { userId: 'user-1', projectId: 'playground', type: 'canvas_shot_prompts', targetId: 't-1', payload },
  } as unknown as Job<TaskJobData>
}

describe('handleCanvasShotPromptsTask', () => {
  beforeEach(() => {
    aiMock.executeAiTextStep.mockReset()
    workerMock.reportTaskProgress.mockReset()
    workerMock.assertTaskActive.mockReset()
  })

  it('returns one finalPrompt + entities per input shot, in input order', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        shots: [
          { shotNumber: 2, finalPrompt: '全景：古代沈昭昭跪在金銮殿…', entities: ['古代沈昭昭', '金銮殿'] },
          { shotNumber: 1, finalPrompt: '近景：现代沈昭昭伏案…', entities: ['现代沈昭昭'] },
        ],
      }),
      reasoning: '',
    })
    const res = await handleCanvasShotPromptsTask(makeJob({ shots: SHOTS, assets: ASSETS, globalStyle: '厚涂插画', model: 'm' }))
    expect(res.success).toBe(true)
    expect(res.count).toBe(2)
    expect(res.prompts).toEqual([
      { shotNumber: 1, finalPrompt: '近景：现代沈昭昭伏案…', entities: ['现代沈昭昭'] },
      { shotNumber: 2, finalPrompt: '全景：古代沈昭昭跪在金銮殿…', entities: ['古代沈昭昭', '金銮殿'] },
    ])
  })

  it('prompt carries globalStyle, the asset list, and the full shot table', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({ shots: [
        { shotNumber: 1, finalPrompt: 'p1', entities: [] },
        { shotNumber: 2, finalPrompt: 'p2', entities: [] },
      ] }),
      reasoning: '',
    })
    await handleCanvasShotPromptsTask(makeJob({ shots: SHOTS, assets: ASSETS, globalStyle: '厚涂插画', model: 'm' }))
    const calls = aiMock.executeAiTextStep.mock.calls as unknown as Array<[
      { messages?: Array<{ content?: string }> },
    ]>
    const prompt = String(calls.at(-1)?.[0]?.messages?.[0]?.content ?? '')
    expect(prompt).toContain('厚涂插画')
    expect(prompt).toContain('盛唐男装女官')
    expect(prompt).toContain('冷蓝屏幕光')
    expect(prompt).toContain('"entities"')
  })

  it('drops entity names the asset list does not contain (never invents refs)', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({ shots: [
        { shotNumber: 1, finalPrompt: 'p1', entities: ['现代沈昭昭', '不存在的资产', '现代沈昭昭'] },
        { shotNumber: 2, finalPrompt: 'p2', entities: [] },
      ] }),
      reasoning: '',
    })
    const res = await handleCanvasShotPromptsTask(makeJob({ shots: SHOTS, assets: ASSETS, globalStyle: '', model: 'm' }))
    expect(res.prompts[0].entities).toEqual(['现代沈昭昭'])
  })

  it('a shot missing from the model output fails the task explicitly', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({ shots: [{ shotNumber: 1, finalPrompt: 'only one', entities: [] }] }),
      reasoning: '',
    })
    await expect(
      handleCanvasShotPromptsTask(makeJob({ shots: SHOTS, assets: ASSETS, globalStyle: '', model: 'm' })),
    ).rejects.toThrow(/shot 2 missing finalPrompt/)
  })

  it('tolerates markdown fences around the object', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: '```json\n{"shots":[{"shotNumber":1,"finalPrompt":"p1","entities":[]},{"shotNumber":2,"finalPrompt":"p2","entities":[]}]}\n```',
      reasoning: '',
    })
    const res = await handleCanvasShotPromptsTask(makeJob({ shots: SHOTS, assets: ASSETS, globalStyle: '', model: 'm' }))
    expect(res.prompts.map((p) => p.finalPrompt)).toEqual(['p1', 'p2'])
  })

  it('throws when model is not resolved', async () => {
    await expect(handleCanvasShotPromptsTask(makeJob({ shots: SHOTS }))).rejects.toThrow(/model not resolved/)
  })

  it('throws when shots are missing or malformed', async () => {
    await expect(handleCanvasShotPromptsTask(makeJob({ model: 'm' }))).rejects.toThrow(/shots must be a non-empty array/)
    await expect(
      handleCanvasShotPromptsTask(makeJob({ model: 'm', shots: [{ shotNumber: 1 }] })),
    ).rejects.toThrow(/needs shotNumber and description/)
  })

  it('throws on malformed assets instead of silently ignoring them', async () => {
    await expect(
      handleCanvasShotPromptsTask(makeJob({ model: 'm', shots: SHOTS, assets: [{ kind: 'character', name: 'x' }] })),
    ).rejects.toThrow(/needs kind\/name\/description/)
  })

  it('throws when the output has no JSON object', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '抱歉', reasoning: '' })
    await expect(
      handleCanvasShotPromptsTask(makeJob({ shots: SHOTS, assets: [], globalStyle: '', model: 'm' })),
    ).rejects.toThrow(/CANVAS_SHOT_PROMPTS_PARSE/)
  })
})
