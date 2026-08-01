import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { resolveModelSelection } from '@/lib/api-config'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import {
  SCRIPT_ANALYSIS_MIN_CHARS,
  SCRIPT_ANALYSIS_PIPELINE_VERSION,
  type ScriptSourceFormat,
} from '@/lib/visual-development/script-analysis'
import { parseWorldBible, toWorldBibleJson } from '@/lib/visual-development/world-bible'
import { getSignedUrl } from '@/lib/cos'

type RouteContext = { params: Promise<{ projectId: string }> }
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function requiredString(value: unknown, field: string, max: number): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field })
  if (normalized.length > max) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max } })
  return normalized
}

function parseSourceFormat(value: unknown): ScriptSourceFormat {
  if (value === 'pasted' || value === 'docx' || value === 'txt' || value === 'md') return value
  throw new ApiError('INVALID_PARAMS', { code: 'SCRIPT_SOURCE_FORMAT_INVALID', field: 'sourceFormat' })
}

function parseCharacterCodes(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ApiError('INVALID_PARAMS', { code: 'CHARACTER_CODES_REQUIRED' })
  return [...new Set(value.map((item) => typeof item === 'string' ? item.trim().toUpperCase() : '').filter(Boolean))]
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
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  const document = workspace ? parseWorldBible(workspace.worldBible) : null
  const activeSource = document?.sources[document.sources.length - 1] ?? null
  const recentTasks = activeSource
    ? await prisma.task.findMany({
      where: { projectId, userId: access.userId, type: TASK_TYPE.VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, status: true, progress: true, errorCode: true, errorMessage: true, createdAt: true, payload: true },
    })
    : []
  const activeTask = recentTasks.find((candidate) => record(candidate.payload).sourceId === activeSource?.id) ?? null
  const task = activeTask
    ? {
      id: activeTask.id,
      status: activeTask.status,
      progress: activeTask.progress,
      errorCode: activeTask.errorCode,
      errorMessage: activeTask.errorMessage,
      createdAt: activeTask.createdAt,
    }
    : null
  const analysis = document && document.scriptAnalysis?.sourceId === activeSource?.id
    ? document.scriptAnalysis
    : null
  const sources = document?.sources.map((source, index) => ({
    ...source,
    version: index + 1,
    downloadUrl: getSignedUrl(source.originalKey ?? source.key, 3600),
  })) ?? []
  return NextResponse.json({ success: true, data: { analysis, sources, task } })
})

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = record(await request.json())
  const locale = resolveRequiredTaskLocale(request, body)
  const sourceId = requiredString(body.sourceId, 'sourceId', 120)
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  if (!workspace) throw new ApiError('NOT_FOUND')
  const source = parseWorldBible(workspace.worldBible).sources.find((item) => item.id === sourceId)
  if (!source) throw new ApiError('NOT_FOUND', { code: 'SCRIPT_SOURCE_NOT_FOUND' })
  if (source.textLength < SCRIPT_ANALYSIS_MIN_CHARS) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SCRIPT_TOO_SHORT',
      field: 'sourceId',
      details: { min: SCRIPT_ANALYSIS_MIN_CHARS },
    })
  }
  const sourceTitle = requiredString(body.sourceTitle, 'sourceTitle', 240)
  const sourceFormat = parseSourceFormat(body.sourceFormat)
  if (source.sourceFormat !== sourceFormat || source.sourceTitle !== sourceTitle) {
    throw new ApiError('CONFLICT', { code: 'SCRIPT_SOURCE_METADATA_MISMATCH' })
  }
  const modelKey = requiredString(body.modelKey, 'modelKey', 255)
  let selection
  try {
    selection = await resolveModelSelection(access.userId, modelKey, 'llm')
  } catch (error) {
    throw new ApiError('FORBIDDEN', {
      code: 'MODEL_NOT_ENABLED',
      details: { message: error instanceof Error ? error.message : String(error) },
    })
  }

  const fingerprint = createHash('sha256')
    .update(`${SCRIPT_ANALYSIS_PIPELINE_VERSION}\u0000${selection.modelKey}\u0000${source.sha256}`)
    .digest('hex')
    .slice(0, 24)
  const submitted = await submitTask({
    userId: access.userId,
    locale,
    projectId,
    type: TASK_TYPE.VISUAL_DEVELOPMENT_SCRIPT_ANALYSIS,
    targetType: 'VisualDevelopmentWorkspace',
    targetId: projectId,
    dedupeKey: `visual-development-script:v${SCRIPT_ANALYSIS_PIPELINE_VERSION}:${projectId}:${fingerprint}`,
    dedupeMode: 'active',
    payload: {
      sourceId,
      sourceKey: source.key,
      sourceSha256: source.sha256,
      sourceTitle,
      sourceFormat,
      analysisModel: selection.modelKey,
      model: selection.modelKey,
      maxInputTokens: Math.min(160_000, Math.ceil(source.textLength / 2) + 1_000),
      maxOutputTokens: 10_000,
    },
  })
  return NextResponse.json({ success: true, data: submitted }, { status: 202 })
})

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = record(await request.json())
  if (body.action !== 'apply-analysis') {
    throw new ApiError('INVALID_PARAMS', { code: 'SCRIPT_ANALYSIS_ACTION_INVALID' })
  }
  const applyWorldBible = body.applyWorldBible === true
  const characterCodes = parseCharacterCodes(body.characterCodes)
  if (!applyWorldBible && characterCodes.length === 0) {
    throw new ApiError('INVALID_PARAMS', { code: 'SCRIPT_ANALYSIS_NOTHING_SELECTED' })
  }
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({
    where: { projectId },
    include: { characters: { include: { _count: { select: { castingBatches: true } } } } },
  })
  if (!workspace) throw new ApiError('NOT_FOUND')
  const worldBible = parseWorldBible(workspace.worldBible)
  const analysis = worldBible.scriptAnalysis
  if (!analysis) throw new ApiError('NOT_FOUND', { code: 'SCRIPT_ANALYSIS_NOT_FOUND' })
  if (applyWorldBible && workspace.status === 'world_locked') {
    throw new ApiError('CONFLICT', { code: 'WORLD_CANON_ALREADY_LOCKED' })
  }
  if (applyWorldBible && worldBible.research.status === 'locked') {
    throw new ApiError('CONFLICT', {
      code: 'RESEARCH_CANON_ALREADY_LOCKED',
      details: { message: 'Create a new project version before applying a different screenplay to World Bible.' },
    })
  }
  const byCode = new Map(analysis.characters.map((character) => [character.code, character]))
  const selected = characterCodes.map((code) => {
    const character = byCode.get(code)
    if (!character) throw new ApiError('INVALID_PARAMS', { code: 'SCRIPT_CHARACTER_NOT_FOUND', details: { characterCode: code } })
    return character
  })
  const existingByCode = new Map(workspace.characters.map((character) => [character.code, character]))
  const protectedCharacter = selected.find((character) => {
    const existing = existingByCode.get(character.code)
    return existing && (existing.status !== 'draft' || existing._count.castingBatches > 0)
  })
  if (protectedCharacter) {
    throw new ApiError('CONFLICT', {
      code: 'CHARACTER_CANON_ALREADY_STARTED',
      details: { characterCode: protectedCharacter.code },
    })
  }

  const importedAt = new Date().toISOString()
  if (applyWorldBible) {
    Object.assign(worldBible, analysis.worldBible)
    worldBible.assets = []
    worldBible.canonId = null
    worldBible.lockedAt = null
  }
  worldBible.scriptAnalysis = {
    ...analysis,
    status: 'applied',
    importedAt,
    importedCharacterCodes: selected.map((character) => character.code),
  }
  await prisma.$transaction(async (tx) => {
    await tx.visualDevelopmentWorkspace.update({
      where: { id: workspace.id },
      data: {
        worldBible: toWorldBibleJson(worldBible),
        ...(applyWorldBible ? { status: 'world_draft', worldVersion: { increment: 1 } } : {}),
      },
    })
    for (const character of selected) {
      const existing = existingByCode.get(character.code)
      const existingDna = record(existing?.characterDna)
      const existingBrief = record(existing?.castingBrief)
      await tx.visualDevelopmentCharacter.upsert({
        where: { workspaceId_code: { workspaceId: workspace.id, code: character.code } },
        create: {
          workspaceId: workspace.id,
          code: character.code,
          name: character.name,
          characterDna: {
            role: character.role,
            narrativeFunction: character.narrativeFunction,
            coreTraits: character.coreTraits,
            goal: character.goal,
            fear: character.fear,
            secret: character.secret,
            arc: character.arc,
            relationships: character.relationships,
            physicalNotes: character.physicalNotes,
            entityType: character.entityType,
            firstAppearance: character.firstAppearance,
            aliases: character.aliases,
          },
          castingBrief: { apparentAge: character.apparentAge, ...character.castingBrief, performerAge: '21+' },
        },
        update: {
          name: character.name,
          characterDna: {
            ...existingDna,
            role: character.role,
            narrativeFunction: character.narrativeFunction,
            coreTraits: character.coreTraits,
            goal: character.goal,
            fear: character.fear,
            secret: character.secret,
            arc: character.arc,
            relationships: character.relationships,
            physicalNotes: character.physicalNotes,
            entityType: character.entityType,
            firstAppearance: character.firstAppearance,
            aliases: character.aliases,
          },
          castingBrief: {
            ...existingBrief,
            apparentAge: character.apparentAge,
            ...character.castingBrief,
            performerAge: typeof existingBrief.performerAge === 'string' && existingBrief.performerAge.trim()
              ? existingBrief.performerAge
              : '21+',
          },
        },
      })
    }
  })
  return NextResponse.json({
    success: true,
    data: {
      analysisId: analysis.id,
      worldBibleApplied: applyWorldBible,
      importedCharacterCodes: selected.map((character) => character.code),
    },
  })
})
