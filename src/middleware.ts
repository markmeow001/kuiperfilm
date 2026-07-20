import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { locales, defaultLocale } from '@/i18n';
import {
    isPhoneUserAgent,
    v2PathToMobile,
    DESKTOP_OVERRIDE_COOKIE,
} from '@/lib/mobile-detection';

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

    // 2026-05-03 — mobile UA bounces from V2 to /m/* so phone users
    // land on the mobile-native review surface instead of a cramped
    // desktop layout. Cookie escape hatch (`kuiper_desktop_override`)
    // lets power users opt out and use V2 anyway. See
    // `src/lib/mobile-detection.ts` for the path-mapping rules.
    const desktopOverride = request.cookies.get(DESKTOP_OVERRIDE_COOKIE)?.value === '1';
    if (!desktopOverride && isPhoneUserAgent(request.headers.get('user-agent'))) {
        const target = v2PathToMobile(pathname);
        if (target && target !== pathname) {
            const url = request.nextUrl.clone();
            url.pathname = target;
            // Preserve query string so deep-linked filters survive.
            return NextResponse.redirect(url);
        }
    }

    return intlMiddleware(request);
}

export const config = {
    // 匹配所有路径，除了 api、_next/static、_next/image、favicon.ico 等
    matcher: [
        // 匹配根路径和所有带语言前缀的路径
        '/',
        '/(zh|en)/:path*',
        // 匹配所有其他路径（用于重定向到带语言前缀的路径）。
        // onnxruntime = public/ 自托管的 ORT runtime（.mjs/.wasm）——不排除会被
        // locale 307 到 /zh/onnxruntime → 404，RVM 引擎无法初始化（2026-07-20）。
        // 注：/mediapipe、/models 一直能用纯属侥幸——lookahead 里为 /m 行动版
        // 排除的裸 `m` 恰好挡掉了所有 m 开头路径。
        '/((?!api|m|onnxruntime|_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.gif|.*\\.ico).*)'
    ]
};
