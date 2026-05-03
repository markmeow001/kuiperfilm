/**
 * Mobile UA detection + V2 → /m/* path mapping.
 *
 * Single source of truth for the auto-redirect logic. Used by the
 * middleware to decide when to bounce a phone user from a V2 page to
 * the corresponding /m/* page; also used by the desktop-override
 * banner so the "open desktop view" link goes back to the right V2
 * URL.
 *
 * Why phone-only (not tablet): tablets handle V2 fine in landscape,
 * and aggressive redirect on iPad would punish power users on
 * landscape iPads doing real workflow editing. We err narrow.
 */

const PHONE_UA_REGEX =
  /Mobile|iPhone|iPod|Android.*Mobile|BlackBerry|webOS|IEMobile|Opera Mini|Phone/i

/** True iff the UA looks like a phone (intentionally excludes tablet). */
export function isPhoneUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  // iPad announces itself as "Mac" on iPadOS 13+; we accept that and
  // don't try to detect it. Tablet users get desktop V2.
  if (/iPad/.test(userAgent)) return false
  return PHONE_UA_REGEX.test(userAgent)
}

/**
 * Map a V2 pathname to its `/m/*` equivalent. Returns null when the
 * V2 path has no clean mobile counterpart and we shouldn't redirect.
 *
 * Conservative: pages that exist on /m/* get a direct redirect; pages
 * that don't (creation, script editor, multi-shot) bounce up to the
 * project's mobile home so the user lands somewhere they can actually
 * navigate from. The desktop-override banner inside /m/* covers the
 * "I really wanted desktop" case.
 *
 * Examples:
 *   /zh/v2                                  → /zh/m/projects
 *   /zh/v2/workspace/<pid>                  → /zh/m/projects/<pid>
 *   /zh/v2/workspace/<pid>/storyboard       → /zh/m/projects/<pid>
 *   /zh/v2/workspace/<pid>/script           → /zh/m/projects/<pid>
 *   /zh/v2/new                              → null (keep on V2 — creation needs desktop)
 */
export function v2PathToMobile(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  // Need at least [locale, v2, ...]
  if (parts.length < 2) return null
  const locale = parts[0]
  if (locale !== 'zh' && locale !== 'en') return null
  if (parts[1] !== 'v2') return null

  // /<locale>/v2  → projects list
  if (parts.length === 2) return `/${locale}/m/projects`

  // /<locale>/v2/new → don't redirect; new project needs desktop
  if (parts[2] === 'new') return null

  // /<locale>/v2/workspace/<projectId>(...) → /m/projects/<projectId>
  if (parts[2] === 'workspace' && parts[3]) {
    return `/${locale}/m/projects/${parts[3]}`
  }

  // Any other V2 surface (admin / org / etc) — leave it alone, those
  // aren't mobile-redirect targets.
  return null
}

/**
 * Reverse direction: given a /m/* pathname, return the corresponding
 * V2 URL the desktop-override banner should link to. Used so "open
 * desktop view" lands on the equivalent V2 page rather than always
 * dumping to /v2.
 */
export function mobilePathToV2(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length < 2) return '/zh/v2'
  const locale = parts[0] === 'en' ? 'en' : 'zh'
  if (parts[1] !== 'm') return `/${locale}/v2`

  // /m/projects → /v2
  if (parts[2] === 'projects' && parts.length === 3) {
    return `/${locale}/v2`
  }
  // /m/projects/<pid> → /v2/workspace/<pid>
  if (parts[2] === 'projects' && parts[3]) {
    return `/${locale}/v2/workspace/${parts[3]}`
  }
  return `/${locale}/v2`
}

/** Cookie that bypasses the V2 → /m/* redirect when set to '1'. */
export const DESKTOP_OVERRIDE_COOKIE = 'kuiper_desktop_override'
