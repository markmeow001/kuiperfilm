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
import { parseCanvasAssistantPlan, type CanvasAssistantPlan } from '@/lib/canvas/assistant-contract'
import { VIDEO_PROMPT_COMPRESSION_TARGET } from '@/lib/playground/video-prompt-limits'

export const CANVAS_TEXT_MODES = {
  expand: '把下面的文字扩写得更丰富、更具体，补充画面感与细节，保持原意、结构与语言不变。只输出扩写后的正文，不要任何解释。',
  rewrite: '改写下面的文字，使表达更流畅自然、更有张力，保持原意与语言不变。只输出改写后的正文，不要任何解释。',
  polish: '润色下面的文字：修正语病、收紧冗词、统一语气，内容与语言保持不变。只输出润色后的正文，不要任何解释。',
  continue: '顺着下面的文字自然续写一段，延续既有的风格、人物与语言。只输出续写的正文（不要重复原文），不要任何解释。',
  // Video-prompt compression (Seedance-class models dilute/ignore over-long
  // prompts): keep the essentials, hard-cap the output length.
  compress: `把下面的视频生成提示词压缩到 ${VIDEO_PROMPT_COMPRESSION_TARGET} 字符以内。硬性要求（要素保全优先于字数）：①出现的每个人物及其外观关键词一个都不能丢；②动作保持原有先后顺序；③关键道具、场景环境、镜头景别与运镜、光线氛围、风格关键词全部保留。只删除：重复的描述、纯叙事铺陈、不影响画面的修饰词。在满足以上前提下越精炼越好；保持原语言。只输出压缩后的提示词，不要任何解释。`,
  assistant: `你是影视制作无限画布的规划助手。输入是 JSON，包含用户要求、当前节点、选中节点与连线。
只输出一个 JSON 对象，不要 Markdown，不要解释。格式：
{"summary":"简短说明","operations":[...]}
operations 最多 12 个，只能使用：
1. {"kind":"create_node","alias":"唯一别名","nodeType":"text|script|image|video|audio|mask|composition|director|character","title":"标题","prompt":"可选提示词","aspectRatio":"可选，例如 16:9"}
2. {"kind":"update_nodes","nodeIds":["现有节点 id 或新节点别名"],"patch":{"title":"可选","prompt":"可选","aspectRatio":"可选"}}
3. {"kind":"connect","source":"现有节点 id 或新节点别名","target":"现有节点 id 或新节点别名"}
4. {"kind":"arrange","nodeIds":["现有节点 id 或新节点别名"],"mode":"left|top|horizontal|vertical"}
不要删除节点，不要修改锁定节点，不要捏造现有节点 id。连接必须符合影视资料流：文本/脚本/角色可供图片或视频使用，图片可供视频/遮罩/角色使用，视频与音频可供视频合成使用。若用户要求含糊，建立最小而完整的流程。`,
} as const

export type CanvasTextMode = keyof typeof CANVAS_TEXT_MODES

export function isCanvasTextMode(v: unknown): v is CanvasTextMode {
  // Object.hasOwn (not `in`): `in` walks the prototype chain, so payloads like
  // mode:"toString" would pass the whitelist and stringify a builtin into the
  // LLM instruction.
  return typeof v === 'string' && Object.hasOwn(CANVAS_TEXT_MODES, v)
}

export interface CanvasTextTaskResult extends Record<string, unknown> {
  success: true
  text?: string
  assistantPlan?: CanvasAssistantPlan
}

export async function handleCanvasTextTask(job: Job<TaskJobData>): Promise<CanvasTextTaskResult> {
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

  if (mode === 'assistant') {
    return { success: true, assistantPlan: parseCanvasAssistantPlan(out) }
  }

  // 续写 appends; the other modes replace.
  const result = mode === 'continue' ? `${text}\n${out}` : out
  return { success: true, text: result }
}
