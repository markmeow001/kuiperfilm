/**
 * taskToPlaygroundRunView — payload 覆写后的 prompt/modelKey 回退。
 *
 * 背景:worker 进度更新(tryUpdateTaskProgress)会整包覆写 task.payload
 * 顶层,只有 meta.* 被合并保留。提交时 route 把 originPrompt/originModelKey
 * 写进 meta;view 端顶层读不到时回退 meta——否则历史记录的描述词面板
 * 在任务开跑后就永远是空的(2026-07-08 用户反馈)。
 */

import { describe, it, expect } from 'vitest'
import { taskToPlaygroundRunView } from '@/lib/playground/run-view'
import { TASK_TYPE } from '@/lib/task/types'

const baseTask = {
  id: 't1',
  type: TASK_TYPE.PLAYGROUND_IMAGE,
  status: 'completed',
  errorMessage: null,
  createdAt: new Date('2026-07-08T00:00:00Z'),
  finishedAt: new Date('2026-07-08T00:01:00Z'),
  result: null,
}

describe('taskToPlaygroundRunView prompt/modelKey fallback', () => {
  it('uses top-level payload fields when present (pre-progress state)', () => {
    const view = taskToPlaygroundRunView({
      ...baseTask,
      payload: { prompt: '黑色蕾丝套装', modelKey: 'atlascloud::gemini-3', meta: { originPrompt: 'x', originModelKey: 'y' } },
    })
    expect(view.prompt).toBe('黑色蕾丝套装')
    expect(view.modelKey).toBe('atlascloud::gemini-3')
  })

  it('falls back to meta.originPrompt/originModelKey after progress overwrote the top level', () => {
    const view = taskToPlaygroundRunView({
      ...baseTask,
      // 进度 payload 长这样:flow/stage 字段 + 被 merge 保留的 meta。
      payload: { stage: 'received', displayMode: 'loading', meta: { locale: 'zh', originPrompt: '黑色蕾丝套装', originModelKey: 'atlascloud::gemini-3' } },
    })
    expect(view.prompt).toBe('黑色蕾丝套装')
    expect(view.modelKey).toBe('atlascloud::gemini-3')
  })

  it('returns empty strings for legacy tasks that have neither', () => {
    const view = taskToPlaygroundRunView({ ...baseTask, payload: { stage: 'received' } })
    expect(view.prompt).toBe('')
    expect(view.modelKey).toBe('')
  })

  it('exposes tailFrameUrl from result and maps video type', () => {
    const view = taskToPlaygroundRunView({
      ...baseTask,
      type: TASK_TYPE.PLAYGROUND_VIDEO,
      payload: { meta: { originPrompt: 'p' } },
      result: { resultUrls: ['https://pub.example/clip.mp4'], tailFrameKey: 'https://pub.example/tail.jpg' },
    })
    expect(view.outputType).toBe('video')
    expect(view.resultUrls).toEqual(['https://pub.example/clip.mp4'])
    expect(view.tailFrameUrl).toBe('https://pub.example/tail.jpg')
  })
})
