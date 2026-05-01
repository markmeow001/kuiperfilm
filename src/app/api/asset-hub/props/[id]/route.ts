/**
 * Phase 11.3 — single Global prop CRUD.
 *
 * PATCH  /api/asset-hub/props/:id  body { name?, summary?, folderId? }
 *   — editor+ can rename / move / re-summarise.
 * DELETE /api/asset-hub/props/:id
 *   — editor+ can delete (image MediaObject not cascaded; left for media GC).
 *
 * Reads are part of the listing endpoint; no GET single needed for v1.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireEditorAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const authResult = await requireEditorAuth()
  if (isErrorResponse(authResult)) return authResult

  const { id } = await context.params

  const body = await request.json().catch(() => ({}))
  const { name, summary, folderId } = body as {
    name?: unknown
    summary?: unknown
    folderId?: unknown
  }

  const updateData: { name?: string; summary?: string | null; folderId?: string | null } = {}
  if (typeof name === 'string' && name.trim()) updateData.name = name.trim()
  if (typeof summary === 'string') updateData.summary = summary.trim() || null
  else if (summary === null) updateData.summary = null
  if (typeof folderId === 'string' && folderId.trim()) updateData.folderId = folderId.trim()
  else if (folderId === null) updateData.folderId = null

  if (Object.keys(updateData).length === 0) {
    throw new ApiError('INVALID_PARAMS', { message: 'no updatable fields supplied' })
  }

  const exists = await prisma.globalProp.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!exists) {
    throw new ApiError('NOT_FOUND')
  }

  const prop = await prisma.globalProp.update({
    where: { id },
    data: updateData,
  })

  return NextResponse.json({ success: true, prop })
})

export const DELETE = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) => {
  const authResult = await requireEditorAuth()
  if (isErrorResponse(authResult)) return authResult

  const { id } = await context.params

  const exists = await prisma.globalProp.findUnique({
    where: { id },
    select: { id: true },
  })
  if (!exists) {
    throw new ApiError('NOT_FOUND')
  }

  await prisma.globalProp.delete({ where: { id } })

  return NextResponse.json({ success: true })
})
