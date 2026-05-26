/**
 * Scope enforcement helper — Phase 5 (2026-05-25).
 *
 * Called by every `/api/public/v1/*` route AFTER the validator has
 * returned a successful ValidatedApiKey. Keeps the scope-check concern
 * out of the validator so a single key can be reused across endpoints
 * with different scope requirements without re-running auth.
 *
 * Returns a structured failure shape (mirrors the validator's failure
 * envelope) instead of throwing — public-API code paths shouldn't rely
 * on exceptions for predictable auth flow.
 */

import { hasScope, type PublicApiScope } from './scopes'
import type { ValidatedApiKey } from './validator'

export interface ScopeFailure {
  ok: false
  code: 'INSUFFICIENT_SCOPE'
  status: 403
  /** The scope the route required. Surfaced in the error response so
   *  the developer can update their key. */
  required: PublicApiScope
  /** What the key currently has. Surfaced for the same reason. */
  granted: readonly string[]
}

export type ScopeCheckResult = { ok: true } | ScopeFailure

/**
 * Hard-require a single scope. Use when the route maps 1:1 to a scope
 * (the common case — e.g. `POST /v1/scripts` requires `scripts.write`).
 */
export function requireScope(
  apiKey: ValidatedApiKey,
  required: PublicApiScope,
): ScopeCheckResult {
  if (hasScope(apiKey.scopes, required)) {
    return { ok: true }
  }
  return {
    ok: false,
    code: 'INSUFFICIENT_SCOPE',
    status: 403,
    required,
    granted: apiKey.scopes,
  }
}

/**
 * Require ANY one of the listed scopes. Use sparingly — most routes
 * should require exactly one scope so permission decisions remain
 * predictable. Currently only `/v1/projects` GET uses this (accepts
 * either `read` or any `.write` that implies read of that resource).
 *
 * `required[0]` is reported as the canonical required scope in the
 * error response, since reporting all would confuse developers who
 * just need to know what to add.
 */
export function requireAnyScope(
  apiKey: ValidatedApiKey,
  required: readonly [PublicApiScope, ...PublicApiScope[]],
): ScopeCheckResult {
  for (const scope of required) {
    if (hasScope(apiKey.scopes, scope)) return { ok: true }
  }
  return {
    ok: false,
    code: 'INSUFFICIENT_SCOPE',
    status: 403,
    required: required[0],
    granted: apiKey.scopes,
  }
}
