'use client'

/**
 * 存入資產庫 — after an export completes, upload the blob to the caller's
 * playground-ref namespace and register it as a CanvasAsset on a canvas the
 * user picks (canvas selection happens at save time, per the approved flow).
 */
import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { createCanvasLibraryAsset, listUserCanvases, type CanvasSummary } from './lib/canvas-library-api'

const MAX_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024

export interface ExportedAsset {
  blob: Blob
  /** canvasAssetCreateSchema type — exports are plain media, so image|video. */
  assetType: 'image' | 'video'
  /** Upload MIME (must be in the upload-reference allowlist). */
  mimeType: string
  fileName: string
  defaultName: string
}

interface SaveToLibraryDialogProps {
  asset: ExportedAsset
  onClose: () => void
}

export function SaveToLibraryDialog({ asset, onClose }: SaveToLibraryDialogProps) {
  const upload = useUploadPlaygroundReference()
  const [canvases, setCanvases] = useState<CanvasSummary[] | null>(null)
  const [canvasId, setCanvasId] = useState('')
  const [name, setName] = useState(asset.defaultName)
  const [busyMessage, setBusyMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listUserCanvases()
      .then((rows) => {
        if (cancelled) return
        setCanvases(rows)
        if (rows.length > 0) setCanvasId((current) => current || rows[0].id)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '畫布清單載入失敗')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = async () => {
    setError(null)
    setSavedMessage(null)
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('請先輸入資產名稱')
      return
    }
    if (!canvasId) {
      setError('請先選擇要存入的畫布')
      return
    }
    const cap = asset.assetType === 'video' ? MAX_VIDEO_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES
    if (asset.blob.size > cap) {
      setError(`輸出檔案 ${(asset.blob.size / (1024 * 1024)).toFixed(1)}MB 超過 ${Math.round(cap / (1024 * 1024))}MB 上傳上限`)
      return
    }
    try {
      setBusyMessage('正在上傳輸出檔案…')
      const file = new File([asset.blob], asset.fileName, { type: asset.mimeType })
      const uploaded = await upload.mutateAsync({ file, type: asset.assetType })
      setBusyMessage('正在寫入資產庫…')
      await createCanvasLibraryAsset({
        canvasId,
        name: trimmedName.slice(0, 120),
        type: asset.assetType,
        source: { kind: 'storage-key', storageKey: uploaded.key },
      })
      setBusyMessage(null)
      setSavedMessage('已存入資產庫。')
    } catch (err) {
      setBusyMessage(null)
      setError(err instanceof Error ? err.message : '存入資產庫失敗')
    }
  }

  const busy = busyMessage !== null

  return (
    <div role="dialog" aria-label="存入資產庫" className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-stone-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-stone-100">
            <AppIcon name="bookmark" className="h-4 w-4 text-cyan-300" />存入資產庫
          </div>
          <button type="button" aria-label="關閉存入資產庫視窗" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-stone-500 hover:bg-white/10 hover:text-white">
            ✕
          </button>
        </div>

        <label className="mt-4 block text-xs text-stone-400">
          資產名稱
          <input
            aria-label="資產名稱"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-sm text-stone-200 focus:border-cyan-400/50 focus:outline-none disabled:opacity-40"
          />
        </label>

        <label className="mt-3 block text-xs text-stone-400">
          目標畫布
          <select
            aria-label="目標畫布"
            value={canvasId}
            disabled={busy || canvases === null}
            onChange={(event) => setCanvasId(event.target.value)}
            className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-black/30 px-2 text-sm text-stone-200 focus:border-cyan-400/50 focus:outline-none disabled:opacity-40"
          >
            {canvases === null ? <option value="">載入畫布清單中…</option> : null}
            {canvases !== null && canvases.length === 0 ? <option value="">（沒有可用的畫布，請先建立畫布）</option> : null}
            {(canvases ?? []).map((canvas) => (
              <option key={canvas.id} value={canvas.id}>{canvas.title}</option>
            ))}
          </select>
        </label>

        {busy ? <p role="status" className="mt-3 text-xs text-cyan-300">{busyMessage}</p> : null}
        {error ? <p role="alert" className="mt-3 text-xs leading-5 text-red-300">{error}</p> : null}
        {savedMessage ? <p role="status" className="mt-3 text-xs text-emerald-300">{savedMessage}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-stone-300 hover:bg-white/[0.06] disabled:opacity-40">
            {savedMessage ? '完成' : '取消'}
          </button>
          <button
            type="button"
            disabled={busy || canvases === null || canvases.length === 0 || Boolean(savedMessage)}
            onClick={() => void save()}
            className="rounded-lg bg-cyan-400 px-3 py-2 text-sm font-medium text-stone-950 hover:bg-cyan-300 disabled:opacity-40"
          >
            存入資產庫
          </button>
        </div>
      </div>
    </div>
  )
}
