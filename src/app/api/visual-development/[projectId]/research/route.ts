import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { getSignedUrl } from '@/lib/cos'
import {
  RESEARCH_EDITABLE_FIELDS,
  evaluateResearchGate,
  type ResearchDocument,
} from '@/lib/visual-development/research'
import {
  EMPTY_WORLD_BIBLE,
  parseWorldBible,
  toWorldBibleJson,
  type WorldBibleDocument,
} from '@/lib/visual-development/world-bible'
import { updateVisualDevelopmentWorkspaceAtRevision } from '@/lib/visual-development/workspace-concurrency'

type RouteContext = { params: Promise<{ projectId: string }> }
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function requiredString(value: unknown, field: string, max = 4000): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ApiError('INVALID_PARAMS', { code: 'FIELD_REQUIRED', field })
  if (normalized.length > max) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max } })
  }
  return normalized
}

function mergeResearch(current: ResearchDocument, value: unknown): ResearchDocument {
  const input = record(value)
  const next = { ...current }
  for (const field of RESEARCH_EDITABLE_FIELDS) {
    if (typeof input[field] !== 'string') continue
    if (input[field].length > 8_000) {
      throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max: 8_000 } })
    }
    next[field] = input[field].trim()
  }
  return next
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

function assertResearchMutable(document: WorldBibleDocument, workspaceStatus: string | undefined) {
  if (document.research.status === 'locked') {
    throw new ApiError('CONFLICT', { code: 'RESEARCH_CANON_LOCKED' })
  }
  if (workspaceStatus === 'world_locked') {
    throw new ApiError('CONFLICT', { code: 'WORLD_CANON_ALREADY_LOCKED' })
  }
}

export const GET = apiHandler(async (_request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'read')
  if (access instanceof Response) return access
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  const world = workspace ? parseWorldBible(workspace.worldBible) : EMPTY_WORLD_BIBLE
  return NextResponse.json({
    success: true,
    data: {
      research: {
        ...world.research,
        references: world.research.references.map((reference) => ({
          ...reference,
          previewUrl: getSignedUrl(reference.key, 3600),
        })),
        gate: evaluateResearchGate(world.research),
      },
      worldStatus: workspace?.status ?? 'draft',
    },
  })
})

export const PUT = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = record(await request.json())
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  const world = workspace ? parseWorldBible(workspace.worldBible) : parseWorldBible(EMPTY_WORLD_BIBLE)
  assertResearchMutable(world, workspace?.status)
  world.research = mergeResearch(world.research, body.research)
  if (workspace) {
    await updateVisualDevelopmentWorkspaceAtRevision(workspace, { worldBible: toWorldBibleJson(world) })
  } else {
    await prisma.visualDevelopmentWorkspace.create({
      data: { projectId, worldBible: toWorldBibleJson(world), status: 'draft' },
    })
  }
  return NextResponse.json({
    success: true,
    data: {
      research: {
        status: world.research.status,
        version: world.research.version,
        gate: evaluateResearchGate(world.research),
      },
    },
  })
})

export const PATCH = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId, 'write')
  if (access instanceof Response) return access
  const body = record(await request.json())
  const action = requiredString(body.action, 'action', 40)
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  if (!workspace) throw new ApiError('NOT_FOUND')
  const world = parseWorldBible(workspace.worldBible)
  assertResearchMutable(world, workspace.status)

  if (action === 'reference-review') {
    const referenceId = requiredString(body.referenceId, 'referenceId', 100)
    const reference = world.research.references.find((item) => item.id === referenceId)
    if (!reference) throw new ApiError('NOT_FOUND', { code: 'RESEARCH_REFERENCE_NOT_FOUND' })
    const approved = body.approved === true
    reference.reviewStatus = approved ? 'approved' : 'rejected'
    reference.rejectionNote = approved ? null : requiredString(body.rejectionNote, 'rejectionNote', 2_000)
    await updateVisualDevelopmentWorkspaceAtRevision(workspace, { worldBible: toWorldBibleJson(world) })
    return NextResponse.json({
      success: true,
      data: { referenceId, reviewStatus: reference.reviewStatus, gate: evaluateResearchGate(world.research) },
    })
  }

  if (action === 'reference-processing') {
    const referenceId = requiredString(body.referenceId, 'referenceId', 100)
    const reference = world.research.references.find((item) => item.id === referenceId)
    if (!reference) throw new ApiError('NOT_FOUND', { code: 'RESEARCH_REFERENCE_NOT_FOUND' })
    const externalProcessingAllowed = body.externalProcessingAllowed === true
    const downstreamEnabled = body.downstreamEnabled === true
    if (
      externalProcessingAllowed
      && reference.rightsStatus !== 'owned'
      && reference.rightsStatus !== 'licensed'
      && reference.rightsStatus !== 'public-domain'
    ) {
      throw new ApiError('INVALID_PARAMS', { code: 'RESEARCH_EXTERNAL_PROCESSING_RIGHTS_BLOCKED', field: 'rightsStatus' })
    }
    if (downstreamEnabled && (!externalProcessingAllowed || reference.usage !== 'use')) {
      throw new ApiError('INVALID_PARAMS', { code: 'RESEARCH_DOWNSTREAM_REFERENCE_INVALID', field: 'downstreamEnabled' })
    }
    reference.externalProcessingAllowed = externalProcessingAllowed
    reference.downstreamEnabled = downstreamEnabled
    await updateVisualDevelopmentWorkspaceAtRevision(workspace, { worldBible: toWorldBibleJson(world) })
    return NextResponse.json({
      success: true,
      data: {
        referenceId,
        externalProcessingAllowed,
        downstreamEnabled,
        gate: evaluateResearchGate(world.research),
      },
    })
  }

  if (action !== 'canon-lock') {
    throw new ApiError('INVALID_PARAMS', { code: 'RESEARCH_ACTION_INVALID' })
  }
  const gate = evaluateResearchGate(world.research)
  if (!gate.ready) {
    throw new ApiError('CONFLICT', { code: 'RESEARCH_GATE_INCOMPLETE', details: gate })
  }
  world.research.status = 'locked'
  world.research.lockedAt = new Date().toISOString()
  world.research.canonId = `RESEARCH-${projectId.slice(0, 8).toUpperCase()}-v${String(world.research.version).padStart(3, '0')}`
  await updateVisualDevelopmentWorkspaceAtRevision(workspace, { worldBible: toWorldBibleJson(world) })
  return NextResponse.json({
    success: true,
    data: {
      status: world.research.status,
      canonId: world.research.canonId,
      lockedAt: world.research.lockedAt,
    },
  })
})
