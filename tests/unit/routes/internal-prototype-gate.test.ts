import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const notFoundMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
}))

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}))

import DevLayout from '@/app/[locale]/dev/layout'
import PreviewLayout from '@/app/[locale]/preview/layout'
import V5Layout from '@/app/[locale]/v5/layout'

const internalLayouts = [
  ['preview', PreviewLayout],
  ['dev', DevLayout],
  ['v5', V5Layout],
] as const

describe('internal prototype route gate', () => {
  beforeEach(() => {
    notFoundMock.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it.each(internalLayouts)('%s + production -> delegates to Next not-found', (_route, Layout) => {
    vi.stubEnv('NODE_ENV', 'production')

    expect(() => Layout({ children: 'internal content' })).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  it.each(internalLayouts)('%s + non-production -> renders its children', (_route, Layout) => {
    vi.stubEnv('NODE_ENV', 'development')

    expect(Layout({ children: 'internal content' })).toBe('internal content')
    expect(notFoundMock).not.toHaveBeenCalled()
  })
})
