/**
 * Canvas 无限画布 — 导演台 AI 导演路线方案 handler (previz S4)。
 *
 * 输入一段场景描述 + 舞台卡司/道具清单，让 LLM 出 2-3 套「导演路线方案」
 * （每套 = 有序镜头列表：景别机位预设/运镜/时长/焦点角色）。JSON 结果写进
 * Task.result，画布 poll /api/tasks/[taskId] 取回后由客户端
 * route-materialize 落成 previz StageShot[]。文本任务：跑 text worker，
 * 走 createRun → worker → run-runtime（CLAUDE.md §3，route 不直连 LLM）。
 * 类型与解析在 @/lib/canvas/director-routes-schema（纯模块，供客户端共用）。
 */
import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-runtime'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { ROUTE_MOVEMENTS, parseRoutePlans, PRESET_NAMES, MAX_SHOTS_PER_PLAN, MAX_SCENE_SEC } from '@/lib/canvas/director-routes-schema'

function buildPrompt(description: string, cast: string[], props: string[]): string {
  return [
    '你是一位短剧导演。为下面的场景设计 2-3 套差异明显的「导演路线方案」（如：一镜到底情绪流 / 蒙太奇快切 / 压迫式空间收紧）。',
    '要求：',
    '1. 只输出一个 JSON 数组（2-3 个方案对象），不要任何解释或 markdown 代码块围栏。',
    '2. 方案对象形如：{"name": "01 一镜到底·情绪沉淀", "style": "中近景 / 跟随推进", "shots": [...]}',
    `3. 每个 shot 形如：{"label": "01 开场·远景", "note": "远景 / 建立空间", "durationSec": 7.5, "cameraPreset": "正面全景", "movement": "推近", "focus": "角色名"}`,
    `4. cameraPreset 只能从这些里选：${PRESET_NAMES.join('、')}。movement 只能是：${ROUTE_MOVEMENTS.join('、')}。`,
    `5. 每套方案 1-${MAX_SHOTS_PER_PLAN} 个镜头，durationSec 合计不超过 ${MAX_SCENE_SEC} 秒（硬性）。节奏要有设计：不要平均分配时长。`,
    cast.length > 0 ? `6. 舞台上的角色：${cast.join('、')}。focus 必须从中选。` : '6. 舞台上暂无角色，focus 留空字符串。',
    props.length > 0 ? `7. 舞台道具：${props.join('、')}（可在 note 里利用）。` : '',
    '8. 与场景描述保持同一种语言。',
    '',
    '场景描述：',
    description,
  ].filter(Boolean).join('\n')
}

export async function handleCanvasDirectorRoutesTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const description = typeof payload.description === 'string' ? payload.description.trim() : ''
  const cast = Array.isArray(payload.cast) ? payload.cast.filter((c): c is string => typeof c === 'string') : []
  const props = Array.isArray(payload.props) ? payload.props.filter((p): p is string => typeof p === 'string') : []
  const model = typeof payload.model === 'string' ? payload.model : ''

  if (!description) throw new Error('CANVAS_DIRECTOR_ROUTES: description is required')
  if (!model) throw new Error('CANVAS_DIRECTOR_ROUTES: model not resolved')

  await reportTaskProgress(job, 20, { stage: 'canvas_director_routes_generate' })
  await assertTaskActive(job, 'canvas_director_routes_llm')

  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model,
    messages: [{ role: 'user', content: buildPrompt(description, cast, props) }],
    reasoning: false,
    projectId: job.data.projectId,
    action: 'canvas_director_routes',
    meta: {
      stepId: 'canvas_director_routes',
      stepTitle: '导演路线方案',
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  if (!completion.text) throw new Error('CANVAS_DIRECTOR_ROUTES: empty model output')
  const plans = parseRoutePlans(completion.text)

  await reportTaskProgress(job, 95, { stage: 'canvas_director_routes_done' })

  return { success: true, plans, count: plans.length }
}
