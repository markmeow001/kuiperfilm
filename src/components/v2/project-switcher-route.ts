const PROJECT_SCOPED_ROUTES = new Set([
  'script',
  'subjects',
  'storyboard',
  'voice',
  'final',
  'shot-builder',
  'clip-composer',
])

/** Keeps a project switch inside the same production workspace route. */
export function buildProjectSwitchHref({
  pathname,
  locale,
  projectId,
}: {
  pathname: string | null
  locale: string
  projectId: string
}): string {
  const route = resolveProjectScopedRoute(pathname)
  return `/${locale}/v2/workspace/${projectId}${route ? `/${route}` : ''}`
}

export function resolveProjectScopedRoute(pathname: string | null): string {
  if (!pathname) return ''
  const parts = pathname.split('/').filter(Boolean)
  const workspaceIndex = parts.findIndex((part) => part === 'workspace')
  if (workspaceIndex === -1 || workspaceIndex + 2 >= parts.length) return ''
  const route = parts[workspaceIndex + 2]
  return PROJECT_SCOPED_ROUTES.has(route) ? route : ''
}
