import { NextRequest, NextResponse } from 'next/server'
import { ApiError, apiHandler } from '@/lib/api-errors'
import {
  isErrorResponse,
  requireProjectAccess,
  requireUserAuth,
} from '@/lib/api-auth'
import { buildProjectGraphProjection } from '@/lib/project-graph/projection'
import { queryProjectGraph } from '@/lib/project-graph/query'
import {
  PROJECT_GRAPH_DEFAULT_EPISODE_LIMIT,
  PROJECT_GRAPH_MAX_EPISODE_LIMIT,
} from '@/lib/project-graph/types'

function readOptionalId(value: string | null, field: string): string | undefined {
  if (value === null) return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 191) {
    throw new ApiError('INVALID_PARAMS', { field })
  }
  return trimmed
}

function readLimit(value: string | null): number {
  if (value === null || value.trim() === '') {
    return PROJECT_GRAPH_DEFAULT_EPISODE_LIMIT
  }
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ApiError('INVALID_PARAMS', { field: 'limit' })
  }
  return Math.min(parsed, PROJECT_GRAPH_MAX_EPISODE_LIMIT)
}

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult

  const access = await requireProjectAccess(
    projectId,
    authResult.session.user.id,
    'read',
  )
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND') throw new ApiError('NOT_FOUND')
    if (access.reason === 'NOT_AUTHENTICATED') throw new ApiError('UNAUTHORIZED')
    throw new ApiError('FORBIDDEN', { code: 'NO_PROJECT_ACCESS' })
  }

  const episodeId = readOptionalId(
    request.nextUrl.searchParams.get('episodeId'),
    'episodeId',
  )
  const cursor = readOptionalId(request.nextUrl.searchParams.get('cursor'), 'cursor')
  if (episodeId && cursor) {
    throw new ApiError('INVALID_PARAMS', {
      field: 'cursor',
      reason: 'cursor cannot be combined with episodeId',
    })
  }

  const limit = readLimit(request.nextUrl.searchParams.get('limit'))
  const result = await queryProjectGraph({
    projectId,
    episodeId,
    cursor,
    limit,
  })

  if (result.status === 'project_not_found' || result.status === 'episode_not_found') {
    throw new ApiError('NOT_FOUND')
  }
  if (result.status === 'cursor_not_found') {
    throw new ApiError('INVALID_PARAMS', { field: 'cursor' })
  }
  if (result.status === 'graph_too_large') {
    throw new ApiError('INVALID_PARAMS', {
      code: 'PROJECT_GRAPH_TOO_LARGE',
      details: {
        sceneCount: result.sceneCount,
        shotCount: result.shotCount,
        maxScenes: result.maxScenes,
        maxShots: result.maxShots,
      },
    })
  }

  const graph = buildProjectGraphProjection(result.source, {
    limit: result.pageInfo.limit,
  })

  return NextResponse.json(
    {
      ...graph,
      pageInfo: result.pageInfo,
    },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    },
  )
})
