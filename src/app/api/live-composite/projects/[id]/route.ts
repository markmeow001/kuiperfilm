/**
 * Live Composite project detail (2026-07-17).
 *
 * GET    /api/live-composite/projects/:id — full payload; videoKey /
 *        backgroundKey / baseMaskKeys are signed into fresh URLs at read
 *        time (keys are validated on write to the caller's own namespace).
 * PATCH  /api/live-composite/projects/:id — partial update, owner-only.
 * DELETE /api/live-composite/projects/:id — owner-only.
 *
 * Non-owner access is always 404 (not 403) so project ids don't leak
 * existence. Contract lives in ../../lib/projects-contract.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isErrorResponse, requireUserAuth } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedUrl } from '@/lib/cos'
import { logError as _ulogError } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import {
  findForeignStorageKey,
  LIVE_COMPOSITE_MAX_TIMELINE_BYTES,
  liveCompositeProjectUpdateSchema,
  liveCompositeTimelineSchema,
  timelineByteSize,
  type LiveCompositeProjectDetail,
} from '../../lib/projects-contract'

const SIGNED_URL_TTL_SECONDS = 3600

type RouteContext = { params: Promise<{ id: string }> }

async function requireOwnedProject(id: string, userId: string) {
  const project = await prisma.liveCompositeProject.findFirst({
    where: { id, ownerUserId: userId },
  })
  if (!project) {
    // 404 (not 403) even when the row exists but belongs to someone else.
    throw new ApiError('NOT_FOUND', { code: 'LIVE_COMPOSITE_PROJECT_NOT_FOUND' })
  }
  return project
}

export const GET = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { id } = await params

  const project = await requireOwnedProject(id, userId)

  const timelineParsed = liveCompositeTimelineSchema.safeParse(project.timeline)
  if (!timelineParsed.success) {
    // Stored JSON should always satisfy the write-time contract; a mismatch
    // means data corruption — fail loudly instead of returning garbage.
    _ulogError(`[live-composite.projects.get] corrupt timeline projectId=${id} issues=${JSON.stringify(timelineParsed.error.issues.slice(0, 3))}`)
    throw new ApiError('INTERNAL_ERROR', { code: 'LIVE_COMPOSITE_TIMELINE_CORRUPT' })
  }

  const detail: LiveCompositeProjectDetail = {
    id: project.id,
    name: project.name,
    videoKey: project.videoKey,
    videoUrl: project.videoKey ? getSignedUrl(project.videoKey, SIGNED_URL_TTL_SECONDS) : null,
    videoName: project.videoName,
    backgroundKey: project.backgroundKey,
    backgroundUrl: project.backgroundKey ? getSignedUrl(project.backgroundKey, SIGNED_URL_TTL_SECONDS) : null,
    backgroundColor: project.backgroundColor,
    timeline: {
      keyframes: timelineParsed.data.keyframes.map((keyframe) => ({
        ...keyframe,
        ...(keyframe.baseMaskKey ? { baseMaskUrl: getSignedUrl(keyframe.baseMaskKey, SIGNED_URL_TTL_SECONDS) } : {}),
      })),
      ...(timelineParsed.data.virtualCharacter ? {
        virtualCharacter: {
          ...timelineParsed.data.virtualCharacter,
          assetUrl: getSignedUrl(timelineParsed.data.virtualCharacter.assetKey, SIGNED_URL_TTL_SECONDS),
        },
      } : {}),
    },
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
  return NextResponse.json({ project: detail })
})

export const PATCH = apiHandler(async (request: NextRequest, { params }: RouteContext) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { id } = await params

  await requireOwnedProject(id, userId)

  let body: unknown
  try {
    body = await request.json()
  } catch (err) {
    _ulogError(`[live-composite.projects.patch] invalid JSON body projectId=${id} err=${err instanceof Error ? err.message : String(err)}`)
    throw new ApiError('INVALID_PARAMS', { code: 'INVALID_JSON_BODY' })
  }

  const parsed = liveCompositeProjectUpdateSchema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'LIVE_COMPOSITE_PAYLOAD_INVALID',
      details: { issues: parsed.error.issues.slice(0, 5) },
    })
  }

  const foreign = findForeignStorageKey(
    {
      videoKey: parsed.data.videoKey ?? undefined,
      backgroundKey: parsed.data.backgroundKey ?? undefined,
      timeline: parsed.data.timeline,
    },
    userId,
  )
  if (foreign) {
    throw new ApiError('FORBIDDEN', {
      code: 'LIVE_COMPOSITE_STORAGE_KEY_REJECTED',
      details: { field: foreign.field },
    })
  }

  if (parsed.data.timeline) {
    const blobSize = timelineByteSize(parsed.data.timeline)
    if (blobSize > LIVE_COMPOSITE_MAX_TIMELINE_BYTES) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'LIVE_COMPOSITE_TIMELINE_TOO_LARGE',
        details: { got: blobSize, max: LIVE_COMPOSITE_MAX_TIMELINE_BYTES },
      })
    }
  }

  const updated = await prisma.liveCompositeProject.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.videoKey !== undefined ? { videoKey: parsed.data.videoKey } : {}),
      ...(parsed.data.videoName !== undefined ? { videoName: parsed.data.videoName } : {}),
      ...(parsed.data.backgroundKey !== undefined ? { backgroundKey: parsed.data.backgroundKey } : {}),
      ...(parsed.data.backgroundColor !== undefined ? { backgroundColor: parsed.data.backgroundColor } : {}),
      ...(parsed.data.timeline !== undefined ? { timeline: parsed.data.timeline } : {}),
    },
  })

  return NextResponse.json({
    project: {
      id: updated.id,
      name: updated.name,
      videoName: updated.videoName,
      updatedAt: updated.updatedAt.toISOString(),
    },
  })
})

export const DELETE = apiHandler(async (_request: NextRequest, { params }: RouteContext) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const userId = authResult.session.user.id
  const { id } = await params

  await requireOwnedProject(id, userId)
  await prisma.liveCompositeProject.delete({ where: { id } })
  return NextResponse.json({ deletedId: id })
})
