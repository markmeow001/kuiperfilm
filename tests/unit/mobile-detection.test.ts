import { describe, expect, it } from 'vitest'
import {
  isPhoneUserAgent,
  v2PathToMobile,
  mobilePathToV2,
} from '@/lib/mobile-detection'

describe('isPhoneUserAgent', () => {
  it('matches iPhone', () => {
    expect(
      isPhoneUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      ),
    ).toBe(true)
  })

  it('matches Android phones', () => {
    expect(
      isPhoneUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36',
      ),
    ).toBe(true)
  })

  it('rejects desktop Chrome', () => {
    expect(
      isPhoneUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
      ),
    ).toBe(false)
  })

  it('rejects iPad (intentionally — landscape iPad handles V2 fine)', () => {
    expect(
      isPhoneUserAgent(
        'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      ),
    ).toBe(false)
  })

  it('rejects null / empty', () => {
    expect(isPhoneUserAgent(null)).toBe(false)
    expect(isPhoneUserAgent('')).toBe(false)
    expect(isPhoneUserAgent(undefined)).toBe(false)
  })
})

describe('v2PathToMobile', () => {
  it('redirects /zh/v2 to projects list', () => {
    expect(v2PathToMobile('/zh/v2')).toBe('/zh/m/projects')
  })

  it('redirects /en/v2 to en projects list', () => {
    expect(v2PathToMobile('/en/v2')).toBe('/en/m/projects')
  })

  it('redirects workspace home to project mobile home', () => {
    expect(v2PathToMobile('/zh/v2/workspace/abc-123')).toBe('/zh/m/projects/abc-123')
  })

  it('redirects nested workspace pages to project mobile home', () => {
    expect(v2PathToMobile('/zh/v2/workspace/abc-123/storyboard')).toBe('/zh/m/projects/abc-123')
    expect(v2PathToMobile('/zh/v2/workspace/abc-123/script')).toBe('/zh/m/projects/abc-123')
    expect(v2PathToMobile('/zh/v2/workspace/abc-123/voice')).toBe('/zh/m/projects/abc-123')
    expect(v2PathToMobile('/zh/v2/workspace/abc-123/final')).toBe('/zh/m/projects/abc-123')
  })

  it('does NOT redirect /v2/new (creation needs desktop)', () => {
    expect(v2PathToMobile('/zh/v2/new')).toBeNull()
  })

  it('does NOT redirect non-v2 paths', () => {
    expect(v2PathToMobile('/zh/admin')).toBeNull()
    expect(v2PathToMobile('/zh/m/projects')).toBeNull()
    expect(v2PathToMobile('/zh/profile')).toBeNull()
  })

  it('does NOT redirect non-zh / non-en locales', () => {
    expect(v2PathToMobile('/foo/v2')).toBeNull()
  })
})

describe('mobilePathToV2', () => {
  it('maps /m/projects to /v2', () => {
    expect(mobilePathToV2('/zh/m/projects')).toBe('/zh/v2')
  })

  it('maps /m/projects/<pid> to /v2/workspace/<pid>', () => {
    expect(mobilePathToV2('/zh/m/projects/abc-123')).toBe('/zh/v2/workspace/abc-123')
  })

  it('preserves locale', () => {
    expect(mobilePathToV2('/en/m/projects')).toBe('/en/v2')
    expect(mobilePathToV2('/en/m/projects/x')).toBe('/en/v2/workspace/x')
  })

  it('falls back to /v2 for non-/m/* paths', () => {
    expect(mobilePathToV2('/zh/foo')).toBe('/zh/v2')
  })
})
