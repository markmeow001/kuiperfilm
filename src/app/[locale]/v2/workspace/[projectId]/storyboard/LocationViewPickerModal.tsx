'use client'

/**
 * Phase 12.5.4 commit 3 — location view picker for the multi-shot
 * chip rail.
 *
 * The user clicks a scene chip and this modal lists every
 * LocationImage with thumbnail + viewName label (`viewName ?? '主視角'`),
 * letting them swap to a different camera angle / time-of-day /
 * lighting variant for the next regenerate. Picks set the
 * `viewName` field of the locationOverrides entry.
 *
 * Selection is returned via `onSelect(viewName | null)` — `null`
 * reverts to the worker's default (main view, imageIndex=0).
 */

import { useEffect } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface LocationImageLike {
  id: string
  imageIndex?: number
  description?: string | null
  imageUrl?: string | null
  // schema field — assets API returns it but the project Location
  // type doesn't currently declare it, so we read it loosely.
  viewName?: string | null
}

interface LocationLike {
  id: string
  name: string
  images?: LocationImageLike[]
}

interface LocationViewPickerModalProps {
  open: boolean
  onClose: () => void
  location: LocationLike | null
  currentViewName: string | null
  onSelect: (viewName: string | null) => void
}

export function LocationViewPickerModal({
  open,
  onClose,
  location,
  currentViewName,
  onSelect,
}: LocationViewPickerModalProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !location) return null
  const images = location.images ?? []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-sm border border-amber-900/30 bg-stone-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-amber-900/20 bg-stone-950/40 px-5 py-3">
          <div>
            <div className="font-mono text-[14px] uppercase tracking-wider text-amber-500/70">
              換視角
            </div>
            <div className="mt-0.5 font-fraunces text-base italic text-amber-300">
              {location.name}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-500 transition-colors hover:text-stone-200"
          >
            <AppIcon name="close" className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {images.length === 0 ? (
            <p className="font-serif-cn text-sm italic text-stone-500">
              這個場景目前只有主視角(沒有額外的 view)。先到「主體 → 場景」加入新視角。
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.map((img, idx) => {
                const view = img.viewName ?? null
                const label = view || (idx === 0 ? '主視角' : `視角 ${idx + 1}`)
                const isCurrent = view === currentViewName
                  || (currentViewName === null && idx === 0)
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => {
                      // imageIndex=0 ↔ null viewName (default main view)
                      onSelect(idx === 0 && !view ? null : view)
                      onClose()
                    }}
                    className={`group relative overflow-hidden rounded-sm border text-left transition-all ${
                      isCurrent
                        ? 'border-amber-500/60 ring-2 ring-amber-500/30'
                        : 'border-stone-800 hover:border-amber-500/40'
                    }`}
                  >
                    <div className="relative aspect-video overflow-hidden bg-stone-950">
                      {img.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={img.imageUrl}
                          alt={label}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-stone-600">
                          <AppIcon name="image" className="h-6 w-6" />
                        </div>
                      )}
                      {isCurrent ? (
                        <div className="absolute right-1.5 top-1.5 rounded bg-amber-500/90 px-1.5 py-0.5 font-mono text-[12px] tracking-wider text-stone-950">
                          當前
                        </div>
                      ) : null}
                    </div>
                    <div className="bg-stone-900/80 px-2 py-1.5">
                      <div className="font-serif-cn text-xs text-stone-200">{label}</div>
                      {img.description ? (
                        <div className="mt-0.5 line-clamp-1 font-mono text-[12px] tracking-wider text-stone-500">
                          {img.description}
                        </div>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-amber-900/20 bg-stone-950/40 px-5 py-2.5">
          <button
            type="button"
            onClick={() => {
              onSelect(null)
              onClose()
            }}
            className="font-mono text-[14px] tracking-wider text-stone-500 transition-colors hover:text-amber-400"
          >
            還原預設(主視角)
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-stone-800 px-3 py-1 font-mono text-[14px] tracking-wider text-stone-400 transition-colors hover:border-stone-700 hover:text-stone-200"
          >
            取消
          </button>
        </footer>
      </div>
    </div>
  )
}
