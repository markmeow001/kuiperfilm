/**
 * Bull-Board startup auth-config gate (F4).
 *
 * Bull-Board exposes full queue state and lets the operator drain,
 * promote, or fail jobs. An unauthenticated instance reachable from
 * outside the host is therefore a privilege-escalation primitive. To
 * prevent silent fail-open at start time we evaluate the host + auth
 * env vars here and return a structured decision the script entry
 * point translates to a `process.exit(1)` or `listen()`.
 *
 * Three legal modes:
 *
 *   1) dev / loopback (NODE_ENV !== 'production' AND host is one of
 *      127.0.0.1 / localhost / ::1): unauth allowed for convenience
 *      so `npm run dev` works without extra setup.
 *   2) prod, OR any non-loopback bind, AND both BULL_BOARD_USER and
 *      BULL_BOARD_PASSWORD set to non-empty strings: basic auth
 *      enforced.
 *   3) any other combination: refused. The caller exits non-zero so
 *      the orchestrator surfaces the misconfiguration.
 */

export type BullBoardGateInput = {
  nodeEnv: string | undefined
  host: string
  authUser: string | undefined
  authPassword: string | undefined
}

export type BullBoardGateDecision =
  | {
      ok: true
      // True when the middleware should enforce basic auth on every
      // request. False only in dev/loopback mode.
      authConfigured: boolean
    }
  | {
      ok: false
      reason:
        | 'partial-credentials'
        | 'prod-or-non-loopback-without-auth'
      details: Record<string, unknown>
    }

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export function evaluateBullBoardAuthGate(input: BullBoardGateInput): BullBoardGateDecision {
  const { nodeEnv, host, authUser, authPassword } = input
  const isProduction = nodeEnv === 'production'
  const isLoopbackBind = LOOPBACK_HOSTS.has(host)
  const hasUser = Boolean(authUser && authUser.length > 0)
  const hasPassword = Boolean(authPassword && authPassword.length > 0)
  const authConfigured = hasUser && hasPassword
  const authPartiallyConfigured = (hasUser || hasPassword) && !authConfigured

  if (authPartiallyConfigured) {
    return {
      ok: false,
      reason: 'partial-credentials',
      details: { hasUser, hasPassword },
    }
  }

  if ((isProduction || !isLoopbackBind) && !authConfigured) {
    return {
      ok: false,
      reason: 'prod-or-non-loopback-without-auth',
      details: { isProduction, host, isLoopbackBind },
    }
  }

  return { ok: true, authConfigured }
}
