/**
 * Admin: list recent runs across all users (failed by default).
 *
 * GET /api/admin/runs?status=failed&limit=50
 *
 * Returns the latest N graphRun rows with the owning user attached so
 * the admin dashboard can show "user X's <type> task failed at <time>
 * with <error>". For pagination we use cursor=runId; small surface,
 * 50 rows fits one screen, infinite scroll later if needed.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

const ALLOWED_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'canceled'])

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireAdminAuth()
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const statusParam = searchParams.get('status') || 'failed'
  const limitParam = Number.parseInt(searchParams.get('limit') || '50', 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50
  const cursor = searchParams.get('cursor')

  const where: Prisma.GraphRunWhereInput = {}
  if (statusParam === 'all') {
    // no filter
  } else if (ALLOWED_STATUSES.has(statusParam)) {
    where.status = statusParam
  } else {
    where.status = 'failed'
  }

  const runs = await prisma.graphRun.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    select: {
      id: true,
      userId: true,
      projectId: true,
      episodeId: true,
      workflowType: true,
      taskType: true,
      taskId: true,
      targetType: true,
      targetId: true,
      status: true,
      errorCode: true,
      errorMessage: true,
      queuedAt: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  })

  const nextCursor = runs.length === limit ? runs[runs.length - 1].id : null

  return NextResponse.json({
    runs: runs.map((r) => ({
      ...r,
      // BigInt-safe serialize: errorMessage truncated for table display
      errorMessage: r.errorMessage ? r.errorMessage.slice(0, 500) : null,
    })),
    nextCursor,
  })
})
