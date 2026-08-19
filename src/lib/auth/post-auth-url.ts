const INTERNAL_ORIGIN = 'https://kuiper.internal'
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/

/**
 * Keep post-auth navigation inside Kuiper while preserving the full in-app
 * pathname, query and hash that led the user to sign in.
 */
export function resolvePostAuthPath(
  rawCallbackUrl: string | null | undefined,
  fallbackPath: string,
): string {
  const candidate = rawCallbackUrl?.trim()

  if (
    !candidate ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\') ||
    CONTROL_CHARACTER.test(candidate)
  ) {
    return fallbackPath
  }

  try {
    const resolved = new URL(candidate, INTERNAL_ORIGIN)
    if (resolved.origin !== INTERNAL_ORIGIN) return fallbackPath
    return `${resolved.pathname}${resolved.search}${resolved.hash}`
  } catch {
    return fallbackPath
  }
}

export function withCallbackUrl(authPath: string, callbackUrl: string | null): string {
  if (!callbackUrl) return authPath

  const query = new URLSearchParams({ callbackUrl })
  return `${authPath}?${query.toString()}`
}
