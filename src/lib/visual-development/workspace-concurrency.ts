import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

export interface VisualDevelopmentWorkspaceRevision {
  id: string
  updatedAt: Date
}

export async function updateVisualDevelopmentWorkspaceAtRevision(
  workspace: VisualDevelopmentWorkspaceRevision,
  data: Prisma.VisualDevelopmentWorkspaceUpdateManyMutationInput,
): Promise<void> {
  const result = await prisma.visualDevelopmentWorkspace.updateMany({
    where: { id: workspace.id, updatedAt: workspace.updatedAt },
    data,
  })
  if (result.count !== 1) {
    throw new ApiError('CONFLICT', {
      code: 'VISUAL_DEVELOPMENT_WRITE_CONFLICT',
      details: { message: 'This project changed in another request. Reload the latest version before saving again.' },
    })
  }
}
