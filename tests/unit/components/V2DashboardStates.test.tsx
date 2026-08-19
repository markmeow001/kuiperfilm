import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  router: {
    push: vi.fn(),
    replace: vi.fn(),
  },
  searchParams: {
    get: vi.fn((_key: string): string | null => null),
  },
  sessionState: {
    data: {
      user: {
        name: 'Test User',
        email: 'test@example.com',
        role: 'member',
      },
    },
    status: 'authenticated' as const,
  },
  translate: vi.fn((key: string) => key),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  useSearchParams: () => mocks.searchParams,
}))

vi.mock('next-auth/react', () => ({
  useSession: () => mocks.sessionState,
  signOut: vi.fn(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => mocks.translate,
}))

vi.mock('@/components/v2/NotificationBell', () => ({
  NotificationBell: () => <div>notification bell</div>,
}))

vi.mock('@/app/[locale]/v2/WorkspaceCollabIntroBanner', () => ({
  WorkspaceCollabIntroBanner: () => null,
}))

vi.mock('@/app/[locale]/v2/V2HomeRail', () => ({
  V2HomeRail: () => <nav aria-label="home rail" />,
}))

vi.mock('@/app/[locale]/v2/V2WorkflowLauncher', () => ({
  V2WorkflowLauncher: () => <div>workflow launcher</div>,
}))

import { V2HomeClient } from '@/app/[locale]/v2/V2HomeClient'

const globalWithFetch = globalThis as unknown as {
  fetch: ReturnType<typeof vi.fn>
}

function projectResponse(
  id: string,
  name: string,
  page = 1,
  totalPages = 1,
  access?: {
    effectiveRole: 'owner' | 'admin' | 'ws_owner' | 'ws_owner_legacy' | 'editor' | 'viewer'
    canDelete: boolean
    lastStep: string | null
  },
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      projects: [{
        id,
        name,
        description: null,
        createdAt: '2026-08-08T00:00:00.000Z',
        updatedAt: '2026-08-08T00:00:00.000Z',
        effectiveRole: access?.effectiveRole ?? 'owner',
        canDelete: access?.canDelete ?? true,
        lastStep: access?.lastStep ?? null,
      }],
      pagination: {
        page,
        pageSize: 11,
        total: totalPages,
        totalPages,
      },
    }),
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  mocks.router.push.mockClear()
  mocks.router.replace.mockClear()
  mocks.searchParams.get.mockImplementation(() => null)
  globalWithFetch.fetch = vi.fn()
})

describe('V2 dashboard project loading states', () => {
  it('專案列表 503 -> 顯示 error；retry 成功後恢復真實專案而非空狀態', async () => {
    globalWithFetch.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          projects: [
            {
              id: 'project-1',
              name: 'Recovered project',
              description: null,
              createdAt: '2026-08-08T00:00:00.000Z',
              updatedAt: '2026-08-08T00:00:00.000Z',
            },
          ],
          pagination: {
            page: 1,
            pageSize: 11,
            total: 1,
            totalPages: 1,
          },
        }),
      })

    render(<V2HomeClient locale="zh" />)

    expect(document.querySelector('[data-studio-theme="dark"]')).toBeInTheDocument()

    expect(await screen.findByText('errors.loadTitle')).toBeInTheDocument()
    expect(screen.getByText('HTTP 503')).toBeInTheDocument()
    expect(screen.queryByText('empty.noneYet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'errors.retry' }))

    await waitFor(() => {
      expect(screen.getByText('Recovered project')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /grid.continueProject/ })).toHaveAttribute(
      'href',
      '/zh/v2/workspace/project-1?startAt=script',
    )
    expect(screen.queryByText('errors.loadTitle')).not.toBeInTheDocument()
    expect(screen.queryByText('empty.noneYet')).not.toBeInTheDocument()
  })

  it('workspace/page requests ignore stale responses and project actions are sibling controls', async () => {
    let activeWorkspace: string | null = null
    mocks.searchParams.get.mockImplementation((key: string) => (
      key === 'ws' ? activeWorkspace : null
    ))
    const stalePage = deferred<ReturnType<typeof projectResponse>>()
    globalWithFetch.fetch = vi.fn((input: unknown) => {
      const url = new URL(String(input), 'http://localhost')
      const page = Number(url.searchParams.get('page'))
      const workspace = url.searchParams.get('ws')
      if (page === 2) return stalePage.promise
      if (workspace === 'workspace-b') {
        return Promise.resolve(projectResponse('project-b', 'Workspace B project'))
      }
      return Promise.resolve(projectResponse('project-a', 'Personal project', 1, 2))
    })

    const { rerender } = render(<V2HomeClient locale="zh" />)
    expect(await screen.findByText('Personal project')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '→' }))
    await waitFor(() => {
      expect(globalWithFetch.fetch.mock.calls.some(([input]) => (
        new URL(String(input), 'http://localhost').searchParams.get('page') === '2'
      ))).toBe(true)
    })

    activeWorkspace = 'workspace-b'
    rerender(<V2HomeClient locale="zh" />)
    expect(await screen.findByText('Workspace B project')).toBeInTheDocument()

    await act(async () => {
      stalePage.resolve(projectResponse('stale-project', 'Stale personal project', 2, 2))
      await stalePage.promise
    })

    expect(screen.queryByText('Stale personal project')).not.toBeInTheDocument()
    const projectCard = screen.getByText('Workspace B project').closest('article')
    const overviewLink = screen.getByRole('link', { name: 'grid.openOverview' })
    const deleteButton = screen.getByRole('button', {
      name: 'grid.deleteTitle: Workspace B project',
    })
    expect(projectCard).not.toBeNull()
    expect(projectCard).toContainElement(overviewLink)
    expect(projectCard).toContainElement(deleteButton)
    expect(deleteButton.closest('a')).toBeNull()
  })

  it('workspace switcher is a disclosure and Escape closes it while restoring focus', async () => {
    globalWithFetch.fetch = vi.fn((input: unknown) => {
      const url = String(input)
      if (url.startsWith('/api/workspaces')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            workspaces: [{ id: 'workspace-b', name: 'Studio B' }],
            workspaceMemberships: [],
          }),
        })
      }
      return Promise.resolve(projectResponse('project-a', 'Personal project'))
    })

    render(<V2HomeClient locale="zh" />)
    const trigger = screen.getByRole('button', {
      name: 'title: personal',
    })
    expect(trigger).not.toHaveAttribute('aria-haspopup')

    fireEvent.click(trigger)
    const workspaceButton = await screen.findByRole('button', { name: 'Studio B' })
    const panelId = trigger.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId as string)).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    workspaceButton.focus()
    expect(workspaceButton).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => {
      expect(document.getElementById(panelId as string)).not.toBeInTheDocument()
    })
    expect(trigger).toHaveFocus()
  })

  it('workspace switcher keeps request failures distinct from an empty list and can retry', async () => {
    let workspaceAttempts = 0
    globalWithFetch.fetch = vi.fn((input: unknown) => {
      const url = String(input)
      if (url.startsWith('/api/workspaces')) {
        workspaceAttempts += 1
        if (workspaceAttempts === 1) {
          return Promise.resolve({ ok: false, status: 503 })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            workspaces: [{ id: 'workspace-b', name: 'Recovered Studio' }],
            workspaceMemberships: [],
          }),
        })
      }
      return Promise.resolve(projectResponse('project-a', 'Personal project'))
    })

    render(<V2HomeClient locale="zh" />)
    fireEvent.click(screen.getByRole('button', { name: 'title: personal' }))

    expect(await screen.findByText('loadError')).toBeInTheDocument()
    expect(screen.queryByText('noJoinable')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'retry' }))

    expect(await screen.findByRole('button', { name: 'Recovered Studio' })).toBeInTheDocument()
    expect(screen.queryByText('loadError')).not.toBeInTheDocument()
  })

  it('gives overview and continue distinct destinations and hides delete from viewers', async () => {
    globalWithFetch.fetch = vi.fn().mockResolvedValue(projectResponse(
      'project-viewer',
      'Shared project',
      1,
      1,
      {
        effectiveRole: 'viewer',
        canDelete: false,
        lastStep: 'storyboard',
      },
    ))

    render(<V2HomeClient locale="zh" />)

    expect(await screen.findByText('Shared project')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'grid.openOverview' })).toHaveAttribute(
      'href',
      '/zh/v2/workspace/project-viewer?stay=1',
    )
    expect(screen.getByRole('link', { name: /grid.continueProject/ })).toHaveAttribute(
      'href',
      '/zh/v2/workspace/project-viewer?startAt=storyboard',
    )
    expect(screen.queryByRole('button', {
      name: 'grid.deleteTitle: Shared project',
    })).not.toBeInTheDocument()
  })
})
