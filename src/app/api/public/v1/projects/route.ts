/**
 * Public API — list projects within the API key's workspace.
 *
 * GET /api/public/v1/projects?limit=20&cursor=<id>
 *
 *   Auth:  Bearer kfk_... (scope: read)
 *   Query:
 *     limit       — 1..100, default 20
 *     cursor      — opaque project ID; returns rows AFTER this id
 *     search      — substring match on name/description (optional)
 *
 *   Returns:
 *     {
 *       data: [{ id, name, description, createdAt, updatedAt }],
 *       pagination: { nextCursor, hasMore }
 *     }
 *
 * Pagination is cursor-based (id > cursor + ORDER BY id) rather than
 * offset/page like the internal route. Rationale: keyset pagination is
 * stable under concurrent insert (no row drift, no re-counts), and
 * matches what most public APIs (Stripe, GitHub) ship — SDK authors
 * won't have to adapt to a second pagination model.
 *
 * Cross-workspace leak guard: every query filters on
 * `workspaceId = ctx.workspaceId`. The key's workspace is the only
 * tenant boundary on the public API — internal session-based routes
 * additionally check organization membership, but public-API keys are
 * always scoped to a single workspace.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { publicApiHandler } from '@/lib/api-keys'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export const GET = publicApiHandler(
  { requireScope: 'read' },
  async (req: NextRequest, ctx) => {
    const url = new URL(req.url)

    const rawLimit = url.searchParams.get('limit')
    let limit = DEFAULT_LIMIT
    if (rawLimit) {
      const parsed = Number.parseInt(rawLimit, 10)
      if (Number.isFinite(parsed)) {
        limit = Math.min(MAX_LIMIT, Math.max(1, parsed))
      }
    }

    const cursor = url.searchParams.get('cursor')?.trim() || null
    const search = url.searchParams.get('search')?.trim() || ''

    const where: Record<string, unknown> = {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    // Fetch limit+1 to detect hasMore without a second COUNT query.
    const rows = await prisma.project.findMany({
      where,
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        description: true,
        mode: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    const hasMore = rows.length > limit
    const data = hasMore ? rows.slice(0, limit) : rows
    const nextCursor = hasMore ? data[data.length - 1]?.id ?? null : null

    return NextResponse.json({
      data,
      pagination: { nextCursor, hasMore },
    })
  },
)
