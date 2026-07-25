const REFERENCE_DURATION_PROBE_ERROR = 'SEEDANCE_REFERENCE_PROBE_DURATION_INVALID'

export function formatDepthRebuildTerminalError(
  rawMessage: string | null | undefined,
  runId: string,
): string {
  const message = rawMessage?.trim() ?? ''
  if (message.includes(REFERENCE_DURATION_PROBE_ERROR)) {
    return '系統無法讀取深度影片的秒數，已在送往 AtlasCloud 前停止。請清除失敗任務後重新送出；若仍失敗，請重新產生深度影片。'
  }
  if (message) return `深度重建執行失敗：${message}`
  return `深度重建執行失敗（任務 ${runId}）`
}
