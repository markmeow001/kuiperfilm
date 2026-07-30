import type { Job } from 'bullmq'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { getProductionStage } from '@/lib/visual-development/production-stages'
import {
  buildProductionStageBriefMessages,
  parseProductionStageBriefModelOutput,
  productionStageBriefDnaKey,
} from '@/lib/visual-development/stage-brief'
import { parseWorldBible } from '@/lib/visual-development/world-bible'

function requiredText(payload: Record<string, unknown>, key: string, max: number): string {
  const value = typeof payload[key] === 'string' ? payload[key].trim() : ''
  if (!value) throw new Error(`VISUAL_DEVELOPMENT_STAGE_BRIEF: ${key} is required`)
  if (value.length > max) throw new Error(`VISUAL_DEVELOPMENT_STAGE_BRIEF: ${key} exceeds ${max} characters`)
  return value
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

export async function handleVisualDevelopmentStageBriefTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const characterId = requiredText(payload, 'characterId', 191)
  const characterCode = requiredText(payload, 'characterCode', 64)
  const stageId = requiredText(payload, 'stageId', 64)
  const modelKey = requiredText(payload, 'analysisModel', 255)
  const stage = getProductionStage(stageId)
  const briefKey = productionStageBriefDnaKey(stage.id)

  const character = await prisma.visualDevelopmentCharacter.findFirst({
    where: { id: characterId, code: characterCode, workspace: { projectId: job.data.projectId } },
    include: { workspace: true },
  })
  if (!character) throw new Error('VISUAL_DEVELOPMENT_STAGE_BRIEF: character not found')
  const characterDna = stringRecord(character.characterDna)
  if (characterDna[briefKey]) {
    throw new Error(`VISUAL_DEVELOPMENT_STAGE_BRIEF: immutable ${stage.id} brief already exists`)
  }
  const worldBible = parseWorldBible(character.workspace.worldBible)
  const analysis = worldBible.scriptAnalysis
  if (!analysis || analysis.status !== 'applied') {
    throw new Error('VISUAL_DEVELOPMENT_STAGE_BRIEF: applied screenplay analysis is required')
  }
  const analysisCharacter = analysis.characters.find((candidate) => candidate.code === characterCode)
  if (!analysisCharacter) {
    throw new Error(`VISUAL_DEVELOPMENT_STAGE_BRIEF: screenplay character ${characterCode} not found`)
  }

  await reportTaskProgress(job, 15, { stage: 'stage_brief_prepare', productionStageId: stage.id })
  await assertTaskActive(job, 'visual_development_stage_brief_llm')
  const completion = await executeAiTextStep({
    userId: job.data.userId,
    model: modelKey,
    messages: buildProductionStageBriefMessages({
      locale: job.data.locale,
      stage,
      characterCode,
      characterName: character.name,
      worldBible: {
        projectPremise: worldBible.projectPremise,
        visualThesis: worldBible.visualThesis,
        eraAndGeography: worldBible.eraAndGeography,
        societyAndFactions: worldBible.societyAndFactions,
        technologyRules: worldBible.technologyRules,
        colorScript: worldBible.colorScript,
        materialRules: worldBible.materialRules,
        architectureLanguage: worldBible.architectureLanguage,
        cameraFormat: worldBible.cameraFormat,
        forbiddenElements: worldBible.forbiddenElements,
      },
      characterDna,
      analysisCharacter,
      locations: analysis.locations,
    }),
    reasoning: false,
    temperature: 0.2,
    maxRetries: 0,
    maxOutputTokens: 4_000,
    stream: false,
    projectId: job.data.projectId,
    action: 'visual_development_stage_brief',
    meta: {
      stepId: `stage_brief_${stage.id}`,
      stepTitle: job.data.locale === 'zh'
        ? `建立 Phase ${String(stage.phase).padStart(2, '0')} 劇本基準`
        : `Build Phase ${String(stage.phase).padStart(2, '0')} screenplay baseline`,
      stepIndex: 1,
      stepTotal: 1,
    },
  })

  await reportTaskProgress(job, 75, { stage: 'stage_brief_validate', productionStageId: stage.id })
  const brief = parseProductionStageBriefModelOutput({
    text: completion.text,
    stage,
    characterCode,
    modelKey,
    createdAt: new Date().toISOString(),
    sourceAnalysisId: analysis.id,
  })

  await assertTaskActive(job, 'visual_development_stage_brief_persist')
  const current = await prisma.visualDevelopmentCharacter.findUnique({
    where: { id: character.id },
    select: { characterDna: true },
  })
  const currentDna = stringRecord(current?.characterDna)
  if (currentDna[briefKey]) {
    throw new Error(`VISUAL_DEVELOPMENT_STAGE_BRIEF: immutable ${stage.id} brief already exists`)
  }
  const nextDna: Prisma.InputJsonObject = {
    ...currentDna,
    [briefKey]: JSON.stringify(brief),
  }
  await prisma.visualDevelopmentCharacter.update({
    where: { id: character.id },
    data: { characterDna: nextDna },
  })
  await reportTaskProgress(job, 95, { stage: 'stage_brief_ready', productionStageId: stage.id })
  return {
    success: true,
    stageId: stage.id,
    characterCode,
    briefVersion: brief.version,
  }
}
