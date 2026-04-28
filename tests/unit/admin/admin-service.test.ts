/**
 * Unit tests for the multi-user admin-service module.
 *
 * Focuses on pure logic that doesn't require a real DB:
 * - isValidRole truth table
 * - generateInviteCode shape + uniqueness
 * - createInvite / revokeInvite / assertNotLastActiveAdmin behavior with
 *   the prisma client fully mocked
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted mock of the prisma client so admin-service sees this version.
// The shape mirrors only the methods the service actually calls.
const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    count: vi.fn(),
  },
  inviteCode: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

// Replace the api-errors barrel so we can assert on a plain JS Error
// shape without having to hand-roll the full unified error catalog.
vi.mock('@/lib/api-errors', async () => {
  return {
    ApiError: class ApiError extends Error {
      code: string
      details?: Record<string, unknown>
      constructor(code: string, details?: Record<string, unknown>) {
        super(typeof details?.message === 'string' ? details.message : code)
        this.name = 'ApiError'
        this.code = code
        this.details = details
      }
    },
  }
})

import {
  assertNotLastActiveAdmin,
  createInvite,
  generateInviteCode,
  isValidRole,
  revokeInvite,
} from '@/lib/admin-service'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isValidRole', () => {
  it.each([
    ['admin', true],
    ['editor', true],
    ['member', true],
    ['user', false], // legacy, intentionally rejected
    ['', false],
    ['ADMIN', false], // case sensitive
    [null, false],
    [undefined, false],
    [42, false],
  ])('isValidRole(%p) → %p', (input, expected) => {
    expect(isValidRole(input)).toBe(expected)
  })
})

describe('generateInviteCode', () => {
  it('returns a 24-char uppercase hex string', () => {
    const code = generateInviteCode()
    expect(code).toMatch(/^[0-9A-F]{24}$/)
  })

  it('produces unique codes across many invocations', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 200; i += 1) {
      seen.add(generateInviteCode())
    }
    expect(seen.size).toBe(200)
  })
})

describe('createInvite', () => {
  it('defaults role to "member" when none supplied', async () => {
    prismaMock.inviteCode.create.mockImplementation(({ data }: any) => ({ id: 'i1', ...data }))

    const created = await createInvite({ createdBy: 'u1' })

    expect(prismaMock.inviteCode.create).toHaveBeenCalledTimes(1)
    const call = prismaMock.inviteCode.create.mock.calls[0][0]
    expect(call.data.role).toBe('member')
    expect(call.data.expiresAt).toBeNull()
    expect(call.data.note).toBeNull()
    expect(created.role).toBe('member')
  })

  it('honors a valid role', async () => {
    prismaMock.inviteCode.create.mockImplementation(({ data }: any) => ({ id: 'i2', ...data }))
    await createInvite({ createdBy: 'u1', role: 'editor' })
    expect(prismaMock.inviteCode.create.mock.calls[0][0].data.role).toBe('editor')
  })

  it('falls back to member for an invalid role string', async () => {
    prismaMock.inviteCode.create.mockImplementation(({ data }: any) => ({ id: 'i3', ...data }))
    await createInvite({ createdBy: 'u1', role: 'owner' as any })
    expect(prismaMock.inviteCode.create.mock.calls[0][0].data.role).toBe('member')
  })

  it('computes expiresAt from expiresHours when positive', async () => {
    prismaMock.inviteCode.create.mockImplementation(({ data }: any) => ({ id: 'i4', ...data }))
    const before = Date.now()
    await createInvite({ createdBy: 'u1', expiresHours: 2 })
    const after = Date.now()

    const call = prismaMock.inviteCode.create.mock.calls[0][0]
    const expiresAt: Date = call.data.expiresAt
    expect(expiresAt).toBeInstanceOf(Date)
    const elapsed = expiresAt.getTime() - before
    expect(elapsed).toBeGreaterThanOrEqual(2 * 60 * 60 * 1000)
    expect(elapsed).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + (after - before) + 50)
  })

  it('leaves expiresAt null when expiresHours is null/undefined/zero', async () => {
    prismaMock.inviteCode.create.mockImplementation(({ data }: any) => ({ id: 'i', ...data }))
    await createInvite({ createdBy: 'u1', expiresHours: null })
    await createInvite({ createdBy: 'u1', expiresHours: undefined })
    await createInvite({ createdBy: 'u1', expiresHours: 0 })

    for (const call of prismaMock.inviteCode.create.mock.calls) {
      expect(call[0].data.expiresAt).toBeNull()
    }
  })

  it('trims and clips note to 200 chars', async () => {
    prismaMock.inviteCode.create.mockImplementation(({ data }: any) => ({ id: 'i', ...data }))
    const longNote = '  ' + 'x'.repeat(300) + '  '
    await createInvite({ createdBy: 'u1', note: longNote })
    const persisted = prismaMock.inviteCode.create.mock.calls[0][0].data.note
    expect(persisted).toHaveLength(200)
    expect(persisted!.startsWith('x')).toBe(true)
  })
})

describe('revokeInvite', () => {
  it('soft-revokes an unused invite by setting revokedAt', async () => {
    prismaMock.inviteCode.findUnique.mockResolvedValueOnce({
      id: 'i1',
      usedBy: null,
      revokedAt: null,
    })
    prismaMock.inviteCode.update.mockResolvedValueOnce({})

    await expect(revokeInvite('i1')).resolves.toBeUndefined()

    const call = prismaMock.inviteCode.update.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'i1' })
    expect(call.data.revokedAt).toBeInstanceOf(Date)
  })

  it('throws NOT_FOUND when invite does not exist', async () => {
    prismaMock.inviteCode.findUnique.mockResolvedValueOnce(null)
    await expect(revokeInvite('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(prismaMock.inviteCode.update).not.toHaveBeenCalled()
  })

  it('throws CONFLICT when invite was already used', async () => {
    prismaMock.inviteCode.findUnique.mockResolvedValueOnce({
      id: 'i1',
      usedBy: 'u9',
      revokedAt: null,
    })
    await expect(revokeInvite('i1')).rejects.toMatchObject({
      code: 'CONFLICT',
    })
    expect(prismaMock.inviteCode.update).not.toHaveBeenCalled()
  })

  it('throws CONFLICT when invite was already revoked', async () => {
    prismaMock.inviteCode.findUnique.mockResolvedValueOnce({
      id: 'i1',
      usedBy: null,
      revokedAt: new Date(),
    })
    await expect(revokeInvite('i1')).rejects.toMatchObject({
      code: 'CONFLICT',
    })
  })
})

describe('assertNotLastActiveAdmin', () => {
  it('is a no-op when target user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null)
    await expect(assertNotLastActiveAdmin('missing')).resolves.toBeUndefined()
    expect(prismaMock.user.count).not.toHaveBeenCalled()
  })

  it('is a no-op when target is not admin', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: 'member',
      isActive: true,
    })
    await expect(assertNotLastActiveAdmin('uM')).resolves.toBeUndefined()
    expect(prismaMock.user.count).not.toHaveBeenCalled()
  })

  it('is a no-op when target admin is already inactive', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: 'admin',
      isActive: false,
    })
    await expect(assertNotLastActiveAdmin('uA')).resolves.toBeUndefined()
    expect(prismaMock.user.count).not.toHaveBeenCalled()
  })

  it('throws CONFLICT when target is the last active admin', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: 'admin',
      isActive: true,
    })
    prismaMock.user.count.mockResolvedValueOnce(0)

    await expect(assertNotLastActiveAdmin('uOnly')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: expect.objectContaining({ reason: 'last_admin' }),
    })

    const where = prismaMock.user.count.mock.calls[0][0].where
    expect(where).toMatchObject({
      role: 'admin',
      isActive: true,
      id: { not: 'uOnly' },
    })
  })

  it('passes when at least one other active admin exists', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({
      role: 'admin',
      isActive: true,
    })
    prismaMock.user.count.mockResolvedValueOnce(2)

    await expect(assertNotLastActiveAdmin('uA')).resolves.toBeUndefined()
  })
})
