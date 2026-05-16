/**
 * Regression: /api/admin/task-usage-snapshot must use parameterized queries.
 *
 * 2026-05-15 /cso audit (F2) flagged that the userId query param was
 * interpolated into a $queryRawUnsafe with only a single-quote strip:
 *
 *   const userClause = userIdFilter
 *     ? `AND userId = '${userIdFilter.replace(/'/g, '')}'`
 *     : ''
 *   prisma.$queryRawUnsafe(`... ${userClause} ...`, since)
 *
 * The strip is brittle (MySQL backslash escapes can break quote handling
 * depending on sql_mode) and is the textbook anti-pattern Prisma docs
 * explicitly warn against. The route is also reachable via
 * x-snapshot-token header (LLM_USAGE_SNAPSHOT_TOKEN), bypassing the
 * admin session gate, so token holders (off-box monitoring per memory
 * reference_kuiperfilm_admin_endpoints.md) get the injection too.
 *
 * Fix: rewrite to $queryRaw with Prisma.sql tagged template and
 * Prisma.empty for the conditional clause.
 *
 * This test pins:
 * 1. The route uses $queryRaw, NOT $queryRawUnsafe.
 * 2. When userId is a SQL-injection payload, Prisma binds it as a
 *    parameter (not concatenated), so it shows up as a Prisma.Sql
 *    value with the payload kept whole.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
import { callRoute } from '../../helpers/request'
import {
  installAuthMocks,
  mockAuthenticated,
  mockRole,
  resetAuthMockState,
} from '../../helpers/auth'

const prismaMock = vi.hoisted(() => ({
  task: {
    groupBy: vi.fn(async () => []),
  },
  $queryRaw: vi.fn(async () => []),
  $queryRawUnsafe: vi.fn(async () => {
    throw new Error('$queryRawUnsafe must not be called — F2 regression')
  }),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  resetAuthMockState()
  installAuthMocks()
  mockAuthenticated('admin-A')
  mockRole('admin')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/api/admin/task-usage-snapshot SQL injection regression', () => {
  it('uses $queryRaw (parameterized), never $queryRawUnsafe', async () => {
    const { GET } = await import('@/app/api/admin/task-usage-snapshot/route')
    const res = await callRoute(GET, {
      path: '/api/admin/task-usage-snapshot?userId=any-id',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(res.status).toBe(200)
    expect(prismaMock.$queryRaw).toHaveBeenCalled()
    expect(prismaMock.$queryRawUnsafe).not.toHaveBeenCalled()
  })

  it('binds SQL-injection payload as a parameter — never inlined into the SQL string', async () => {
    const payload = "x'; DROP TABLE users; --"
    const { GET } = await import('@/app/api/admin/task-usage-snapshot/route')

    await callRoute(GET, {
      path: `/api/admin/task-usage-snapshot?userId=${encodeURIComponent(payload)}`,
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    const sqlArg = prismaMock.$queryRaw.mock.calls[0][0] as Prisma.Sql

    // Prisma.Sql carries text + values; values is what gets bound.
    // The payload must appear in values, never in the literal text.
    expect(sqlArg.values).toContain(payload)
    expect(sqlArg.text).not.toContain(payload)
    // And specifically, the raw string DROP TABLE must not be in the SQL
    // body — it should only ever exist in the bound parameters.
    expect(sqlArg.text).not.toContain('DROP TABLE')
  })

  it('omits the userId clause entirely when userId param is absent', async () => {
    const { GET } = await import('@/app/api/admin/task-usage-snapshot/route')
    await callRoute(GET, {
      path: '/api/admin/task-usage-snapshot',
      method: 'GET',
      context: { params: Promise.resolve({}) },
    })

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    const sqlArg = prismaMock.$queryRaw.mock.calls[0][0] as Prisma.Sql
    // No userId binding when filter is absent.
    expect(sqlArg.text).not.toContain('userId')
  })
})
