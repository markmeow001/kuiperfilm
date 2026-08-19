import { describe, expect, it } from 'vitest'

import { resolvePostAuthPath, withCallbackUrl } from '@/lib/auth/post-auth-url'

describe('post-auth callback URL', () => {
  it('內部深連結含 query 與 hash -> 完整保留', () => {
    expect(
      resolvePostAuthPath('/zh/v2/workspace/project-1/storyboard?episode=ep-2#shot-4', '/zh/v2'),
    ).toBe('/zh/v2/workspace/project-1/storyboard?episode=ep-2#shot-4')
  })

  it('外部網址或 protocol-relative URL -> 使用站內 fallback', () => {
    expect(resolvePostAuthPath('https://evil.example/phish', '/zh/v2')).toBe('/zh/v2')
    expect(resolvePostAuthPath('//evil.example/phish', '/zh/v2')).toBe('/zh/v2')
    expect(resolvePostAuthPath('/\\evil.example/phish', '/zh/v2')).toBe('/zh/v2')
  })

  it('空白或控制字元 callback -> 使用站內 fallback', () => {
    expect(resolvePostAuthPath(null, '/en/v2')).toBe('/en/v2')
    expect(resolvePostAuthPath('   ', '/en/v2')).toBe('/en/v2')
    expect(resolvePostAuthPath('/en/v2\nhttps://evil.example', '/en/v2')).toBe('/en/v2')
  })

  it('建立登入或註冊連結 -> callback 只被編碼一次', () => {
    expect(
      withCallbackUrl('/zh/auth/signin', '/zh/v2/workspace/project-1?episode=ep-2'),
    ).toBe(
      '/zh/auth/signin?callbackUrl=%2Fzh%2Fv2%2Fworkspace%2Fproject-1%3Fepisode%3Dep-2',
    )
  })
})
