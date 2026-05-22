// @vitest-environment jsdom
//
// Phase 12.5 (2026-05-22) — useProjectAccess hook unit tests.
//
// Behavior:
//   - 200 response with allowed=true → exposes role + canEdit
//   - 403 / 404 → allowed=false, canEdit=false (conservative lockout)
//   - Loading state → isLoading=true, canEdit=false (no flash)
//
// Note: Tests use React.createElement instead of JSX because the
// vitest config only includes .test.ts (not .test.tsx). Same
// behavior — just spelled out.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useProjectAccess } from '@/lib/query/hooks/useProjectAccess'
import React, { type ReactNode } from 'react'

const globalAny = globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }

function wrapper({ children }: { children: ReactNode }) {
  // New QueryClient per test so caches don't leak between cases.
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })
  return React.createElement(QueryClientProvider, { client }, children)
}

beforeEach(() => {
  globalAny.fetch = vi.fn()
})

describe('useProjectAccess', () => {
  it('returns canEdit=true for owner role from 200 response', async () => {
    globalAny.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ allowed: true, role: 'owner', canEdit: true, canView: true }),
    })

    const { result } = renderHook(() => useProjectAccess('proj-1'), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.allowed).toBe(true)
    expect(result.current.role).toBe('owner')
    expect(result.current.canEdit).toBe(true)
    expect(result.current.canView).toBe(true)
  })

  it('returns canEdit=false for viewer role from 200 response', async () => {
    globalAny.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ allowed: true, role: 'viewer', canEdit: false, canView: true }),
    })

    const { result } = renderHook(() => useProjectAccess('proj-1'), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.role).toBe('viewer')
    expect(result.current.canEdit).toBe(false)
    expect(result.current.canView).toBe(true)
  })

  it('treats 403 as locked (allowed=false, canEdit=false)', async () => {
    globalAny.fetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    })

    const { result } = renderHook(() => useProjectAccess('proj-1'), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.allowed).toBe(false)
    expect(result.current.canEdit).toBe(false)
    expect(result.current.canView).toBe(false)
    expect(result.current.role).toBeNull()
  })

  it('treats 404 as locked (project soft-deleted or doesn\'t exist)', async () => {
    globalAny.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    })

    const { result } = renderHook(() => useProjectAccess('proj-1'), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.allowed).toBe(false)
    expect(result.current.canEdit).toBe(false)
  })

  it('does not fetch when projectId is null (avoid hammering)', () => {
    const { result } = renderHook(() => useProjectAccess(null), { wrapper })

    expect(globalAny.fetch).not.toHaveBeenCalled()
    expect(result.current.allowed).toBe(false)
    expect(result.current.canEdit).toBe(false)
  })

  it('default state during loading is locked (no flash)', () => {
    // Mock fetch that never resolves
    globalAny.fetch.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => useProjectAccess('proj-1'), { wrapper })

    expect(result.current.isLoading).toBe(true)
    expect(result.current.canEdit).toBe(false)
    expect(result.current.canView).toBe(false)
    expect(result.current.allowed).toBe(false)
  })
})
