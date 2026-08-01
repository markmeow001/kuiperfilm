import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { detectSupportedImageType } from '@/lib/playground/image-file-type'
import { generateUniqueKey, getSignedUrl, uploadToCOS } from '@/lib/cos'
import {
  RESEARCH_REFERENCE_CATEGORIES,
  RESEARCH_RIGHTS_STATUSES,
  MAX_RESEARCH_REFERENCES,
  type ResearchReferenceCategory,
  type ResearchReferenceUsage,
  type ResearchRightsStatus,
} from '@/lib/visual-development/research'
import { EMPTY_WORLD_BIBLE, parseWorldBible, toWorldBibleJson } from '@/lib/visual-development/world-bible'
import { updateVisualDevelopmentWorkspaceAtRevision } from '@/lib/visual-development/workspace-concurrency'

type RouteContext = { params: Promise<{ projectId: string }> }

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024

async function requireAccess(projectId: string) {
  const auth = await requireUserAuth()
  if (isErrorResponse(auth)) return auth
  const access = await requireProjectAccess(projectId, auth.session.user.id, 'write')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND') throw new ApiError('NOT_FOUND')
    throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
  }
  return { userId: auth.session.user.id }
}

function formText(formData: FormData, field: string, max: number): string {
  const value = formData.get(field)
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized.length > max) {
    throw new ApiError('INVALID_PARAMS', { code: 'FIELD_TOO_LONG', field, details: { max } })
  }
  return normalized
}

function category(value: string): ResearchReferenceCategory {
  if (!RESEARCH_REFERENCE_CATEGORIES.includes(value as ResearchReferenceCategory)) {
    throw new ApiError('INVALID_PARAMS', { code: 'RESEARCH_CATEGORY_INVALID', field: 'category' })
  }
  return value as ResearchReferenceCategory
}

function rightsStatus(value: string): ResearchRightsStatus {
  if (!RESEARCH_RIGHTS_STATUSES.includes(value as ResearchRightsStatus)) {
    throw new ApiError('INVALID_PARAMS', { code: 'RESEARCH_RIGHTS_STATUS_INVALID', field: 'rightsStatus' })
  }
  return value as ResearchRightsStatus
}

function formBoolean(formData: FormData, field: string): boolean {
  return formData.get(field) === 'true'
}

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId)
  if (access instanceof Response) return access
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  const world = workspace ? parseWorldBible(workspace.worldBible) : parseWorldBible(EMPTY_WORLD_BIBLE)
  if (world.research.status === 'locked') throw new ApiError('CONFLICT', { code: 'RESEARCH_CANON_LOCKED' })
  if (workspace?.status === 'world_locked') throw new ApiError('CONFLICT', { code: 'WORLD_CANON_ALREADY_LOCKED' })
  if (world.research.references.length >= MAX_RESEARCH_REFERENCES) {
    throw new ApiError('CONFLICT', { code: 'RESEARCH_REFERENCE_LIMIT_REACHED', details: { max: MAX_RESEARCH_REFERENCES } })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    throw new ApiError('INVALID_PARAMS', { code: 'FORMDATA_PARSE_FAILED' })
  }
  const file = formData.get('file')
  if (!(file instanceof File)) throw new ApiError('INVALID_PARAMS', { code: 'FILE_FIELD_MISSING' })
  if (file.size > MAX_REFERENCE_BYTES) {
    throw new ApiError('INVALID_PARAMS', { code: 'FILE_TOO_LARGE', details: { max: MAX_REFERENCE_BYTES } })
  }
  const buffer = Buffer.from(await file.arrayBuffer())
  const detected = detectSupportedImageType(buffer)
  if (!detected) throw new ApiError('INVALID_PARAMS', { code: 'IMAGE_CONTENT_INVALID' })

  const referenceCategory = category(formText(formData, 'category', 80))
  const rawUsage = formText(formData, 'usage', 20)
  if (rawUsage !== 'use' && rawUsage !== 'avoid') {
    throw new ApiError('INVALID_PARAMS', { code: 'RESEARCH_USAGE_INVALID', field: 'usage' })
  }
  const usageValue: ResearchReferenceUsage = rawUsage
  const referenceRightsStatus = rightsStatus(formText(formData, 'rightsStatus', 40))
  const externalProcessingAllowed = formBoolean(formData, 'externalProcessingAllowed')
  const downstreamEnabled = formBoolean(formData, 'downstreamEnabled')
  if (externalProcessingAllowed && referenceRightsStatus !== 'owned' && referenceRightsStatus !== 'licensed' && referenceRightsStatus !== 'public-domain') {
    throw new ApiError('INVALID_PARAMS', { code: 'RESEARCH_EXTERNAL_PROCESSING_RIGHTS_BLOCKED', field: 'rightsStatus' })
  }
  if (downstreamEnabled && (!externalProcessingAllowed || usageValue !== 'use')) {
    throw new ApiError('INVALID_PARAMS', { code: 'RESEARCH_DOWNSTREAM_REFERENCE_INVALID', field: 'downstreamEnabled' })
  }
  const key = generateUniqueKey(`images/visual-development/research/${projectId}/reference`, detected.extension)
  await uploadToCOS(buffer, key)
  const reference = {
    id: randomUUID(),
    key,
    name: file.name.slice(0, 255) || 'Research reference',
    category: referenceCategory,
    usage: usageValue,
    note: formText(formData, 'note', 2_000),
    sourceUrl: formText(formData, 'sourceUrl', 2_000),
    creator: formText(formData, 'creator', 500),
    license: formText(formData, 'license', 500),
    rightsStatus: referenceRightsStatus,
    externalProcessingAllowed,
    downstreamEnabled,
    reviewStatus: 'pending' as const,
    rejectionNote: null,
    createdAt: new Date().toISOString(),
  }
  world.research.references = [...world.research.references, reference]
  if (workspace) {
    await updateVisualDevelopmentWorkspaceAtRevision(workspace, { worldBible: toWorldBibleJson(world) })
  } else {
    await prisma.visualDevelopmentWorkspace.create({
      data: { projectId, worldBible: toWorldBibleJson(world), status: 'draft' },
    })
  }
  return NextResponse.json({
    success: true,
    data: { reference: { ...reference, previewUrl: getSignedUrl(key, 3600) } },
  })
})

export const DELETE = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId)
  if (access instanceof Response) return access
  const body = await request.json() as { referenceId?: unknown }
  const referenceId = typeof body.referenceId === 'string' ? body.referenceId.trim() : ''
  if (!referenceId) throw new ApiError('INVALID_PARAMS', { code: 'REFERENCE_ID_REQUIRED' })
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  if (!workspace) throw new ApiError('NOT_FOUND')
  const world = parseWorldBible(workspace.worldBible)
  if (world.research.status === 'locked') throw new ApiError('CONFLICT', { code: 'RESEARCH_CANON_LOCKED' })
  if (workspace.status === 'world_locked') throw new ApiError('CONFLICT', { code: 'WORLD_CANON_ALREADY_LOCKED' })
  const nextReferences = world.research.references.filter((reference) => reference.id !== referenceId)
  if (nextReferences.length === world.research.references.length) {
    throw new ApiError('NOT_FOUND', { code: 'RESEARCH_REFERENCE_NOT_FOUND' })
  }
  world.research.references = nextReferences
  await updateVisualDevelopmentWorkspaceAtRevision(workspace, { worldBible: toWorldBibleJson(world) })
  return NextResponse.json({ success: true, data: { referenceId } })
})
