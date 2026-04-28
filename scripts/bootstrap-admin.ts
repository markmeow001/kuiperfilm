/**
 * 多人系统：初始化管理员帐号 + 一张可立即使用的邀请码。
 *
 * 适用情境：
 * - 首次部署 / 任何 DB 中尚无 admin 时
 * - CI 测试种子
 *
 * Idempotent — 已经有 admin 时不会重复建账号，但仍可选择 --rotate-invite
 * 重新生成一张 admin 邀请码（避免每次都看到 stale code）。
 *
 * 用法（必备 env）：
 *   ADMIN_USERNAME=admin
 *   ADMIN_PASSWORD=<至少 8 字元的强密码>
 *   ADMIN_EMAIL=admin@example.com  (选填)
 *
 *   pnpm tsx scripts/bootstrap-admin.ts
 *   pnpm tsx scripts/bootstrap-admin.ts --rotate-invite
 */

import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

const ROTATE_INVITE = process.argv.includes('--rotate-invite')

function generateInviteCode(): string {
  return randomBytes(12).toString('hex').toUpperCase()
}

async function ensureAdmin(username: string, password: string, email?: string) {
  const existingAdmin = await prisma.user.findFirst({ where: { role: 'admin' } })
  if (existingAdmin) {
    console.log(`[bootstrap] admin already exists: ${existingAdmin.name} (id=${existingAdmin.id})`)
    return existingAdmin
  }

  const hashed = await bcrypt.hash(password, 12)
  const admin = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: username,
        password: hashed,
        role: 'admin',
        isActive: true,
        ...(email ? { email } : {}),
      },
    })
    await tx.userBalance.create({
      data: {
        userId: created.id,
        balance: 0,
        frozenAmount: 0,
        totalSpent: 0,
      },
    })
    return created
  })
  console.log(`[bootstrap] created admin: ${admin.name} (id=${admin.id})`)
  return admin
}

async function ensureBootstrapInvite(adminId: string, force: boolean) {
  if (!force) {
    const existing = await prisma.inviteCode.findFirst({
      where: { createdBy: adminId, usedBy: null, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) {
      console.log(`[bootstrap] reusing existing usable invite: ${existing.code} (role=${existing.role})`)
      return existing
    }
  }
  const invite = await prisma.inviteCode.create({
    data: {
      code: generateInviteCode(),
      role: 'admin',
      createdBy: adminId,
      note: 'bootstrap-admin script',
    },
  })
  console.log(`[bootstrap] created invite: ${invite.code} (role=${invite.role})`)
  return invite
}

async function main() {
  const username = (process.env.ADMIN_USERNAME || '').trim()
  const password = process.env.ADMIN_PASSWORD || ''
  const email = (process.env.ADMIN_EMAIL || '').trim() || undefined

  if (!username || !password) {
    console.error('[bootstrap] ADMIN_USERNAME and ADMIN_PASSWORD must be set.')
    console.error('[bootstrap] example:')
    console.error('  ADMIN_USERNAME=admin ADMIN_PASSWORD=ChangeMeNow! pnpm tsx scripts/bootstrap-admin.ts')
    process.exitCode = 1
    return
  }
  if (password.length < 8) {
    console.error('[bootstrap] ADMIN_PASSWORD must be at least 8 characters.')
    process.exitCode = 1
    return
  }

  const admin = await ensureAdmin(username, password, email)
  await ensureBootstrapInvite(admin.id, ROTATE_INVITE)

  console.log('[bootstrap] done.')
}

main()
  .catch((err) => {
    console.error('[bootstrap] failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
