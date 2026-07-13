'use client'

/**
 * Full-screen preview for a canvas result (放大). Lightweight sibling of the
 * playground ResultLightbox — canvas nodes don't have a PlaygroundController,
 * so this takes just a url + kind and renders media centered with Esc / backdrop
 * close and an in-frame 下载. Portaled to <body> so it escapes React Flow's
 * transformed / clipped canvas layer.
 */
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { canvasDownloadHref } from '../lib/canvas-download'

interface CanvasMediaLightboxProps {
  url: string
  kind: 'image' | 'video'
  filename?: string
  onClose: () => void
}

export function CanvasMediaLightbox({ url, kind, filename, onClose }: CanvasMediaLightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <button
        type="button"
        aria-label="关闭 (Esc)"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-md border border-stone-700 text-[16px] text-stone-300 hover:border-stone-500 hover:text-white"
      >
        ✕
      </button>
      <div className="relative max-h-[92vh] max-w-[94vw]" onMouseDown={(e) => e.stopPropagation()}>
        {kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="预览" className="max-h-[92vh] max-w-[94vw] object-contain" />
        ) : (
          <video src={url} controls autoPlay playsInline className="max-h-[92vh] max-w-[94vw] object-contain" />
        )}
        <a
          href={canvasDownloadHref(url, filename)}
          download
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute bottom-3 right-3 rounded-md border border-stone-700 bg-black/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-stone-200 hover:border-stone-500 hover:text-white"
        >
          ↓ 下载
        </a>
      </div>
    </div>,
    document.body,
  )
}
