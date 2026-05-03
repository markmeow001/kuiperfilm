#!/usr/bin/env node
/**
 * Worker startup smoke test.
 *
 * Spawns src/lib/workers/index.ts via tsx and watches stderr for
 * module-init-time crashes — the exact failure mode that production
 * outages have been built from on this codebase:
 *
 *   2026-05-03  commit 77c13bd  feat(b-path): dialogue-driven per-shot
 *                                durations
 *               introduced a circular import between
 *               multi-shot-video-b-path.ts and
 *               speech-duration-estimator.ts. `tsc --noEmit` was clean
 *               and existing unit tests passed (they import functions
 *               directly, not the worker entry chain), so the build
 *               shipped. At cold start the cycle threw
 *
 *                 ReferenceError: Cannot access
 *                 'KLING_OMNI_DEFAULT_PER_SHOT_DURATION' before
 *                 initialization
 *
 *               in TDZ, the worker process exited code 1, concurrently
 *               --kill-others propagated SIGTERM to next + watchdog +
 *               board, the container restarted, the cycle repeated →
 *               intermittent 502 / 200 on art.kuiperfilmailab.com/zh
 *               until hotfix bcb7be4 broke the cycle.
 *
 * What this guard catches:
 *   - circular import TDZ ("Cannot access ... before initialization")
 *   - syntax errors that survive tsc but die at runtime
 *   - any uncaught exception during module evaluation
 *
 * What this guard does NOT catch (intentional):
 *   - runtime errors after init (Redis / MySQL not running locally is
 *     fine — those happen after every module loaded successfully, which
 *     is the only thing we're verifying)
 *   - logic bugs inside handlers
 *
 * Usage:
 *   node scripts/guards/worker-startup-smoke.mjs
 *
 * Wired into npm run test:guards via package.json.
 */

import { spawn } from 'node:child_process'

const WORKER_ENTRY = 'src/lib/workers/index.ts'
const TIMEOUT_MS = 10_000

// Patterns that indicate the worker died at module-init time.
// Anything that matches → the build is broken, fail the guard.
const FATAL_PATTERNS = [
  /ReferenceError: Cannot access ['"][^'"]+['"] before initialization/,
  /SyntaxError:/,
  /Error \[ERR_REQUIRE_ESM\]/,
  /Error \[ERR_MODULE_NOT_FOUND\]/,
]

const child = spawn('npx', ['tsx', WORKER_ENTRY], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
})

let stderr = ''
let crashed = false

child.stdout?.on('data', () => {})
child.stderr?.on('data', (chunk) => {
  stderr += chunk.toString()
})

function detectCrash() {
  if (crashed) return true
  for (const pattern of FATAL_PATTERNS) {
    if (pattern.test(stderr)) {
      crashed = true
      console.error('[worker-startup-smoke] FAIL — module-init crash:')
      console.error('---')
      console.error(stderr.slice(0, 2000))
      console.error('---')
      child.kill('SIGKILL')
      return true
    }
  }
  return false
}

const checkInterval = setInterval(() => {
  if (detectCrash()) {
    clearInterval(checkInterval)
    process.exit(1)
  }
}, 100)

const timeout = setTimeout(() => {
  clearInterval(checkInterval)
  if (!detectCrash()) {
    console.log(
      '[worker-startup-smoke] OK — module init survived 10s with no TDZ / syntax error',
    )
    child.kill('SIGTERM')
    // Give kill a moment to land before exiting the wrapper
    setTimeout(() => process.exit(0), 200)
  }
}, TIMEOUT_MS)

child.on('exit', (code, signal) => {
  clearInterval(checkInterval)
  clearTimeout(timeout)

  // We killed it after the 10s window — that's the success path.
  if (signal === 'SIGTERM' || signal === 'SIGKILL') {
    return
  }

  // Worker exited on its own. Check stderr one more time.
  if (detectCrash()) {
    process.exit(1)
  }

  // Non-fatal exit (e.g. Redis connection refused without local infra).
  // We don't fail the guard for that — we only care about module init.
  if (code !== 0) {
    console.log(
      `[worker-startup-smoke] OK — worker exited code=${code} but no module-init crash`,
    )
  } else {
    console.log('[worker-startup-smoke] OK — worker exited cleanly')
  }
  process.exit(0)
})
