import { prisma } from '@/lib/prisma'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { TASK_STATUS } from '@/lib/task/types'

const ACTIVE_TASK_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING]

/**
 * Release a submit claim only after the provider has definitively rejected the
 * request. Ambiguous transport/5xx outcomes must retain their claim instead.
 */
export async function releaseRejectedProviderSubmitClaimOrThrow(
  taskId: string,
  expectedClaimId: string,
): Promise<void> {
  const id = taskId.trim()
  const claimId = expectedClaimId.trim()
  if (!id || !claimId) throw new Error('TASK_EXTERNAL_ID_CLAIM_RELEASE_INPUT_INVALID')

  const released = await withPrismaRetry(() => prisma.task.updateMany({
    where: {
      id,
      status: { in: ACTIVE_TASK_STATUSES },
      externalId: claimId,
    },
    data: { externalId: null },
  }), { maxRetries: 4, initialDelayMs: 100 })
  if (released.count === 1) return

  const current = await withPrismaRetry(() => prisma.task.findUnique({
    where: { id },
    select: { externalId: true },
  }), { maxRetries: 4, initialDelayMs: 100 })
  if (current?.externalId === null || current?.externalId === '') return
  throw new Error('TASK_EXTERNAL_ID_CLAIM_RELEASE_FAILED')
}
