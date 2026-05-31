/**
 * Multi-user preference inheritance — non-admin members inherit admin's
 * model selections + workflow settings whenever the project (or their
 * own user_preferences) leaves a field NULL.
 *
 * This complements:
 *   - Worker-side admin fallback (commit a15bad0 — analyze, character
 *     profile, shot AI persist) which lets background tasks resolve a
 *     model when the project doesn't have one set.
 *   - Project creation copy-from-admin (src/app/api/projects/route.ts)
 *     which seeds new projects with admin's defaults at write time.
 *
 * The remaining gap was the read-side: existing projects created BEFORE
 * a15bad0 still have NULL model fields, and the v2 storyboard UI gates
 * (e.g. "請先在 profile 中選擇視頻模型") read directly off
 * project.novelPromotionData.videoModel and refuse to proceed.
 *
 * `applyAdminFallbackToNovelPromotionProject` patches the response in
 * place: any model field still null after the project + user-pref pass
 * gets filled from admin's UserPreference. The injection is FE-only
 * (response shaping) — DB rows stay null until the project owner
 * explicitly picks a model. Backfilling at write time was deliberately
 * avoided so a future "admin changes the team's default video model"
 * flows to every project automatically rather than freezing each
 * project at the value at creation time.
 *
 * Usage (called from any route that returns NovelPromotionProject to
 * the client):
 *
 *   const novelPromotionData = await prisma.novelPromotionProject.findUnique({...})
 *   if (novelPromotionData) {
 *     await applyAdminFallbackToNovelPromotionProject({
 *       requestUserId: session.user.id,
 *       data: novelPromotionData,
 *     })
 *   }
 */

import { prisma } from '@/lib/prisma'
import { UserRole } from '@/lib/auth/user-role'

/**
 * Fields on novel_promotion_projects that mirror UserPreference and
 * therefore should inherit from admin when null. Kept as a single
 * source of truth so adding a new model column updates every read
 * path uniformly.
 */
const INHERITED_MODEL_FIELDS = [
  'analysisModel',
  'characterModel',
  'locationModel',
  'storyboardModel',
  'editModel',
  'videoModel',
  'imageModel',
] as const
type InheritedModelField = (typeof INHERITED_MODEL_FIELDS)[number]

/**
 * Settings that aren't model selections but follow the same
 * inherit-from-admin rule (workflow / output config). NULL on the
 * project would surface as an empty placeholder in the UI; pulling
 * admin's value keeps non-admin members on the team-standard config.
 *
 * We deliberately do NOT inherit non-string columns like videoRatio
 * (default '9:16' at schema level — never null) here because Prisma
 * already gives us the schema default for those, no fallback needed.
 */
const INHERITED_TEXT_FIELDS = [
  // Currently empty — kept as a hook for future additions like
  // ttsRate or workflowMode if those gain "inherit from admin" semantics.
] as const

type ProjectShape = {
  [K in InheritedModelField]?: string | null
} & Record<string, unknown>

let cachedAdminPrefs: { userId: string; prefs: Record<string, unknown> | null } | null = null
let cachedAdminPrefsAt = 0
const ADMIN_PREFS_CACHE_TTL_MS = 30_000

async function loadAdminPreferences(): Promise<{
  userId: string
  prefs: Record<string, unknown> | null
} | null> {
  const now = Date.now()
  if (cachedAdminPrefs && now - cachedAdminPrefsAt < ADMIN_PREFS_CACHE_TTL_MS) {
    return cachedAdminPrefs
  }
  const adminUser = await prisma.user.findFirst({
    where: { role: UserRole.ADMIN },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!adminUser) {
    cachedAdminPrefs = null
    cachedAdminPrefsAt = now
    return null
  }
  const prefs = await prisma.userPreference.findUnique({
    where: { userId: adminUser.id },
  })
  cachedAdminPrefs = { userId: adminUser.id, prefs: prefs as Record<string, unknown> | null }
  cachedAdminPrefsAt = now
  return cachedAdminPrefs
}

/**
 * Mutates `data` in place: for every NULL inherited field, fill from
 * admin's UserPreference. Does nothing when the requesting user IS the
 * admin (admin's own NULL means "unset, deal with it") or when no admin
 * user exists.
 *
 * Returns the (possibly-mutated) object as a convenience so callers
 * can chain `return NextResponse.json({ project: applyAdminFallback(...) })`.
 */
export async function applyAdminFallbackToNovelPromotionProject<T extends ProjectShape>(
  params: {
    requestUserId: string
    data: T
  },
): Promise<T> {
  const { requestUserId, data } = params

  // Quick exit if every inherited field is already populated — the
  // hot path for admin's own projects and any project that was created
  // after Session A's a15bad0 write-side fix.
  const anyNull = INHERITED_MODEL_FIELDS.some((f) => data[f] === null || data[f] === undefined)
  if (!anyNull) return data

  const admin = await loadAdminPreferences()
  if (!admin) return data
  if (admin.userId === requestUserId) return data
  if (!admin.prefs) return data

  for (const field of INHERITED_MODEL_FIELDS) {
    if (data[field] === null || data[field] === undefined) {
      const adminVal = admin.prefs[field]
      if (typeof adminVal === 'string' && adminVal.length > 0) {
         
        ;(data as any)[field] = adminVal
      }
    }
  }
  for (const field of INHERITED_TEXT_FIELDS) {
    if (data[field] === null || data[field] === undefined) {
      const adminVal = admin.prefs[field]
      if (typeof adminVal === 'string' && adminVal.length > 0) {
         
        ;(data as any)[field] = adminVal
      }
    }
  }
  return data
}

/**
 * Drop the in-process cache. Used by tests + by admin-side mutations
 * that change UserPreference (so the next read sees the new defaults
 * within a few seconds rather than waiting out the TTL).
 */
export function invalidateAdminPreferenceCache(): void {
  cachedAdminPrefs = null
  cachedAdminPrefsAt = 0
}
