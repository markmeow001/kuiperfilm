/**
 * Phase 12.5 (2026-05-22) — Backfill workspace collaboration defaults.
 *
 * Runs AFTER scripts/migrations/2026-05-22-workspace-collab.sql has
 * created the new columns/tables. Brings existing data to the right
 * defaults so the 4-tier → 8-tier auth cascade migration is a no-op
 * for existing users (no silent permission regressions).
 *
 * Two backfills:
 *
 *   1. WorkspaceMember.role — every existing row gets `editor`.
 *      The column's DDL default is `viewer` (per spec Decision 1B,
 *      NEW invites should land as viewer for safety). But applying
 *      that default to EXISTING rows would silently strip RW access
 *      from people who already had it via the legacy 4-tier cascade
 *      (workspace owner editor + member). So existing rows must be
 *      written to `editor` to preserve the behavior they had
 *      yesterday.
 *
 *   2. Project.workspaceId — stays NULL for ALL existing projects.
 *      This is already the column default; the script verifies (no
 *      rogue migrations) and reports the count.
 *
 * Idempotency:
 *   - Running this script twice MUST produce the same end state.
 *   - Tested by re-running and comparing row counts before/after.
 *   - The WorkspaceMember update uses `where: { role: 'viewer' }` so
 *     re-running only touches rows the script hasn't touched yet (or
 *     newly inserted viewer-default rows added by post-deploy invites).
 *     This means a 2nd-run on a healthy prod will write 0 rows.
 *
 * ⚠️ Run AFTER SQL migration but BEFORE code deploy:
 *
 *   ssh root@137.184.64.179
 *   cd /opt/kuiperAI
 *   # 1. apply SQL first (see 2026-05-22-workspace-collab.sql header)
 *   # 2. run this backfill (inside the app container, has DATABASE_URL):
 *   docker compose -p deploy -f deploy/docker-compose.prod.yml exec app \
 *     npx tsx scripts/migrations/backfill-workspace-collab.ts --apply
 *   # 3. then code deploy
 *
 * Dry-run (safe, prints what would change):
 *   npx tsx scripts/migrations/backfill-workspace-collab.ts
 *
 * Apply:
 *   npx tsx scripts/migrations/backfill-workspace-collab.ts --apply
 */

import { prisma } from '@/lib/prisma'
import { logInfo, logWarn } from '@/lib/logging/core'

interface BackfillStats {
  /** Existing WorkspaceMember rows found before backfill. */
  workspaceMembersTotal: number
  /** Rows still at DDL default `viewer` (needing upgrade to `editor`). */
  workspaceMembersToUpgrade: number
  /** Rows already at `editor` (idempotent re-run, no-op). */
  workspaceMembersAlreadyEditor: number
  /** Rows actually written in apply mode. */
  workspaceMembersUpgraded: number
  /** Total Project rows (sanity check). */
  projectsTotal: number
  /** Projects with workspaceId set (sanity — should be 0 on first run). */
  projectsWithWorkspace: number
}

export async function backfillWorkspaceCollab(opts: { apply: boolean }): Promise<BackfillStats> {
  const stats: BackfillStats = {
    workspaceMembersTotal: 0,
    workspaceMembersToUpgrade: 0,
    workspaceMembersAlreadyEditor: 0,
    workspaceMembersUpgraded: 0,
    projectsTotal: 0,
    projectsWithWorkspace: 0,
  }

  // ─── 1. Inspect current state ─────────────────────────────────────

  stats.workspaceMembersTotal = await prisma.workspaceMember.count()
  stats.workspaceMembersAlreadyEditor = await prisma.workspaceMember.count({
    where: { role: 'editor' },
  })
  stats.workspaceMembersToUpgrade = await prisma.workspaceMember.count({
    where: { role: 'viewer' },
  })

  stats.projectsTotal = await prisma.project.count()
  stats.projectsWithWorkspace = await prisma.project.count({
    where: { workspaceId: { not: null } },
  })

  logInfo('[backfill-workspace-collab] state before backfill', {
    workspaceMembersTotal: stats.workspaceMembersTotal,
    workspaceMembersToUpgrade: stats.workspaceMembersToUpgrade,
    workspaceMembersAlreadyEditor: stats.workspaceMembersAlreadyEditor,
    projectsTotal: stats.projectsTotal,
    projectsWithWorkspace: stats.projectsWithWorkspace,
  })

  // ─── 2. Sanity check ──────────────────────────────────────────────

  if (stats.workspaceMembersTotal !== stats.workspaceMembersToUpgrade + stats.workspaceMembersAlreadyEditor) {
    // Should never happen — WorkspaceRole enum is only { editor, viewer }.
    // Log loudly but don't fail; counts may include other-state rows we can't see.
    logWarn('[backfill-workspace-collab] count mismatch — viewer + editor != total', {
      total: stats.workspaceMembersTotal,
      viewer: stats.workspaceMembersToUpgrade,
      editor: stats.workspaceMembersAlreadyEditor,
    })
  }

  // ─── 3. Apply (or dry-run) ────────────────────────────────────────

  if (!opts.apply) {
    logInfo('[backfill-workspace-collab] DRY-RUN. Use --apply to write.', {
      wouldUpgrade: stats.workspaceMembersToUpgrade,
    })
    return stats
  }

  if (stats.workspaceMembersToUpgrade === 0) {
    logInfo('[backfill-workspace-collab] nothing to do (all rows already editor or no rows exist)')
    return stats
  }

  // Bulk update — single UPDATE statement is fine, this is a one-time
  // migration on a small table (< 1000 rows expected). updateMany returns
  // the count of affected rows for verification.
  const result = await prisma.workspaceMember.updateMany({
    where: { role: 'viewer' },
    data: { role: 'editor' },
  })
  stats.workspaceMembersUpgraded = result.count

  logInfo('[backfill-workspace-collab] applied', {
    upgraded: stats.workspaceMembersUpgraded,
    expectedUpgrade: stats.workspaceMembersToUpgrade,
  })

  if (stats.workspaceMembersUpgraded !== stats.workspaceMembersToUpgrade) {
    logWarn('[backfill-workspace-collab] upgrade count != expected', {
      upgraded: stats.workspaceMembersUpgraded,
      expected: stats.workspaceMembersToUpgrade,
    })
  }

  // ─── 4. Verify post-state ─────────────────────────────────────────

  const finalViewers = await prisma.workspaceMember.count({
    where: { role: 'viewer' },
  })
  const finalEditors = await prisma.workspaceMember.count({
    where: { role: 'editor' },
  })

  logInfo('[backfill-workspace-collab] state after backfill', {
    finalViewers,
    finalEditors,
    expectedFinalViewers: 0,
    expectedFinalEditors: stats.workspaceMembersTotal,
  })

  if (finalViewers !== 0) {
    logWarn('[backfill-workspace-collab] some viewers remain after backfill', {
      finalViewers,
    })
  }

  return stats
}

async function main() {
  const apply = process.argv.includes('--apply')
  if (!apply) {
    logInfo('[backfill-workspace-collab] DRY-RUN mode. Use --apply to write.')
  }
  await backfillWorkspaceCollab({ apply })
}

if (require.main === module) {
  main()
    .catch((err) => {
      logWarn('[backfill-workspace-collab] fatal', {
        error: err instanceof Error ? err.message : String(err),
      })
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}
