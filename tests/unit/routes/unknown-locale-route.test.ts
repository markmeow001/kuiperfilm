import { describe, expect, it, vi } from 'vitest'

const notFoundMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
}))

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}))

import UnknownLocaleRoute from '@/app/[locale]/[...notFound]/page'

describe('unknown locale route', () => {
  it('delegates every unmatched locale path to the shared not-found state', () => {
    expect(() => UnknownLocaleRoute()).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })
})
