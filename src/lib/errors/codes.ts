export const ERROR_CATEGORY = {
  AUTH: 'AUTH',
  BILLING: 'BILLING',
  CONTENT: 'CONTENT',
  PROVIDER: 'PROVIDER',
  SYSTEM: 'SYSTEM',
  VALIDATION: 'VALIDATION',
} as const

export type ErrorCategory = (typeof ERROR_CATEGORY)[keyof typeof ERROR_CATEGORY]

export const ERROR_CATALOG = {
  UNAUTHORIZED: {
    httpStatus: 401,
    retryable: false,
    category: ERROR_CATEGORY.AUTH,
    userMessageKey: 'errors.UNAUTHORIZED',
    defaultMessage: 'Unauthorized',
  },
  FORBIDDEN: {
    httpStatus: 403,
    retryable: false,
    category: ERROR_CATEGORY.AUTH,
    userMessageKey: 'errors.FORBIDDEN',
    defaultMessage: 'Forbidden',
  },
  NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.NOT_FOUND',
    defaultMessage: 'Resource not found',
  },
  INVALID_PARAMS: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.INVALID_PARAMS',
    defaultMessage: 'Invalid parameters',
  },
  MISSING_CONFIG: {
    httpStatus: 400,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.MISSING_CONFIG',
    defaultMessage: 'Missing required configuration',
  },
  // 2026-05-21 — surfaced when the user clicks "分析" on an episode
  // (STEP 03 storyboard) before STEP 01 script + chunking has run.
  // Pre-fix: the worker threw a bare Error('No clips found') which got
  // generic-wrapped by V2's error scrubber into "系统内部错误，请稍后重
  // 试" — misleading because retry never helps until the user adds a
  // script. With this code, the V2 client routes to the targeted
  // friendly message pointing them to the script step.
  EPISODE_NO_CLIPS: {
    httpStatus: 422,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.EPISODE_NO_CLIPS',
    defaultMessage: 'Episode has no clips yet — add a script first',
  },
  // 2026-05-21 — surfaced when the user clicks 重新分析 / submit again
  // while a previous task (clips_build / script_to_storyboard_run /
  // similar) is still processing. Pre-fix this fell into generic
  // CONFLICT ("当前状态冲突，请刷新后重试") which sent users into a
  // refresh loop that never helped — the right action is just to
  // wait a few seconds for the running task to finish.
  TASK_STILL_PROCESSING: {
    httpStatus: 409,
    retryable: true,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.TASK_STILL_PROCESSING',
    defaultMessage: 'Previous task still processing — please wait a few seconds',
  },
  CONFLICT: {
    httpStatus: 409,
    retryable: false,
    category: ERROR_CATEGORY.VALIDATION,
    userMessageKey: 'errors.CONFLICT',
    defaultMessage: 'Conflict',
  },
  TASK_NOT_READY: {
    httpStatus: 202,
    retryable: true,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.TASK_NOT_READY',
    defaultMessage: 'Task is not ready',
  },
  NO_RESULT: {
    httpStatus: 404,
    retryable: false,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.NO_RESULT',
    defaultMessage: 'No task result',
  },
  RATE_LIMIT: {
    httpStatus: 429,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.RATE_LIMIT',
    defaultMessage: 'Rate limit exceeded',
  },
  QUOTA_EXCEEDED: {
    httpStatus: 429,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.QUOTA_EXCEEDED',
    defaultMessage: 'Quota exceeded',
  },
  EXTERNAL_ERROR: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.EXTERNAL_ERROR',
    defaultMessage: 'External service failed',
  },
  NETWORK_ERROR: {
    httpStatus: 502,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.NETWORK_ERROR',
    defaultMessage: 'Network request failed',
  },
  INSUFFICIENT_BALANCE: {
    httpStatus: 402,
    retryable: false,
    category: ERROR_CATEGORY.BILLING,
    userMessageKey: 'errors.INSUFFICIENT_BALANCE',
    defaultMessage: 'Insufficient balance',
  },
  SENSITIVE_CONTENT: {
    httpStatus: 422,
    retryable: false,
    category: ERROR_CATEGORY.CONTENT,
    userMessageKey: 'errors.SENSITIVE_CONTENT',
    defaultMessage: 'Sensitive content detected',
  },
  // 2026-05-23 — 火山方舟 Seedance 2.0 real-person face filter rejects
  // raw URLs of photoreal AI portraits. The escape hatch is to register
  // the image via the asset API (CreateAsset → asset://<Id>). Surfaces
  // when user picks ark::doubao-seedance-2-0-* without pre-registering
  // refs. Sub-code of SENSITIVE_CONTENT but with a register-aware
  // friendly message that points the user to the 「报备火山」 button.
  ARK_FACE_DETECTED: {
    httpStatus: 422,
    retryable: false,
    category: ERROR_CATEGORY.CONTENT,
    userMessageKey: 'errors.ARK_FACE_DETECTED',
    defaultMessage: 'ARK rejected the input image (face detected) — register via asset API first',
  },
  // 2026-05-23 — 火山方舟 asset API requires Seedance 2.0 高级创作权益包
  // subscription before CreateAssetGroup / CreateAsset / GetAsset accept
  // any call. Returned as 403 SubscriptionRequired by Volcengine; we
  // translate to a friendly "请到火山控制台购买权益包" message rather
  // than letting the user see a raw API error.
  ARK_SUBSCRIPTION_REQUIRED: {
    httpStatus: 402,
    retryable: false,
    category: ERROR_CATEGORY.BILLING,
    userMessageKey: 'errors.ARK_SUBSCRIPTION_REQUIRED',
    defaultMessage: 'ARK asset API requires Seedance 2.0 advanced/premium subscription',
  },
  GENERATION_TIMEOUT: {
    httpStatus: 504,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.GENERATION_TIMEOUT',
    defaultMessage: 'Generation timed out',
  },
  GENERATION_FAILED: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.PROVIDER,
    userMessageKey: 'errors.GENERATION_FAILED',
    defaultMessage: 'Generation failed',
  },
  WATCHDOG_TIMEOUT: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.WATCHDOG_TIMEOUT',
    defaultMessage: 'Task heartbeat timeout',
  },
  WORKER_EXECUTION_ERROR: {
    httpStatus: 500,
    retryable: true,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.WORKER_EXECUTION_ERROR',
    defaultMessage: 'Worker execution failed',
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    retryable: false,
    category: ERROR_CATEGORY.SYSTEM,
    userMessageKey: 'errors.INTERNAL_ERROR',
    defaultMessage: 'Internal server error',
  },
} as const

export type UnifiedErrorCode = keyof typeof ERROR_CATALOG

export const DEFAULT_ERROR_CODE: UnifiedErrorCode = 'INTERNAL_ERROR'

export const LEGACY_ERROR_CODE_ALIASES: Record<string, UnifiedErrorCode> = {
  OPERATION_FAILED: 'INTERNAL_ERROR',
}

export function isKnownErrorCode(code: unknown): code is UnifiedErrorCode {
  return typeof code === 'string' && code in ERROR_CATALOG
}

export function resolveUnifiedErrorCode(code: unknown): UnifiedErrorCode | null {
  if (isKnownErrorCode(code)) return code
  if (typeof code !== 'string') return null
  const normalized = code.trim().toUpperCase()
  return LEGACY_ERROR_CODE_ALIASES[normalized] || null
}

export function getErrorSpec(code: UnifiedErrorCode) {
  return ERROR_CATALOG[code]
}
