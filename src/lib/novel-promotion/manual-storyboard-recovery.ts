function readHttpStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object'
    && error !== null
    && 'status' in error
    && typeof error.status === 'number'
  ) {
    return error.status
  }
  return undefined
}

/** Network failures and 5xx responses may have committed before the client
 * lost the response. They must replay the same draft/key; explicit 4xx
 * responses are known rejections and may start a new attempt. */
export function isManualStoryboardOutcomeUnknown(error: unknown): boolean {
  const status = readHttpStatus(error)
  return status === undefined || status >= 500
}

/** A retained idempotency key is namespaced to its original episode. */
export function manualStoryboardRecoveryMatchesEpisode(
  recoveryEpisodeId: string | null,
  currentEpisodeId: string,
): boolean {
  return recoveryEpisodeId === null || recoveryEpisodeId === currentEpisodeId
}
