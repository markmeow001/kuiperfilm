import type { Job } from 'bullmq'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { parseDirectorBlockingDraft } from '@/lib/canvas/director-blocking-schema'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'

function buildPrompt(description: string): string {
  return [
    '你是电影导演与分镜预演师。把用户描述转换成一个可编辑的 3D 排戏草稿。',
    '只输出一个 JSON 对象，不要 markdown、解释或额外文字。',
    '坐标系：X 是画面左右，Y 是高度且地面为 0，Z 是前后；人物脚底通常 Y=0。摄影机通常放在正 Z 看向原点。',
    '人物 bodyType 只能是 male、female、broad、muscular、slender、teen、child、chibi。',
    '道具 kind 只能是 box、sphere、cylinder、car；用基础几何近似墙、桌、遮挡物等。',
    'facingDeg 是绕 Y 轴旋转角度。摄影机焦段 focalLengthMm 必须在 14-200，使用全画幅语义。',
    '所有人物必须被 camera 的 framing 合理框住；如果用户指定焦段、人数、遮挡关系或构图，必须精确遵守。',
    'JSON 结构：',
    '{"title":"方案名","summary":"构图与调度说明","subjects":[{"label":"角色A","bodyType":"male","position":[-1,0,0],"facingDeg":90}],"props":[{"label":"中间遮挡物","kind":"box","position":[0,0,0],"rotationDeg":[0,0,0],"scale":[0.5,1.2,0.5]}],"camera":{"label":"35mm 双人中景","position":[0,1.6,6],"target":[0,1,0],"focalLengthMm":35,"framing":"双人中景，两人均在画内","rollDeg":0}}',
    '数量限制：subjects 1-6 个，props 0-8 个。位置范围尽量控制在 -12 到 12 米。',
    '所有 label、title、summary、framing 使用用户描述的语言。',
    '',
    '用户描述：',
    description,
  ].join('\n')
}

export async function handleCanvasDirectorBlockingTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const description = typeof payload.description === 'string' ? payload.description.trim() : ''
  const model = typeof payload.model === 'string' ? payload.model : ''
  if (!description) throw new Error('CANVAS_DIRECTOR_BLOCKING: description is required')
  if (!model) throw new Error('CANVAS_DIRECTOR_BLOCKING: model not resolved')

  await reportTaskProgress(job, 20, { stage: 'canvas_director_blocking_generate' })
  await assertTaskActive(job, 'canvas_director_blocking_llm')
  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model,
    messages: [{ role: 'user', content: buildPrompt(description) }],
    reasoning: false,
    projectId: job.data.projectId,
    action: 'canvas_director_blocking',
    meta: { stepId: 'canvas_director_blocking', stepTitle: 'AI 排戏', stepIndex: 1, stepTotal: 1 },
  })
  if (!completion.text) throw new Error('CANVAS_DIRECTOR_BLOCKING: empty model output')
  const draft = parseDirectorBlockingDraft(completion.text)
  await reportTaskProgress(job, 95, { stage: 'canvas_director_blocking_done' })
  return { success: true, draft }
}
