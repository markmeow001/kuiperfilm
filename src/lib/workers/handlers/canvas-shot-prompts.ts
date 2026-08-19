/**
 * Canvas 脚本生成器 step 3 — 合成提示词 handler.
 *
 * Takes the confirmed shot table + asset list + 全局风格 and asks the LLM to
 * write one final generation prompt per shot, plus the list of asset names
 * that appear in that shot (drives per-shot reference selection and the
 * entity highlighting in the table). Text-only: rides the text worker; the
 * JSON result is written to Task.result and read back by the canvas via
 * GET /api/tasks/[taskId]. Complies with CLAUDE.md §3 (no direct route LLM
 * call; model resolved at submit time and pinned into payload).
 */
import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-runtime'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import type {
  CanvasStoryboardAsset,
  CanvasStoryboardShot,
} from '@/lib/workers/handlers/canvas-storyboard'

export interface CanvasShotPromptResult {
  shotNumber: number
  finalPrompt: string
  /** Asset names (exactly as provided) that appear in this shot. */
  entities: string[]
}

const MAX_SHOTS = 40
const MAX_ASSETS = 40

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseShotsInput(raw: unknown): CanvasStoryboardShot[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SHOTS) {
    throw new Error('CANVAS_SHOT_PROMPTS: shots must be a non-empty array')
  }
  return raw.map((item, i) => {
    if (!isRecord(item)) throw new Error(`CANVAS_SHOT_PROMPTS: shot ${i + 1} is not an object`)
    const description = trimmedString(item.description)
    const shotNumber = typeof item.shotNumber === 'number' && Number.isFinite(item.shotNumber)
      ? item.shotNumber
      : null
    if (!description || shotNumber === null) {
      throw new Error(`CANVAS_SHOT_PROMPTS: shot ${i + 1} needs shotNumber and description`)
    }
    const optional = (key: keyof CanvasStoryboardShot) => {
      const value = trimmedString(item[key])
      return value ? { [key]: value } : {}
    }
    return {
      shotNumber,
      description,
      ...optional('shotSize'),
      ...optional('cameraMove'),
      ...optional('cameraAngle'),
      ...optional('lens'),
      ...optional('performance'),
      ...optional('blocking'),
      ...optional('lighting'),
      ...optional('sfx'),
      ...optional('dialogue'),
    }
  })
}

function parseAssetsInput(raw: unknown): CanvasStoryboardAsset[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.length > MAX_ASSETS) {
    throw new Error('CANVAS_SHOT_PROMPTS: assets must be an array')
  }
  return raw.map((item, i) => {
    if (!isRecord(item)) throw new Error(`CANVAS_SHOT_PROMPTS: asset ${i + 1} is not an object`)
    const kind = trimmedString(item.kind)
    const name = trimmedString(item.name)
    const description = trimmedString(item.description)
    if (!kind || !['character', 'scene', 'prop'].includes(kind) || !name || !description) {
      throw new Error(`CANVAS_SHOT_PROMPTS: asset ${i + 1} needs kind/name/description`)
    }
    return { kind: kind as CanvasStoryboardAsset['kind'], name, description }
  })
}

function buildPrompt(params: {
  shots: CanvasStoryboardShot[]
  assets: CanvasStoryboardAsset[]
  globalStyle: string
}): string {
  return [
    '你是一位资深的 AI 影像提示词工程师兼摄影指导。为下面分镜表中的每一个镜头合成一条最终生成提示词。',
    '要求：',
    '1. 只输出一个 JSON 对象，不要任何解释或 markdown 代码块围栏。',
    '2. 对象形如：{"shots": [{"shotNumber": 1, "finalPrompt": "...", "entities": ["资产名", …]}, …]}，镜头数量与顺序必须与输入完全一致。',
    '3. finalPrompt 是可直接送入图像/视频生成模型的完整视觉提示词：融合画面描述、出场资产的外观设定（用资产 description 展开，不要只写名字）、人物表演与情绪、站位调度、景别/机位/焦段等镜头语言、光影氛围、运镜，并以全局风格收尾统一质感。对白不要作为字幕写进画面。',
    '4. entities 列出该镜头中出场的资产名称，必须从下方资产清单的 name 中原样挑选，没有则给空数组。',
    '5. 与输入保持同一种语言。',
    '',
    `全局风格：${params.globalStyle || '（未提供）'}`,
    '',
    '资产清单：',
    JSON.stringify(params.assets),
    '',
    '分镜表：',
    JSON.stringify(params.shots),
  ].join('\n')
}

/**
 * Strict parse: every input shot must come back with a non-empty finalPrompt
 * for its exact shotNumber — a missing shot fails the task explicitly rather
 * than leaving that row silently un-synthesized. Unknown entity names are the
 * one tolerated model quirk: they are dropped (never invented into refs).
 */
function parseResult(
  text: string,
  inputShots: CanvasStoryboardShot[],
  knownAssetNames: ReadonlySet<string>,
): CanvasShotPromptResult[] {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('CANVAS_SHOT_PROMPTS_PARSE: no JSON object in model output')
  }
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1))
  if (!isRecord(parsed) || !Array.isArray(parsed.shots)) {
    throw new Error('CANVAS_SHOT_PROMPTS_PARSE: shots is not an array')
  }
  const byShotNumber = new Map<number, { finalPrompt: string; entities: string[] }>()
  for (const raw of parsed.shots) {
    if (!isRecord(raw)) continue
    const shotNumber = typeof raw.shotNumber === 'number' ? raw.shotNumber : null
    const finalPrompt = trimmedString(raw.finalPrompt)
    if (shotNumber === null || !finalPrompt) continue
    const entities = Array.isArray(raw.entities)
      ? raw.entities
          .map((name) => trimmedString(name))
          .filter((name): name is string => Boolean(name) && knownAssetNames.has(name!))
      : []
    byShotNumber.set(shotNumber, { finalPrompt, entities: [...new Set(entities)] })
  }
  return inputShots.map((shot) => {
    const match = byShotNumber.get(shot.shotNumber)
    if (!match) {
      throw new Error(`CANVAS_SHOT_PROMPTS_PARSE: shot ${shot.shotNumber} missing finalPrompt`)
    }
    return { shotNumber: shot.shotNumber, ...match }
  })
}

export async function handleCanvasShotPromptsTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const model = typeof payload.model === 'string' ? payload.model : ''
  if (!model) throw new Error('CANVAS_SHOT_PROMPTS: model not resolved')

  const shots = parseShotsInput(payload.shots)
  const assets = parseAssetsInput(payload.assets)
  const globalStyle = trimmedString(payload.globalStyle) ?? ''

  await reportTaskProgress(job, 20, { stage: 'canvas_shot_prompts_generate' })
  await assertTaskActive(job, 'canvas_shot_prompts_llm')

  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model,
    messages: [{ role: 'user', content: buildPrompt({ shots, assets, globalStyle }) }],
    reasoning: false,
    projectId: job.data.projectId,
    action: 'canvas_shot_prompts',
    meta: {
      stepId: 'canvas_shot_prompts',
      stepTitle: '合成提示词',
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  if (!completion.text) throw new Error('CANVAS_SHOT_PROMPTS: empty model output')
  const knownAssetNames = new Set(assets.map((asset) => asset.name))
  const prompts = parseResult(completion.text, shots, knownAssetNames)

  await reportTaskProgress(job, 95, { stage: 'canvas_shot_prompts_done' })

  return { success: true, prompts, count: prompts.length }
}
