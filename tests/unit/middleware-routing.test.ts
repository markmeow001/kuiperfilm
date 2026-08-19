import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import middleware, { config } from '../../src/middleware'

const PHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'

function buildRequest(
  path: string,
  options: { userAgent?: string; cookie?: string } = {},
): NextRequest {
  const headers = new Headers()
  if (options.userAgent) headers.set('user-agent', options.userAgent)
  if (options.cookie) headers.set('cookie', options.cookie)

  return new NextRequest(`https://kuiper.test${path}`, { headers })
}

describe('canonical Next middleware routing', () => {
  it('手機造訪 V2 workspace -> 透過真實 canonical middleware 導向既有 mobile mapping 並保留 query', async () => {
    const response = await middleware(
      buildRequest('/zh/v2/workspace/project-123/storyboard?episode=ep-2&panel=panel-7', {
        userAgent: PHONE_USER_AGENT,
      }),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://kuiper.test/zh/m/projects/project-123?episode=ep-2&panel=panel-7',
    )
  })

  it('手機造訪 V2 首頁與 desktop playground -> 精確套用 v2PathToMobile 對應', async () => {
    const v2Response = await middleware(
      buildRequest('/en/v2?from=bookmark', { userAgent: PHONE_USER_AGENT }),
    )
    const playgroundResponse = await middleware(
      buildRequest('/zh/playground?prompt=cat', { userAgent: PHONE_USER_AGENT }),
    )

    expect(v2Response.headers.get('location')).toBe(
      'https://kuiper.test/en/m/playground?from=bookmark',
    )
    expect(playgroundResponse.headers.get('location')).toBe(
      'https://kuiper.test/zh/m/playground?prompt=cat',
    )
  })

  it('桌機造訪 V2 workspace -> 不導向 mobile 且保留 locale middleware 正常通行', async () => {
    const response = await middleware(
      buildRequest('/zh/v2/workspace/project-123', { userAgent: DESKTOP_USER_AGENT }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('手機帶 desktop override cookie -> 不導向 mobile', async () => {
    const response = await middleware(
      buildRequest('/zh/v2/workspace/project-123', {
        userAgent: PHONE_USER_AGENT,
        cookie: 'kuiper_desktop_override=1',
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('regional locale alias -> 導向 canonical locale 並保留完整 query', async () => {
    const response = await middleware(
      buildRequest('/zh-TW/v2/workspace/project-123?tab=storyboard&returnTo=%2Fzh-TW%2Fv2', {
        userAgent: PHONE_USER_AGENT,
      }),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toBe(
      'https://kuiper.test/zh/v2/workspace/project-123?tab=storyboard&returnTo=%2Fzh-TW%2Fv2',
    )
  })

  it('手機已在 /zh/m 與 mobile auth callback deep link -> 不形成 redirect loop', async () => {
    const mobileResponse = await middleware(
      buildRequest('/zh/m/projects/project-123', { userAgent: PHONE_USER_AGENT }),
    )
    const authResponse = await middleware(
      buildRequest(
        '/zh/m/auth/signin?callbackUrl=%2Fzh%2Fm%2Fprojects%2Fproject-123',
        { userAgent: PHONE_USER_AGENT },
      ),
    )

    expect(mobileResponse.status).toBe(200)
    expect(mobileResponse.headers.get('location')).toBeNull()
    expect(mobileResponse.headers.get('x-middleware-next')).toBe('1')
    expect(authResponse.status).toBe(200)
    expect(authResponse.headers.get('location')).toBeNull()
    expect(authResponse.headers.get('x-middleware-next')).toBe('1')
  })

  it('V2 new project 沒有 mobile counterpart -> 手機仍留在原頁', async () => {
    const response = await middleware(
      buildRequest('/zh/v2/new?template=blank', { userAgent: PHONE_USER_AGENT }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })
})

describe('middleware matcher and entry contract', () => {
  it.each([
    '/api/auth/callback/credentials?callbackUrl=%2Fzh%2Fv2',
    '/_next/static/chunks/app.js',
    '/_next/image?url=%2Fimages%2Fhero.png&w=640&q=75',
    '/favicon.ico',
    '/onnxruntime/ort-wasm-simd-threaded.mjs',
    '/mediapipe/vision/vision_wasm_internal.js',
    '/models/live-composite/rvm-mobilenetv3-fp32.onnx',
    '/m/public-media-id',
  ])('%s -> 不進 locale/mobile middleware', (path) => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: `https://kuiper.test${path}`,
      }),
    ).toBe(false)
  })

  it.each(['/', '/zh/v2', '/en/v2/workspace/project-123', '/zh/m/auth/signin'])(
    '%s -> 進 canonical middleware',
    (path) => {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          nextConfig: {},
          url: `https://kuiper.test${path}`,
        }),
      ).toBe(true)
    },
  )

  it.each([
    '/zh/api/auth/callback/credentials?callbackUrl=%2Fzh%2Fv2',
    '/en/_next/static/chunks/app.js',
    '/zh/onnxruntime/ort-wasm-simd-threaded.mjs',
  ])('%s -> locale matcher 的 OR 語義會執行 middleware，但不 redirect 或形成 loop', async (path) => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: `https://kuiper.test${path}`,
      }),
    ).toBe(true)

    const response = await middleware(buildRequest(path, { userAgent: PHONE_USER_AGENT }))
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('x-middleware-next')).toBe('1')
  })

  it('Next 15 src/app convention -> 專案只保留 src/middleware.ts entry', () => {
    const entries = ['middleware.ts', 'src/middleware.ts'].filter((entry) =>
      existsSync(resolve(process.cwd(), entry)),
    )

    expect(entries).toEqual(['src/middleware.ts'])
    expect(resolve(process.cwd(), 'src/middleware.ts')).toBe(
      resolve(process.cwd(), 'src/app', '..', 'middleware.ts'),
    )
  })
})
