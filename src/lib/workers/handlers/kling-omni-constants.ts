/**
 * Kling Omni B-path duration / shot-count constants.
 *
 * Carved out of multi-shot-video-b-path.ts on 2026-05-03 to break a
 * production-fatal circular import:
 *
 *   speech-duration-estimator.ts (`PER_PANEL_MIN_SEC = KLING_OMNI_DEFAULT_PER_SHOT_DURATION` at top level)
 *     ↑ imports
 *   multi-shot-video-b-path.ts (declares the const + imports buildDialogueDrivenDurations from estimator)
 *
 * Both modules ran at import time, and the consumer landed on the
 * declaration mid-initialization → ReferenceError: Cannot access
 * 'KLING_OMNI_DEFAULT_PER_SHOT_DURATION' before initialization, which
 * crashed the worker process at startup, which `concurrently
 * --kill-others` propagated to next/watchdog/board → 502 prod outage.
 *
 * Fix: pure-data leaf module that depends on nothing. Both consumers
 * import from here. multi-shot-video-b-path.ts re-exports for any
 * downstream caller that imports the constants from the old path.
 */
export const KLING_OMNI_MAX_TOTAL_DURATION = 15
export const KLING_OMNI_DEFAULT_PER_SHOT_DURATION = 3
export const KLING_OMNI_MAX_SHOTS = 6
