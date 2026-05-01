import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { logAuthAction } from '@/lib/logging/semantic'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { prisma } from '@/lib/prisma'

/**
 * 多人系统：注册改为「凭邀请码」模式。
 *
 * 流程：
 * 1. 管理员透过 POST /api/admin/invites 生成一段 hex code，发给受邀人
 * 2. 受邀人在 /auth/signup 页面输入 username + password + invite_code
 * 3. 这里验证邀请码（存在 / 未使用 / 未撤销 / 未过期）→ 建账号 + 标记
 *    code 已使用 + 给账号继承邀请码上的 role
 *
 * 任何错误（参数缺失、用户名重复、邀请码无效）都映射到 ApiError，
 * 统一由 apiHandler 序列化为 4xx 响应，避免泄漏内部状态。
 */
export const POST = apiHandler(async (request: NextRequest) => {
  let name = 'unknown'
  const body = await request.json()
  name = body.name || 'unknown'
  const { password, invite_code: inviteCodeRaw, email, displayName } = body

  // 验证输入
  if (!name || !password || !inviteCodeRaw) {
    logAuthAction('REGISTER', name, { error: 'Missing credentials or invite code' })
    throw new ApiError('INVALID_PARAMS')
  }

  if (password.length < 6) {
    logAuthAction('REGISTER', name, { error: 'Password too short' })
    throw new ApiError('INVALID_PARAMS')
  }

  const inviteCode = String(inviteCodeRaw).trim()
  if (!inviteCode) {
    logAuthAction('REGISTER', name, { error: 'Empty invite code' })
    throw new ApiError('INVALID_PARAMS')
  }

  // 透过事务确保「邀请码消耗」与「建账号」是原子的
  const created = await prisma.$transaction(async (tx) => {
    const invite = await tx.inviteCode.findUnique({ where: { code: inviteCode } })
    if (!invite) {
      throw new ApiError('INVALID_PARAMS', { message: 'Invite code not found', reason: 'invite_not_found' })
    }
    if (invite.usedBy) {
      throw new ApiError('INVALID_PARAMS', { message: 'Invite code already used', reason: 'invite_used' })
    }
    if (invite.revokedAt) {
      throw new ApiError('INVALID_PARAMS', { message: 'Invite code has been revoked', reason: 'invite_revoked' })
    }
    if (invite.expiresAt && invite.expiresAt <= new Date()) {
      throw new ApiError('INVALID_PARAMS', { message: 'Invite code has expired', reason: 'invite_expired' })
    }

    // 用户名 / email 唯一性
    const existing = await tx.user.findUnique({ where: { name } })
    if (existing) {
      throw new ApiError('INVALID_PARAMS', { message: 'Username already taken', reason: 'username_taken' })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    // Hard-cap registration to 'member' role regardless of what the
    // invite carries. Background: the previous design let admins
    // generate invites with role=admin, dispatched via UI dropdown,
    // and any invite-bearer who registered inherited that role. User
    // could (and did) accidentally leak admin privileges.
    //
    // New rule: invitations are pure access tokens — they let someone
    // join the system, nothing more. To grant elevated roles, the
    // owning admin promotes via /admin/users AFTER the user signs up.
    // This applies even to invites previously generated with role=admin
    // before the UI was tightened, so revoking + re-creating them is
    // not required to clean up the legacy mistake.
    const newUser = await tx.user.create({
      data: {
        name,
        password: hashedPassword,
        role: 'member',
        ...(typeof email === 'string' && email.length > 0 ? { email } : {}),
        ...(typeof displayName === 'string' && displayName.length > 0
          ? { displayName }
          : {}),
      },
    })

    // 💰 创建用户余额记录（初始余额为0）
    await tx.userBalance.create({
      data: {
        userId: newUser.id,
        balance: 0,
        frozenAmount: 0,
        totalSpent: 0,
      },
    })

    // 标记邀请码已使用
    await tx.inviteCode.update({
      where: { id: invite.id },
      data: {
        usedBy: newUser.id,
        usedAt: new Date(),
      },
    })

    return newUser
  })

  logAuthAction('REGISTER', name, { userId: created.id, success: true })

  return NextResponse.json(
    {
      message: '注册成功',
      user: {
        id: created.id,
        name: created.name,
        role: created.role,
      },
    },
    { status: 201 }
  )
})
