/**
 * Phase 11.1.5 — episode reorder API.
 *
 * POST /api/novel-promotion/:projectId/episodes/reorder
 * body: { order: string[] }   // ordered list of episodeIds
 *
 * Replaces the current episodeNumber sequence with the supplied
 * order (1-indexed). All ids must belong to the project; missing ids
 * (or extras) yield INVALID_PARAMS.
 *
 * The two-phase write avoids the (novelPromotionProjectId,
 * episodeNumber) @@unique collision: phase A pushes every targeted
 * episodeNumber into a non-overlapping high range (+1000), phase B
 * writes the final 1..N values.
 *
 * UI (drag-and-drop on EpisodeTabBar) is deferred — see master plan
 * Phase 11.1.5. This endpoint is what the UI will call.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

const REORDER_PARK_OFFSET = 1000

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({}))
  const orderRaw = (body as { order?: unknown }).order
  if (!Array.isArray(orderRaw) || orderRaw.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ORDER_REQUIRED',
      message: 'order must be a non-empty string[] of episode ids',
    })
  }
  const order = orderRaw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  if (order.length !== orderRaw.length) {
    throw new ApiError('INVALID_PARAMS', { code: 'ORDER_NON_STRING' })
  }
  // Reject duplicate ids in the supplied order
  if (new Set(order).size !== order.length) {
    throw new ApiError('INVALID_PARAMS', { code: 'ORDER_DUPLICATES' })
  }

  // Resolve novelPromotionProject once so we can chain by id
  const npProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true },
  })
  if (!npProject) {
    throw new ApiError('NOT_FOUND', { code: 'NOVEL_PROMOTION_NOT_FOUND' })
  }

  // The supplied order MUST be exactly the episodes belonging to this
  // project (no extras, no missing). This prevents partial reorders
  // from silently corrupting the sequence.
  const existing = await prisma.novelPromotionEpisode.findMany({
    where: { novelPromotionProjectId: npProject.id },
    select: { id: true, episodeNumber: true },
    orderBy: { episodeNumber: 'asc' },
  })
  const existingIds = new Set(existing.map((e) => e.id))
  for (const id of order) {
    if (!existingIds.has(id)) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'ORDER_UNKNOWN_ID',
        details: { unknownId: id },
      })
    }
  }
  if (order.length !== existing.length) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'ORDER_INCOMPLETE',
      details: {
        expected: existing.length,
        received: order.length,
        message: 'order must list every episode in the project exactly once',
      },
    })
  }

  // Two-phase write: park then place. Wrap in $transaction so a crash
  // mid-flight leaves the DB at the parked state (+1000) rather than a
  // half-applied sequence — the next attempt can detect the +1000s and
  // recover, or an admin can.
  await prisma.$transaction(async (tx) => {
    // Phase A — park: shift every targeted episode's episodeNumber to
    // <currentNumber + REORDER_PARK_OFFSET>. None of these collide
    // with any pre-existing 1..N values.
    for (const ep of existing) {
      await tx.novelPromotionEpisode.update({
        where: { id: ep.id },
        data: { episodeNumber: ep.episodeNumber + REORDER_PARK_OFFSET },
      })
    }
    // Phase B — place: write the final 1..N positions in supplied order.
    for (let i = 0; i < order.length; i++) {
      await tx.novelPromotionEpisode.update({
        where: { id: order[i] },
        data: { episodeNumber: i + 1 },
      })
    }
  })

  // Return the new ordering for the optimistic-update reconciliation
  const reordered = await prisma.novelPromotionEpisode.findMany({
    where: { novelPromotionProjectId: npProject.id },
    select: { id: true, episodeNumber: true, name: true },
    orderBy: { episodeNumber: 'asc' },
  })

  return NextResponse.json({ episodes: reordered })
})
