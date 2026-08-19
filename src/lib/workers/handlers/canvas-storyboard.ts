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
  /** 光影氛围：这一镜的光线基调与情绪。 */
  lighting?: string
  /** 音效：这一镜的声音设计（环境音/拟音/配乐提示）。 */
  sfx?: string
  durationSec?: number
  dialogue?: string
}

/** One extracted production asset (角色/场景/道具) for the asset board. */
export interface CanvasStoryboardAsset {
  kind: 'character' | 'scene' | 'prop'
  name: string
  description: string
}

export interface CanvasStoryboardResult {
  shots: CanvasStoryboardShot[]
  /** 全局风格：全片统一的题材/媒介/色彩基调/光影特征/画质段落。 */
  globalStyle: string
  /** 从剧本中抽出的可复用资产清单（准备资产步骤的底稿）。 */
  assets: CanvasStoryboardAsset[]
}

const MAX_SHOTS = 40

export interface CanvasStoryboardCastMember {
  name: string
  description?: string
}

/** 入口二「角色生成分镜脚本」：以给定卡司原创短剧再拆分镜。 */
function buildCharactersSource(cast: CanvasStoryboardCastMember[], brief: string): string {
  return [
    '（没有现成剧本——请先以下列角色为主角，原创一部适合竖屏短视频的完整短剧，再按要求拆解。）',
    '主要角色：',
    ...cast.map((member) => `- ${member.name}${member.description ? `：${member.description}` : ''}`),
    ...(brief ? ['', `故事方向：${brief}`] : []),
  ].join('\n')
}

function buildPrompt(script: string): string {
  return [
    '你是一位专业短剧分镜师兼摄影指导。把下面的剧本/故事拆解成一份完整的分镜表与制作资产清单。',
    '要求：',
    '1. 只输出一个 JSON 对象，不要任何解释或 markdown 代码块围栏。',
    '2. 对象形如：{"globalStyle": "...", "assets": [...], "shots": [...]}',
    '3. globalStyle：全片统一的全局风格段落——题材与媒介（如：国风二次元厚涂插画/写实电影感）、色彩基调、光影特征、画质质感。',
    '4. assets：从剧本抽出的可复用资产清单，每项形如 {"kind": "character/scene/prop", "name": "简短唯一名称（镜头描述中提到该资产时必须使用完全相同的名称）", "description": "可直接用于文生图的外观设定：人物含性别/年龄/身高/服装/气质，场景含空间/陈设/时代，道具含材质/形制"}。同一人物的不同时期算不同资产（如「现代沈昭昭」「古代沈昭昭」）。',
    '5. 每个镜头形如：{"shotNumber": 1, "description": "画面内容的完整视觉描述（用于文生图）：场景、人物、动作——提到资产时必须使用 assets 里完全相同的 name", "shotSize": "中景/特写/全景/近景…", "cameraMove": "推近/拉远/环绕/固定/跟移…", "cameraAngle": "平视/俯拍/仰拍/过肩/主观视角…", "lens": "24mm 广角/35mm/50mm 标准/85mm 人像…", "performance": "该镜头中人物的表演与情绪（谁、什么情绪、怎么演）", "blocking": "站位与调度：谁在画面哪个位置、朝向、走位", "lighting": "光影氛围：这一镜的光线基调与情绪", "sfx": "音效：环境音/拟音/配乐提示", "durationSec": 5, "dialogue": "该镜头的对白或旁白，无则留空字符串"}',
    '6. 每个镜头的 shotSize、cameraAngle、lens、performance、blocking、lighting、sfx 都必须给出，不得省略——这是分镜表不是故事梗概。',
    `7. 镜头数量根据剧情自然切分，最多 ${MAX_SHOTS} 个。`,
    '8. 与剧本保持同一种语言。',
    '',
    '剧本：',
    script,
  ].join('\n')
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const ASSET_KINDS = new Set(['character', 'scene', 'prop'])
const MAX_ASSETS = 40

function parseAssets(raw: unknown): CanvasStoryboardAsset[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const assets: CanvasStoryboardAsset[] = []
  for (const item of raw.slice(0, MAX_ASSETS)) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const kind = trimmedString(o.kind)
    const name = trimmedString(o.name)
    const description = trimmedString(o.description)
    // 资产三要素缺一即丢弃该条（不发明占位描述）；名称去重保序。
    if (!kind || !ASSET_KINDS.has(kind) || !name || !description || seen.has(name)) continue
    seen.add(name)
    assets.push({ kind: kind as CanvasStoryboardAsset['kind'], name, description })
  }
  return assets
}

/**
 * Tolerant extraction — strips markdown fences / prose. Canonical output is
 * {"globalStyle", "assets", "shots"}; a bare shot array (misbehaving model) is
 * still accepted with empty globalStyle/assets rather than failing the whole
 * paid task on an envelope quirk. Shot-level validation stays strict: no
 * description → drop; zero valid shots → explicit parse failure.
 */
function parseStoryboard(text: string): CanvasStoryboardResult {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
  const objStart = trimmed.indexOf('{')
  const arrStart = trimmed.indexOf('[')
  let rawShots: unknown
  let globalStyle = ''
  let assets: CanvasStoryboardAsset[] = []
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
    globalStyle = trimmedString(record.globalStyle) ?? ''
    assets = parseAssets(record.assets)
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
    const lighting = trimmedString(o.lighting)
    const sfx = trimmedString(o.sfx)
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
      ...(lighting ? { lighting } : {}),
      ...(sfx ? { sfx } : {}),
      ...(typeof o.durationSec === 'number' && Number.isFinite(o.durationSec) ? { durationSec: o.durationSec } : {}),
      ...(dialogue ? { dialogue } : {}),
    })
  })
  if (shots.length === 0) {
    throw new Error('CANVAS_STORYBOARD_PARSE: no valid shots parsed')
  }
  return { shots, globalStyle, assets }
}

function parseCast(raw: unknown): CanvasStoryboardCastMember[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 12) {
    throw new Error('CANVAS_STORYBOARD: characters mode needs 1-12 cast members')
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`CANVAS_STORYBOARD: cast member ${i + 1} is not an object`)
    }
    const record = item as Record<string, unknown>
    const name = trimmedString(record.name)
    if (!name) throw new Error(`CANVAS_STORYBOARD: cast member ${i + 1} needs a name`)
    const description = trimmedString(record.description)
    return { name, ...(description ? { description } : {}) }
  })
}

export async function handleCanvasStoryboardTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const mode = payload.mode === 'characters' ? 'characters' : 'script'
  const model = typeof payload.model === 'string' ? payload.model : ''
  if (!model) throw new Error('CANVAS_STORYBOARD: model not resolved')

  let script: string
  if (mode === 'characters') {
    const cast = parseCast(payload.characters)
    const brief = trimmedString(payload.brief) ?? ''
    script = buildCharactersSource(cast, brief)
  } else {
    script = typeof payload.script === 'string' ? payload.script.trim() : ''
    if (!script) throw new Error('CANVAS_STORYBOARD: script is required')
  }

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
  const { shots, globalStyle, assets } = parseStoryboard(completion.text)

  await reportTaskProgress(job, 95, { stage: 'canvas_storyboard_done' })

  return { success: true, shots, globalStyle, assets, count: shots.length }
}
