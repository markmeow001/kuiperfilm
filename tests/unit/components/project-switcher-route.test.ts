import { describe, expect, it } from 'vitest'
import { buildProjectSwitchHref } from '@/components/v2/project-switcher-route'

describe('buildProjectSwitchHref', () => {
  it.each(['storyboard', 'shot-builder', 'clip-composer'])(
    'keeps the %s workspace route while switching projects',
    (route) => {
      expect(buildProjectSwitchHref({
        pathname: `/zh/v2/workspace/project-a/${route}`,
        locale: 'zh',
        projectId: 'project-b',
      })).toBe(`/zh/v2/workspace/project-b/${route}`)
    },
  )

  it('falls back to project home for unknown nested routes', () => {
    expect(buildProjectSwitchHref({
      pathname: '/en/v2/workspace/project-a/not-a-workspace-route',
      locale: 'en',
      projectId: 'project-b',
    })).toBe('/en/v2/workspace/project-b')
  })
})
