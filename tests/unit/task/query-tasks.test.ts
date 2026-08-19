import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_STATUS } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  task: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/billing', () => ({ rollbackTaskBilling: vi.fn() }))
vi.mock('@/lib/prisma-retry', () => ({
  withPrismaRetry: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
}))
vi.mock('@/i18n/routing', () => ({ locales: ['zh', 'en'] }))

import { queryTasks } from '@/lib/task/service'

describe('queryTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.task.findMany.mockResolvedValue([])
  })

  it('个人游标列表 -> 在数据库查询中带 userId、episodeId 与稳定排序', async () => {
    await queryTasks({
      userId: 'user-1',
      episodeId: 'episode-1',
      cursor: 'task-cursor',
      type: ['video_panel'],
      limit: 21,
    })

    expect(prismaMock.task.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        episodeId: 'episode-1',
        type: { in: ['video_panel'] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: { id: 'task-cursor' },
      skip: 1,
      take: 21,
    })
  })

  it('筛选失败与取消 -> 在数据库层区分 TASK_CANCELLED', async () => {
    await queryTasks({
      projectId: 'project-1',
      status: [TASK_STATUS.FAILED],
      jobStatus: ['failed', 'cancelled'],
      limit: 51,
    })

    expect(prismaMock.task.findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'project-1',
        status: { in: [TASK_STATUS.FAILED] },
        AND: [{
          OR: [
            {
              status: TASK_STATUS.FAILED,
              OR: [
                { errorCode: null },
                { errorCode: { not: 'TASK_CANCELLED' } },
              ],
            },
            { status: TASK_STATUS.FAILED, errorCode: 'TASK_CANCELLED' },
          ],
        }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
    })
  })
})
