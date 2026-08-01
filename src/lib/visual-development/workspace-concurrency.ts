import type { Prisma } from '@prisma/client'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

interface WorkspaceUpdateManyClient {
  visualDevelopmentWorkspace: {
    updateMany(args: Prisma.VisualDevelopmentWorkspaceUpdateManyArgs): Promise<{ count: number }>
  }
}

export interface VisualDevelopmentWorkspaceRevision {
  id: string
  updatedAt: Date
}

export async function updateVisualDevelopmentWorkspaceAtRevision(
  workspace: VisualDevelopmentWorkspaceRevision,
  data: Prisma.VisualDevelopmentWorkspaceUpdateManyMutationInput,
  client: WorkspaceUpdateManyClient = prisma,
): Promise<void> {
  const result = await client.visualDevelopmentWorkspace.updateMany({
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
