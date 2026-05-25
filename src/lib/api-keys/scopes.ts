/**
 * Public API scope enumeration — Phase 5 (2026-05-25).
 *
 * Mirrors the PolyFilm scope set minus their `register-character` (which
 * is product-name specific to their brand and clashes with our standalone
 * 火山 asset registration flow). Workspace owners pick a subset when
 * creating a key; the public API middleware checks the picked subset at
 * each endpoint via `requireScope(...)`.
 *
 * Naming convention:
 *   - `read` — broad read access to all workspace resources
 *   - `<resource>.write` — mutate a specific resource family
 *   - `<resource>.manage` — administrative ops (e.g. webhooks reg/list/delete)
 *
 * Future scopes (NOT yet enabled, future-proofing the enum is intentional):
 *   - `vendors.write` — pick which video provider per call (multi-vendor
 *     is a KuiperAI differentiator, deferred until Phase 6 :produce ships)
 *   - `ark.register` — explicit 火山 asset register grant when we
 *     re-enable that pipeline
 */

export const PUBLIC_API_SCOPES = [
  'read',
  'scripts.write',
  'storyboards.write',
  'production.write',
  'projects.write',
  'assets.write',
  'videos.write',
  'webhooks.manage',
] as const

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number]

/**
 * Human-readable label + description, used by /workspaces/[id]/developer
 * checkbox list. Order matches PUBLIC_API_SCOPES so the UI is deterministic.
 */
export const SCOPE_LABELS: Record<PublicApiScope, { zh: string; en: string; description: string }> = {
  read: {
    zh: '读取',
    en: 'read',
    description: '读取资源(项目/剧本/分镜/角色/场景/视频)',
  },
  'scripts.write': {
    zh: '剧本写入',
    en: 'scripts.write',
    description: '上传/替换剧本(支持 ======== 分段)',
  },
  'storyboards.write': {
    zh: '分镜写入',
    en: 'storyboards.write',
    description: '触发分镜生成',
  },
  'production.write': {
    zh: '一键生产',
    en: 'production.write',
    description: '一键全流程 produce(剧本 → 分镜 → 角色 → 视频)',
  },
  'projects.write': {
    zh: '项目写入',
    en: 'projects.write',
    description: '创建项目、单集',
  },
  'assets.write': {
    zh: '素材写入',
    en: 'assets.write',
    description: '生成角色/场景/道具',
  },
  'videos.write': {
    zh: '视频写入',
    en: 'videos.write',
    description: '触发 Seedance 视频生成',
  },
  'webhooks.manage': {
    zh: 'Webhook 管理',
    en: 'webhooks.manage',
    description: '注册/管理回调 webhook',
  },
}

export function isValidScope(value: string): value is PublicApiScope {
  return (PUBLIC_API_SCOPES as readonly string[]).includes(value)
}

/** Throws if any entry in `scopes` is not a recognized scope. */
export function assertValidScopes(scopes: string[]): asserts scopes is PublicApiScope[] {
  for (const s of scopes) {
    if (!isValidScope(s)) {
      throw new Error(`INVALID_SCOPE: ${s} is not a recognized scope (allowed: ${PUBLIC_API_SCOPES.join(', ')})`)
    }
  }
}

/**
 * True if the key's scopes satisfy the required scope. `read` is
 * deliberately NOT inferred from any `.write` scope — write access for
 * resource X doesn't imply read access for resource Y. This matches
 * principle of least privilege.
 *
 * The one shortcut: `*.write` implies the corresponding `read` only when
 * read is on the same resource family — but since `read` is a single
 * top-level scope (not resource-scoped), we don't grant it implicitly.
 * Callers asking for `read` must have `read` explicitly.
 */
export function hasScope(grantedScopes: readonly string[], required: PublicApiScope): boolean {
  return grantedScopes.includes(required)
}
