/**
 * Canvas 无限画布 — Text node writing-assistant handler.
 *
 * Takes the text node's current content + a whitelisted writing mode (扩写/
 * 改写/润色/续写) and returns the rewritten text. Text-only: runs on the text
 * worker, plain-text result is written to Task.result and read back by the
 * canvas via GET /api/tasks/[taskId]. Complies with CLAUDE.md §3 (AI goes
 * through createRun → worker → run-runtime; no direct route LLM call).
 *
 * The model is resolved at submit time (route → getProjectModelConfig) and
 * pinned into payload.model so billing freezes on it.
 */
import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-runtime'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'

export const CANVAS_TEXT_MODES = {
  expand: '把下面的文字扩写得更丰富、更具体，补充画面感与细节，保持原意、结构与语言不变。只输出扩写后的正文，不要任何解释。',
  rewrite: '改写下面的文字，使表达更流畅自然、更有张力，保持原意与语言不变。只输出改写后的正文，不要任何解释。',
  polish: '润色下面的文字：修正语病、收紧冗词、统一语气，内容与语言保持不变。只输出润色后的正文，不要任何解释。',
  continue: '顺着下面的文字自然续写一段，延续既有的风格、人物与语言。只输出续写的正文（不要重复原文），不要任何解释。',
  // Video-prompt compression (Seedance-class models dilute/ignore over-long
  // prompts): keep the essentials, hard-cap the output length.
  compress: '把下面的视频生成提示词压缩到 1500 字符以内。硬性要求（要素保全优先于字数）：①出现的每个人物及其外观关键词一个都不能丢；②动作保持原有先后顺序；③关键道具、场景环境、镜头景别与运镜、光线氛围、风格关键词全部保留。只删除：重复的描述、纯叙事铺陈、不影响画面的修饰词。在满足以上前提下越精炼越好；保持原语言。只输出压缩后的提示词，不要任何解释。',
} as const

export type CanvasTextMode = keyof typeof CANVAS_TEXT_MODES

export function isCanvasTextMode(v: unknown): v is CanvasTextMode {
  // Object.hasOwn (not `in`): `in` walks the prototype chain, so payloads like
  // mode:"toString" would pass the whitelist and stringify a builtin into the
  // LLM instruction.
  return typeof v === 'string' && Object.hasOwn(CANVAS_TEXT_MODES, v)
}

export async function handleCanvasTextTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const text = typeof payload.text === 'string' ? payload.text.trim() : ''
  const mode = payload.mode
  const model = typeof payload.model === 'string' ? payload.model : ''

  if (!text) throw new Error('CANVAS_TEXT: text is required')
  if (!isCanvasTextMode(mode)) throw new Error('CANVAS_TEXT: invalid mode')
  if (!model) throw new Error('CANVAS_TEXT: model not resolved')

  await reportTaskProgress(job, 20, { stage: 'canvas_text_generate' })
  await assertTaskActive(job, 'canvas_text_llm')

  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model,
    messages: [{ role: 'user', content: `${CANVAS_TEXT_MODES[mode]}\n\n${text}` }],
    reasoning: false,
    projectId: job.data.projectId,
    action: 'canvas_text',
    meta: {
      stepId: 'canvas_text',
      stepTitle: '文本写作助手',
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  const out = completion.text?.trim()
  if (!out) throw new Error('CANVAS_TEXT: empty model output')

  await reportTaskProgress(job, 95, { stage: 'canvas_text_done' })

  // 续写 appends; the other modes replace.
  const result = mode === 'continue' ? `${text}\n${out}` : out
  return { success: true, text: result }
}
