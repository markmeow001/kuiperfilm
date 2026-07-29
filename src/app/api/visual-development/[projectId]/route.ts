import { randomInt } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { resolveModelSelection } from '@/lib/api-config'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildCastingPrompt, type StringRecord } from '@/lib/visual-development/prompt'
import { projectCandidateTask } from '@/lib/visual-development/records'
import { parseWorldBible } from '@/lib/visual-development/world-bible'

type RouteContext = { params: Promise<{ projectId: string }> }
type JsonRecord = Record<string, unknown>

function toRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function toStringRecord(value: unknown): StringRecord {
  return Object.fromEntries(
    Object.entries(toRecord(value))
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, text]) => [key, text.trim()]),
  )
}

function requiredString(value: unknown, field: string, max = 4000): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field })
  if (normalized.length > max) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max } })
  }
  return normalized
}

function normalizeCharacterCode(value: unknown): string {
  const code = requiredString(value, 'characterCode', 64).toUpperCase().replace(/[^A-Z0-9_-]/g, '-')
  if (!code) throw new ApiError('INVALID_PARAMS', { code: 'CHARACTER_CODE_INVALID' })
  return code
}

function assertAdultCastingBrief(castingBrief: StringRecord) {
  const ages = (castingBrief.apparentAge || '').match(/\d+/g)?.map(Number) ?? []
  if (ages.length === 0 || Math.min(...ages) < 21) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'CASTING_ADULT_AGE_REQUIRED',
      field: 'castingBrief.apparentAge',
      details: { message: 'Casting 候選必須明確設定為 21 歲以上的虛構成年人。' },
    })
  }
}

async function requireAccess(projectId: string, action: 'read' | 'write') {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const access = await requireProjectAccess(projectId, auth.session.user.id, action)
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND') throw new ApiError('NOT_FOUND')
    throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
  }
  return { userId: auth.session.user.id }
}

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'read')
  if (access instanceof Response) return access

  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({
    where: { projectId },
    include: {
      characters: {
        orderBy: { createdAt: 'asc' },
        include: {
          castingBatches: {
            orderBy: { createdAt: 'desc' },
            take: 30,
            include: { candidates: { orderBy: { code: 'asc' } } },
          },
        },
      },
    },
  })
  if (!workspace) return NextResponse.json({ success: true, data: { workspace: null } })

  const taskIds = workspace.characters.flatMap((character) =>
    character.castingBatches.flatMap((batch) =>
      batch.candidates.flatMap((candidate) => candidate.taskId ? [candidate.taskId] : []),
    ),
  )
  const tasks = taskIds.length > 0
    ? await prisma.task.findMany({
      where: { id: { in: taskIds }, userId: access.userId, projectId },
      select: {
        id: true,
        status: true,
        progress: true,
        result: true,
        errorCode: true,
        errorMessage: true,
      },
    })
    : []
  const tasksById = new Map(tasks.map((task) => [task.id, task]))

  return NextResponse.json({
    success: true,
    data: {
      workspace: {
        ...workspace,
        characters: workspace.characters.map((character) => ({
          ...character,
          castingBatches: character.castingBatches.map((batch) => ({
            ...batch,
            candidates: batch.candidates.map((candidate) => ({
              ...candidate,
              ...projectCandidateTask(candidate, tasksById),
            })),
          })),
        })),
      },
    },
  })
})

export const PUT = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = toRecord(await request.json())
  const worldBible = toStringRecord(body.worldBible)
  const characterDna = toStringRecord(body.characterDna)
  const castingBrief = toStringRecord(body.castingBrief)
  const characterCode = normalizeCharacterCode(body.characterCode)
  const characterName = requiredString(body.characterName, 'characterName', 120)

  const workspace = await prisma.visualDevelopmentWorkspace.upsert({
    where: { projectId },
    create: { projectId, worldBible },
    update: { worldBible, worldVersion: { increment: 1 } },
  })
  const character = await prisma.visualDevelopmentCharacter.upsert({
    where: { workspaceId_code: { workspaceId: workspace.id, code: characterCode } },
    create: { workspaceId: workspace.id, code: characterCode, name: characterName, characterDna, castingBrief },
    update: { name: characterName, characterDna, castingBrief },
  })
  return NextResponse.json({ success: true, data: { workspace, character } })
})

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = toRecord(await request.json())
  const locale = resolveRequiredTaskLocale(request, body)
  const lockedWorkspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  if (!lockedWorkspace || lockedWorkspace.status !== 'world_locked') {
    throw new ApiError('CONFLICT', { code: 'WORLD_CANON_REQUIRED' })
  }
  const worldDocument = parseWorldBible(lockedWorkspace.worldBible)
  const worldBible: StringRecord = {
    projectPremise: worldDocument.projectPremise,
    visualThesis: worldDocument.visualThesis,
    eraAndGeography: worldDocument.eraAndGeography,
    societyAndFactions: worldDocument.societyAndFactions,
    technologyRules: worldDocument.technologyRules,
    colorScript: worldDocument.colorScript,
    materialRules: worldDocument.materialRules,
    architectureLanguage: worldDocument.architectureLanguage,
    cameraFormat: worldDocument.cameraFormat,
    forbiddenElements: worldDocument.forbiddenElements,
  }
  const characterDna = toStringRecord(body.characterDna)
  const castingBrief = toStringRecord(body.castingBrief)
  const characterCode = normalizeCharacterCode(body.characterCode)
  const characterName = requiredString(body.characterName, 'characterName', 120)
  const modelKey = requiredString(body.modelKey, 'modelKey', 255)
  const candidateCount = Number(body.candidateCount)
  if (![4, 8, 10].includes(candidateCount)) {
    throw new ApiError('INVALID_PARAMS', { code: 'CASTING_BATCH_SIZE_INVALID' })
  }
  assertAdultCastingBrief(castingBrief)
  requiredString(worldBible.projectPremise, 'worldBible.projectPremise')
  requiredString(worldBible.visualThesis, 'worldBible.visualThesis')
  requiredString(characterDna.role, 'characterDna.role')
  requiredString(characterDna.coreTraits, 'characterDna.coreTraits')
  requiredString(castingBrief.emotionalRead, 'castingBrief.emotionalRead')

  let selection
  try {
    selection = await resolveModelSelection(access.userId, modelKey, 'image')
  } catch (error) {
    throw new ApiError('FORBIDDEN', {
      code: 'MODEL_NOT_ENABLED',
      details: { message: error instanceof Error ? error.message : String(error) },
    })
  }
  const capabilities = findBuiltinCapabilities('image', selection.provider, selection.modelId)?.image
  const seedSupported = capabilities?.supportSeed === true
  const aspectRatio = typeof body.aspectRatio === 'string' && body.aspectRatio.trim()
    ? body.aspectRatio.trim()
    : '4:5'
  if (capabilities?.aspectRatioOptions && !capabilities.aspectRatioOptions.includes(aspectRatio)) {
    throw new ApiError('INVALID_PARAMS', { code: 'ASPECT_RATIO_UNSUPPORTED', field: 'aspectRatio' })
  }
  const resolution = typeof body.resolution === 'string' && body.resolution.trim()
    ? body.resolution.trim()
    : null
  if (resolution && capabilities?.resolutionOptions && !capabilities.resolutionOptions.includes(resolution)) {
    throw new ApiError('INVALID_PARAMS', { code: 'RESOLUTION_UNSUPPORTED', field: 'resolution' })
  }

  const character = await prisma.visualDevelopmentCharacter.upsert({
    where: { workspaceId_code: { workspaceId: lockedWorkspace.id, code: characterCode } },
    create: { workspaceId: lockedWorkspace.id, code: characterCode, name: characterName, characterDna, castingBrief },
    update: { name: characterName, characterDna, castingBrief },
  })
  const basePrompt = buildCastingPrompt({
    worldBible,
    characterDna,
    castingBrief,
    candidateCode: `${characterCode}-CANDIDATE`,
  })
  const batch = await prisma.visualDevelopmentBatch.create({
    data: {
      characterId: character.id,
      candidateCount,
      provider: selection.provider,
      modelKey: selection.modelKey,
      modelId: selection.modelId,
      seedSupported,
      prompt: basePrompt.prompt,
      negativePrompt: basePrompt.negativePrompt,
      promptStack: basePrompt.promptStack,
      worldBibleSnapshot: worldBible,
      characterDnaSnapshot: characterDna,
      castingBriefSnapshot: castingBrief,
      aspectRatio,
      resolution,
      candidates: {
        create: Array.from({ length: candidateCount }, (_, index) => {
          const code = `C-${String(index + 1).padStart(2, '0')}`
          const requestedSeed = seedSupported ? randomInt(1, 2_147_483_647) : null
          const prompt = buildCastingPrompt({ worldBible, characterDna, castingBrief, candidateCode: code })
          return {
            code,
            requestedSeed,
            effectiveSeed: requestedSeed,
            seedStatus: seedSupported ? 'applied' : 'unsupported',
            prompt: prompt.prompt,
            negativePrompt: prompt.negativePrompt,
            modelKey: selection.modelKey,
            provider: selection.provider,
            modelId: selection.modelId,
            aspectRatio,
            resolution,
          }
        }),
      },
    },
    include: { candidates: { orderBy: { code: 'asc' } } },
  })

  const submissions = await Promise.allSettled(batch.candidates.map(async (candidate) => {
    const submitted = await submitTask({
      userId: access.userId,
      locale,
      projectId,
      type: TASK_TYPE.VISUAL_DEVELOPMENT_IMAGE,
      targetType: 'visual-development-candidate',
      targetId: candidate.id,
      dedupeKey: `visual-development:${candidate.id}`,
      dedupeMode: 'idempotent',
      skipRateLimit: true,
      payload: {
        prompt: candidate.prompt,
        modelKey: selection.modelKey,
        modelId: selection.modelId,
        aspectRatio,
        ...(resolution ? { resolution } : {}),
        ...(capabilities?.supportNegativePrompt === true ? { negativePrompt: candidate.negativePrompt } : {}),
        ...(seedSupported && candidate.requestedSeed !== null ? { seed: candidate.requestedSeed } : {}),
        generationCount: 1,
        meta: {
          originPrompt: candidate.prompt,
          originModelKey: selection.modelKey,
          visualDevelopmentBatchId: batch.id,
          visualDevelopmentCandidateId: candidate.id,
          seedStatus: candidate.seedStatus,
        },
      },
    })
    await prisma.visualDevelopmentCandidate.update({
      where: { id: candidate.id },
      data: { taskId: submitted.taskId, status: submitted.status },
    })
    return submitted.taskId
  }))

  const failed = submissions.filter((result) => result.status === 'rejected').length
  if (failed > 0) {
    const failedCandidateIds = batch.candidates
      .filter((_, index) => submissions[index]?.status === 'rejected')
      .map((candidate) => candidate.id)
    await prisma.visualDevelopmentCandidate.updateMany({
      where: { id: { in: failedCandidateIds } },
      data: { status: 'submission_failed' },
    })
  }
  await prisma.visualDevelopmentBatch.update({
    where: { id: batch.id },
    data: { status: failed === 0 ? 'queued' : failed === candidateCount ? 'failed' : 'partial_failed' },
  })

  return NextResponse.json({
    success: failed === 0,
    data: { batchId: batch.id, submitted: candidateCount - failed, failed, seedSupported },
  }, { status: failed === 0 ? 202 : 207 })
})

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = toRecord(await request.json())
  const candidateId = requiredString(body.candidateId, 'candidateId', 191)
  const action = requiredString(body.action, 'action', 32)
  const candidate = await prisma.visualDevelopmentCandidate.findUnique({
    where: { id: candidateId },
    include: { batch: { include: { character: { include: { workspace: true } } } } },
  })
  if (!candidate || candidate.batch.character.workspace.projectId !== projectId) {
    throw new ApiError('NOT_FOUND')
  }

  if (action === 'shortlist') {
    const updated = await prisma.visualDevelopmentCandidate.update({
      where: { id: candidateId },
      data: { shortlisted: body.shortlisted !== false },
    })
    return NextResponse.json({ success: true, data: { candidate: updated } })
  }
  if (action !== 'canon-lock') {
    throw new ApiError('INVALID_PARAMS', { code: 'CANDIDATE_ACTION_INVALID' })
  }
  if (!candidate.taskId) throw new ApiError('CONFLICT', { code: 'CANDIDATE_NOT_GENERATED' })
  const task = await prisma.task.findFirst({
    where: { id: candidate.taskId, userId: access.userId, projectId, status: 'completed' },
    select: { id: true },
  })
  if (!task) throw new ApiError('CONFLICT', { code: 'CANDIDATE_NOT_COMPLETED' })

  await prisma.$transaction([
    prisma.visualDevelopmentCandidate.updateMany({
      where: { batch: { characterId: candidate.batch.characterId } },
      data: { isCanon: false },
    }),
    prisma.visualDevelopmentCandidate.update({
      where: { id: candidate.id },
      data: { isCanon: true, shortlisted: true },
    }),
    prisma.visualDevelopmentCharacter.update({
      where: { id: candidate.batch.characterId },
      data: { canonCandidateId: candidate.id, canonLockedAt: new Date(), status: 'identity_locked' },
    }),
  ])
  return NextResponse.json({ success: true, data: { candidateId: candidate.id } })
})
