/**
 * UserRole — org-level role enum constant
 *
 * D-1 (2026-05-30) 拍板 7-role 全套對齊 K-openapi.yaml UserRole enum。
 * Phase 4.0 (2026-05-31) 補：把 codebase 散落的 "admin" / "editor" / "member"
 * 字串比對改成 UserRole.X 引用，避免新人 / AI 寫死錯字。
 *
 * 注意：
 *   - DB 仍是 `String @default("member")`（Phase 4.1 才改 schema enum）
 *   - 因此 enum value 必須跟 DB 字串一致（小寫）
 *   - "member" 是 legacy default，語義等同 "viewer"
 *     新註冊用戶在 Phase 4.1 schema migration 後預設 "viewer"
 *
 * Role 階層（從強到弱）：
 *   OWNER       — workspace 創建者，可刪 workspace / 轉移所有權
 *   ADMIN       — 管理員，邀請 / 移除成員、改 billing
 *   EDITOR      — 創建編輯所有 project
 *   COMMENTER   — 可看 + 留言 + react
 *   VIEWER      — 唯讀（取代 LEGACY "member" 字串）
 *   BILLING     — 只看帳單 + 升降級（給財務專用）
 *   GUEST       — 公開 share 已登入訪客
 */

export const UserRole = {
  OWNER: 'owner',
  ADMIN: 'admin',
  EDITOR: 'editor',
  COMMENTER: 'commenter',
  VIEWER: 'viewer',
  BILLING: 'billing',
  GUEST: 'guest',
  /** @deprecated Use VIEWER instead. Backwards-compat for existing DB rows. */
  MEMBER: 'member',
} as const

export type UserRole = typeof UserRole[keyof typeof UserRole]

/**
 * 所有合法 role string 集合（含 legacy "member"）。
 * 給 zod schema / runtime validate 用。
 */
export const ALL_USER_ROLES = Object.values(UserRole) as readonly UserRole[]

/**
 * 7-role canonical（不含 legacy "member"）— 給未來 DB schema 拍板用。
 */
export const CANONICAL_USER_ROLES: readonly UserRole[] = [
  UserRole.OWNER,
  UserRole.ADMIN,
  UserRole.EDITOR,
  UserRole.COMMENTER,
  UserRole.VIEWER,
  UserRole.BILLING,
  UserRole.GUEST,
]

/**
 * 判斷是否為合法 role string。
 */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ALL_USER_ROLES as readonly string[]).includes(value)
}

/**
 * Legacy "member" → "viewer" 的語義映射。
 * 用在 UI 顯示 / 權限判斷時，把 legacy "member" 視為 viewer。
 *
 * 注意：**這函數不改 DB**，只是 read-side normalize。
 * DB 真正 backfill "member"→"viewer" 是 Phase 4.1 migration 才做。
 */
export function normalizeUserRole(value: string | null | undefined): UserRole {
  if (!value || !isUserRole(value)) return UserRole.VIEWER  // 未知 / null 視為最弱權限
  if (value === UserRole.MEMBER) return UserRole.VIEWER
  return value
}

/**
 * 判斷是否為 admin（org-level admin）。
 * 取代散落各處的 `user.role === "admin"` 字串比對。
 */
export function isAdmin(role: string | null | undefined): boolean {
  return role === UserRole.ADMIN
}

/**
 * 判斷是否為 owner（org-level owner — D-1 新加，未來才會出現）。
 */
export function isOwner(role: string | null | undefined): boolean {
  return role === UserRole.OWNER
}

/**
 * 判斷是否為 admin OR owner（多數權限檢查的高位 role）。
 * 取代 `user.role === "admin"` 在「需要管理權限」場景的用法。
 */
export function isAdminOrOwner(role: string | null | undefined): boolean {
  return role === UserRole.ADMIN || role === UserRole.OWNER
}
