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

/** One storyboard shot returned to the canvas (mirrors the client's
 *  CanvasStoryboardShot in app/[locale]/canvas/lib/canvas-types — kept in two places
 *  so the client never imports server code). */
export interface CanvasStoryboardShot {
  shotNumber: number
  description: string
  /** 景别：中景/特写/全景… */
  shotSize?: string
  /** 运镜：推近/拉远/环绕/固定… */
  cameraMove?: string
  /** 机位角度：平视/俯拍/仰拍/过肩/主观… */
  cameraAngle?: string
  /** 镜头焦段：24mm 广角/50mm 标准/85mm 人像… */
  lens?: string
  /** 人物表演与情绪。 */
  performance?: string
  /** 站位与调度（谁在哪、朝向、走位）。 */
  blocking?: string
  durationSec?: number
  dialogue?: string
}

export interface CanvasStoryboardResult {
  shots: CanvasStoryboardShot[]
  /** 全片统一的整体色调/风格（用于每镜生图 prompt）。 */
  colorTone: string
}

const MAX_SHOTS = 40

function buildPrompt(script: string): string {
  return [
    '你是一位专业短剧分镜师兼摄影指导。把下面的剧本/故事拆解成一组有序的分镜镜头。',
    '要求：',
    '1. 只输出一个 JSON 对象，不要任何解释或 markdown 代码块围栏。',
    '2. 对象形如：{"colorTone": "全片统一的整体色调与视觉风格（光线基调、色彩倾向、质感，如：冷蓝夜色、高对比霓虹、胶片颗粒…）", "shots": [<镜头数组>]}',
    '3. 每个镜头形如：{"shotNumber": 1, "description": "画面内容的完整视觉描述（用于文生图）：场景、人物、动作、光线、氛围", "shotSize": "中景/特写/全景/近景…", "cameraMove": "推近/拉远/环绕/固定/跟移…", "cameraAngle": "平视/俯拍/仰拍/过肩/主观视角…", "lens": "24mm 广角/35mm/50mm 标准/85mm 人像…", "performance": "该镜头中人物的表演与情绪（谁、什么情绪、怎么演）", "blocking": "站位与调度：谁在画面哪个位置、朝向、走位", "durationSec": 5, "dialogue": "该镜头的对白或旁白，无则留空字符串"}',
    '4. 每个镜头的 shotSize、cameraAngle、lens、performance、blocking 都必须给出，不得省略——这是分镜表不是故事梗概。',
    `5. 镜头数量根据剧情自然切分，最多 ${MAX_SHOTS} 个。`,
    '6. 与剧本保持同一种语言。',
    '',
    '剧本：',
    script,
  ].join('\n')
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/**
 * Tolerant extraction — strips markdown fences / prose. Canonical output is
 * {"colorTone", "shots"}; a bare shot array (older/misbehaving model) is still
 * accepted with an empty colorTone rather than failing the whole paid task on
 * an envelope quirk. Shot-level validation stays strict: no description → drop.
 */
function parseStoryboard(text: string): CanvasStoryboardResult {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const objStart = trimmed.indexOf('{')
  const arrStart = trimmed.indexOf('[')
  let rawShots: unknown
  let colorTone = ''
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    const end = trimmed.lastIndexOf('}')
    if (end <= objStart) {
      throw new Error('CANVAS_STORYBOARD_PARSE: no JSON object in model output')
    }
    const parsed: unknown = JSON.parse(trimmed.slice(objStart, end + 1))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('CANVAS_STORYBOARD_PARSE: result is not an object')
    }
    const record = parsed as Record<string, unknown>
    colorTone = trimmedString(record.colorTone) ?? ''
    rawShots = record.shots
  } else {
    if (arrStart === -1) {
      throw new Error('CANVAS_STORYBOARD_PARSE: no JSON in model output')
    }
    const end = trimmed.lastIndexOf(']')
    if (end <= arrStart) {
      throw new Error('CANVAS_STORYBOARD_PARSE: no JSON array in model output')
    }
    rawShots = JSON.parse(trimmed.slice(arrStart, end + 1))
  }
  if (!Array.isArray(rawShots)) {
    throw new Error('CANVAS_STORYBOARD_PARSE: shots is not an array')
  }
  const shots: CanvasStoryboardShot[] = []
  rawShots.slice(0, MAX_SHOTS).forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return
    const o = raw as Record<string, unknown>
    const description = trimmedString(o.description)
    if (!description) return
    const shotSize = trimmedString(o.shotSize)
    const cameraMove = trimmedString(o.cameraMove)
    const cameraAngle = trimmedString(o.cameraAngle)
    const lens = trimmedString(o.lens)
    const performance = trimmedString(o.performance)
    const blocking = trimmedString(o.blocking)
    const dialogue = trimmedString(o.dialogue)
    shots.push({
      shotNumber: typeof o.shotNumber === 'number' ? o.shotNumber : i + 1,
      description,
      ...(shotSize ? { shotSize } : {}),
      ...(cameraMove ? { cameraMove } : {}),
      ...(cameraAngle ? { cameraAngle } : {}),
      ...(lens ? { lens } : {}),
      ...(performance ? { performance } : {}),
      ...(blocking ? { blocking } : {}),
      ...(typeof o.durationSec === 'number' && Number.isFinite(o.durationSec) ? { durationSec: o.durationSec } : {}),
      ...(dialogue ? { dialogue } : {}),
    })
  })
  if (shots.length === 0) {
    throw new Error('CANVAS_STORYBOARD_PARSE: no valid shots parsed')
  }
  return { shots, colorTone }
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
  const { shots, colorTone } = parseStoryboard(completion.text)

  await reportTaskProgress(job, 95, { stage: 'canvas_storyboard_done' })

  return { success: true, shots, colorTone, count: shots.length }
}
