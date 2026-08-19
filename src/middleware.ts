import createMiddleware from 'next-intl/middleware'
import { NextRequest, NextResponse } from 'next/server'
import { routing } from './i18n/routing'
import {
  DESKTOP_OVERRIDE_COOKIE,
  isPhoneUserAgent,
  v2PathToMobile,
} from './lib/mobile-detection'

const intlMiddleware = createMiddleware(routing)

// Regional locale spellings that must resolve to a canonical route before
// next-intl handles the request. Keeping this list narrow prevents a real
// first path segment from being mistaken for a locale.
const LOCALE_ALIAS: Readonly<Record<string, string>> = {
  'zh-TW': 'zh',
  'zh-HK': 'zh',
  'zh-CN': 'zh',
  'zh-Hans': 'zh',
  'zh-Hant': 'zh',
  'en-US': 'en',
  'en-GB': 'en',
}

/**
 * Canonical middleware entry for this `src/app` project.
 *
 * Phone redirects and locale handling share this file so the Next.js build
 * cannot silently choose one behavior and ignore the other. The desktop
 * override cookie remains an explicit escape hatch for phone users who need
 * the full V2 workspace.
 */
export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const segments = pathname.split('/')
  const firstSegment = segments[1]
  const canonicalLocale = firstSegment ? LOCALE_ALIAS[firstSegment] : undefined

  if (canonicalLocale) {
    const rest = segments.slice(2).join('/')
    const url = request.nextUrl.clone()
    url.pathname = `/${canonicalLocale}${rest ? `/${rest}` : ''}`
    return NextResponse.redirect(url)
  }

  const desktopOverride =
    request.cookies.get(DESKTOP_OVERRIDE_COOKIE)?.value === '1'

  if (!desktopOverride && isPhoneUserAgent(request.headers.get('user-agent'))) {
    const target = v2PathToMobile(pathname)
    if (target && target !== pathname) {
      const url = request.nextUrl.clone()
      url.pathname = target
      // Cloning the URL preserves the incoming query string.
      return NextResponse.redirect(url)
    }
  }

  return intlMiddleware(request)
}

export const config = {
  matcher: [
    '/',
    '/(zh|en)/:path*',
    // Keep API, mobile media, framework assets, and self-hosted inference
    // runtimes outside locale rewriting. The locale-prefixed /zh/m and /en/m
    // pages still pass through the explicit matcher above and safely no-op.
    '/((?!api|m|onnxruntime|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.gif|.*\\.ico).*)',
  ],
}
