/**
 * Live Composite project persistence (2026-07-17).
 *
 * POST /api/live-composite/projects — create a project for the caller
 *   { name?, videoKey?, videoName?, backgroundKey?, backgroundColor?, timeline }
 *   Storage keys must live in the caller's own playground-ref namespace.
 * GET  /api/live-composite/projects — the caller's projects (id, name,
 *   videoName, updatedAt), newest first, capped at 100.
 *
 * Contract lives in ../lib/projects-contract.ts (shared with the client).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { logError as _ulogError } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import {
  findForeignStorageKey,
  LIVE_COMPOSITE_MAX_TIMELINE_BYTES,
  LIVE_COMPOSITE_PROJECT_LIST_CAP,
  liveCompositeProjectCreateSchema,
  timelineByteSize,
  type LiveCompositeProjectSummary,
} from '../lib/projects-contract'

export const GET = apiHandler(async () => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id

  const rows = await prisma.liveCompositeProject.findMany({
    where: { ownerUserId: userId },
    orderBy: { updatedAt: 'desc' },
    take: LIVE_COMPOSITE_PROJECT_LIST_CAP,
    select: { id: true, name: true, videoName: true, updatedAt: true },
  })
  const projects: LiveCompositeProjectSummary[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    videoName: row.videoName,
    updatedAt: row.updatedAt.toISOString(),
  }))
  return NextResponse.json({ projects })
})

export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id

  let body: unknown
  try {
    body = await request.json()
  } catch (err) {
    _ulogError(`[live-composite.projects.create] invalid JSON body userId=${userId} err=${err instanceof Error ? err.message : String(err)}`)
    throw new ApiError('INVALID_PARAMS', { code: 'INVALID_JSON_BODY' })
  }

  const parsed = liveCompositeProjectCreateSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'LIVE_COMPOSITE_PAYLOAD_INVALID',
      details: { issues: parsed.error.issues.slice(0, 5) },
    })
  }

  const foreign = findForeignStorageKey(parsed.data, userId)
  if (foreign) {
    throw new ApiError('FORBIDDEN', {
      code: 'LIVE_COMPOSITE_STORAGE_KEY_REJECTED',
      details: { field: foreign.field },
    })
  }

  const blobSize = timelineByteSize(parsed.data.timeline)
  if (blobSize > LIVE_COMPOSITE_MAX_TIMELINE_BYTES) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'LIVE_COMPOSITE_TIMELINE_TOO_LARGE',
      details: { got: blobSize, max: LIVE_COMPOSITE_MAX_TIMELINE_BYTES },
    })
  }

  const project = await prisma.liveCompositeProject.create({
    data: {
      ownerUserId: userId,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      videoKey: parsed.data.videoKey ?? null,
      videoName: parsed.data.videoName ?? null,
      backgroundKey: parsed.data.backgroundKey ?? null,
      ...(parsed.data.backgroundColor !== undefined ? { backgroundColor: parsed.data.backgroundColor } : {}),
      timeline: parsed.data.timeline,
    },
  })

  return NextResponse.json({
    project: {
      id: project.id,
      name: project.name,
      videoName: project.videoName,
      updatedAt: project.updatedAt.toISOString(),
    },
  })
})
