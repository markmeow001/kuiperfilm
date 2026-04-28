/**
 * Admin operations shared by /api/admin/* routes.
 *
 * Handles the multi-user system invariants:
 * - Last-active-admin cannot be demoted or disabled (so the team is never
 *   locked out of administration)
 * - Acting admin cannot modify their own role / active state via this path
 *   (prevents accidental self-demotion; admins still flow through normal
 *   profile flows for self-changes)
 * - Roles are constrained to the canonical three: admin / editor / member
 */

import { randomBytes } from 'crypto'
import { ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'
import type { Role } from '@/lib/api-auth'

const VALID_ROLES: Role[] = ['admin', 'editor', 'member']

export function isValidRole(role: unknown): role is Role {
  return typeof role === 'string' && (VALID_ROLES as string[]).includes(role)
}

export function generateInviteCode(): string {
  return randomBytes(12).toString('hex').toUpperCase()
}

/**
 * Throws ApiError('CONFLICT') if changing this user away from admin / disabling
 * them would leave the platform without any active admin.
 */
export async function assertNotLastActiveAdmin(targetUserId: string): Promise<void> {
  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { role: true, isActive: true },
  })
  if (!targetUser) return // caller will surface NOT_FOUND
  if (targetUser.role !== 'admin') return
  if (targetUser.isActive === false) return // already inactive — irrelevant

  const otherActiveAdmins = await prisma.user.count({
    where: {
      role: 'admin',
      isActive: true,
      id: { not: targetUserId },
    },
  })
  if (otherActiveAdmins === 0) {
    throw new ApiError('CONFLICT', {
      message: 'Cannot demote or disable the last active admin',
      reason: 'last_admin',
    })
  }
}

export interface CreateInviteInput {
  role?: Role | null | undefined
  expiresHours?: number | null | undefined
  note?: string | null | undefined
  createdBy: string
}

export async function createInvite(input: CreateInviteInput) {
  const role = input.role && isValidRole(input.role) ? input.role : 'member'
  const expiresAt =
    typeof input.expiresHours === 'number' && input.expiresHours > 0
      ? new Date(Date.now() + input.expiresHours * 60 * 60 * 1000)
      : null
  const note =
    typeof input.note === 'string' && input.note.trim().length > 0
      ? input.note.trim().slice(0, 200)
      : null

  return prisma.inviteCode.create({
    data: {
      code: generateInviteCode(),
      role,
      createdBy: input.createdBy,
      expiresAt,
      note,
    },
  })
}

export async function revokeInvite(inviteId: string): Promise<void> {
  const invite = await prisma.inviteCode.findUnique({ where: { id: inviteId } })
  if (!invite) {
    throw new ApiError('NOT_FOUND', { message: 'Invite not found' })
  }
  if (invite.usedBy || invite.revokedAt) {
    throw new ApiError('CONFLICT', {
      message: 'Invite already used or revoked',
      reason: 'invite_unrevokable',
    })
  }
  await prisma.inviteCode.update({
    where: { id: inviteId },
    data: { revokedAt: new Date() },
  })
}
