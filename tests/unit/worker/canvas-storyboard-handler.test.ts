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

  it('parses the canonical {globalStyle, assets, shots} object with all shot fields', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        globalStyle: '国风二次元厚涂插画，冷蓝与暖金高对比',
        assets: [
          { kind: 'character', name: '男主', description: '30岁男性，风衣，疲惫气质' },
          { kind: 'scene', name: '公寓客厅', description: '现代小户型客厅，冷色灯光' },
          { kind: 'prop', name: '牧场手铐', description: '磨损的金属手铐' },
        ],
        shots: [
          {
            shotNumber: 1,
            description: '男主 推门而入，冷光',
            shotSize: '中景',
            cameraMove: '推近',
            cameraAngle: '过肩',
            lens: '35mm',
            performance: '男主疲惫而克制',
            blocking: '男主画面左侧朝右走入',
            lighting: '深夜室内，冷蓝屏幕光主导',
            sfx: '钥匙转动声，门轴吱呀',
            durationSec: 5,
            dialogue: '我回来了',
          },
          { shotNumber: 2, description: '女主转身惊讶' },
        ],
      }),
      reasoning: '',
    })
    const res = await handleCanvasStoryboardTask(makeJob({ script: '一场重逢', model: 'gpt-x' }))
    expect(res.success).toBe(true)
    expect(res.count).toBe(2)
    expect(res.globalStyle).toBe('国风二次元厚涂插画，冷蓝与暖金高对比')
    expect(res.assets).toEqual([
      { kind: 'character', name: '男主', description: '30岁男性，风衣，疲惫气质' },
      { kind: 'scene', name: '公寓客厅', description: '现代小户型客厅，冷色灯光' },
      { kind: 'prop', name: '牧场手铐', description: '磨损的金属手铐' },
    ])
    expect(res.shots[0]).toEqual({
      shotNumber: 1,
      description: '男主 推门而入，冷光',
      shotSize: '中景',
      cameraMove: '推近',
      cameraAngle: '过肩',
      lens: '35mm',
      performance: '男主疲惫而克制',
      blocking: '男主画面左侧朝右走入',
      lighting: '深夜室内，冷蓝屏幕光主导',
      sfx: '钥匙转动声，门轴吱呀',
      durationSec: 5,
      dialogue: '我回来了',
    })
    // second shot keeps only the fields present
    expect(res.shots[1]).toEqual({ shotNumber: 2, description: '女主转身惊讶' })
  })

  it('drops malformed assets (missing kind/name/description or duplicate name) without failing', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: JSON.stringify({
        globalStyle: 'x',
        assets: [
          { kind: 'character', name: '男主', description: 'ok' },
          { kind: 'character', name: '男主', description: '重复名' },
          { kind: 'vehicle', name: '车', description: '未知类型' },
          { kind: 'scene', name: '', description: '缺名' },
          { kind: 'prop', name: '手铐' },
        ],
        shots: [{ description: 'ok' }],
      }),
      reasoning: '',
    })
    const res = await handleCanvasStoryboardTask(makeJob({ script: 's', model: 'm' }))
    expect(res.assets).toEqual([{ kind: 'character', name: '男主', description: 'ok' }])
  })

  it('prompt demands per-shot camera language, lighting, sfx, assets, and a globalStyle envelope', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: '{"globalStyle":"x","assets":[],"shots":[{"description":"ok"}]}',
      reasoning: '',
    })
    await handleCanvasStoryboardTask(makeJob({ script: '剧本', model: 'm' }))
    const calls = aiMock.executeAiTextStep.mock.calls as unknown as Array<[
      { messages?: Array<{ content?: string }> },
    ]>
    const prompt = String(calls.at(-1)?.[0]?.messages?.[0]?.content ?? '')
    expect(prompt).toContain('"globalStyle"')
    expect(prompt).toContain('"assets"')
    for (const field of ['"shotSize"', '"cameraMove"', '"cameraAngle"', '"lens"', '"performance"', '"blocking"', '"lighting"', '"sfx"']) {
      expect(prompt).toContain(field)
    }
    expect(prompt).toContain('不得省略')
  })

  it('accepts a bare shot array (envelope quirk) with empty globalStyle and assets', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: '[{"shotNumber":1,"description":"男主推门而入"}]',
      reasoning: '',
    })
    const res = await handleCanvasStoryboardTask(makeJob({ script: 's', model: 'm' }))
    expect(res.count).toBe(1)
    expect(res.globalStyle).toBe('')
    expect(res.assets).toEqual([])
    expect(res.shots[0]).toEqual({ shotNumber: 1, description: '男主推门而入' })
  })

  it('tolerates markdown code fences / prose around the object', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: '好的，这是分镜：\n```json\n{"globalStyle":"暖黄","assets":[],"shots":[{"description":"航拍城市夜景"}]}\n```',
      reasoning: '',
    })
    const res = await handleCanvasStoryboardTask(makeJob({ script: 's', model: 'm' }))
    expect(res.count).toBe(1)
    expect(res.globalStyle).toBe('暖黄')
    expect(res.shots[0].shotNumber).toBe(1) // defaulted from index
    expect(res.shots[0].description).toBe('航拍城市夜景')
  })

  it('drops entries without a description and defaults shotNumber by index', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: '{"globalStyle":"","assets":[],"shots":[{"description":""},{"foo":1},{"description":"有效镜头"}]}',
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

  it('throws when the model output has no JSON at all', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '抱歉我无法生成', reasoning: '' })
    await expect(handleCanvasStoryboardTask(makeJob({ script: 's', model: 'm' }))).rejects.toThrow(/CANVAS_STORYBOARD_PARSE/)
  })

  it('throws when the object has no shots array', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '{"globalStyle":"x"}', reasoning: '' })
    await expect(handleCanvasStoryboardTask(makeJob({ script: 's', model: 'm' }))).rejects.toThrow(/shots is not an array/)
  })

  it('throws when the array has no valid shots', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '{"globalStyle":"x","assets":[],"shots":[{"foo":1}]}', reasoning: '' })
    await expect(handleCanvasStoryboardTask(makeJob({ script: 's', model: 'm' }))).rejects.toThrow(/no valid shots/)
  })
})
