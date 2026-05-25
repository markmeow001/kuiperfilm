/**
 * Phase 12.5 — explicit audit log helper.
 *
 * Per spec §9.5 #4 and CLAUDE.md ("不打補丁 / 不隱式回退"), audit
 * is captured by EXPLICIT call sites, not a Prisma `$extends` extension.
 * Trade-off accepted: caller must remember to log. Win: every audit
 * entry is grep-able to a specific call site, no hidden behavior at
 * the ORM layer.
 *
 * Narrow scope in v1:
 *   - Project: soft-delete, restore
 *   - ProjectCollaborator: add (upsert), remove, role-change
 *   - EditRequest: approve, deny, withdraw
 *   - WorkspaceMember: add, remove, role-change
 *
 * Explicitly NOT logged: Panel / Character / Storyboard mutations.
 * Worker writes them hundreds of times per run; the noise + DB cost
 * isn't worth it. Add later if security-review demand exists.
 *
 * Gated by AUDIT_LOG_ENABLED=true env — flipping off is a one-line
 * kill switch if audit writes start misbehaving in prod.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Either the global Prisma client or a transactional one (passed
 * inside `prisma.$transaction(async (tx) => ...)`). When called from
 * within a tx, audit row commits/rolls back atomically with parent.
 */
export type AuditClient = typeof prisma | Prisma.TransactionClient

/** Canonical action verbs. Add new ones here — keeps reporting consistent. */
export type AuditAction =
  | 'project.soft_delete'
  | 'project.restore'
  | 'project.update'
  | 'collaborator.add'
  | 'collaborator.remove'
  | 'collaborator.role_change'
  | 'edit_request.create'
  | 'edit_request.approve'
  | 'edit_request.deny'
  | 'edit_request.withdraw'
  | 'workspace_member.add'
  | 'workspace_member.remove'
  | 'workspace_member.role_change'

export type AuditEntityType =
  | 'Project'
  | 'ProjectCollaborator'
  | 'EditRequest'
  | 'WorkspaceMember'

export interface RecordAuditParams {
  userId: string
  action: AuditAction
  entityType: AuditEntityType
  entityId: string
  /** Project the action affects. Null for workspace-level actions. */
  projectId?: string | null
  /** Optional pre-mutation snapshot. JSON-serialisable. Use only for
   *  destructive actions (delete) where restore needs the prior state. */
  snapshot?: Record<string, unknown> | null
}

const ENABLED = process.env.AUDIT_LOG_ENABLED === 'true'

/**
 * Insert an audit log row. Never throws — on failure logs warn so
 * a broken audit subsystem cannot block user mutations.
 *
 * When called inside a `prisma.$transaction(async tx => ...)`, pass
 * the tx client so the audit row participates in the same atomic unit.
 */
export async function recordAudit(
  client: AuditClient,
  params: RecordAuditParams,
): Promise<void> {
  if (!ENABLED) return
  try {
    await client.auditLog.create({
      data: {
        userId: params.userId,
        projectId: params.projectId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        snapshot: (params.snapshot ?? null) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      },
    })
  } catch (err) {
    // Audit failure is non-fatal — never break the user mutation
    // because audit had a hiccup. Warn so it shows up in logs.
    console.warn('[audit-log] insert failed', {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
