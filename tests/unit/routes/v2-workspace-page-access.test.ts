import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('React', React)

const routeMocks = vi.hoisted(() => ({
  requireProjectPageReadAccess: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`NEXT_REDIRECT:${location}`)
  }),
  findProjectState: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: routeMocks.redirect,
}))

vi.mock('@/lib/auth/page-access', () => ({
  requireProjectPageReadAccess: routeMocks.requireProjectPageReadAccess,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userProjectState: {
      findUnique: routeMocks.findProjectState,
    },
  },
}))

vi.mock('@/components/system/SystemStateScreen', () => ({
  SystemStateScreen: 'system-state-screen',
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/V2WorkspaceShell', () => ({
  V2WorkspaceShell: 'workspace-shell',
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/V2HomeClient', () => ({
  V2HomeClient: 'home-client',
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/script/V2ScriptClient', () => ({
  V2ScriptClient: 'script-client',
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/subjects/V2SubjectsClient', () => ({
  V2SubjectsClient: 'subjects-client',
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/storyboard/V2StoryboardClient', () => ({
  V2StoryboardClient: 'storyboard-client',
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/voice/V2VoiceClient', () => ({
  V2VoiceClient: 'voice-client',
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/final/V2FinalClient', () => ({
  V2FinalClient: 'final-client',
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/shot-builder/V2ShotBuilderClient', () => ({
  V2ShotBuilderClient: 'shot-builder-client',
}))

vi.mock('@/app/[locale]/v2/workspace/[projectId]/clip-composer/V2ClipComposerClient', () => ({
  V2ClipComposerClient: 'clip-composer-client',
}))

import V2WorkspaceHomePage from '@/app/[locale]/v2/workspace/[projectId]/page'
import V2ScriptPage from '@/app/[locale]/v2/workspace/[projectId]/script/page'
import V2SubjectsPage from '@/app/[locale]/v2/workspace/[projectId]/subjects/page'
import V2StoryboardPage from '@/app/[locale]/v2/workspace/[projectId]/storyboard/page'
import V2VoicePage from '@/app/[locale]/v2/workspace/[projectId]/voice/page'
import V2FinalPage from '@/app/[locale]/v2/workspace/[projectId]/final/page'
import V2ShotBuilderPage from '@/app/[locale]/v2/workspace/[projectId]/shot-builder/page'
import V2ClipComposerPage from '@/app/[locale]/v2/workspace/[projectId]/clip-composer/page'

const allowedAccess = {
  kind: 'allowed',
  session: { user: { id: 'viewer-1' } },
  effectiveRole: 'viewer',
} as const

const protectedStepPages = [
  ['script', V2ScriptPage],
  ['subjects', V2SubjectsPage],
  ['storyboard', V2StoryboardPage],
  ['voice', V2VoicePage],
  ['final', V2FinalPage],
  ['shot-builder', V2ShotBuilderPage],
  ['clip-composer', V2ClipComposerPage],
] as const

describe('V2 workspace page access', () => {
  beforeEach(() => {
    routeMocks.requireProjectPageReadAccess.mockReset()
    routeMocks.requireProjectPageReadAccess.mockResolvedValue(allowedAccess)
    routeMocks.redirect.mockClear()
    routeMocks.findProjectState.mockReset()
    routeMocks.findProjectState.mockResolvedValue(null)
  })

  it.each(protectedStepPages)('%s -> render 前以精確路徑與完整 query 驗證讀取權限', async (step, Page) => {
    const searchParams = {
      episode: ['episode-1', 'episode-2'],
      stay: '1',
    }

    await Page({
      params: Promise.resolve({ locale: 'zh', projectId: 'project-1' }),
      searchParams: Promise.resolve(searchParams),
    })

    expect(routeMocks.requireProjectPageReadAccess).toHaveBeenCalledWith({
      locale: 'zh',
      pathname: `/zh/v2/workspace/project-1/${step}`,
      projectId: 'project-1',
      searchParams,
    })
  })

  it.each(protectedStepPages)('%s + NO_ACCESS -> 只顯示共用 forbidden 狀態', async (_step, Page) => {
    routeMocks.requireProjectPageReadAccess.mockResolvedValue({ kind: 'forbidden' })

    const rendered = await Page({
      params: Promise.resolve({ locale: 'en', projectId: 'private-project' }),
      searchParams: Promise.resolve({ episode: 'episode-1' }),
    })

    expect(rendered).toMatchObject({
      type: 'system-state-screen',
      props: {
        state: 'forbidden',
        locale: 'en',
      },
    })
    expect(rendered.props).not.toHaveProperty('projectId')
  })

  it('home + startAt -> 權限驗證先於明確 continue redirect', async () => {
    const accessError = new Error('SESSION_STORE_UNAVAILABLE')
    routeMocks.requireProjectPageReadAccess.mockRejectedValue(accessError)

    await expect(V2WorkspaceHomePage({
      params: Promise.resolve({ locale: 'en', projectId: 'project-1' }),
      searchParams: Promise.resolve({ startAt: 'script', stay: '1' }),
    })).rejects.toBe(accessError)

    expect(routeMocks.redirect).not.toHaveBeenCalled()
    expect(routeMocks.findProjectState).not.toHaveBeenCalled()
  })

  it('home + viewer + startAt -> 允許進入並保留原本步驟 redirect', async () => {
    const searchParams = {
      startAt: 'storyboard',
      stay: '1',
      episode: ['episode-1', 'episode-2'],
      view: 'timeline',
    }

    await expect(V2WorkspaceHomePage({
      params: Promise.resolve({ locale: 'zh', projectId: 'project-1' }),
      searchParams: Promise.resolve(searchParams),
    })).rejects.toThrow(
      'NEXT_REDIRECT:/zh/v2/workspace/project-1/storyboard?episode=episode-1&episode=episode-2&view=timeline',
    )

    expect(routeMocks.requireProjectPageReadAccess).toHaveBeenCalledWith({
      locale: 'zh',
      pathname: '/zh/v2/workspace/project-1',
      projectId: 'project-1',
      searchParams,
    })
    expect(routeMocks.findProjectState).not.toHaveBeenCalled()
  })

  it('home root + 已保存 sticky step -> 仍穩定顯示 Home 且不讀 auto-resume state', async () => {
    routeMocks.findProjectState.mockResolvedValue({ lastStep: 'voice' })

    const rendered = await V2WorkspaceHomePage({
      params: Promise.resolve({ locale: 'en', projectId: 'project-1' }),
      searchParams: Promise.resolve({
        episode: 'episode-7',
        panel: ['panel-1', 'panel-2'],
      }),
    })

    expect(rendered).toMatchObject({
      type: 'workspace-shell',
      props: {
        projectId: 'project-1',
        locale: 'en',
        currentStep: 'home',
      },
    })
    expect(routeMocks.redirect).not.toHaveBeenCalled()
    expect(routeMocks.findProjectState).not.toHaveBeenCalled()
  })

  it('NO_ACCESS -> 顯示共用 forbidden 狀態且不讀 sticky-state', async () => {
    routeMocks.requireProjectPageReadAccess.mockResolvedValue({ kind: 'forbidden' })

    const rendered = await V2WorkspaceHomePage({
      params: Promise.resolve({ locale: 'zh', projectId: 'private-project' }),
      searchParams: Promise.resolve({ startAt: 'script' }),
    })

    expect(rendered).toMatchObject({
      type: 'system-state-screen',
      props: {
        state: 'forbidden',
        locale: 'zh',
      },
    })
    expect(routeMocks.redirect).not.toHaveBeenCalled()
    expect(routeMocks.findProjectState).not.toHaveBeenCalled()
  })
})
