/**
 * Phase 11.3 — Asset-hub Props (global, team-shared).
 *
 * GET    /api/asset-hub/props?folderId=...  — list all global props
 *                                             (read-all, K3b team-share)
 * POST   /api/asset-hub/props                — create a global prop
 *                                             (editor+ writes)
 *
 * Mirrors the GlobalLocation pattern. Image generation runs lazily
 * via the existing asset-hub-image worker dispatch (clients call
 * generate-image with type='prop' once that handler ships).
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, requireEditorAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const folderId = searchParams.get('folderId')

  const where: Record<string, unknown> = {}
  if (folderId === 'null') {
    where.folderId = null
  } else if (folderId) {
    where.folderId = folderId
  }

  const props = await prisma.globalProp.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({ props })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireEditorAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()
  const { name, summary, folderId } = body as {
    name?: unknown
    summary?: unknown
    folderId?: unknown
  }

  if (typeof name !== 'string' || !name.trim()) {
    throw new ApiError('INVALID_PARAMS', { message: 'name is required' })
  }

  if (folderId && typeof folderId === 'string') {
    const folder = await prisma.globalAssetFolder.findUnique({ where: { id: folderId } })
    if (!folder) {
      throw new ApiError('INVALID_PARAMS', { code: 'FOLDER_NOT_FOUND' })
    }
  }

  const prop = await prisma.globalProp.create({
    data: {
      userId: session.user.id,
      folderId: typeof folderId === 'string' && folderId ? folderId : null,
      name: name.trim(),
      summary: typeof summary === 'string' ? summary.trim() || null : null,
    },
  })

  return NextResponse.json({ success: true, prop })
})
