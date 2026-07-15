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
import {
  ROUTE_MOVEMENTS,
  parseDirectorRouteSegments,
  PRESET_NAMES,
  MAX_SHOTS_PER_PLAN,
  MAX_SCENE_SEC,
  MAX_STORYBOARD_SEGMENTS,
  type DirectorRouteInputMode,
} from '@/lib/canvas/director-routes-schema'

function buildPrompt(description: string, mode: DirectorRouteInputMode, cast: string[], props: string[]): string {
  const outputRules = mode === 'storyboard'
    ? [
        `把完整分镜按原文顺序拆成 1-${MAX_STORYBOARD_SEGMENTS} 个连续段落；每段必须能在 ${MAX_SCENE_SEC} 秒内拍完。`,
        '覆盖原文所有关键剧情动作、人物关系、对白节点与硬性限制；删除小说修辞、重复说明和无法视觉化的内心解释，但不可改变事件因果。',
        '每个段落只给 1 套你判断最准确、最可执行的导演方案，避免无意义的备选方案。',
      ]
    : [
        `只建立 1 个段落，并为它设计 2-3 套差异明显的导演方案（如：一镜到底情绪流 / 蒙太奇快切 / 压迫式空间收紧）。`,
      ]
  return [
    '你是一位短剧导演与分镜整理师。请把输入转换为可直接执行的导演路线。',
    '要求：',
    '1. 只输出一个 JSON 对象，不要解释或 markdown 围栏。对象格式：{"segments":[{"title":"段落标题","sourceSummary":"从原文抽出的可拍摄事件摘要","plans":[...]}]}。',
    ...outputRules.map((rule, index) => `${index + 2}. ${rule}`),
    `5. 每个 plan 形如：{"name":"方案名","style":"视觉与节奏风格","shots":[...]}。每套 1-${MAX_SHOTS_PER_PLAN} 镜，durationSec 合计不超过 ${MAX_SCENE_SEC} 秒且不要平均分配。`,
    `6. 每个 shot 形如：{"label":"01 开场·远景","note":"画面动作 / 构图 / 对白节点","durationSec":7.5,"cameraPreset":"正面全景","movement":"推近","focus":"角色名"}。`,
    `7. cameraPreset 只能从这些里选：${PRESET_NAMES.join('、')}。movement 只能是：${ROUTE_MOVEMENTS.join('、')}。`,
    cast.length > 0 ? `8. 舞台上的角色：${cast.join('、')}。focus 必须从中选。` : '8. 舞台上暂无角色，focus 留空字符串。',
    props.length > 0 ? `9. 舞台道具：${props.join('、')}（可在 note 里利用）。` : '',
    '10. 与输入保持同一种语言；段落标题和摘要必须让用户能核对原文是否被正确保留。',
    '',
    '场景描述：',
    description,
  ].filter(Boolean).join('\n')
}

export async function handleCanvasDirectorRoutesTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const description = typeof payload.description === 'string' ? payload.description.trim() : ''
  const mode = payload.mode === 'brief' || payload.mode === 'storyboard' ? payload.mode as DirectorRouteInputMode : null
  const cast = Array.isArray(payload.cast) ? payload.cast.filter((c): c is string => typeof c === 'string') : []
  const props = Array.isArray(payload.props) ? payload.props.filter((p): p is string => typeof p === 'string') : []
  const model = typeof payload.model === 'string' ? payload.model : ''

  if (!description) throw new Error('CANVAS_DIRECTOR_ROUTES: description is required')
  if (!mode) throw new Error('CANVAS_DIRECTOR_ROUTES: mode is required')
  if (!model) throw new Error('CANVAS_DIRECTOR_ROUTES: model not resolved')

  await reportTaskProgress(job, 20, { stage: 'canvas_director_routes_generate' })
  await assertTaskActive(job, 'canvas_director_routes_llm')

  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model,
    messages: [{ role: 'user', content: buildPrompt(description, mode, cast, props) }],
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
  const segments = parseDirectorRouteSegments(completion.text, mode)

  await reportTaskProgress(job, 95, { stage: 'canvas_director_routes_done' })

  return { success: true, segments, count: segments.length, planCount: segments.reduce((sum, segment) => sum + segment.plans.length, 0) }
}
