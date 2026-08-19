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
import type { Locale } from '@/i18n/routing'

const R2V_CHARACTER_SYSTEM_PROMPT_ZH = `你是電影角色視覺設定師。請把使用者提供的簡短角色構想，整理成適合 Seedance 2.0 R2V 的角色外觀描述。
必須包含：人物身分與年代、年齡感、臉部與五官質感、髮型、身形、服裝層次與材質、妝容或特效妝、配件，以及電影寫實要求。
參考圖負責鎖定人物身分；不要加入動作、走位、鏡頭、背景、對白或其他人物。不得改變使用者明確指定的性別、年代與核心造型。
請以繁體中文輸出 120–320 個字。只輸出可直接貼入「角色補充描述」的正文，不要標題、Markdown、引號或解釋。`

const R2V_CHARACTER_SYSTEM_PROMPT_EN = `You are a cinematic character visual-development artist. Turn the user's short character brief into a production-ready character appearance description for Seedance 2.0 R2V.
Include the character's identity and period, apparent age, realistic face and facial features, hairstyle, body type, layered clothing and materials, makeup or prosthetic effects, accessories, and a photorealistic cinematic finish.
The reference image locks identity. Do not add actions, blocking, camera directions, background, dialogue, or other characters. Preserve every explicitly stated gender, period, and core design choice.
Write about 60–100 concise English words and never exceed 600 characters. Output only the text that can be pasted into the character description field, with no heading, Markdown, quotation marks, or explanation.`

const R2V_SCENE_SYSTEM_PROMPT_ZH = `你是電影美術指導與動態場景提示詞設計師。請把使用者提供的簡短場景構想，整理成適合 Seedance 2.0 R2V 的「場景與動態描述」。
必須包含：年代與地點、時間與天氣、主要建築與材質、空間層次、光線與色調，以及畫面中合理且持續運動的環境元素，例如路人、車輛、旗幟、雨霧、樹葉、反射或煙塵；同時描述它們隨原片運鏡產生的透視與視差變化。
環境必須是連續運動的真實空間，不能像靜態照片；不得改變原片人物數量、動作順序、走位、互動、對白或鏡頭軌跡。
請以繁體中文輸出 150–420 個字。只輸出可直接貼入「場景與動態描述」的正文，不要標題、Markdown、引號或解釋。`

const R2V_SCENE_SYSTEM_PROMPT_EN = `You are a film production designer and dynamic-environment prompt specialist. Turn the user's short scene brief into a production-ready scene and environmental-motion description for Seedance 2.0 R2V.
Include the period and location, time and weather, principal architecture and materials, spatial depth, lighting and color palette, plus plausible continuous environmental motion such as pedestrians, vehicles, flags, rain, fog, foliage, reflections, or dust. Describe perspective and parallax changes caused by the source camera movement.
The environment must feel like a continuously moving real space, never a still photograph. Do not alter the source video's character count, action order, blocking, interactions, dialogue, or camera path.
Write about 100–160 concise English words and never exceed 1,000 characters. Output only the text that can be pasted into the scene-and-motion field, with no heading, Markdown, quotation marks, or explanation.`

export const R2V_CANVAS_TEXT_MAX_CHARS = 500

export const R2V_CANVAS_TEXT_POLICIES = {
  r2v_character: {
    maxOutputTokens: 800,
    systemPrompt: {
      zh: R2V_CHARACTER_SYSTEM_PROMPT_ZH,
      en: R2V_CHARACTER_SYSTEM_PROMPT_EN,
    },
  },
  r2v_scene_motion: {
    maxOutputTokens: 1000,
    systemPrompt: {
      zh: R2V_SCENE_SYSTEM_PROMPT_ZH,
      en: R2V_SCENE_SYSTEM_PROMPT_EN,
    },
  },
} as const

export type R2VCanvasTextMode = keyof typeof R2V_CANVAS_TEXT_POLICIES

export function isR2VCanvasTextMode(value: unknown): value is R2VCanvasTextMode {
  return typeof value === 'string' && Object.hasOwn(R2V_CANVAS_TEXT_POLICIES, value)
}

export function getR2VCanvasTextPolicy(mode: R2VCanvasTextMode, locale: Locale) {
  const policy = R2V_CANVAS_TEXT_POLICIES[mode]
  return {
    maxOutputTokens: policy.maxOutputTokens,
    systemPrompt: policy.systemPrompt[locale],
  }
}

export const CANVAS_TEXT_MODES = {
  expand: '把下面的文字扩写得更丰富、更具体，补充画面感与细节，保持原意、结构与语言不变。只输出扩写后的正文，不要任何解释。',
  rewrite: '改写下面的文字，使表达更流畅自然、更有张力，保持原意与语言不变。只输出改写后的正文，不要任何解释。',
  polish: '润色下面的文字：修正语病、收紧冗词、统一语气，内容与语言保持不变。只输出润色后的正文，不要任何解释。',
  continue: '顺着下面的文字自然续写一段，延续既有的风格、人物与语言。只输出续写的正文（不要重复原文），不要任何解释。',
  // Video-prompt compression (Seedance-class models dilute/ignore over-long
  // prompts): keep the essentials, hard-cap the output length.
  compress: `把下面的视频生成提示词压缩到 ${VIDEO_PROMPT_COMPRESSION_TARGET} 字符以内。硬性要求（要素保全优先于字数）：①出现的每个人物及其外观关键词一个都不能丢；②动作保持原有先后顺序；③关键道具、场景环境、镜头景别与运镜、光线氛围、风格关键词全部保留。只删除：重复的描述、纯叙事铺陈、不影响画面的修饰词。在满足以上前提下越精炼越好；保持原语言。只输出压缩后的提示词，不要任何解释。`,
  r2v_character: R2V_CHARACTER_SYSTEM_PROMPT_ZH,
  r2v_scene_motion: R2V_SCENE_SYSTEM_PROMPT_ZH,
  assistant: `你是影视制作无限画布的规划助手。输入是 JSON，包含用户要求、当前节点、选中节点与连线。
只输出一个 JSON 对象，不要 Markdown，不要解释。格式：
{"summary":"简短说明","operations":[...]}
operations 最多 12 个，只能使用：
1. {"kind":"create_node","alias":"唯一别名","nodeType":"text|script|image|video|audio|mask|composition|director|character|scene|prop","title":"标题","prompt":"可选提示词","aspectRatio":"可选，例如 16:9"}
2. {"kind":"update_nodes","nodeIds":["现有节点 id 或新节点别名"],"patch":{"title":"可选","prompt":"可选","aspectRatio":"可选"}}
3. {"kind":"connect","source":"现有节点 id 或新节点别名","target":"现有节点 id 或新节点别名"}
4. {"kind":"arrange","nodeIds":["现有节点 id 或新节点别名"],"mode":"left|top|horizontal|vertical"}
不要删除节点，不要修改锁定节点，不要捏造现有节点 id。若输入含 scriptAttachment（用户上传的剧本，系统只给你摘要），需要用到剧本全文时创建一个 script 节点并把 prompt 留空——系统会自动把附件全文填进去，绝不要在 prompt 里复述或改写剧本内容。连接必须符合影视资料流：文本/脚本/角色可供图片或视频使用，图片可供视频/遮罩/角色使用，视频与音频可供视频合成使用。若用户要求含糊，建立最小而完整的流程。`,
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
  const locale = job.data.locale

  if (!text) throw new Error('CANVAS_TEXT: text is required')
  if (!isCanvasTextMode(mode)) throw new Error('CANVAS_TEXT: invalid mode')
  if (!model) throw new Error('CANVAS_TEXT: model not resolved')
  if (locale !== 'zh' && locale !== 'en') throw new Error('CANVAS_TEXT: invalid locale')

  const r2vPolicy = isR2VCanvasTextMode(mode)
    ? getR2VCanvasTextPolicy(mode, locale)
    : null
  const messages = r2vPolicy
    ? [
        { role: 'system' as const, content: r2vPolicy.systemPrompt },
        { role: 'user' as const, content: text },
      ]
    : [{ role: 'user' as const, content: `${CANVAS_TEXT_MODES[mode]}\n\n${text}` }]

  await reportTaskProgress(job, 20, { stage: 'canvas_text_generate' })
  await assertTaskActive(job, 'canvas_text_llm')

  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model,
    messages,
    reasoning: false,
    ...(r2vPolicy
      ? {
          maxRetries: 0,
          maxOutputTokens: r2vPolicy.maxOutputTokens,
          stream: false,
        }
      : {}),
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
