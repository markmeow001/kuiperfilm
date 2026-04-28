/**
 * 多人系统升级：把历史遗留 role='user' 的所有用户迁到 role='member'。
 *
 * 设计动机：早期 schema 默认值是 'user'；多人系统改为三角色 admin/editor/member。
 * 运行时已有 normalizeRole() 将 'user' 视同 'member'，但 DB 持久态保留 'user'
 * 会让 admin UI 的过滤、报表、未来索引/约束变复杂，建议一次性矫正。
 *
 * Idempotent — 重复执行只会 update 0 笔。
 *
 * 用法：
 *   pnpm tsx scripts/migrations/migrate-user-role-to-member.ts            # 预览
 *   pnpm tsx scripts/migrations/migrate-user-role-to-member.ts --apply    # 实际写入
 */

import { prisma } from '@/lib/prisma'

const APPLY = process.argv.includes('--apply')

async function main() {
  const legacyCount = await prisma.user.count({ where: { role: 'user' } })
  console.log(`[migrate-role] found ${legacyCount} user(s) with legacy role='user'`)

  if (legacyCount === 0) {
    console.log('[migrate-role] nothing to do.')
    return
  }

  if (!APPLY) {
    const sample = await prisma.user.findMany({
      where: { role: 'user' },
      select: { id: true, name: true, role: true, createdAt: true },
      take: 5,
      orderBy: { createdAt: 'asc' },
    })
    console.log('[migrate-role] preview (first 5):')
    for (const u of sample) {
      console.log(`  - ${u.name} (${u.id}) created=${u.createdAt.toISOString()}`)
    }
    console.log('[migrate-role] re-run with --apply to migrate.')
    return
  }

  const result = await prisma.user.updateMany({
    where: { role: 'user' },
    data: { role: 'member' },
  })
  console.log(`[migrate-role] migrated ${result.count} user(s) from 'user' → 'member'.`)
}

main()
  .catch((err) => {
    console.error('[migrate-role] failed:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
