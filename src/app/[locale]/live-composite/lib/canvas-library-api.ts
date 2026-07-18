/**
 * Live Composite — canvas asset library client (Feature: 存入資產庫).
 *
 * listUserCanvases reads GET /api/canvas (the `resources` list is already
 * newest-first). createCanvasLibraryAsset posts the strict
 * canvasAssetCreateSchema payload to /api/canvas/assets. Known failure
 * codes are translated into user-facing Traditional Chinese; unknown ones
 * keep the server message so nothing fails silently.
 */
import type { CanvasAssetCreateInput } from '@/lib/canvas/canvas-assets-contract'

export interface CanvasSummary {
  id: string
  title: string
  updatedAt: string
}

const ASSET_ERROR_MESSAGES: Record<string, string> = {
  CANVAS_NOT_FOUND: '找不到目標畫布，請重新整理畫布清單',
  CANVAS_ASSET_WRITE_DENIED: '你沒有這個畫布的寫入權限',
  CANVAS_WORKSPACE_ACCESS_DENIED: '你沒有這個工作區的存取權限',
  FORBIDDEN: '沒有權限寫入資產庫（需要 editor 權限）',
  UNAUTHORIZED: '登入已失效，請重新登入',
  INSUFFICIENT_BALANCE: '帳戶額度不足，無法寫入資產庫',
}

function extractError(payload: Record<string, unknown>, status: number, fallback: string): Error {
  const errorRecord = payload.error && typeof payload.error === 'object'
    ? (payload.error as Record<string, unknown>)
    : {}
  const detailCode = (errorRecord.details as Record<string, unknown> | undefined)?.code
  const code = [detailCode, errorRecord.code]
    .find((value): value is string => typeof value === 'string' && value.length > 0)
  if (code && ASSET_ERROR_MESSAGES[code]) return new Error(ASSET_ERROR_MESSAGES[code])
  const message = typeof errorRecord.message === 'string' && errorRecord.message ? errorRecord.message : null
  return new Error(message ? `${fallback}（${message}）` : `${fallback}（HTTP ${status}）`)
}

export async function listUserCanvases(): Promise<CanvasSummary[]> {
  let response: Response
  try {
    response = await fetch('/api/canvas', { method: 'GET' })
  } catch (error) {
    throw new Error(`畫布清單載入失敗：${error instanceof Error ? error.message : String(error)}`)
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw extractError(payload, response.status, '畫布清單載入失敗')
  const resources = Array.isArray(payload.resources) ? payload.resources : []
  return resources
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .filter((row) => typeof row.id === 'string' && typeof row.title === 'string')
    .map((row) => ({
      id: row.id as string,
      title: row.title as string,
      updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : '',
    }))
}

export async function createCanvasLibraryAsset(input: CanvasAssetCreateInput): Promise<{ id: string }> {
  let response: Response
  try {
    response = await fetch('/api/canvas/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch (error) {
    throw new Error(`存入資產庫失敗：${error instanceof Error ? error.message : String(error)}`)
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw extractError(payload, response.status, '存入資產庫失敗')
  const asset = payload.asset && typeof payload.asset === 'object' ? payload.asset as Record<string, unknown> : null
  if (!asset || typeof asset.id !== 'string' || !asset.id) {
    throw new Error('存入資產庫失敗（伺服器未回傳資產 ID）')
  }
  return { id: asset.id }
}
