/**
 * Public API request wrapper — Phase 5 (2026-05-25).
 *
 * Bridges the 4 cross-cutting concerns every `/api/public/v1/*` route
 * needs into one composable helper:
 *
 *   1. Bearer-token auth        → validateApiKey()
 *   2. Scope enforcement        → requireScope()
 *   3. Sliding-window rate cap  → checkAndRecordRateLimit()
 *   4. Usage logging            → fire-and-forget INSERT into ApiKeyUsage
 *
 * The handler receives a fully-resolved `ApiContext` (workspaceId,
 * scopes, etc.) so each endpoint body can focus on its business logic
 * — no boilerplate auth code per route.
 *
 * Error envelope is consistent across every public endpoint:
 *   { error: { code, message, details? } }
 *
 * This mirrors Stripe/GitHub's convention and lets SDK authors write
 * one error-mapping function for the whole API surface.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logError as _ulogError, logInfo as _ulogInfo } from '@/lib/logging/core'
import { prisma } from '@/lib/prisma'
import {
  validateApiKey,
  touchLastUsedAt,
  type ValidatedApiKey,
} from './validator'
import { requireScope } from './scope-check'
import { checkAndRecordRateLimit } from './rate-limit'
import type { PublicApiScope } from './scopes'

export interface PublicApiContext {
  apiKey: ValidatedApiKey
  /** Convenience alias — most routes only need workspaceId. */
  workspaceId: string
  /** Same shape as `apiKey.scopes`, exposed for ergonomics. */
  scopes: readonly PublicApiScope[]
}

export interface PublicApiOptions {
  /** Required scope for this endpoint. Always exactly one — multi-scope
   *  endpoints should call `requireAnyScope` inside the handler. */
  requireScope: PublicApiScope
}

export type PublicApiHandler = (
  req: NextRequest,
  ctx: PublicApiContext,
) => Promise<Response | NextResponse>

interface ErrorBody {
  code: string
  message: string
  details?: Record<string, unknown>
}

/**
 * Single source of truth for public-API error envelopes. Adds rate-limit
 * headers when present so SDKs can surface them even on 429/403/401
 * responses (not just 2xx).
 */
function errorResponse(
  status: number,
  body: ErrorBody,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: body },
    { status, headers: { ...extraHeaders, 'X-Public-API-Error': body.code } },
  )
}

const CODE_TO_USER_MESSAGE: Record<string, string> = {
  MISSING_AUTH_HEADER: 'Missing Authorization header. Include `Authorization: Bearer kfk_…`.',
  INVALID_KEY_FORMAT: 'API key format is not recognized.',
  KEY_NOT_FOUND: 'API key is invalid.',
  KEY_REVOKED: 'API key has been revoked.',
  KEY_EXPIRED: 'API key has expired. Generate a new one in the developer console.',
  INSUFFICIENT_SCOPE: 'API key does not have the required scope for this endpoint.',
  RATE_LIMITED: 'Rate limit exceeded. Slow down and retry after the period indicated by Retry-After.',
}

/**
 * Wrap a route handler with public-API auth, scope check, rate-limit,
 * and usage logging. Use exactly like Next.js's native route export:
 *
 *   export const GET = publicApiHandler(
 *     { requireScope: 'read' },
 *     async (req, ctx) => { ... }
 *   )
 */
export function publicApiHandler(
  options: PublicApiOptions,
  handler: PublicApiHandler,
) {
  return async function wrapped(req: NextRequest): Promise<Response | NextResponse> {
    const startedAt = Date.now()
    let apiKeyIdForLog: string | null = null
    let statusForLog = 500

    try {
      // 1. Auth
      const validation = await validateApiKey(req.headers.get('authorization'))
      if (!validation.ok) {
        statusForLog = validation.status
        return errorResponse(validation.status, {
          code: validation.code,
          message: CODE_TO_USER_MESSAGE[validation.code] ?? validation.code,
        })
      }
      apiKeyIdForLog = validation.apiKeyId

      // 2. Scope
      const scopeCheck = requireScope(validation, options.requireScope)
      if (!scopeCheck.ok) {
        statusForLog = scopeCheck.status
        return errorResponse(scopeCheck.status, {
          code: scopeCheck.code,
          message: CODE_TO_USER_MESSAGE[scopeCheck.code] ?? scopeCheck.code,
          details: { required: scopeCheck.required, granted: scopeCheck.granted },
        })
      }

      // 3. Rate limit
      const rate = await checkAndRecordRateLimit({
        apiKeyId: validation.apiKeyId,
        reqPerMinute: validation.reqPerMinute,
      })
      const rateHeaders: Record<string, string> = {
        'X-RateLimit-Limit': String(validation.reqPerMinute),
        'X-RateLimit-Remaining': String(Math.max(0, rate.remaining)),
      }
      if (rate.degraded) rateHeaders['X-RateLimit-Degraded'] = 'true'

      if (!rate.allowed) {
        statusForLog = 429
        return errorResponse(
          429,
          {
            code: 'RATE_LIMITED',
            message: CODE_TO_USER_MESSAGE.RATE_LIMITED!,
            details: { retryAfterMs: rate.retryAfterMs },
          },
          {
            ...rateHeaders,
            'Retry-After': String(Math.ceil(rate.retryAfterMs / 1000)),
          },
        )
      }

      // 4. Hand off to the actual route handler.
      const ctx: PublicApiContext = {
        apiKey: validation,
        workspaceId: validation.workspaceId,
        scopes: validation.scopes,
      }
      const response = await handler(req, ctx)
      statusForLog = response.status

      // Echo rate-limit headers on success too — clients use them for
      // proactive throttling.
      const merged = new Headers(response.headers)
      for (const [k, v] of Object.entries(rateHeaders)) merged.set(k, v)
      return new NextResponse(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: merged,
      })
    } catch (error) {
      _ulogError('[public-api] handler threw', error)
      statusForLog = 500
      return errorResponse(500, {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred. Try again or contact support.',
      })
    } finally {
      // Always log usage (auth failures included — useful for spotting
      // probing / leaked-key abuse). Best-effort; never block the response.
      if (apiKeyIdForLog) {
        touchLastUsedAt(apiKeyIdForLog)
        const durationMs = Date.now() - startedAt
        void prisma.apiKeyUsage
          .create({
            data: {
              apiKeyId: apiKeyIdForLog,
              endpoint: new URL(req.url).pathname.slice(0, 128),
              method: req.method.slice(0, 8),
              statusCode: statusForLog,
              durationMs,
              ipAddress: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()?.slice(0, 45) ?? null,
              userAgent: req.headers.get('user-agent')?.slice(0, 1024) ?? null,
            },
          })
          .catch((err) => _ulogError('[public-api] usage log failed', err))
      }
    }
  }
}
