/**
 * Canvas 无限画布 — Script node storyboard handler.
 *
 * Takes a raw script (pasted into / wired to the canvas Script node) and asks
 * the LLM to split it into an ordered array of storyboard shots. Text-only:
 * runs on the text worker, the JSON result is written to Task.result and read
 * back by the canvas via GET /api/tasks/[taskId]. Complies with CLAUDE.md §3
 * (AI goes through createRun → worker → run-runtime; no direct route LLM call).
 *
 * The model is resolved at submit time (route → getProjectModelConfig) and
 * pinned into payload.model so billing freezes on it.
 */
import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-runtime'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'

/** One storyboard shot returned to the canvas. */
export interface CanvasStoryboardShot {
  shotNumber: number
  description: string
  shotSize?: string
  cameraMove?: string
  durationSec?: number
  dialogue?: string
}

const MAX_SHOTS = 40

function buildPrompt(script: string): string {
  return [
    '你是一位短剧分镜师。把下面的剧本/故事拆解成一组有序的分镜镜头。',
    '要求：',
    '1. 只输出一个 JSON 数组，不要任何解释或 markdown 代码块围栏。',
    '2. 每个元素形如：{"shotNumber": 1, "description": "画面内容的完整视觉描述（用于文生图）", "shotSize": "中景/特写/全景/近景…", "cameraMove": "推近/拉远/环绕/固定…", "durationSec": 5, "dialogue": "该镜头的对白或旁白，无则留空字符串"}',
    '3. description 要具体到可直接拿去生成图片：场景、人物、动作、光线、氛围。',
    `4. 镜头数量根据剧情自然切分，最多 ${MAX_SHOTS} 个。`,
    '5. 与剧本保持同一种语言。',
    '',
    '剧本：',
    script,
  ].join('\n')
}

/** Tolerant JSON-array extraction — strips markdown fences / prose around it. */
function parseShots(text: string): CanvasStoryboardShot[] {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('CANVAS_STORYBOARD_PARSE: no JSON array in model output')
  }
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1))
  if (!Array.isArray(parsed)) {
    throw new Error('CANVAS_STORYBOARD_PARSE: result is not an array')
  }
  const shots: CanvasStoryboardShot[] = []
  parsed.slice(0, MAX_SHOTS).forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return
    const o = raw as Record<string, unknown>
    const description = typeof o.description === 'string' ? o.description.trim() : ''
    if (!description) return
    shots.push({
      shotNumber: typeof o.shotNumber === 'number' ? o.shotNumber : i + 1,
      description,
      ...(typeof o.shotSize === 'string' && o.shotSize.trim() ? { shotSize: o.shotSize.trim() } : {}),
      ...(typeof o.cameraMove === 'string' && o.cameraMove.trim() ? { cameraMove: o.cameraMove.trim() } : {}),
      ...(typeof o.durationSec === 'number' && Number.isFinite(o.durationSec) ? { durationSec: o.durationSec } : {}),
      ...(typeof o.dialogue === 'string' && o.dialogue.trim() ? { dialogue: o.dialogue.trim() } : {}),
    })
  })
  if (shots.length === 0) {
    throw new Error('CANVAS_STORYBOARD_PARSE: no valid shots parsed')
  }
  return shots
}

export async function handleCanvasStoryboardTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const script = typeof payload.script === 'string' ? payload.script.trim() : ''
  const model = typeof payload.model === 'string' ? payload.model : ''

  if (!script) throw new Error('CANVAS_STORYBOARD: script is required')
  if (!model) throw new Error('CANVAS_STORYBOARD: model not resolved')

  await reportTaskProgress(job, 20, { stage: 'canvas_storyboard_generate' })
  await assertTaskActive(job, 'canvas_storyboard_llm')

  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model,
    messages: [{ role: 'user', content: buildPrompt(script) }],
    reasoning: false,
    projectId: job.data.projectId,
    action: 'canvas_storyboard',
    meta: {
      stepId: 'canvas_storyboard',
      stepTitle: '剧本拆分镜',
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  if (!completion.text) throw new Error('CANVAS_STORYBOARD: empty model output')
  const shots = parseShots(completion.text)

  await reportTaskProgress(job, 95, { stage: 'canvas_storyboard_done' })

  return { success: true, shots, count: shots.length }
}
