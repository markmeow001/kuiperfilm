import { createHash, randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, apiHandler } from '@/lib/api-errors'
import { isErrorResponse, requireProjectAccess, requireUserAuth } from '@/lib/api-auth'
import { generateUniqueKey, getSignedUrl, uploadToCOS } from '@/lib/cos'
import {
  EMPTY_WORLD_BIBLE,
  parseWorldBible,
  toWorldBibleJson,
  type ScreenplaySourceVersion,
} from '@/lib/visual-development/world-bible'
import { SCRIPT_ANALYSIS_MAX_CHARS, type ScriptSourceFormat } from '@/lib/visual-development/script-analysis'

type RouteContext = { params: Promise<{ projectId: string }> }

const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const MAX_SOURCE_VERSIONS = 50

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

function sourceExtension(name: string): { format: Exclude<ScriptSourceFormat, 'pasted'>; extension: string; mimeType: string } | null {
  const extension = name.toLowerCase().split('.').pop()
  if (extension === 'docx') return { format: 'docx', extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
  if (extension === 'txt') return { format: 'txt', extension: 'txt', mimeType: 'text/plain; charset=utf-8' }
  if (extension === 'md' || extension === 'markdown') return { format: 'md', extension: 'md', mimeType: 'text/markdown; charset=utf-8' }
  return null
}

function validateBuffer(buffer: Buffer, format: ScriptSourceFormat) {
  if (format === 'docx') {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      throw new ApiError('INVALID_PARAMS', { code: 'DOCX_CONTENT_INVALID' })
    }
    return
  }
  if (buffer.includes(0)) throw new ApiError('INVALID_PARAMS', { code: 'TEXT_CONTENT_INVALID' })
}

function title(value: unknown, fallback: string): string {
  const result = typeof value === 'string' ? value.trim() : ''
  return (result || fallback).slice(0, 240)
}

export const POST = apiHandler(async (request: NextRequest, context: RouteContext) => {
  const { projectId } = await context.params
  const access = await requireAccess(projectId)
  if (access instanceof Response) return access
  const workspace = await prisma.visualDevelopmentWorkspace.findUnique({ where: { projectId } })
  const document = workspace ? parseWorldBible(workspace.worldBible) : { ...EMPTY_WORLD_BIBLE }
  if (document.sources.length >= MAX_SOURCE_VERSIONS) {
    throw new ApiError('CONFLICT', { code: 'SCRIPT_SOURCE_LIMIT_REACHED', details: { max: MAX_SOURCE_VERSIONS } })
  }

  const contentType = request.headers.get('content-type') ?? ''
  let buffer: Buffer
  let normalizedText: string
  let name: string
  let sourceTitle: string
  let sourceFormat: ScriptSourceFormat
  let mimeType: string
  let extension: string

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) throw new ApiError('INVALID_PARAMS', { code: 'FILE_FIELD_MISSING' })
    if (file.size === 0 || file.size > MAX_SOURCE_BYTES) {
      throw new ApiError('INVALID_PARAMS', { code: 'FILE_SIZE_INVALID', details: { max: MAX_SOURCE_BYTES } })
    }
    const fileType = sourceExtension(file.name)
    if (!fileType) throw new ApiError('INVALID_PARAMS', { code: 'SCRIPT_SOURCE_FORMAT_INVALID' })
    buffer = Buffer.from(await file.arrayBuffer())
    validateBuffer(buffer, fileType.format)
    const extracted = formData.get('scriptText')
    normalizedText = typeof extracted === 'string' ? extracted.trim() : ''
    if (!normalizedText || normalizedText.length > SCRIPT_ANALYSIS_MAX_CHARS) {
      throw new ApiError('INVALID_PARAMS', { code: 'SCRIPT_TEXT_INVALID', details: { max: SCRIPT_ANALYSIS_MAX_CHARS } })
    }
    name = file.name.slice(0, 255)
    sourceTitle = title(formData.get('sourceTitle'), name.replace(/\.(docx|txt|md|markdown)$/i, ''))
    sourceFormat = fileType.format
    mimeType = fileType.mimeType
    extension = fileType.extension
  } else {
    const body = await request.json() as { sourceTitle?: unknown; scriptText?: unknown }
    const scriptText = typeof body.scriptText === 'string' ? body.scriptText.trim() : ''
    if (!scriptText || scriptText.length > SCRIPT_ANALYSIS_MAX_CHARS) {
      throw new ApiError('INVALID_PARAMS', { code: 'SCRIPT_TEXT_INVALID', details: { max: SCRIPT_ANALYSIS_MAX_CHARS } })
    }
    sourceTitle = title(body.sourceTitle, 'Untitled Screenplay')
    name = `${sourceTitle}.txt`
    buffer = Buffer.from(scriptText, 'utf8')
    normalizedText = scriptText
    sourceFormat = 'pasted'
    mimeType = 'text/plain; charset=utf-8'
    extension = 'txt'
  }

  const key = generateUniqueKey(`documents/visual-development/${projectId}/screenplay-text`, 'txt')
  const originalKey = sourceFormat === 'pasted'
    ? null
    : generateUniqueKey(`documents/visual-development/${projectId}/screenplay-original`, extension)
  await uploadToCOS(Buffer.from(normalizedText, 'utf8'), key)
  if (originalKey) await uploadToCOS(buffer, originalKey)
  const source: ScreenplaySourceVersion = {
    id: randomUUID(),
    key,
    originalKey,
    name,
    sourceTitle,
    sourceFormat,
    mimeType,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    sizeBytes: buffer.byteLength,
    textLength: normalizedText.length,
    createdAt: new Date().toISOString(),
  }
  document.sources = [...document.sources, source]
  await prisma.visualDevelopmentWorkspace.upsert({
    where: { projectId },
    create: { projectId, worldBible: toWorldBibleJson(document), status: 'world_draft' },
    update: { worldBible: toWorldBibleJson(document) },
  })
  return NextResponse.json({
    success: true,
    data: {
      source: {
        ...source,
        version: document.sources.length,
        downloadUrl: getSignedUrl(originalKey ?? key, 3600),
      },
    },
  }, { status: 201 })
})
