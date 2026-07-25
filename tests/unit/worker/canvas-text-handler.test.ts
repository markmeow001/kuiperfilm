import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskJobData } from '@/lib/task/types'

const aiMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(async (..._args: unknown[]) => ({ text: '', reasoning: '' })),
}))
const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: aiMock.executeAiTextStep }))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))

import {
  handleCanvasTextTask,
  CANVAS_TEXT_MODES,
  R2V_CANVAS_TEXT_POLICIES,
  isCanvasTextMode,
} from '@/lib/workers/handlers/canvas-text'

function makeJob(payload: Record<string, unknown>, locale: 'zh' | 'en' = 'zh'): Job<TaskJobData> {
  return {
    data: {
      userId: 'user-1',
      projectId: 'playground',
      type: 'canvas_text',
      targetId: 't-1',
      locale,
      payload,
    },
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
    const call = (aiMock.executeAiTextStep.mock.calls as unknown as Array<[{
      messages: Array<{ content: string }>
      maxRetries?: number
      maxOutputTokens?: number
      stream?: boolean
    }]>)[0]?.[0]
    expect(call?.messages[0]?.content).toContain(CANVAS_TEXT_MODES.expand)
    expect(call?.messages[0]?.content).toContain('T')
    expect(call).not.toHaveProperty('maxRetries')
    expect(call).not.toHaveProperty('maxOutputTokens')
    expect(call).not.toHaveProperty('stream')
  })

  it('keeps every existing writing mode whitelisted while accepting the two R2V assist modes', () => {
    for (const mode of [
      'expand',
      'rewrite',
      'polish',
      'continue',
      'compress',
      'assistant',
      'r2v_character',
      'r2v_scene_motion',
    ]) {
      expect(isCanvasTextMode(mode), mode).toBe(true)
    }
  })

  it.each([
    {
      mode: 'r2v_character',
      brief: '1930 年代女記者，深棕短髮與墨綠羊毛大衣',
      expectedRules: [
        '電影角色視覺設定師',
        '參考圖負責鎖定人物身分',
        '不要加入動作、走位、鏡頭、背景、對白或其他人物',
        '繁體中文輸出 120–320 個字',
      ],
      maxOutputTokens: 800,
    },
    {
      mode: 'r2v_scene_motion',
      brief: '雨夜的上海街口，有電車與路人',
      expectedRules: [
        '電影美術指導與動態場景提示詞設計師',
        '合理且持續運動的環境元素',
        '透視與視差變化',
        '不得改變原片人物數量、動作順序、走位、互動、對白或鏡頭軌跡',
        '繁體中文輸出 150–420 個字',
      ],
      maxOutputTokens: 1000,
    },
  ] as const)('$mode separates its Traditional-Chinese system instruction from the brief', async ({
    mode,
    brief,
    expectedRules,
    maxOutputTokens,
  }) => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '整理後的描述', reasoning: '' })

    const res = await handleCanvasTextTask(makeJob({ text: brief, mode, model: 'm' }))

    expect(res).toEqual({ success: true, text: '整理後的描述' })
    const call = (aiMock.executeAiTextStep.mock.calls as unknown as Array<[
      {
        messages: Array<{ role: string; content: string }>
        maxRetries?: number
        maxOutputTokens?: number
        stream?: boolean
      },
    ]>)[0]?.[0]
    expect(call?.messages).toEqual([
      { role: 'system', content: CANVAS_TEXT_MODES[mode] },
      { role: 'user', content: brief },
    ])
    expect(call).toMatchObject({
      maxRetries: 0,
      maxOutputTokens,
      stream: false,
    })
    for (const rule of expectedRules) {
      expect(call?.messages[0]?.content).toContain(rule)
    }
  })

  it.each([
    ['r2v_character', 800],
    ['r2v_scene_motion', 1000],
  ] as const)('%s uses the English system prompt when locale=en', async (mode, maxOutputTokens) => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: 'Completed description', reasoning: '' })

    await handleCanvasTextTask(makeJob({ text: '1930s newspaper reporter', mode, model: 'm' }, 'en'))

    const call = aiMock.executeAiTextStep.mock.calls[0]?.[0] as unknown as {
      messages: Array<{ role: string; content: string }>
      maxOutputTokens: number
    }
    expect(call.messages).toEqual([
      { role: 'system', content: R2V_CANVAS_TEXT_POLICIES[mode].systemPrompt.en },
      { role: 'user', content: '1930s newspaper reporter' },
    ])
    expect(call.messages[0]?.content).toContain('English')
    expect(call.messages[0]?.content).not.toContain('繁體中文')
    if (mode === 'r2v_character') {
      expect(call.messages[0]?.content).toContain('60–100')
      expect(call.messages[0]?.content).toContain('600 characters')
    } else {
      expect(call.messages[0]?.content).toContain('100–160')
      expect(call.messages[0]?.content).toContain('1,000 characters')
    }
    expect(call.maxOutputTokens).toBe(maxOutputTokens)
  })

  it('compress mode REPLACES with the compressed prompt and sends the length-cap instruction', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '精简后的提示词', reasoning: '' })
    const res = await handleCanvasTextTask(makeJob({ text: '超长视频提示词……', mode: 'compress', model: 'm' }))
    expect(res.text).toBe('精简后的提示词')
    const call = (aiMock.executeAiTextStep.mock.calls as unknown as Array<[{ messages: Array<{ content: string }> }]>)[0]?.[0]
    expect(call?.messages[0]?.content).toContain('3000 字符以内')
    expect(call?.messages[0]?.content).toContain('要素保全优先于字数')
    expect(call?.messages[0]?.content).toContain('运镜')
  })

  it('assistant mode returns a validated operation plan instead of free text', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: '{"summary":"建立图片流程","operations":[{"kind":"create_node","alias":"frame","nodeType":"image","title":"主画面"}]}',
      reasoning: '',
    })
    const res = await handleCanvasTextTask(makeJob({ text: '{"instruction":"建立图片"}', mode: 'assistant', model: 'm' }))
    expect(res).toMatchObject({ success: true, assistantPlan: { summary: '建立图片流程' } })
  })

  it('assistant mode rejects malformed or destructive AI plans', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({
      text: '{"summary":"删除","operations":[{"kind":"delete_node","nodeIds":["x"]}]}',
      reasoning: '',
    })
    await expect(handleCanvasTextTask(makeJob({ text: '{"instruction":"整理"}', mode: 'assistant', model: 'm' }))).rejects.toThrow(/unsupported operation/)
  })

  it('throws when text is missing', async () => {
    await expect(handleCanvasTextTask(makeJob({ mode: 'expand', model: 'm' }))).rejects.toThrow(/text is required/)
  })

  it('throws on a non-whitelisted mode', async () => {
    await expect(handleCanvasTextTask(makeJob({ text: 't', mode: 'jailbreak', model: 'm' }))).rejects.toThrow(/invalid mode/)
  })

  it('rejects prototype-chain keys (mode:"toString" must not pass the whitelist)', async () => {
    for (const mode of ['toString', 'constructor', 'valueOf', 'hasOwnProperty']) {
      await expect(handleCanvasTextTask(makeJob({ text: 't', mode, model: 'm' }))).rejects.toThrow(/invalid mode/)
    }
  })

  it('throws when model is not resolved', async () => {
    await expect(handleCanvasTextTask(makeJob({ text: 't', mode: 'expand' }))).rejects.toThrow(/model not resolved/)
  })

  it('rejects task payloads with an unsupported locale', async () => {
    const job = makeJob({ text: 't', mode: 'r2v_character', model: 'm' })
    ;(job.data as { locale: string }).locale = 'ja'
    await expect(handleCanvasTextTask(job)).rejects.toThrow(/invalid locale/)
  })

  it('throws on empty model output', async () => {
    aiMock.executeAiTextStep.mockResolvedValueOnce({ text: '   ', reasoning: '' })
    await expect(handleCanvasTextTask(makeJob({ text: 't', mode: 'polish', model: 'm' }))).rejects.toThrow(/empty model output/)
  })
})
