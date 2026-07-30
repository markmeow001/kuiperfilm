import { prisma } from '@/lib/prisma'
import { ApiError } from '@/lib/api-errors'
import { resolveModelSelection } from '@/lib/api-config'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE } from '@/lib/task/types'
import type { Locale } from '@/i18n/routing'
import { canEnterProductionStage, type ProductionStageDefinition } from './production-stages'
import {
  parseStoredProductionStageBrief,
  productionStageBriefDnaKey,
  productionStageCreativePromptDnaKey,
} from './stage-brief'
import { parseWorldBible } from './world-bible'

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

async function findCharacter(projectId: string, characterCode: string) {
  const character = await prisma.visualDevelopmentCharacter.findFirst({
    where: { code: characterCode, workspace: { projectId } },
    include: { workspace: true },
  })
  if (!character) throw new ApiError('NOT_FOUND', { code: 'VISUAL_CHARACTER_NOT_FOUND' })
  return character
}

function taskTargetId(characterId: string, stage: ProductionStageDefinition): string {
  return `${characterId}:${stage.id}`
}

export async function readProductionStageBriefState(input: {
  projectId: string
  userId: string
  characterCode: string
  stage: ProductionStageDefinition
}) {
  const character = await findCharacter(input.projectId, input.characterCode)
  const dna = stringRecord(character.characterDna)
  const brief = parseStoredProductionStageBrief(
    dna[productionStageBriefDnaKey(input.stage.id)],
    input.stage,
  )
  const task = await prisma.task.findFirst({
    where: {
      projectId: input.projectId,
      userId: input.userId,
      type: TASK_TYPE.VISUAL_DEVELOPMENT_STAGE_BRIEF,
      targetType: 'visual-development-stage-brief',
      targetId: taskTargetId(character.id, input.stage),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      progress: true,
      errorCode: true,
      errorMessage: true,
      createdAt: true,
    },
  })
  const worldBible = parseWorldBible(character.workspace.worldBible)
  return {
    brief,
    creativePrompt: dna[productionStageCreativePromptDnaKey(input.stage.id)] ?? '',
    analysisModel: worldBible.scriptAnalysis?.modelKey ?? null,
    task,
  }
}

export async function submitProductionStageBrief(input: {
  projectId: string
  userId: string
  locale: Locale
  characterCode: string
  stage: ProductionStageDefinition
}) {
  const character = await findCharacter(input.projectId, input.characterCode)
  if (!canEnterProductionStage(character.status, input.stage.id)) {
    throw new ApiError('CONFLICT', {
      code: 'UPSTREAM_CANON_LOCK_REQUIRED',
      details: { required: input.stage.prerequisiteStatus },
    })
  }
  const dna = stringRecord(character.characterDna)
  if (dna[productionStageBriefDnaKey(input.stage.id)]) {
    throw new ApiError('CONFLICT', { code: 'STAGE_BRIEF_ALREADY_EXISTS' })
  }
  const worldBible = parseWorldBible(character.workspace.worldBible)
  const analysis = worldBible.scriptAnalysis
  if (!analysis || analysis.status !== 'applied') {
    throw new ApiError('CONFLICT', { code: 'APPLIED_SCRIPT_ANALYSIS_REQUIRED' })
  }
  if (!analysis.characters.some((candidate) => candidate.code === character.code)) {
    throw new ApiError('CONFLICT', {
      code: 'SCRIPT_CHARACTER_NOT_FOUND',
      details: { characterCode: character.code },
    })
  }
  let selection
  try {
    selection = await resolveModelSelection(input.userId, analysis.modelKey, 'llm')
  } catch (error) {
    throw new ApiError('FORBIDDEN', {
      code: 'MODEL_NOT_ENABLED',
      details: { message: error instanceof Error ? error.message : String(error) },
    })
  }
  const targetId = taskTargetId(character.id, input.stage)
  return await submitTask({
    userId: input.userId,
    locale: input.locale,
    projectId: input.projectId,
    type: TASK_TYPE.VISUAL_DEVELOPMENT_STAGE_BRIEF,
    targetType: 'visual-development-stage-brief',
    targetId,
    dedupeKey: `visual-development-stage-brief:v1:${targetId}`,
    dedupeMode: 'active',
    payload: {
      characterId: character.id,
      characterCode: character.code,
      stageId: input.stage.id,
      analysisModel: selection.modelKey,
      model: selection.modelKey,
      maxInputTokens: 12_000,
      maxOutputTokens: 4_000,
    },
  })
}
