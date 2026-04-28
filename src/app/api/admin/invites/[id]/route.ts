/**
 * Admin: revoke an invite code.
 *
 * DELETE /api/admin/invites/:id
 *
 * Soft-revoke (sets revokedAt). Already-used or already-revoked invites
 * surface CONFLICT — caller knows the operation is a no-op.
 */
import { NextResponse } from 'next/server'
import { isErrorResponse, requireAdminAuth } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { revokeInvite } from '@/lib/admin-service'

export const DELETE = apiHandler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const authResult = await requireAdminAuth()
    if (isErrorResponse(authResult)) return authResult

    const { id } = await params
    await revokeInvite(id)
    return NextResponse.json({ revoked: true })
  }
)
