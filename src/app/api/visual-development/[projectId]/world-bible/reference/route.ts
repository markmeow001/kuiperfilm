import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { detectSupportedImageType } from '@/lib/playground/image-file-type'
import { generateUniqueKey, getSignedUrl, uploadToCOS } from '@/lib/cos'
import { EMPTY_WORLD_BIBLE, parseWorldBible, toWorldBibleJson } from '@/lib/visual-development/world-bible'

type RouteContext = { params: Promise<{ projectId: string }> }

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024
const MAX_REFERENCES = 12

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

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId)
  if (access instanceof Response) return access
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  if (workspace?.status === 'world_locked') throw new ApiError('CONFLICT', { code: 'WORLD_BIBLE_LOCKED' })
  const document = workspace ? parseWorldBible(workspace.worldBible) : EMPTY_WORLD_BIBLE
  if (document.references.length >= MAX_REFERENCES) {
    throw new ApiError('CONFLICT', { code: 'WORLD_REFERENCE_LIMIT_REACHED', details: { max: MAX_REFERENCES } })
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
  const category = typeof formData.get('category') === 'string' ? String(formData.get('category')).trim() : 'general'
  const note = typeof formData.get('note') === 'string' ? String(formData.get('note')).trim().slice(0, 1000) : ''
  const key = generateUniqueKey(`images/visual-development/world/${projectId}/reference`, detected.extension)
  await uploadToCOS(buffer, key)
  const reference = {
    id: randomUUID(),
    key,
    name: file.name.slice(0, 255) || 'Reference',
    category: category || 'general',
    note,
    createdAt: new Date().toISOString(),
  }
  document.references = [...document.references, reference]
  await prisma.visualDevelopmentWorkspace.upsert({
    where: { projectId },
    create: { projectId, worldBible: toWorldBibleJson(document), status: 'world_draft' },
    update: { worldBible: toWorldBibleJson(document), status: 'world_draft' },
  })
  return NextResponse.json({ success: true, data: { reference: { ...reference, previewUrl: getSignedUrl(key, 3600) } } })
})

export const DELETE = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId)
  if (access instanceof Response) return access
  const body = await request.json() as { referenceId?: unknown }
  const referenceId = typeof body.referenceId === 'string' ? body.referenceId : ''
  if (!referenceId) throw new ApiError('INVALID_PARAMS', { code: 'REFERENCE_ID_REQUIRED' })
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  if (!workspace) throw new ApiError('NOT_FOUND')
  if (workspace.status === 'world_locked') throw new ApiError('CONFLICT', { code: 'WORLD_BIBLE_LOCKED' })
  const document = parseWorldBible(workspace.worldBible)
  const nextReferences = document.references.filter((reference) => reference.id !== referenceId)
  if (nextReferences.length === document.references.length) throw new ApiError('NOT_FOUND')
  document.references = nextReferences
  await prisma.visualDevelopmentWorkspace.update({
    where: { id: workspace.id },
    data: { worldBible: toWorldBibleJson(document) },
  })
  return NextResponse.json({ success: true, data: { referenceId } })
})
