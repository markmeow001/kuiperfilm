/**
 * Workspace-scoped API key management (admin/owner only).
 *
 *   GET   /api/workspaces/:workspaceId/api-keys
 *           List keys (hash NEVER returned, full key NEVER returned).
 *   POST  /api/workspaces/:workspaceId/api-keys
 *           Body: { name, scopes[], reqPerMinute?, monthlyCredit?, expiresAt? }
 *           Returns the full key ONCE. Caller must save it; we can't show
 *           it again because we only store the SHA-256 hash.
 *
 * Auth model: session-auth (NextAuth cookie), NOT public-API key auth.
 * Only the workspace OWNER or a global ADMIN can manage keys — regular
 * workspace members can use the keys but can't create / revoke them.
 * Rationale: API keys carry workspace-wide blast radius (any member's
 * project data), so management is restricted to the accountability tier.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, roleAtLeast } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import {
  generateApiKey,
  PUBLIC_API_SCOPES,
  isValidScope,
  type PublicApiScope,
} from '@/lib/api-keys'

const MAX_NAME_LENGTH = 64
const DEFAULT_REQ_PER_MINUTE = 60
const MAX_REQ_PER_MINUTE = 600
const MAX_KEYS_PER_WORKSPACE = 25  // ops cap; raise via direct DB if needed

/**
 * Workspace owner OR global admin only. Members are NOT allowed to
 * manage keys — see file header for rationale.
 */
async function requireKeyAdminAccess(workspaceId: string, userId: string) {
  const [ws, requester] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, ownerEditorId: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ])
  if (!ws) throw new ApiError('NOT_FOUND', { code: 'WORKSPACE_NOT_FOUND' })
  const isAdmin = roleAtLeast(requester?.role, 'admin')
  const isOwner = ws.ownerEditorId === userId
  if (!isAdmin && !isOwner) {
    throw new ApiError('FORBIDDEN', {
      code: 'NOT_WORKSPACE_OWNER',
      details: { reason: 'Only the workspace owner or an admin can manage API keys.' },
    })
  }
  return { ws, isAdmin, isOwner }
}

export const GET = apiHandler(async (
  _req: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) => {
  const { workspaceId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  await requireKeyAdminAccess(workspaceId, session.user.id)

  // Note: we omit keyHash from select — there is no legitimate reason
  // for it to leave the server. Same for any private fields.
  const keys = await prisma.apiKey.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      keyLast4: true,
      scopes: true,
      reqPerMinute: true,
      monthlyCredit: true,
      expiresAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
      createdBy: { select: { id: true, name: true, email: true } },
    },
  })

  return NextResponse.json({
    keys: keys.map((k) => ({
      ...k,
      scopes: safeParseScopes(k.scopes),
    })),
  })
})

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string }> },
) => {
  const { workspaceId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  await requireKeyAdminAccess(workspaceId, session.user.id)

  const body = (await request.json()) as {
    name?: unknown
    scopes?: unknown
    reqPerMinute?: unknown
    monthlyCredit?: unknown
    expiresAt?: unknown
  }

  // Validate name
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw new ApiError('INVALID_PARAMS', { details: { reason: 'name is required' } })
  if (name.length > MAX_NAME_LENGTH) {
    throw new ApiError('INVALID_PARAMS', { details: { reason: `name must be ≤ ${MAX_NAME_LENGTH} chars` } })
  }

  // Validate scopes
  if (!Array.isArray(body.scopes) || body.scopes.length === 0) {
    throw new ApiError('INVALID_PARAMS', {
      details: { reason: 'scopes must be a non-empty array', allowed: PUBLIC_API_SCOPES },
    })
  }
  const scopes: PublicApiScope[] = []
  for (const s of body.scopes) {
    if (typeof s !== 'string' || !isValidScope(s)) {
      throw new ApiError('INVALID_PARAMS', {
        details: { reason: `invalid scope: ${String(s)}`, allowed: PUBLIC_API_SCOPES },
      })
    }
    if (!scopes.includes(s)) scopes.push(s)
  }

  // Validate optional numeric/date fields
  let reqPerMinute = DEFAULT_REQ_PER_MINUTE
  if (body.reqPerMinute !== undefined) {
    const n = Number(body.reqPerMinute)
    if (!Number.isFinite(n) || n < 1 || n > MAX_REQ_PER_MINUTE) {
      throw new ApiError('INVALID_PARAMS', {
        details: { reason: `reqPerMinute must be 1..${MAX_REQ_PER_MINUTE}` },
      })
    }
    reqPerMinute = Math.floor(n)
  }

  let monthlyCredit: number | null = null
  if (body.monthlyCredit !== undefined && body.monthlyCredit !== null) {
    const n = Number(body.monthlyCredit)
    if (!Number.isFinite(n) || n < 0) {
      throw new ApiError('INVALID_PARAMS', { details: { reason: 'monthlyCredit must be ≥ 0' } })
    }
    monthlyCredit = Math.floor(n)
  }

  let expiresAt: Date | null = null
  if (body.expiresAt !== undefined && body.expiresAt !== null && body.expiresAt !== '') {
    const d = new Date(String(body.expiresAt))
    if (Number.isNaN(d.getTime())) {
      throw new ApiError('INVALID_PARAMS', { details: { reason: 'expiresAt is not a valid date' } })
    }
    if (d.getTime() < Date.now()) {
      throw new ApiError('INVALID_PARAMS', { details: { reason: 'expiresAt must be in the future' } })
    }
    expiresAt = d
  }

  // Enforce per-workspace cap — prevents accidental key sprawl.
  const existingCount = await prisma.apiKey.count({
    where: { workspaceId, revokedAt: null },
  })
  if (existingCount >= MAX_KEYS_PER_WORKSPACE) {
    throw new ApiError('CONFLICT', {
      details: {
        reason: `Workspace already has ${existingCount} active keys (max ${MAX_KEYS_PER_WORKSPACE}). Revoke unused keys before creating new ones.`,
      },
    })
  }

  const generated = generateApiKey()
  const created = await prisma.apiKey.create({
    data: {
      workspaceId,
      name,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      keyLast4: generated.keyLast4,
      scopes: JSON.stringify(scopes),
      reqPerMinute,
      monthlyCredit,
      expiresAt,
      createdById: session.user.id,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      keyLast4: true,
      scopes: true,
      reqPerMinute: true,
      monthlyCredit: true,
      expiresAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json({
    key: {
      ...created,
      scopes: safeParseScopes(created.scopes),
    },
    // CRITICAL: fullKey is returned exactly once, here. The DB only
    // stores the SHA-256 hash. UI must surface a reveal-once modal.
    fullKey: generated.fullKey,
    warning: 'Save this key now — it will never be shown again.',
  }, { status: 201 })
})

function safeParseScopes(raw: string): PublicApiScope[] {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is PublicApiScope =>
      typeof s === 'string' && isValidScope(s),
    )
  } catch {
    return []
  }
}
