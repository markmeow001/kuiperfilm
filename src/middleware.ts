import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale } from '@/i18n';

const intlMiddleware = createMiddleware({
    // 支持的所有语言
    locales,

    // 默认语言
    defaultLocale,

    // URL 路径策略: 始终显示语言前缀
    localePrefix: 'always',

    // 语言检测: 根据 Accept-Language header 自动检测
    localeDetection: true
});

// Locale aliases — browser preferred locales / regional variants that
// should redirect to a canonical locale. Without this `/zh-TW/...`
// falls through to the catch-all matcher and gets prefixed again
// → `/zh/zh-TW/...` → 404 (user-reported 2026-05-02 hitting a saved
// bookmark). Kept narrow so we don't accidentally hijack a real
// segment — only well-known regional / script-tag fallbacks.
const LOCALE_ALIAS: Record<string, string> = {
    'zh-TW': 'zh',
    'zh-HK': 'zh',
    'zh-CN': 'zh',
    'zh-Hans': 'zh',
    'zh-Hant': 'zh',
    'en-US': 'en',
    'en-GB': 'en',
};

export default function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const segments = pathname.split('/');
    const first = segments[1];
    if (first && LOCALE_ALIAS[first]) {
        const rest = segments.slice(2).join('/');
        const url = request.nextUrl.clone();
        url.pathname = '/' + LOCALE_ALIAS[first] + (rest ? '/' + rest : '');
        return NextResponse.redirect(url);
    }
    return intlMiddleware(request);
}

export const config = {
    // 匹配所有路径，除了 api、_next/static、_next/image、favicon.ico 等
    matcher: [
        // 匹配根路径和所有带语言前缀的路径
        '/',
        '/(zh|en)/:path*',
        // 匹配所有其他路径（用于重定向到带语言前缀的路径）
        '/((?!api|m|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.gif|.*\\.ico).*)'
    ]
};
