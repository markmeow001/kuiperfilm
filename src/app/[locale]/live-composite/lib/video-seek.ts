export interface SeekVideoGuardOptions {
  signal: AbortSignal
  timeoutMs: number
  createTimeoutError: (timeoutSeconds: number) => Error
  createSeekFailedError: () => Error
  createAbortError: () => Error
}

/**
 * Seeks a video element with explicit failure modes: rejects when the caller
 * aborts, when the element reports an error, or when the browser never fires
 * `seeked` within `timeoutMs` (e.g. the source was swapped mid-seek). Callers
 * provide their own error factories so recorder/analysis flows keep their
 * context-specific messages.
 */
export function seekVideoGuarded(
  video: HTMLVideoElement,
  time: number,
  options: SeekVideoGuardOptions,
): Promise<void> {
  const { signal, timeoutMs, createTimeoutError, createSeekFailedError, createAbortError } = options
  if (signal.aborted) return Promise.reject(createAbortError())
  if (video.readyState >= 2 && Math.abs(video.currentTime - time) <= 0.01) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup()
      reject(createTimeoutError(Math.round(timeoutMs / 1_000)))
    }, timeoutMs)
    const cleanup = () => {
      globalThis.clearTimeout(timeout)
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
      signal.removeEventListener('abort', handleAbort)
    }
    const handleSeeked = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(createSeekFailedError())
    }
    const handleAbort = () => {
      cleanup()
      reject(createAbortError())
    }
    video.addEventListener('seeked', handleSeeked, { once: true })
    video.addEventListener('error', handleError, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    video.currentTime = time
  })
}
