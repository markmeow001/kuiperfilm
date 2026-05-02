/**
 * /api/usage/users/[userId] — drill into a specific user's usage
 *
 * Permission cascade (matches the project access pattern):
 *   - requesterId === userId → ✓ (looking at own stats)
 *   - admin → ✓
 *   - editor of any workspace where userId is a member → ✓
 *   - else → 403
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { getUserUsageStats } from '@/lib/usage/usage-stats'

export const GET = apiHandler(async (
  _req: NextRequest,
  context: { params: Promise<{ userId: string }> },
) => {
  const { userId } = await context.params
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  if (session.user.id !== userId) {
    const requester = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    })
    const isAdmin = requester?.role === 'admin'
    if (!isAdmin) {
      const editorAccess = await prisma.workspace.findFirst({
        where: {
          ownerEditorId: session.user.id,
          members: { some: { userId } },
        },
        select: { id: true },
      })
      if (!editorAccess) {
        throw new ApiError('FORBIDDEN', { code: 'NOT_AUTHORIZED' })
      }
    }
  }

  const stats = await getUserUsageStats(userId)
  return NextResponse.json(stats)
})
