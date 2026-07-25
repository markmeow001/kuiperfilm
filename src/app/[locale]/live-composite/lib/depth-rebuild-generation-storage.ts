export interface PendingDepthRebuildGeneration {
  requestKey: string
  runId?: string
}

export const DEPTH_REBUILD_STORAGE_REQUIRED_MESSAGE =
  '瀏覽器無法安全保存這次付費任務，已停止送出；請確認未停用工作階段儲存空間後重試'

export function depthRebuildGenerationStorageKey(scopeKey: string): string {
  return `kuiper:depth-rebuild-generation:${encodeURIComponent(scopeKey)}`
}

export function readPendingDepthRebuildGeneration(
  key: string,
): PendingDepthRebuildGeneration | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (
      typeof parsed.requestKey !== 'string'
      || !parsed.requestKey.trim()
      || (
        parsed.runId !== undefined
        && (typeof parsed.runId !== 'string' || !parsed.runId.trim())
      )
    ) {
      window.sessionStorage.removeItem(key)
      return null
    }
    return {
      requestKey: parsed.requestKey,
      ...(typeof parsed.runId === 'string' ? { runId: parsed.runId } : {}),
    }
  } catch {
    return null
  }
}

export function writePendingDepthRebuildGeneration(
  key: string,
  pending: PendingDepthRebuildGeneration,
): boolean {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(pending))
    return true
  } catch {
    return false
  }
}

export function clearPendingDepthRebuildGeneration(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // The paid request is already protected by its persisted request key.
  }
}
