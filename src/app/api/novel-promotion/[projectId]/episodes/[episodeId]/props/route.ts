import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const GET = apiHandler(async (
  _request: NextRequest,
  context: { params: Promise<{ projectId: string; episodeId: string }> },
) => {
  const { projectId, episodeId } = await context.params
  const authResult = await requireProjectAuthLight(projectId, { action: 'read' })
  if (isErrorResponse(authResult)) return authResult

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { id: episodeId, novelPromotionProject: { projectId } },
    select: { id: true },
  })
  if (!episode) throw new ApiError('NOT_FOUND', { code: 'EPISODE_NOT_FOUND' })

  const bindings = await prisma.episodeProp.findMany({
    where: { episodeId },
    select: {
      id: true,
      propId: true,
      role: true,
      prop: { select: { name: true } },
    },
  })
  return NextResponse.json({ bindings })
})
