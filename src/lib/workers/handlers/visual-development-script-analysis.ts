import { createHash } from 'node:crypto'
import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { getSignedUrl, toFetchableUrl } from '@/lib/cos'
import {
  buildScriptAnalysisMessages,
  parseScriptAnalysisModelOutput,
  SCRIPT_ANALYSIS_MAX_CHARS,
  SCRIPT_ANALYSIS_MIN_CHARS,
  type ScriptSourceFormat,
} from '@/lib/visual-development/script-analysis'
import { EMPTY_WORLD_BIBLE, parseWorldBible, toWorldBibleJson } from '@/lib/visual-development/world-bible'

function requiredText(payload: Record<string, unknown>, key: string, max: number): string {
  const value = typeof payload[key] === 'string' ? payload[key].trim() : ''
  if (!value) throw new Error(`VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS: ${key} is required`)
  if (value.length > max) throw new Error(`VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS: ${key} exceeds ${max} characters`)
  return value
}

function sourceFormat(value: unknown): ScriptSourceFormat {
  if (value === 'pasted' || value === 'docx' || value === 'pdf' || value === 'txt' || value === 'md') return value
  throw new Error('VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS: sourceFormat is invalid')
}

export async function handleVisualDevelopmentScriptAnalysisTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const sourceId = requiredText(payload, 'sourceId', 120)
  const sourceKey = requiredText(payload, 'sourceKey', 2_000)
  const sourceSha256 = requiredText(payload, 'sourceSha256', 64)
  const sourceResponse = await fetch(toFetchableUrl(getSignedUrl(sourceKey, 3600)))
  if (!sourceResponse.ok) {
    throw new Error(`VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS: source download failed (${sourceResponse.status})`)
  }
  const scriptText = (await sourceResponse.text()).trim()
  if (scriptText.length > SCRIPT_ANALYSIS_MAX_CHARS) {
    throw new Error(`VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS: scriptText exceeds ${SCRIPT_ANALYSIS_MAX_CHARS} characters`)
  }
  if (scriptText.length < SCRIPT_ANALYSIS_MIN_CHARS) {
    throw new Error(`VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS: scriptText requires at least ${SCRIPT_ANALYSIS_MIN_CHARS} characters`)
  }
  const actualSha256 = createHash('sha256').update(Buffer.from(scriptText, 'utf8')).digest('hex')
  if (actualSha256 !== sourceSha256 && payload.sourceFormat === 'pasted') {
    throw new Error('VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS: source integrity check failed')
  }
  const sourceTitle = requiredText(payload, 'sourceTitle', 240)
  const format = sourceFormat(payload.sourceFormat)
  const modelKey = requiredText(payload, 'analysisModel', 255)

  await reportTaskProgress(job, 15, { stage: 'script_analysis_read' })
  await assertTaskActive(job, 'visual_development_script_analysis_llm')

  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model: modelKey,
    messages: buildScriptAnalysisMessages({ locale: job.data.locale, sourceTitle, scriptText }),
    reasoning: false,
    temperature: 0.2,
    maxRetries: 0,
    maxOutputTokens: 10_000,
    stream: false,
    projectId: job.data.projectId,
    action: 'visual_development_script_analysis',
    meta: {
      stepId: 'script_analysis',
      stepTitle: job.data.locale === 'zh' ? '劇本世界觀與角色分析' : 'Screenplay world and character analysis',
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  await reportTaskProgress(job, 70, { stage: 'script_analysis_validate' })
  const analyzedAt = new Date().toISOString()
  const analysis = parseScriptAnalysisModelOutput({
    text: completion.text,
    id: `SCRIPT-${job.data.taskId}`,
    sourceTitle,
    sourceFormat: format,
    sourceLength: scriptText.length,
    modelKey,
    analyzedAt,
    sourceId,
  })

  await assertTaskActive(job, 'visual_development_script_analysis_persist')
  const current = await prisma.visualDevelopmentWorkspace.findUnique({
    where: { projectId: job.data.projectId },
  })
  const worldBible = current ? parseWorldBible(current.worldBible) : { ...EMPTY_WORLD_BIBLE }
  worldBible.scriptAnalysis = analysis

  await prisma.visualDevelopmentWorkspace.upsert({
    where: { projectId: job.data.projectId },
    create: {
      projectId: job.data.projectId,
      status: 'world_draft',
      worldBible: toWorldBibleJson(worldBible),
    },
    update: {
      worldBible: toWorldBibleJson(worldBible),
    },
  })

  await reportTaskProgress(job, 95, {
    stage: 'script_analysis_ready',
    characterCount: analysis.characters.length,
    locationCount: analysis.locations.length,
  })

  return {
    success: true,
    analysisId: analysis.id,
    characterCount: analysis.characters.length,
    locationCount: analysis.locations.length,
  }
}
