'use client'

/**
 * 存入資產庫 — after an export completes, upload the blob to the caller's
 * playground-ref namespace and register it as a CanvasAsset on a canvas the
 * user picks (canvas selection happens at save time, per the approved flow).
 */
import { useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { Modal } from '@/components/v2/Modal'
import { useUploadPlaygroundReference } from '@/lib/query/mutations/playground-mutations'
import { createCanvasLibraryAsset, listUserCanvases, type CanvasSummary } from './lib/canvas-library-api'
import { buildCanvasImportHref } from '../canvas/lib/canvas-import-intent'
import styles from './LiveCompositeShell.module.css'

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
  locale: string
  onClose: () => void
}

export function SaveToLibraryDialog({ asset, locale, onClose }: SaveToLibraryDialogProps) {
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

  const save = async (openInCanvas: boolean) => {
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
      const created = await createCanvasLibraryAsset({
        canvasId,
        name: trimmedName.slice(0, 120),
        type: asset.assetType,
        source: { kind: 'storage-key', storageKey: uploaded.key },
      })
      setBusyMessage(null)
      if (openInCanvas) {
        window.location.assign(buildCanvasImportHref(locale, { canvasId, assetId: created.id }))
        return
      }
      setSavedMessage('已存入資產庫。')
    } catch (err) {
      setBusyMessage(null)
      setError(err instanceof Error ? err.message : '存入資產庫失敗')
    }
  }

  const busy = busyMessage !== null

  return (
    <Modal open onClose={onClose} size="md" className={styles.libraryDialog}>
      <Modal.Header
        heading={(
          <span className="flex items-center gap-2">
            <AppIcon name="bookmark" className="h-4 w-4 text-cyan-300" />
            存入資產庫
          </span>
        )}
        subtitle="選擇畫布並保存這次輸出；只有按下保存按鈕才會上傳。"
        onClose={onClose}
        closeAriaLabel="關閉存入資產庫視窗"
      />
      <Modal.Body className={styles.libraryBody}>
        <label className={styles.libraryField}>
          資產名稱
          <input
            aria-label="資產名稱"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            className={styles.libraryControl}
          />
        </label>

        <label className={`${styles.libraryField} mt-3`}>
          目標畫布
          <select
            aria-label="目標畫布"
            value={canvasId}
            disabled={busy || canvases === null}
            onChange={(event) => setCanvasId(event.target.value)}
            className={styles.libraryControl}
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
      </Modal.Body>
      <Modal.Footer>
        <div className={styles.libraryActions} data-live-composite-library-actions>
          <button type="button" disabled={busy} onClick={onClose} className={styles.librarySecondary}>
            {savedMessage ? '完成' : '取消'}
          </button>
          <button
            type="button"
            disabled={busy || canvases === null || canvases.length === 0 || Boolean(savedMessage)}
            onClick={() => void save(false)}
            className={styles.librarySecondary}
          >
            存入資產庫
          </button>
          <button
            type="button"
            disabled={busy || canvases === null || canvases.length === 0 || Boolean(savedMessage)}
            onClick={() => void save(true)}
            className={styles.libraryPrimary}
          >
            存入並在畫布建立節點
          </button>
        </div>
      </Modal.Footer>
    </Modal>
  )
}
