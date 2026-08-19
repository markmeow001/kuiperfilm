/**
 * 🔐 API 权限验证工具
 * 集中管理 Session 验证、项目权限检查等通用逻辑
 */

import { getServerSession } from 'next-auth/next'
import { NextResponse } from 'next/server'
import { headers as readHeaders } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { extractModelKey } from '@/lib/config-service'
import { getErrorSpec, type UnifiedErrorCode } from '@/lib/errors/codes'
import { getLogContext, setLogContext } from '@/lib/logging/context'
import { UserRole, isAdmin } from '@/lib/auth/user-role'

// ============================================================
// 类型定义
// ============================================================

export interface AuthSession {
    user: {
        id: string
        name?: string | null
        email?: string | null
    }
}

function bindAuthLogContext(session: AuthSession, projectId?: string) {
    const context = getLogContext()
    if (!context.requestId) return
    setLogContext({
        userId: session.user.id,
        ...(projectId ? { projectId } : {}),
    })
}

/**
 * Cheap admin-role check, used by `requireProjectAuth` /
 * `requireProjectAuthLight` to allow admin to access any project for
 * support/debug purposes — sister rule to the multi-user inheritance
 * (member inherits admin's keys + models). Only ever called on the
 * cross-user code path (project.userId !== session.user.id), so the
 * extra prisma roundtrip stays off the hot owner-match path.
 */
async function sessionUserIsAdmin(userId: string): Promise<boolean> {
    const user = await withPrismaRetry(() =>
        prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, isActive: true },
        })
    )
    if (!user) return false
    if ((user as { isActive?: boolean }).isActive === false) return false
    return isAdmin((user as { role?: string | null }).role)
}

/**
 * Annotate the log context whenever an admin reaches a project they
 * don't own. LogContext is strictly typed (no free-form fields), so
 * we just rebind the standard userId/projectId pair — the wrapper
 * audit log around requireProjectAuth* already records action+module,
 * which combined with userId being admin's id (vs project ownership
 * inferable from projectId) gives ops enough trail. If we ever need
 * an explicit `adminCrossUser` boolean, extend LogContext first.
 */
function bindAdminCrossUserLog(
    session: AuthSession,
    projectId: string,
    _projectOwnerId: string,
) {
    const context = getLogContext()
    if (!context.requestId) return
    setLogContext({ userId: session.user.id, projectId })
}

/**
 * Workspace-based access helper. Editor sees + edits any project owned
 * by a user that is a member of any workspace the editor manages.
 *
 * Cheap pattern: single indexed prisma lookup against workspace +
 * workspace_member. Only ever called on the cross-user code path
 * (project.userId !== requester.id) AFTER the admin override fails,
 * so the hot owner-match path stays free of extra queries.
 *
 * Multi-tenant org → workspace → member spec (2026-05-02):
 *   - editor creates workspaces (1:N)
 *   - members can join multiple workspaces (M:N)
 *   - editor has full RW on member projects within their workspace
 */
async function editorCanAccessProject(
    requesterId: string,
    projectOwnerId: string,
): Promise<boolean> {
    if (requesterId === projectOwnerId) return true
    const found = await prisma.workspace.findFirst({
        where: {
            ownerEditorId: requesterId,
            members: { some: { userId: projectOwnerId } },
        },
        select: { id: true },
    })
    return !!found
}

/**
 * Same intent as bindAdminCrossUserLog — log breadcrumb when an editor
 * reaches a project they don't own via workspace membership.
 */
function bindEditorCrossUserLog(
    session: AuthSession,
    projectId: string,
    _projectOwnerId: string,
) {
    const context = getLogContext()
    if (!context.requestId) return
    setLogContext({ userId: session.user.id, projectId })
}

async function getInternalTaskSession(): Promise<AuthSession | null> {
    const expectedToken = process.env.INTERNAL_TASK_TOKEN || ''

    const incomingHeaders = await readHeaders()
    const token = incomingHeaders.get('x-internal-task-token') || ''
    const userId = incomingHeaders.get('x-internal-user-id') || ''
    if (!userId) return null
    if (expectedToken) {
        if (token !== expectedToken) return null
    } else if (process.env.NODE_ENV === 'production') {
        return null
    }

    return {
        user: {
            id: userId,
            name: 'internal-worker',
            email: null,
        }
    }
}

/**
 * 可选的关联数据加载配置
 */
export type ProjectAuthIncludes = {
    characters?: boolean
    locations?: boolean
    episodes?: boolean
}

interface AuthCharacterLike {
    name: string
    introduction?: string | null
    [key: string]: unknown
}

interface AuthLocationLike {
    name: string
    [key: string]: unknown
}

interface AuthEpisodeLike {
    id: string
    [key: string]: unknown
}

/**
 * 基础 novelData 类型
 */
export interface NovelDataBase {
    id: string
    [key: string]: unknown
}

/**
 * 根据 include 选项推断的 novelData 类型
 */
export type NovelDataWithIncludes<T extends ProjectAuthIncludes> = NovelDataBase
    & (T['characters'] extends true ? { characters: AuthCharacterLike[] } : Record<string, never>)
    & (T['locations'] extends true ? { locations: AuthLocationLike[] } : Record<string, never>)
    & (T['episodes'] extends true ? { episodes: AuthEpisodeLike[] } : Record<string, never>)

/**
 * 完整的认证上下文（带泛型）
 */
export interface ProjectAuthContextWithIncludes<T extends ProjectAuthIncludes = ProjectAuthIncludes> {
    session: AuthSession
    project: {
        id: string
        userId: string
        name: string
        [key: string]: unknown
    }
    novelData: NovelDataWithIncludes<T>
}

/**
 * 向后兼容的类型别名
 */
export type ProjectAuthContext = ProjectAuthContextWithIncludes<ProjectAuthIncludes>

// ============================================================
// 错误响应工具
// ============================================================

function buildErrorResponse(code: UnifiedErrorCode, message?: string, details: Record<string, unknown> = {}) {
    const spec = getErrorSpec(code)
    const finalMessage = message?.trim() || spec.defaultMessage
    return NextResponse.json(
        {
            success: false,
            error: {
                code,
                message: finalMessage,
                retryable: spec.retryable,
                category: spec.category,
                userMessageKey: spec.userMessageKey,
                details,
            },
            code,
            message: finalMessage,
            ...details,
        },
        { status: spec.httpStatus },
    )
}

export function unauthorized(message = 'Unauthorized') {
    return buildErrorResponse('UNAUTHORIZED', message)
}

export function forbidden(message = 'Forbidden') {
    return buildErrorResponse('FORBIDDEN', message)
}

export function notFound(resource = 'Resource') {
    return buildErrorResponse('NOT_FOUND', `${resource} not found`)
}

export function badRequest(message: string) {
    return buildErrorResponse('INVALID_PARAMS', message)
}

export function serverError(message = 'Internal server error') {
    return buildErrorResponse('INTERNAL_ERROR', message)
}

// ============================================================
// 权限验证函数
// ============================================================

/**
 * 验证用户 Session
 * @returns session 或 null
 */
export async function getAuthSession(): Promise<AuthSession | null> {
    const internalSession = await getInternalTaskSession()
    if (internalSession) return internalSession
    const session = await getServerSession(authOptions)
    return session as AuthSession | null
}

/**
 * 要求用户登录
 * @throws 返回 401 响应
 */
export async function requireAuth(): Promise<AuthSession> {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        throw { response: unauthorized() }
    }
    bindAuthLogContext(session)
    return session
}

/**
 * 验证项目访问权限
 * 包含：Session 验证 + 项目存在检查 + 所有权验证 + NovelPromotionData 检查
 * 
 * @param projectId 项目 ID
 * @param options 可选配置，支持按需加载关联数据
 * @returns 验证上下文（session, project, novelData）
 * @throws 返回对应的错误响应
 * 
 * @example
 * ```typescript
 * // 基础用法（不加载关联数据）
 * const authResult = await requireProjectAuth(projectId)
 * 
 * // 加载 characters 和 locations
 * const authResult = await requireProjectAuth(projectId, {
 *   include: { characters: true, locations: true }
 * })
 * // authResult.novelData.characters 和 locations 自动可用
 * ```
 */
export async function requireProjectAuth<T extends ProjectAuthIncludes = ProjectAuthIncludes>(
    projectId: string,
    options?: { include?: T; action?: 'read' | 'write' }
): Promise<ProjectAuthContextWithIncludes<T> | NextResponse> {
    // 1. 验证 Session
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return unauthorized()
    }
    bindAuthLogContext(session, projectId)

    // 2. 构建动态 include 对象
    const novelPromotionIncludes: Record<string, boolean> = {}
    if (options?.include?.characters) {
        novelPromotionIncludes.characters = true
    }
    if (options?.include?.locations) {
        novelPromotionIncludes.locations = true
    }
    if (options?.include?.episodes) {
        novelPromotionIncludes.episodes = true
    }

    // 3. 获取项目（包含 novelPromotionData 及其可选关联）
    const hasIncludes = Object.keys(novelPromotionIncludes).length > 0
    const project = await withPrismaRetry(() =>
        prisma.project.findUnique({
            where: { id: projectId },
            include: {
                novelPromotionData: hasIncludes
                    ? { include: novelPromotionIncludes }
                    : true
            }
        })
    )

    // 4. 项目存在检查
    //    Phase 12.5 (2026-05-22) — soft-deleted projects are treated
    //    as not-found here. Restore endpoint has a dedicated path that
    //    explicitly reads the deletedAt row.
    if (!project || project.deletedAt) {
        return notFound('Project')
    }

    // 5. 权限验证 — Phase 12.5 (2026-05-22) 8-tier cascade
    //    The cascade now extends beyond owner/admin/ws-owner-editor to
    //    support workspace members + per-project collaborators. Default
    //    action='write' means mutation endpoints automatically reject
    //    viewer-only callers; read endpoints opt-in with action='read'.
    //
    //    Compatibility note: existing 4-tier behavior is preserved
    //    because the cascade's first 3 (+ 3.5 legacy) steps match the
    //    old logic exactly. The NEW steps 4-5 only fire when the
    //    requester is a workspace member / project collaborator —
    //    neither exists in production today, so this is permission-
    //    additive (never subtractive) for existing users.
    const action = options?.action ?? 'write'
    const access = await requireProjectAccess(
        { project: { id: project.id, userId: project.userId, workspaceId: project.workspaceId } },
        session.user.id,
        action,
    )
    if (!access.allowed) {
        if (access.reason === 'NOT_AUTHENTICATED') return unauthorized()
        if (access.reason === 'NOT_FOUND') return notFound('Project')
        return forbidden()
    }
    // Log cross-user access for audit (mirrors pre-existing behavior)
    if (project.userId !== session.user.id) {
        if (access.effectiveRole === UserRole.ADMIN) {
            bindAdminCrossUserLog(session, projectId, project.userId)
        } else if (
            access.effectiveRole === 'ws_owner'
            || access.effectiveRole === 'ws_owner_legacy'
        ) {
            bindEditorCrossUserLog(session, projectId, project.userId)
        }
    }

    // 6. NovelPromotionData 检查
    if (!project.novelPromotionData) {
        return notFound('Novel promotion data')
    }

    // 统一返回 modelKey（provider::modelId），禁止降级为纯 modelId
    const rawNovelData = project.novelPromotionData as {
        analysisModel?: string | null
        characterModel?: string | null
        locationModel?: string | null
        storyboardModel?: string | null
        editModel?: string | null
        videoModel?: string | null
        [key: string]: unknown
    }
    const processedNovelData = {
        ...rawNovelData,
        analysisModel: extractModelKey(rawNovelData.analysisModel),
        characterModel: extractModelKey(rawNovelData.characterModel),
        locationModel: extractModelKey(rawNovelData.locationModel),
        storyboardModel: extractModelKey(rawNovelData.storyboardModel),
        editModel: extractModelKey(rawNovelData.editModel),
        videoModel: extractModelKey(rawNovelData.videoModel),
    }

    return {
        session,
        project,
        novelData: processedNovelData as unknown as NovelDataWithIncludes<T>
    }
}

/**
 * 验证用户是否为管理员
 */
export async function requireAdminAuth(): Promise<{ session: AuthSession } | NextResponse> {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return unauthorized()
    }
    bindAuthLogContext(session)

    const user = await withPrismaRetry(() =>
        prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
    )
    if (!user || !isAdmin((user as { role?: string | null }).role)) {
        return forbidden('Admin access required')
    }
    return { session }
}

/**
 * 仅验证 Session，不检查项目权限
 * 适用于用户级 API（如资产库）
 *
 * @example
 * ```typescript
 * const authResult = await requireUserAuth()
 * if (authResult instanceof NextResponse) return authResult
 *
 * const { session } = authResult
 * ```
 */
export async function requireUserAuth(): Promise<{ session: AuthSession } | NextResponse> {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return unauthorized()
    }
    bindAuthLogContext(session)
    return { session }
}

/**
 * 验证项目权限（不要求 NovelPromotionData）
 * 适用于某些不需要 novelPromotionData 的 API
 */
export async function requireProjectAuthLight(
    projectId: string,
    options?: { action?: 'read' | 'write' }
): Promise<{ session: AuthSession; project: { id: string; userId: string; name: string; [key: string]: unknown } } | NextResponse> {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return unauthorized()
    }
    bindAuthLogContext(session, projectId)

    const project = await withPrismaRetry(() =>
        prisma.project.findUnique({
            where: { id: projectId }
        })
    )

    // Phase 12.5 (2026-05-22) — soft-deleted treated as not-found.
    if (!project || project.deletedAt) {
        return notFound('Project')
    }

    // Phase 12.5 (2026-05-22) — 8-tier cascade with default action='write'.
    // See requireProjectAuth above for the full rationale.
    const action = options?.action ?? 'write'
    const access = await requireProjectAccess(
        { project: { id: project.id, userId: project.userId, workspaceId: project.workspaceId } },
        session.user.id,
        action,
    )
    if (!access.allowed) {
        if (access.reason === 'NOT_AUTHENTICATED') return unauthorized()
        if (access.reason === 'NOT_FOUND') return notFound('Project')
        return forbidden()
    }
    if (project.userId !== session.user.id) {
        if (access.effectiveRole === UserRole.ADMIN) {
            bindAdminCrossUserLog(session, projectId, project.userId)
        } else if (
            access.effectiveRole === 'ws_owner'
            || access.effectiveRole === 'ws_owner_legacy'
        ) {
            bindEditorCrossUserLog(session, projectId, project.userId)
        }
    }

    return { session, project }
}

// ============================================================
// Phase 12.5 (2026-05-22) — 8-tier project access cascade
// ============================================================

/**
 * Effective role that grants the requester access to a project.
 *
 * - owner            — R == project.userId (cascade step 1)
 * - admin            — R.role == 'admin' (step 2)
 * - ws_owner         — R == project.workspace.ownerEditorId (step 3, NEW)
 * - ws_owner_legacy  — R is editor of any workspace containing project.userId
 *                      as member (step 3.5 LEGACY, kept for projects with
 *                      workspaceId=NULL until Phase 2 migration)
 * - editor           — ProjectCollaborator(R, project, editor) OR
 *                      WorkspaceMember(project.workspace, R, editor)
 * - viewer           — same as editor but role=viewer; only allows read
 */
export type ProjectAccessRole =
    | 'owner'
    | 'admin'
    | 'ws_owner'
    | 'ws_owner_legacy'
    | 'editor'
    | 'viewer'

export interface ProjectAccessAllowed {
    allowed: true
    /** Which cascade step granted access — useful for logging + Phase 2 deprecation tracking. */
    effectiveRole: ProjectAccessRole
}

export interface ProjectAccessDenied {
    allowed: false
    /** Machine-readable denial reason. */
    reason:
        | 'NOT_FOUND'
        | 'NOT_AUTHENTICATED'
        | 'NO_ACCESS'
        | 'VIEWER_CANNOT_WRITE'
}

export type ProjectAccessResult = ProjectAccessAllowed | ProjectAccessDenied

/**
 * 8-tier project access cascade. Replaces the 4-tier `requireProjectAuth`
 * for new code paths; the old helper remains for incremental migration.
 *
 * Cascade (full ordering, see docs/plans/workspace-collaboration-spec.md §4):
 *
 *   1. R == project.userId                              → owner (read+write)
 *   2. R.role == 'admin'                                 → admin (read+write)
 *   3. project.workspaceId set AND
 *      R == project.workspace.ownerEditorId             → ws_owner (read+write)
 *   3.5 [LEGACY] R is editor of any workspace
 *       containing project.userId as member             → ws_owner_legacy (read+write)
 *       — only fires when steps 3 doesn't match. Will be removed in Phase 2
 *       once all projects have explicit workspaceId.
 *   4. ProjectCollaborator(project, R) exists           → role-based
 *   5. WorkspaceMember(project.workspace, R) exists     → role-based
 *   6. else                                              → NO_ACCESS
 *
 * For action='write': only editor-role passes at steps 4-5
 * For action='read':  both editor and viewer pass
 *
 * Implementation note: this function ONLY runs DB queries on cross-user
 * paths. Steps 1-2 short-circuit before touching workspace/collaborator
 * tables, so the hot owner/admin path stays cheap.
 *
 * @param projectIdOrParams Either the project id directly, or an object
 *                          carrying the pre-fetched project (saves a DB
 *                          query when caller already has the row).
 * @param requesterId       The session user id.
 * @param action            'read' or 'write'.
 */
export async function requireProjectAccess(
    projectIdOrParams:
        | string
        | { project: { id: string; userId: string; workspaceId?: string | null } },
    requesterId: string,
    action: 'read' | 'write',
): Promise<ProjectAccessResult> {
    if (!requesterId) {
        return { allowed: false, reason: 'NOT_AUTHENTICATED' }
    }

    // Resolve project. Caller may pre-fetch for cheap lookups; otherwise
    // we hit the DB. Selecting only fields needed for the cascade keeps
    // the query light.
    let project: { id: string; userId: string; workspaceId: string | null }
    if (typeof projectIdOrParams === 'string') {
        const row = await prisma.project.findUnique({
            where: { id: projectIdOrParams },
            select: { id: true, userId: true, workspaceId: true, deletedAt: true },
        })
        if (!row || row.deletedAt) {
            // Soft-deleted projects are NOT_FOUND for non-admin callers.
            // Admin restore endpoint uses a separate query path that
            // honors deletedAt explicitly.
            return { allowed: false, reason: 'NOT_FOUND' }
        }
        project = { id: row.id, userId: row.userId, workspaceId: row.workspaceId }
    } else {
        project = {
            id: projectIdOrParams.project.id,
            userId: projectIdOrParams.project.userId,
            workspaceId: projectIdOrParams.project.workspaceId ?? null,
        }
    }

    // Step 1: owner always wins.
    if (project.userId === requesterId) {
        return { allowed: true, effectiveRole: UserRole.OWNER }
    }

    // Step 2: admin bypass.
    const requester = await prisma.user.findUnique({
        where: { id: requesterId },
        select: { role: true },
    })
    if (isAdmin(requester?.role)) {
        return { allowed: true, effectiveRole: UserRole.ADMIN }
    }

    // Step 3: workspace owner editor via explicit P.workspaceId.
    if (project.workspaceId) {
        const ws = await prisma.workspace.findUnique({
            where: { id: project.workspaceId },
            select: { ownerEditorId: true },
        })
        if (ws?.ownerEditorId === requesterId) {
            return { allowed: true, effectiveRole: 'ws_owner' }
        }
    }

    // Step 3.5 [LEGACY]: editorCanAccessProject preserves existing 4-tier
    // behavior for projects with workspaceId=NULL. Will be removed once
    // all projects have explicit workspaceId (Phase 2 migration).
    // Explicitly-scoped projects must never inherit access from an unrelated
    // legacy workspace owned by the requester.
    if (project.workspaceId === null) {
        const legacyAllowed = await editorCanAccessProject(requesterId, project.userId)
        if (legacyAllowed) {
            return { allowed: true, effectiveRole: 'ws_owner_legacy' }
        }
    }

    // Step 4: per-project collaborator (explicit grant, overrides workspace default).
    const collab = await prisma.projectCollaborator.findUnique({
        where: { projectId_userId: { projectId: project.id, userId: requesterId } },
        select: { role: true },
    })
    if (collab) {
        if (action === 'read') {
            return { allowed: true, effectiveRole: collab.role === UserRole.EDITOR ? UserRole.EDITOR : UserRole.VIEWER }
        }
        if (collab.role === UserRole.EDITOR) {
            return { allowed: true, effectiveRole: UserRole.EDITOR }
        }
        return { allowed: false, reason: 'VIEWER_CANNOT_WRITE' }
    }

    // Step 5: workspace member role (default for the workspace).
    if (project.workspaceId) {
        const wm = await prisma.workspaceMember.findUnique({
            where: {
                workspaceId_userId: {
                    workspaceId: project.workspaceId,
                    userId: requesterId,
                },
            },
            select: { role: true },
        })
        if (wm) {
            if (action === 'read') {
                return { allowed: true, effectiveRole: wm.role === UserRole.EDITOR ? UserRole.EDITOR : UserRole.VIEWER }
            }
            if (wm.role === UserRole.EDITOR) {
                return { allowed: true, effectiveRole: UserRole.EDITOR }
            }
            return { allowed: false, reason: 'VIEWER_CANNOT_WRITE' }
        }
    }

    // Step 6: no access.
    return { allowed: false, reason: 'NO_ACCESS' }
}

// ============================================================
// 类型守卫
// ============================================================

/**
 * 检查是否是错误响应
 */
export function isErrorResponse(result: unknown): result is NextResponse {
    return result instanceof NextResponse
}

// ============================================================
// 多人系统：角色权限（admin / editor / member）
// ============================================================

export type Role = 'admin' | 'editor' | 'member'

/**
 * 角色階級 (2026-05-02 多人化重構):
 *
 *   admin > editor > member
 *
 * `roleAtLeast(role, threshold)` 回傳 `role` 是否至少達到 `threshold`:
 *   - threshold='admin'  → 只認 admin
 *   - threshold='editor' → 認 admin 或 editor (admin 自動覆蓋 editor 權限)
 *   - threshold='member' → 認任何已 active 的角色
 *
 * 使用情境:
 *   - 工作區 / Org CRUD 入口檢查 (editor 跟 admin 都能建)
 *   - 加 / 踢 workspace member (workspace owner 跟 admin 都能做)
 *   - admin-only routes 直接 requireAdminAuth() 就好,這個 helper 是
 *     給「至少要 editor」這種兩級允許場景。
 *
 * 不查 isActive (假設 caller 已 requireUserAuth 拿過 session,
 * isActive 由 NextAuth signin flow 攔截)。也不查 DB,純參數函式。
 */
export function roleAtLeast(
    role: string | null | undefined,
    threshold: 'admin' | 'editor' | 'member',
): boolean {
    if (threshold === UserRole.ADMIN) return role === UserRole.ADMIN
    if (threshold === UserRole.EDITOR) return role === UserRole.ADMIN || role === UserRole.EDITOR
    // 'member' tier 等同 D-1 7-role 拍板前的 legacy 三角色。
    // VIEWER 是 D-1 新加 role，是否視為「至少 member」是 D-1 設計題，
    // 不在 Phase 4.0 refactor 範圍 — 保留原本三角色語義。
    return role === UserRole.ADMIN || role === UserRole.EDITOR || role === UserRole.MEMBER
}

/**
 * 验证用户至少拥有指定角色之一。admin 自动通过任何角色检查。
 *
 * 角色含义（与团队共享语义对齐）：
 * - admin: 全部资料 + 管理使用者 / 邀请码
 * - editor: 自己的 Project + 团队共享 Global 资产的读写
 * - member: 自己的 Project + 团队共享 Global 资产的只读
 *
 * 也会一并检查 isActive — 已停用的帐号不可访问任何受保护 API。
 *
 * @example
 * ```typescript
 * const authResult = await requireRoleAuth(['editor'])
 * if (authResult instanceof NextResponse) return authResult
 * const { session, role } = authResult
 * ```
 */
export async function requireRoleAuth(
    allowed: Role[]
): Promise<{ session: AuthSession; role: Role } | NextResponse> {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return unauthorized()
    }
    bindAuthLogContext(session)

    const user = await withPrismaRetry(() =>
        prisma.user.findUnique({
            where: { id: session.user.id },
            select: { role: true, isActive: true }
        })
    )
    if (!user) {
        return unauthorized()
    }
    if ((user as { isActive?: boolean }).isActive === false) {
        return forbidden('Account is disabled')
    }
    const role = normalizeRole(user.role)
    // admin always passes; otherwise role must be in the allowed list.
    if (role !== UserRole.ADMIN && !allowed.includes(role)) {
        return forbidden('Insufficient role')
    }
    return { session, role }
}

/**
 * 将持久层的 role 字段映射到统一的三角色枚举。
 *
 * 历史遗留：Schema 早期版本默认 role = 'user'。多人系统改用 admin/editor/member
 * 三角色，所以 'user' 视同 'member'（最低权限）。一次性迁移脚本：
 * `scripts/migrations/migrate-user-role-to-member.ts`
 */
function normalizeRole(rawRole: string | null | undefined): Role {
    if (rawRole === UserRole.ADMIN || rawRole === UserRole.EDITOR || rawRole === UserRole.MEMBER) {
        return rawRole
    }
    // legacy 'user' 或未知值都归到最低权限。
    return UserRole.MEMBER
}

/**
 * 验证用户至少是 editor（admin/editor 都通过）。
 * 用于团队共享资产的写操作（GlobalCharacter / GlobalLocation 等）。
 */
export async function requireEditorAuth(): Promise<{ session: AuthSession; role: Role } | NextResponse> {
    return requireRoleAuth([UserRole.EDITOR])
}
