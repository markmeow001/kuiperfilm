/**
 * Public re-export surface for the api-keys module.
 *
 * Route handlers and admin UI import from `@/lib/api-keys` instead of
 * reaching into the submodules — keeps the public boundary obvious
 * and lets us refactor internals freely.
 */

export {
  PUBLIC_API_SCOPES,
  SCOPE_LABELS,
  isValidScope,
  assertValidScopes,
  hasScope,
  type PublicApiScope,
} from './scopes'

export {
  generateApiKey,
  verifyApiKey,
  parseKeyPrefix,
  type GeneratedApiKey,
} from './generator'

export {
  validateApiKey,
  touchLastUsedAt,
  type ValidatedApiKey,
  type ValidationFailure,
  type ValidationResult,
} from './validator'

export {
  requireScope,
  requireAnyScope,
  type ScopeCheckResult,
  type ScopeFailure,
} from './scope-check'

export {
  checkAndRecordRateLimit,
  type RateLimitResult,
} from './rate-limit'

export {
  publicApiHandler,
  type PublicApiContext,
  type PublicApiOptions,
  type PublicApiHandler,
} from './public-api-handler'
