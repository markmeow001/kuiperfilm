/**
 * Phase T-1 (2026-05-27) — Playground runs history.
 *
 * GET /api/playground/runs?limit=20&workspaceId=...
 *   → returns the calling user's recent runs (or workspace shared runs
 *     when workspaceId is set + user is a member). Newest first.
 *
 * Returns signed result URLs for browser playback. Reference images / videos
 * are returned as raw COS keys; client signs on demand for replay.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getSignedUrl } from '@/lib/cos'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export const GET = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult
  const userId = session.user.id

  const { searchParams } = new URL(request.url)
  const limitRaw = Number.parseInt(searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, limitRaw))
    : DEFAULT_LIMIT
  const workspaceId = searchParams.get('workspaceId') || null

  // Workspace-shared mode: any member can see all runs.
  if (workspaceId) {
    const member = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId },
      select: { workspaceId: true },
    })
    const owned = await prisma.workspace.findFirst({
      where: { id: workspaceId, ownerEditorId: userId },
      select: { id: true },
    })
    if (!member && !owned) {
      throw new ApiError('FORBIDDEN', { code: 'NOT_WORKSPACE_MEMBER' })
    }
  }

  const runs = await prisma.playgroundRun.findMany({
    where: workspaceId
      ? { workspaceId }
      : { userId, workspaceId: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // Sign result URLs that are COS keys; pass through HTTP URLs.
  const signed = runs.map((r) => {
    let resultUrls: string[] | null = null
    if (r.resultUrls) {
      try {
        const parsed = JSON.parse(r.resultUrls)
        if (Array.isArray(parsed)) {
          resultUrls = parsed.map((u) =>
            typeof u === 'string' && (u.startsWith('images/') || u.startsWith('video/'))
              ? getSignedUrl(u, 3600)
              : u,
          )
        }
      } catch {
        // Malformed JSON in DB — ignore, return null.
      }
    }
    return {
      id: r.id,
      prompt: r.prompt,
      outputType: r.outputType,
      modelKey: r.modelKey,
      status: r.status,
      resultUrls,
      errorMessage: r.errorMessage,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    }
  })

  return NextResponse.json({ runs: signed })
})
