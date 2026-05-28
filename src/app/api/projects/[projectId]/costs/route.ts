import { NextRequest, NextResponse } from 'next/server'
import { getProjectCostDetails } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse, requireProjectAccess } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * GET /api/projects/[projectId]/costs
 * 获取项目费用详情
 *
 * Phase V (2026-05-28) — auth uses 8-tier cascade so workspace members can
 * read teammate project cost summary (previously hard owner check returned 403).
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { projectId } = await context.params

  const access = await requireProjectAccess(projectId, session.user.id, 'read')
  if (!access.allowed) {
    if (access.reason === 'NOT_FOUND' || access.reason === 'NOT_AUTHENTICATED') {
      throw new ApiError('NOT_FOUND')
    }
    throw new ApiError('FORBIDDEN', { code: 'INSUFFICIENT_ACCESS' })
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, name: true }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  // 获取费用详情
  const costDetails = await getProjectCostDetails(projectId)

  return NextResponse.json({
    projectId,
    projectName: project.name,
    currency: BILLING_CURRENCY,
    ...costDetails
  })
})
